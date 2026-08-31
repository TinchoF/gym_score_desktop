/**
 * Ciclo de vida del "stack local": mongod embebido + backend GymScore en
 * OFFLINE_MODE + anuncio mDNS. Ver docs/MODO_SEDE.md en el repo del frontend.
 *
 * Modelo:
 *  - `ensureBackend()`  — deja el stack (mongo + backend) arriba y SANO. Si el
 *    backend murió o no llega a su mongo, reinicia todo limpio. Idempotente.
 *  - `startAdvertising()` / `stopAdvertising()` — mDNS + powerSaveBlocker (botón SERVIR).
 *  - `shutdownAll()` — todo abajo, al cerrar la app.
 */
import { fork, ChildProcess, execSync } from 'child_process';
import fs from 'fs';
import { powerSaveBlocker } from 'electron';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Bonjour } from 'bonjour-service';
import {
  backendEntry,
  frontendBuildDir,
  mongoDataDir,
  localSecret,
  LOCAL_PORT,
  LOCAL_API_URL,
  MDNS_NAME,
} from './config';

let mongo: MongoMemoryServer | null = null;
let backend: ChildProcess | null = null;
let bonjour: Bonjour | null = null;
let powerBlockerId: number | null = null;
let starting: Promise<void> | null = null;

export interface StackStatus {
  backendUp: boolean;
  mongoUp: boolean;
  advertising: boolean;
  url: string;
  mdnsUrl: string;
}

export function getStatus(): StackStatus {
  return {
    backendUp: !!backend && !backend.killed,
    mongoUp: !!mongo,
    advertising: !!bonjour,
    url: LOCAL_API_URL,
    mdnsUrl: `http://${MDNS_NAME}.local:${LOCAL_PORT}`,
  };
}

/** El backend responde Y puede consultar su base (404, no 500). */
async function isHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${LOCAL_API_URL}/api/institution/by-code/__healthcheck__`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.status === 404; // ruta ok + query a mongo ok
  } catch {
    return false;
  }
}

async function waitForHealth(timeoutMs = 120000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isHealthy()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('El backend local no arrancó bien (no llega a su base de datos)');
}

async function teardown(): Promise<void> {
  if (backend) {
    try { backend.kill('SIGTERM'); } catch { /* noop */ }
    backend = null;
  }
  if (mongo) {
    try { await mongo.stop(); } catch { /* noop */ }
    mongo = null;
  }
  // Matar cualquier mongod zombie apuntando a NUESTRO dbPath (sesiones anteriores).
  try {
    execSync(`pkill -f ${JSON.stringify(mongoDataDir())}`, { stdio: 'ignore' });
  } catch { /* no había ninguno */ }
}

const MONGOD_VERSION = '8.2.6';

/**
 * Arranca mongod contra dbPath. Si los archivos de datos son de OTRA versión de
 * mongod (típicamente porque una corrida anterior, antes de fijar MONGOD_VERSION,
 * usó "la última" versión resuelta en ese momento — que puede variar), mongod
 * rechaza arrancar con exit code 62 (EXIT_NEED_UPGRADE) y mongodb-memory-server lo
 * reporta como "Instance closed unexpectedly with code 62". dbPath acá es solo
 * caché local de trabajo (el contenido real vive en la nube / se repuebla al
 * "Descargar y poner en modo sede"), así que ante ese fallo puntual la recuperación
 * segura es borrar dbPath y reintentar una vez con datos frescos.
 */
async function createMongo(): Promise<MongoMemoryServer> {
  const dbPath = mongoDataDir();
  try {
    return await MongoMemoryServer.create({
      instance: { dbPath, storageEngine: 'wiredTiger' },
      binary: { version: MONGOD_VERSION },
    });
  } catch (err) {
    console.error('[localStack] mongod no arrancó con los datos existentes, reintentando en limpio:', err);
    try {
      fs.rmSync(dbPath, { recursive: true, force: true });
      fs.mkdirSync(dbPath, { recursive: true }); // mongod espera que dbPath YA exista, no lo crea solo
    } catch { /* noop */ }
    return MongoMemoryServer.create({
      instance: { dbPath, storageEngine: 'wiredTiger' },
      binary: { version: MONGOD_VERSION },
    });
  }
}

/** Deja mongo + backend arriba y sano. Reinicia todo si algo está mal. Idempotente. */
export async function ensureBackend(): Promise<void> {
  if (backend && !backend.killed && (await isHealthy())) return;
  if (starting) return starting;

  starting = (async () => {
    await teardown();
    await new Promise((r) => setTimeout(r, 400));

    // Puerto dinámico → sin choques con zombies. dbPath persistente.
    // Versión de mongod FIJADA a propósito: sin esto, mongodb-memory-server resuelve
    // "la última" contra la red en cada llamada, y esa resolución puede cambiar de
    // una corrida a otra — cada cambio de versión vuelve a descargar ~76MB (~1min),
    // aunque ya haya una versión distinta cacheada en ~/.cache/mongodb-binaries.
    // Confirmado en pruebas: dos corridas sin pin cachearon 7.0.24 y 8.2.6 por separado.
    // Con la versión fija, la descarga pasa UNA sola vez por máquina.
    console.log('[localStack] iniciando mongod embebido (puede descargar ~76MB la primera vez en esta laptop)…');
    mongo = await createMongo();
    console.log('[localStack] mongod listo:', mongo.getUri());
    const mongoUri = mongo.getUri('gymscore');

    const secret = localSecret();
    backend = fork(backendEntry(), [], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        OFFLINE_MODE: 'true',
        PORT: String(LOCAL_PORT),
        MONGO_URI: mongoUri,
        JWT_SECRET: secret,
        OFFLINE_LOCAL_SECRET: secret,
        FRONTEND_BUILD_PATH: frontendBuildDir(),
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    backend.stdout?.on('data', (d) => console.log('[backend]', d.toString().trim()));
    backend.stderr?.on('data', (d) => console.error('[backend]', d.toString().trim()));
    backend.on('exit', (code) => {
      console.error('[backend] exited', code);
      backend = null;
    });

    await waitForHealth();
  })();

  try {
    await starting;
  } finally {
    starting = null;
  }
}

/** Prende el anuncio mDNS + evita que la laptop se duerma. Arranca el backend si hace falta. */
export async function startAdvertising(): Promise<StackStatus> {
  await ensureBackend();
  if (!bonjour) {
    bonjour = new Bonjour();
    bonjour.publish({ name: MDNS_NAME, type: 'http', port: LOCAL_PORT, host: `${MDNS_NAME}.local` });
  }
  if (powerBlockerId === null) {
    powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  }
  return getStatus();
}

/** Apaga mDNS + powerSaveBlocker. El backend sigue corriendo (sync, reanudar serve). */
export function stopAdvertising(): StackStatus {
  if (powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId)) {
    powerSaveBlocker.stop(powerBlockerId);
  }
  powerBlockerId = null;
  try {
    bonjour?.unpublishAll();
    bonjour?.destroy();
  } catch {
    /* noop */
  }
  bonjour = null;
  return getStatus();
}

/** Todo abajo. Al cerrar la app. */
export async function shutdownAll(): Promise<void> {
  stopAdvertising();
  await teardown();
}
