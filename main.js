// main.js
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { runScan, getState } from './index.js';

function createWindow() {
  const win = new BrowserWindow({
    width: 1024, height: 768,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', ()=> { if (process.platform!=='darwin') app.quit(); });

// IPC handlers
ipcMain.handle('refresh', async () => {
    BrowserWindow.getAllWindows()[0]
      .webContents.send('log', '🔄 Lancement manuel du scan…');
    const result = await runScan();
    BrowserWindow.getAllWindows()[0]
      .webContents.send('log', '✅ Scan terminé');
    return result;
  });
  
ipcMain.handle('get-state', async () => {
  return getState();   // { pendingFilms, pendingShows, entries, history }
});
