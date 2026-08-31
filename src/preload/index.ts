import { contextBridge, ipcRenderer } from 'electron';

const invoke = (ch: string, ...args: any[]) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('api', {
  getConfig: () => invoke('config:get'),
  makeQr: (text: string) => invoke('qr:make', text),
  getStatus: () => invoke('status:get'),
  startServing: () => invoke('serve:start'),
  stopServing: () => invoke('serve:stop'),
  login: (u: string, p: string) => invoke('cloud:login', u, p),
  listInstitutions: (token: string) => invoke('cloud:institutions', token),
  prepare: (token: string, id: string, deviceLabel?: string) => invoke('cloud:prepare', token, id, deviceLabel),
  sync: (token: string, id: string, finalize: boolean) => invoke('cloud:sync', token, id, finalize),
  unlock: (token: string, id: string) => invoke('cloud:unlock', token, id),
});
