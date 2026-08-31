import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

/** URL del backend en la nube (la misma que usa el frontend en producción). */
export const CLOUD_API_URL =
  process.env.GYMSCORE_CLOUD_URL || 'https://gymnastic-score-5a4d6aed40d8.herokuapp.com';

/** Puerto en el que sirve el backend local (UI + API + socket.io en un solo origen). */
export const LOCAL_PORT = 4000;
export const LOCAL_API_URL = `http://127.0.0.1:${LOCAL_PORT}`;

// El mongod local usa un puerto dinámico (lo elige mongodb-memory-server) para
// evitar choques con instancias zombie de sesiones anteriores. La URI real se
// arma en runtime con mongo.getUri().

/** Nombre del servicio mDNS → http://gymscore.local:4000 */
export const MDNS_NAME = 'gymscore';

/** En dev, resources/ está en el repo; empaquetada, en process.resourcesPath. */
export function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..', 'resources');
}

export function backendEntry(): string {
  return path.join(resourcesDir(), 'backend', 'dist', 'index.js');
}

export function frontendBuildDir(): string {
  return path.join(resourcesDir(), 'frontend');
}

/** Carpeta persistente para los datos del mongod local (sobrevive reinicios). */
export function mongoDataDir(): string {
  const dir = path.join(app.getPath('userData'), 'offline-data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Secreto local, generado una vez por instalación y persistido. Sirve para:
 *  - JWT_SECRET del backend local (los jueces re-loguean localmente, no necesita
 *    coincidir con la nube)
 *  - OFFLINE_LOCAL_SECRET que protege /api/offline-local/*
 */
export function localSecret(): string {
  const file = path.join(app.getPath('userData'), 'local-secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}
