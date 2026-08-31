/**
 * La app empaquetada no tiene terminal visible — sin esto, `console.log` no se
 * ve en ningún lado y diagnosticar algo como "el login tarda 30s" requiere
 * reconstruir a ciegas. Esto espeja todo console.log/console.error a un archivo
 * en la carpeta de datos de la app, que se puede abrir desde la UI.
 */
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

let logPath = '';

export function initFileLogging(): void {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    logPath = path.join(dir, 'main.log');
    const stream = fs.createWriteStream(logPath, { flags: 'a' });

    const wrap = (orig: (...a: any[]) => void) => (...args: any[]) => {
      orig(...args);
      try {
        const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
        stream.write(`${new Date().toISOString()} ${line}\n`);
      } catch {
        /* noop */
      }
    };
    // eslint-disable-next-line no-console
    console.log = wrap(console.log.bind(console));
    // eslint-disable-next-line no-console
    console.error = wrap(console.error.bind(console));
    console.log('=== GymScore Modo Sede — inicio ===', new Date().toISOString());
  } catch {
    /* si falla, seguimos sin log a archivo */
  }
}

export function getLogPath(): string {
  return logPath;
}
