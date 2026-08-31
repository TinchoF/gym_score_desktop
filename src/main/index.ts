import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { ensureBackend, startAdvertising, stopAdvertising, shutdownAll, getStatus } from './localStack';
import * as cloud from './cloud';
import QRCode from 'qrcode';
import { saveCreds, loadCreds, clearCreds } from './credentials';
import { CLOUD_API_URL } from './config';

let win: BrowserWindow | null = null;

function createWindow() {
  const preloadPath = path.join(__dirname, '..', 'preload', 'index.js');
  win = new BrowserWindow({
    width: 900,
    height: 680,
    title: 'GymScore — Modo Sede',
    webPreferences: { preload: preloadPath },
  });
  win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));

  // Diagnóstico: reenviar la consola del renderer y los errores de preload al stdout.
  win.webContents.on('preload-error', (_e, p, err) => console.error('[preload-error]', p, err));
  win.webContents.on('console-message', (_e, level, message) =>
    console.log(`[renderer:${level}]`, message),
  );
  if (process.env.GYMSCORE_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(async () => {
  if (process.env.GYMSCORE_SELFTEST === '1') {
    try {
      console.log('[selftest] arrancando backend local…');
      await ensureBackend();
      const res = await fetch(`${getStatus().url}/api/institution/by-code/__x__`);
      console.log('[selftest] backend responde:', res.status, '→ OK');
      const imp = await fetch(`${getStatus().url}/api/offline-local/export?institutionId=x`, {
        headers: { 'x-offline-secret': 'wrong' },
      });
      console.log('[selftest] offline-local protegido:', imp.status, imp.status === 401 ? '→ OK' : '→ MAL');

      // payload grande (~2MB) — no debe dar 413
      const { localSecret } = await import('./config');
      const big = { meta: {}, filler: 'x'.repeat(2_000_000) };
      const large = await fetch(`${getStatus().url}/api/offline-local/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-offline-secret': localSecret() },
        body: JSON.stringify(big),
      });
      console.log('[selftest] import 2MB:', large.status, large.status !== 413 ? '→ OK (no 413)' : '→ MAL (413)');
    } catch (err) {
      console.error('[selftest] FALLÓ:', err);
    } finally {
      await shutdownAll();
      app.exit(0);
    }
    return;
  }
  createWindow();
});

let quitting = false;
app.on('window-all-closed', () => app.quit());
app.on('before-quit', async (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  await shutdownAll();
  app.quit();
});

// --- IPC ---
const handle = <T,>(ch: string, fn: (...a: any[]) => Promise<T> | T) =>
  ipcMain.handle(ch, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err), body: err?.body };
    }
  });

handle('config:get', () => ({ cloudUrl: CLOUD_API_URL }));
handle('qr:make', (text: string) => QRCode.toDataURL(text, { width: 260, margin: 1 }));
handle('status:get', () => getStatus());
handle('serve:start', () => startAdvertising());
handle('serve:stop', () => stopAdvertising());

handle('creds:load', () => loadCreds());
handle('creds:save', (username: string, password: string) => {
  saveCreds({ username, password });
  return true;
});
handle('creds:clear', () => {
  clearCreds();
  return true;
});

handle('cloud:login', async (username: string, password: string, remember?: boolean) => {
  const result = await cloud.login(username, password);
  // solo llegamos acá si el login fue OK
  if (remember) {
    try {
      saveCreds({ username, password });
    } catch {
      /* cifrado del sistema no disponible: seguimos sin guardar */
    }
  } else {
    clearCreds();
  }
  return result;
});
handle('cloud:institutions', (token: string) => cloud.listInstitutions(token));
handle('cloud:prepare', async (token: string, institutionId: string, deviceLabel?: string) => {
  await ensureBackend(); // el import va al backend local — tiene que estar arriba
  return cloud.prepareForOffline(token, institutionId, deviceLabel);
});
handle('cloud:sync', async (token: string, institutionId: string, finalize: boolean) => {
  await ensureBackend(); // el export sale del backend local
  return cloud.syncToCloud(token, institutionId, finalize);
});
handle('cloud:unlock', (token: string, institutionId: string) => cloud.unlockInstitution(token, institutionId));
