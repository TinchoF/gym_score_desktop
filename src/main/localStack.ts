/**
 * Ciclo de vida del "stack local": mongod embebido + backend GymScore en
 * OFFLINE_MODE + anuncio mDNS. Ver docs/MODO_SEDE.md en el repo del frontend.
 *
 * Modelo:
 *  - `ensureBackend()`  — arranca mongo + backend si no están (idempotente). Lo
 *    necesitan "Preparar", "Servir" y "Sincronizar".
 *  - `startAdvertising()` / `stopAdvertising()` — mDNS + powerSaveBlocker. Es lo
 *    que prende/apaga el botón SERVIR. El backend queda corriendo igual.
 *  - `shutdownAll()` — todo, al cerrar la app.
 */
import { fork, ChildProcess } from 'child_process';
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
  LOCAL_MONGO_PORT,
  LOCAL_MONGO_URI,
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

async function waitForHealth(timeoutMs = 25000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${LOCAL_API_URL}/api/institution/by-code/__healthcheck__`);
      if (res.status < 500) return;
    } catch {
      /* todavía no levantó */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('El backend local no respondió a tiempo');
}

/** Arranca mongo + backend si no están corriendo. Idempotente y con lock. */
export async function ensureBackend(): Promise<void> {
  if (backend && !backend.killed) return;
  if (starting) return starting;

  starting = (async () => {
    if (!mongo) {
      mongo = await MongoMemoryServer.create({
        instance: { port: LOCAL_MONGO_PORT, dbPath: mongoDataDir(), storageEngine: 'wiredTiger' },
      });
    }

    const secret = localSecret();
    backend = fork(backendEntry(), [], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        OFFLINE_MODE: 'true',
        PORT: String(LOCAL_PORT),
        MONGO_URI: LOCAL_MONGO_URI,
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
  if (backend) {
    backend.kill('SIGTERM');
    backend = null;
  }
  if (mongo) {
    await mongo.stop();
    mongo = null;
  }
}
