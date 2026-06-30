const { app, BrowserWindow, ipcMain, dialog } = require('electron');
app.commandLine.appendSwitch('no-sandbox');
const path = require('path');
const fs = require('fs');
const installer = require('./install');

let win = null;
let installAbort = null;

function createWindow() {
  win = new BrowserWindow({
    width: 620,
    height: 480,
    minWidth: 620,
    minHeight: 480,
    resizable: true,
    frame: false,
    transparent: false,
    backgroundColor: '#0F172A',
    icon: path.join(__dirname, '..', 'src', 'assets', 'pb-logo-256.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'index.html'));
  const isUpdate = process.argv.includes('--update');
  const isDev = process.argv.includes('--dev');
  const isInstall = !isUpdate;

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('init', {
      mode: isUpdate ? 'update' : 'install',
      devMode: isDev,
      appVersion: app.getVersion(),
      platform: process.platform,
    });
  });
}

// ── Window controls ───────────────────────────────────────────────────
ipcMain.on('win-min', () => { if (win) win.minimize(); });
ipcMain.on('win-max', () => { if (win) win.isMaximized() ? win.unmaximize() : win.maximize(); });
ipcMain.on('win-close', () => { if (win) win.close(); });

// ── Try out the browser before installing ─────────────────────────────
ipcMain.handle('try-browser', async () => {
  const { spawn } = require('child_process');
  const rootDir = path.join(__dirname, '..');
  const mainScript = path.join(rootDir, 'src', 'main.js');
  if (!fs.existsSync(mainScript)) {
    return { success: false, error: 'Try-out only available in development mode' };
  }
  try {
    const child = spawn(process.execPath, [mainScript, '--no-sandbox'], {
      cwd: rootDir,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// ── IPC Handlers ──────────────────────────────────────────────────────

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('check-latest-version', async () => {
  return await installer.checkLatestVersion();
});

ipcMain.handle('start-download', async (e, { url, destPath }) => {
  let downloadPromise = null;
  installAbort = () => { if (downloadPromise && downloadPromise.cancel) downloadPromise.cancel(); };
  try {
    downloadPromise = installer.download(url, destPath, (progress) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('download-progress', progress);
      }
    });
    const result = await downloadPromise;
    return { success: true, filePath: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.on('cancel-download', () => {
  if (installAbort) installAbort();
});

ipcMain.handle('install-app', async (e, { installerPath, installDir }) => {
  try {
    await installer.install(installerPath, installDir, (status) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('install-progress', status);
      }
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('launch-app', async () => {
  const installDir = installer.getInstallDir();
  const exeName = process.platform === 'win32' ? 'PoleBrowse.exe'
    : process.platform === 'darwin' ? 'PoleBrowse.app'
    : 'polebrowse';
  const exePath = path.join(installDir, exeName);
  try {
    require('child_process').spawn(exePath, [], {
      detached: true,
      stdio: 'ignore',
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('select-install-dir', async () => {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: installer.getDefaultInstallDir(),
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('quit-installer', () => {
  app.quit();
});

// ── CLI: run hidden install from app update ──────────────────────────
if (process.argv.includes('--silent-install')) {
  app.whenReady().then(async () => {
    const updatePkg = process.argv.find(a => a.endsWith('.exe') || a.endsWith('.dmg') || a.endsWith('.AppImage'));
    if (updatePkg && fs.existsSync(updatePkg)) {
      await installer.install(updatePkg, installer.getInstallDir(), () => {});
      try {
        const exePath = path.join(installer.getInstallDir(),
          process.platform === 'win32' ? 'PoleBrowse.exe' : 'polebrowse');
        if (fs.existsSync(exePath)) {
          require('child_process').spawn(exePath, [], { detached: true, stdio: 'ignore' });
        }
      } catch (_) {}
    }
    app.quit();
  });
}
