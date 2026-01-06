// electron/main.cjs
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let backendModule = null;

async function startBackend() {
  // Resolve runtime data directories in the per-user application data folder.
  // This ensures that the packaged app never attempts to write into the
  // read-only app.asar bundle.
  const userDataDir = app.getPath('userData');
  const dataDir = path.join(userDataDir, 'data');
  const uploadsDir = path.join(userDataDir, 'uploads');

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // Point backend to writable locations for SQLite and uploads.
  process.env.DATABASE_PATH = path.join(dataDir, 'database.sqlite');
  process.env.UPLOAD_PATH = uploadsDir;

  const serverPath = path.join(__dirname, '..', 'server', 'server.js');
  backendModule = await import(serverPath);
}

function isAllowedNavigationUrl(targetUrl) {
  try {
    const u = new URL(targetUrl);

    if (!app.isPackaged) {
      return u.origin === 'http://localhost:5173' || u.origin === 'http://127.0.0.1:5173';
    }

    return u.protocol === 'file:';
  } catch {
    return false;
  }
}

function maybeOpenExternal(targetUrl) {
  try {
    const u = new URL(targetUrl);
    if (u.protocol === 'https:' || u.protocol === 'mailto:') {
      shell.openExternal(targetUrl);
      return true;
    }
  } catch {
    // ignore
  }

  return false;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), 
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      allowRunningInsecureContent: false,
    },
  });

  if (app.isPackaged && process.env.REDIO_DEVTOOLS !== '1') {
    win.webContents.on('devtools-opened', () => {
      win.webContents.closeDevTools();
    });
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    maybeOpenExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigationUrl(url)) {
      event.preventDefault();
      maybeOpenExternal(url);
    }
  });

  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
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

app.on('before-quit', async () => {
  try {
    if (backendModule?.stopBackend) {
      await backendModule.stopBackend();
    }
  } catch {
    // ignore shutdown errors
  }
});
