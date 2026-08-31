/**
 * Guarda usuario/contraseña de super-admin cifrados en disco (Keychain de macOS
 * vía safeStorage). Es una herramienta de mesa de control, se asume la laptop
 * bajo control físico del organizador.
 */
import { app, safeStorage } from 'electron';
import path from 'path';
import fs from 'fs';

const file = () => path.join(app.getPath('userData'), 'creds.enc');

export interface Creds {
  username: string;
  password: string;
}

export function saveCreds(creds: Creds): void {
  if (!safeStorage.isEncryptionAvailable()) {
    // fallback sin cifrado: mejor no persistir en claro → no guardamos
    throw new Error('El cifrado del sistema no está disponible; no se guardaron las credenciales');
  }
  const buf = safeStorage.encryptString(JSON.stringify(creds));
  fs.writeFileSync(file(), buf, { mode: 0o600 });
}

export function loadCreds(): Creds | null {
  try {
    const buf = fs.readFileSync(file());
    if (!safeStorage.isEncryptionAvailable()) return null;
    return JSON.parse(safeStorage.decryptString(buf));
  } catch {
    return null;
  }
}

export function clearCreds(): void {
  try {
    fs.unlinkSync(file());
  } catch {
    /* no existía */
  }
}
