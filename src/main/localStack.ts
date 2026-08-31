/**
 * Ciclo de vida del "stack local": mongod embebido + backend GymScore en
 * OFFLINE_MODE + anuncio mDNS. Ver docs/MODO_SEDE.md en el repo del frontend.
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

export interface StackStatus {
  serving: boolean;
  mongoUp: boolean;
  backendUp: boolean;
  url: string;
  mdnsUrl: string;
}

export function getStatus(): StackStatus {
  return {
    serving: !!backend,
    mongoUp: !!mongo,
    backendUp: !!backend && !backend.killed,
    url: LOCAL_API_URL,
    mdnsUrl: `http://${MDNS_NAME}.local:${LOCAL_PORT}`,
  };
}

async function waitForHealth(timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      // el backend responde 404 JSON en rutas desconocidas; con que conteste alcanza
      const res = await fetch(`${LOCAL_API_URL}/api/institution/by-code/__healthcheck__`);
      if (res.status < 500) return;
    } catch {
      /* todavía no levantó */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('El backend local no respondió a tiempo');
}

export async function startLocalStack(): Promise<StackStatus> {
  if (backend) return getStatus();

  // 1. mongod local, persistente
  mongo = await MongoMemoryServer.create({
    instance: { port: LOCAL_MONGO_PORT, dbPath: mongoDataDir(), storageEngine: 'wiredTiger' },
  });

  // 2. backend en OFFLINE_MODE
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

  // 3. mDNS → gymscore.local
  bonjour = new Bonjour();
  bonjour.publish({ name: MDNS_NAME, type: 'http', port: LOCAL_PORT, host: `${MDNS_NAME}.local` });

  // 4. no dejar dormir la laptop mientras sirve
  powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');

  return getStatus();
}

export async function stopLocalStack(): Promise<StackStatus> {
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

  if (backend) {
    backend.kill('SIGTERM');
    backend = null;
  }
  if (mongo) {
    await mongo.stop();
    mongo = null;
  }
  return getStatus();
}
