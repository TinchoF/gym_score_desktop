import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { startLocalStack, stopLocalStack, getStatus } from './localStack';
import * as cloud from './cloud';
import QRCode from 'qrcode';
import { CLOUD_API_URL } from './config';

let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 680,
    title: 'GymScore — Modo Sede',
    webPreferences: { preload: path.join(__dirname, '..', 'preload', 'index.js') },
  });
  win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', async () => {
  await stopLocalStack();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (e) => {
  if (getStatus().serving) {
    e.preventDefault();
    await stopLocalStack();
    app.quit();
  }
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
handle('serve:start', () => startLocalStack());
handle('serve:stop', () => stopLocalStack());

handle('cloud:login', (username: string, password: string) => cloud.login(username, password));
handle('cloud:institutions', (token: string) => cloud.listInstitutions(token));
handle('cloud:prepare', (token: string, institutionId: string, deviceLabel?: string) =>
  cloud.prepareForOffline(token, institutionId, deviceLabel),
);
handle('cloud:sync', (token: string, institutionId: string, finalize: boolean) =>
  cloud.syncToCloud(token, institutionId, finalize),
);
handle('cloud:unlock', (token: string, institutionId: string) => cloud.unlockInstitution(token, institutionId));
