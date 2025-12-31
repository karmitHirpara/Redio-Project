// electron/main.cjs
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let backendPort = null;

async function startBackend() {
  const serverPath = path.join(__dirname, '..', 'server', 'server.js');
  const server = await import(serverPath);
  backendPort = server.backendPort;
}

ipcMain.handle('get-backend-port', () => backendPort);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), 
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!app.isPackaged) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(async () => {
  await startBackend();
  createWindow();
});
