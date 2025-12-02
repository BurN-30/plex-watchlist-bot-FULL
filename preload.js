// preload.js
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  refresh:    () => ipcRenderer.invoke('refresh'),
  getState:   () => ipcRenderer.invoke('get-state'),
  onLog:      (fn) => ipcRenderer.on('log', (_, msg) => fn(msg))
});
