// electron/main.cjs
const { app, BrowserWindow, shell, dialog, clipboard, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const {
  validateLicenseOrThrow,
  validateActivationOrThrow,
  getDefaultLicensePath,
  getDefaultActivationPath,
  getDeviceFingerprint,
  getDeviceFingerprintV2,
} = require('./license.cjs');

let backendModule = null;
let licenseInfo = null;
let expiryTimeout = null;
let expiryInterval = null;
let expiryHandled = false;
let powerBlockerId = null;
let mainWindow = null;
let isQuitting = false;

// Keep renderer timers/audio responsive even when the window is minimized.
// This is important for uninterrupted playback during scheduled preemptions.
try {
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
} catch {
  // ignore
}

async function startBackend() {
  // Resolve runtime data directories in the per-user application data folder.
  // This ensures that the packaged app never attempts to write into the
  // read-only app.asar bundle.
  const userDataDir = app.getPath('userData');
  const dataDir = path.join(userDataDir, 'data');
  const uploadsDir = path.join(userDataDir, 'uploads');
  const backupsDir = path.join(userDataDir, 'backups');

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  // Point backend to writable locations for SQLite and uploads.
  process.env.DATABASE_PATH = path.join(dataDir, 'database.sqlite');
  process.env.UPLOAD_PATH = uploadsDir;
  process.env.BACKUP_PATH = backupsDir;

  const serverPath = path.join(__dirname, '..', 'server', 'server.js');
  // On Windows, dynamic import of absolute paths must use a file:// URL.
  backendModule = await import(pathToFileURL(serverPath).href);
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

async function ensureLicenseOrQuit() {
  // Allow developers to bypass licensing during local development.
  if (!app.isPackaged) return true;
  if (process.env.REDIO_LICENSE_BYPASS === '1') return true;

  const defaultLicensePath = getDefaultLicensePath({ app });

  // Convenience for distribution: allow shipping a license.json alongside the exe
  // (client can paste it there), then we copy it into userData.
  try {
    const exeDir = path.dirname(process.execPath);
    const exeSideLicense = path.join(exeDir, 'license.json');
    if (!fs.existsSync(defaultLicensePath) && fs.existsSync(exeSideLicense)) {
      fs.mkdirSync(path.dirname(defaultLicensePath), { recursive: true });
      fs.copyFileSync(exeSideLicense, defaultLicensePath);
    }
  } catch {
    // ignore
  }

  // If still missing, prompt the user to select the license file.
  if (!fs.existsSync(defaultLicensePath)) {
    let fingerprint = '';
    let fingerprint2 = '';
    try {
      fingerprint = await getDeviceFingerprint();
      fingerprint2 = await getDeviceFingerprintV2();
    } catch {
      fingerprint = '';
      fingerprint2 = '';
    }

    const introDetail = fingerprint
      ? `Device fingerprints:\n\nCLIENT_FP=${fingerprint}\nCLIENT_FP2=${fingerprint2}\n\nSend CLIENT_FP2 to your provider (recommended; survives Windows reinstall) to receive a license.json.\n\nOr select your license.json now.`
      : 'Send this device fingerprint (CLIENT_FP2 recommended) to your provider to receive a license.json, or select your license.json now.';

    const decision = await dialog.showMessageBox({
      type: 'warning',
      title: 'Activation Required',
      message: 'Redio requires a license to start on this device.',
      detail: introDetail,
      buttons: fingerprint ? ['Copy Fingerprint', 'Select license.json', 'Quit'] : ['Select license.json', 'Quit'],
      defaultId: fingerprint ? 1 : 0,
      cancelId: fingerprint ? 2 : 1,
      noLink: true,
    });

    if (fingerprint && decision.response === 0) {
      try {
        clipboard.writeText(`CLIENT_FP=${fingerprint}\nCLIENT_FP2=${fingerprint2}`);
      } catch {
        // ignore
      }
    }

    const shouldSelect = fingerprint ? decision.response === 1 : decision.response === 0;
    if (!shouldSelect) {
      app.quit();
      return false;
    }

    const result = await dialog.showOpenDialog({
      title: 'Select Redio License File',
      message: 'Please select your license.json to activate this device.',
      properties: ['openFile'],
      filters: [{ name: 'License', extensions: ['json'] }],
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      app.quit();
      return false;
    }

    try {
      fs.mkdirSync(path.dirname(defaultLicensePath), { recursive: true });
      fs.copyFileSync(result.filePaths[0], defaultLicensePath);
    } catch (e) {
      await dialog.showMessageBox({
        type: 'error',
        title: 'License Error',
        message: 'Failed to install license file.',
        detail: String(e && e.message ? e.message : e),
      });
      app.quit();
      return false;
    }
  }

  const publicKeyPath = path.join(__dirname, 'license-public.pem');
  let publicKeyPem = '';
  try {
    publicKeyPem = fs.readFileSync(publicKeyPath, 'utf8');
  } catch {
    await dialog.showMessageBox({
      type: 'error',
      title: 'License Error',
      message: 'Missing license verification key.',
      detail: `Could not read: ${publicKeyPath}`,
    });
    app.quit();
    return false;
  }

  try {
    const info = await validateLicenseOrThrow({
      app,
      fs,
      path,
      publicKeyPem,
      licensePath: defaultLicensePath,
    });
    licenseInfo = info;

    if (licenseInfo && licenseInfo.payload && licenseInfo.payload.licenseId) {
      const okActivation = await ensureActivationOrQuit({ publicKeyPem });
      if (!okActivation) return false;
    }

    return true;
  } catch (err) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'License Error',
      message: 'This copy of Redio is not licensed for this device.',
      detail: String(err && err.message ? err.message : err),
    });
    app.quit();
    return false;
  }
}

async function ensureActivationOrQuit({ publicKeyPem }) {
  if (!app.isPackaged) return true;
  if (process.env.REDIO_LICENSE_BYPASS === '1') return true;
  if (!licenseInfo || !licenseInfo.payload || !licenseInfo.payload.licenseId) return true;

  const defaultActivationPath = getDefaultActivationPath({ app });

  try {
    const exeDir = path.dirname(process.execPath);
    const exeSideActivation = path.join(exeDir, 'activation.json');
    if (!fs.existsSync(defaultActivationPath) && fs.existsSync(exeSideActivation)) {
      fs.mkdirSync(path.dirname(defaultActivationPath), { recursive: true });
      fs.copyFileSync(exeSideActivation, defaultActivationPath);
    }
  } catch {
    // ignore
  }

  const licenseId = String(licenseInfo.payload.licenseId || '');
  const maxActivations = Number(licenseInfo.payload.maxActivations || 0);
  const fp1 = String(licenseInfo.fingerprint || '');
  const fp2 = String(licenseInfo.fingerprintV2 || '');

  const validateIfPresent = async () => {
    if (!fs.existsSync(defaultActivationPath)) return { ok: false, error: null };
    try {
      await validateActivationOrThrow({
        app,
        fs,
        path,
        publicKeyPem,
        activationPath: defaultActivationPath,
        licenseId,
        fingerprints: { fp1, fp2 },
      });
      return { ok: true, error: null };
    } catch (e) {
      return { ok: false, error: e };
    }
  };

  const firstCheck = await validateIfPresent();
  if (firstCheck.ok) return true;

  if (firstCheck.error) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Activation Error',
      message: 'This device is not activated for this license.',
      detail: String(firstCheck.error && firstCheck.error.message ? firstCheck.error.message : firstCheck.error),
    });
  }

  while (true) {
    const detail = `LicenseId: ${licenseId}\nMax Activations: ${maxActivations}\n\nThis device:\nCLIENT_FP=${fp1}\nCLIENT_FP2=${fp2}\n\nSteps:\n1) Save activation-request.json and send it to your provider\n2) Receive activation.json and import it here`;

    const decision = await dialog.showMessageBox({
      type: 'warning',
      title: 'Activation Required',
      message: 'This license requires offline activation on this device.',
      detail,
      buttons: ['Copy Fingerprint', 'Save activation-request.json', 'Select activation.json', 'Quit'],
      defaultId: 2,
      cancelId: 3,
      noLink: true,
    });

    if (decision.response === 0) {
      try {
        clipboard.writeText(`LICENSE_ID=${licenseId}\nCLIENT_FP=${fp1}\nCLIENT_FP2=${fp2}`);
      } catch {
        // ignore
      }
      continue;
    }

    if (decision.response === 1) {
      const result = await dialog.showSaveDialog({
        title: 'Save Activation Request',
        defaultPath: path.join(app.getPath('desktop'), 'activation-request.json'),
        filters: [{ name: 'Activation Request', extensions: ['json'] }],
      });

      if (!result.canceled && result.filePath) {
        try {
          const request = {
            licenseId,
            fingerprint: fp2 || fp1,
            requestedAt: new Date().toISOString(),
            product: String(licenseInfo.payload.product || 'Redio'),
          };
          fs.writeFileSync(result.filePath, JSON.stringify(request, null, 2), 'utf8');
          await dialog.showMessageBox({
            type: 'info',
            title: 'Activation Request Saved',
            message: 'Send this file to your provider to receive activation.json.',
            detail: result.filePath,
          });
        } catch (e) {
          await dialog.showMessageBox({
            type: 'error',
            title: 'Activation Error',
            message: 'Failed to save activation request.',
            detail: String(e && e.message ? e.message : e),
          });
        }
      }

      continue;
    }

    if (decision.response === 2) {
      const result = await dialog.showOpenDialog({
        title: 'Select Activation File',
        message: 'Please select your activation.json to activate this device.',
        properties: ['openFile'],
        filters: [{ name: 'Activation', extensions: ['json'] }],
      });

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        continue;
      }

      try {
        fs.mkdirSync(path.dirname(defaultActivationPath), { recursive: true });
        fs.copyFileSync(result.filePaths[0], defaultActivationPath);
      } catch (e) {
        await dialog.showMessageBox({
          type: 'error',
          title: 'Activation Error',
          message: 'Failed to install activation file.',
          detail: String(e && e.message ? e.message : e),
        });
        continue;
      }

      const check = await validateIfPresent();
      if (check.ok) return true;

      await dialog.showMessageBox({
        type: 'error',
        title: 'Activation Error',
        message: 'Activation file is invalid for this device/license.',
        detail: String(check.error && check.error.message ? check.error.message : check.error),
      });
      continue;
    }

    app.quit();
    return false;
  }
}

async function handleExpiredLicense(reason) {
  if (expiryHandled) return;
  expiryHandled = true;

  try {
    if (expiryTimeout) clearTimeout(expiryTimeout);
    if (expiryInterval) clearInterval(expiryInterval);
  } catch {
    // ignore
  }

  await dialog.showMessageBox({
    type: 'error',
    title: 'License Expired',
    message: 'Your Redio license has expired.',
    detail: reason || 'Please contact your provider to renew your license.',
  });

  app.quit();
}

function startExpiryWatchdog() {
  if (!app.isPackaged) return;
  if (process.env.REDIO_LICENSE_BYPASS === '1') return;
  if (!licenseInfo || !Number.isFinite(licenseInfo.expiresAtMs)) return;
  if (licenseInfo.expiresAtMs === Number.POSITIVE_INFINITY) return;

  const scheduleNext = () => {
    const msLeft = licenseInfo.expiresAtMs - Date.now();
    if (msLeft <= 0) {
      void handleExpiredLicense('License expired.');
      return;
    }

    if (expiryTimeout) clearTimeout(expiryTimeout);
    // Cap the timeout so very long durations don't overflow setTimeout limits.
    const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;
    expiryTimeout = setTimeout(() => {
      void handleExpiredLicense('License expired.');
    }, Math.min(msLeft, MAX_TIMEOUT_MS));
  };

  scheduleNext();

  if (expiryInterval) clearInterval(expiryInterval);
  // Also check periodically to handle sleep/wake or system time jumps.
  expiryInterval = setInterval(() => {
    if (Date.now() > licenseInfo.expiresAtMs) {
      void handleExpiredLicense('License expired.');
      return;
    }
    scheduleNext();
  }, 60 * 1000);
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

  try {
    win.webContents.setBackgroundThrottling(false);
  } catch {
    // ignore
  }

  if (app.isPackaged && process.env.REDIO_DEVTOOLS !== '1') {
    win.webContents.on('devtools-opened', () => {
      win.webContents.closeDevTools();
    });
  }

  win.on('close', async (event) => {
    if (isQuitting) return;

    event.preventDefault();

    try {
      const result = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Cancel', 'Exit'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        title: 'Exit Redio',
        message: 'Are you sure you want to exit?',
        detail: 'Playback and scheduling will stop when you close the app.',
      });

      if (result.response === 1) {
        isQuitting = true;
        app.quit();
      }
    } catch {
      // If prompting fails, do not block exit.
      isQuitting = true;
      app.quit();
    }
  });

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

  mainWindow = win;
}

app.whenReady().then(async () => {
  try {
    const ok = await ensureLicenseOrQuit();
    if (!ok) return;
    startExpiryWatchdog();

    // In packaged desktop mode, ensure the OS doesn't suspend the app while
    // minimized/backgrounded, otherwise audio output and scheduled preemptions
    // can pause unexpectedly.
    try {
      if (app.isPackaged && powerBlockerId == null) {
        powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
      }
    } catch {
      // ignore
    }

    await startBackend();
    createWindow();
  } catch (e) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Startup Error',
      message: 'Redio failed to start after activation.',
      detail: String(e && e.message ? e.message : e),
    });
    app.quit();
  }
});

app.on('before-quit', async () => {
  isQuitting = true;
  try {
    try {
      if (powerBlockerId != null && powerSaveBlocker.isStarted(powerBlockerId)) {
        powerSaveBlocker.stop(powerBlockerId);
      }
    } catch {
      // ignore
    }

    if (backendModule?.stopBackend) {
      await backendModule.stopBackend();
    }
  } catch {
    // ignore shutdown errors
  }
});
