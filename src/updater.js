const { app } = require('electron');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ── CONFIG ─────────────────────────────────────────────────────────
const HUB_URL = process.env.POLEBROWSE_HUB_URL || 'https://polebrowse.vercel.app';
const API_URL = `${HUB_URL}/api/latest`;
const CURRENT_VERSION = app.getVersion();

// ── VERSION COMPARISON ─────────────────────────────────────────────
function parseVersion(v) {
  return (v || '').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
}
function isNewer(latest, current) {
  const l = parseVersion(latest);
  const c = parseVersion(current);
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    if ((l[i] || 0) > (c[i] || 0)) return true;
    if ((l[i] || 0) < (c[i] || 0)) return false;
  }
  return false;
}

// ── HUB API REQUEST ────────────────────────────────────────────────
function hubRequest(url) {
  return new Promise((resolve, reject) => {
    const opts = { headers: { 'User-Agent': 'PoleBrowse-Updater/1.0', 'Accept': 'application/json' } };
    https.get(url, opts, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error('Invalid JSON from hub')); }
        } else {
          reject(new Error(`Hub returned ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

// ── CHECK FOR UPDATES ──────────────────────────────────────────────
async function checkForUpdates() {
  try {
    const info = await hubRequest(API_URL);
    if (info.noReleases) {
      return { hasUpdate: false, latestVersion: null, currentVersion: CURRENT_VERSION, downloadUrl: null, error: null, noReleases: true };
    }
    const asset = info.platforms ? info.platforms[process.platform] : null;
    const hasUpdate = isNewer(info.latestVersion, CURRENT_VERSION);
    return {
      hasUpdate,
      currentVersion: CURRENT_VERSION,
      latestVersion: info.latestVersion,
      downloadUrl: asset ? asset.blobUrl : null,
      assetName: asset ? asset.fileName : null,
      assetSize: asset ? asset.size : 0,
      releaseNotes: (info.releaseNotes || '').substring(0, 2000),
      publishedAt: info.publishedAt || null,
      error: info.error || null,
    };
  } catch (err) {
    const isNoReleases = err.message && err.message.includes('404');
    return {
      hasUpdate: false, currentVersion: CURRENT_VERSION, latestVersion: null,
      downloadUrl: null, assetName: null, assetSize: 0, releaseNotes: '',
      publishedAt: null, error: isNoReleases ? null : err.message, noReleases: isNoReleases,
    };
  }
}

// ── DOWNLOAD UPDATE ────────────────────────────────────────────────
function downloadUpdate(url, destPath, onProgress) {
  let aborted = false;
  let req = null;

  const promise = new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const httpMod = url.startsWith('https') ? https : http;

    function cleanup() {
      file.close();
      try { fs.unlinkSync(destPath); } catch (_) {}
      if (req) { try { req.destroy(); } catch (_) {} }
    }

    function handle(res) {
      if (aborted) { cleanup(); return reject(new Error('Cancelled')); }
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        cleanup();
        return downloadUpdate(res.headers.location, destPath, onProgress).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        cleanup();
        return reject(new Error(`Server returned ${res.statusCode}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;
      res.on('data', chunk => {
        if (aborted) { cleanup(); return reject(new Error('Cancelled')); }
        downloaded += chunk.length;
        file.write(chunk);
        if (onProgress) onProgress({ downloaded, total, percent: total ? Math.round((downloaded / total) * 100) : 0 });
      });
      res.on('end', () => {
        if (aborted) { cleanup(); return reject(new Error('Cancelled')); }
        file.end();
        resolve(destPath);
      });
      res.on('error', err => {
        if (aborted) { cleanup(); return reject(new Error('Cancelled')); }
        cleanup();
        reject(err);
      });
    }

    req = httpMod.get(url, { headers: { 'User-Agent': USER_AGENT } }, handle);
    req.on('error', err => {
      if (aborted) { cleanup(); return reject(new Error('Cancelled')); }
      cleanup();
      reject(err);
    });
  });

  promise.cancel = () => {
    aborted = true;
    if (req) { try { req.destroy(); } catch (_) {} }
  };

  return promise;
}

// ── INSTALL UPDATE ─────────────────────────────────────────────────
function installUpdate(installerPath) {
  const platform = process.platform;
  const exeName = path.basename(installerPath);
  const setupDir = path.dirname(installerPath);

  if (platform === 'win32') {
    // Custom NSIS installer with silent flags + update mode
    const args = ['/S', '/UPDATE'];
    spawn(installerPath, args, { detached: true, stdio: 'ignore' });
  } else if (platform === 'darwin') {
    // Mount DMG, copy app, detach
    const mountPoint = '/Volumes/PoleBrowse-' + Date.now();
    const dmgArgs = [
      'attach', installerPath,
      '-nobrowse', '-mountpoint', mountPoint, '-quiet',
    ];
    const child = spawn('hdiutil', dmgArgs, { stdio: 'pipe' });
    child.on('close', () => {
      const srcApp = path.join(mountPoint, 'PoleBrowse.app');
      const destApp = '/Applications/PoleBrowse.app';
      if (fs.existsSync(destApp)) {
        fs.rmSync(destApp, { recursive: true, force: true });
      }
      fs.cpSync(srcApp, destApp, { recursive: true });
      spawn('hdiutil', ['detach', mountPoint, '-quiet'], { stdio: 'ignore' });
    });
  } else {
    // Linux AppImage or executable
    fs.chmodSync(installerPath, '755');
    const appImageArgs = ['--no-sandbox'];
    spawn(installerPath, appImageArgs, { detached: true, stdio: 'ignore' });
  }
  app.quit();
}

// ── REGISTER IPC HANDLERS ──────────────────────────────────────────
function register(ipcMain, getMainWindow) {
  let downloadAbort = null;

  ipcMain.handle('check-for-updates', async () => {
    return await checkForUpdates();
  });

  ipcMain.handle('download-update', async (e, { url }) => {
    const destDir = app.getPath('downloads');
    const destName = `PoleBrowse-Update-${Date.now()}.exe`;
    const destPath = path.join(destDir, destName);
    const win = getMainWindow(e);

    let aborted = false;
    downloadAbort = () => { aborted = true; };

    try {
      await downloadUpdate(url, destPath, progress => {
        if (aborted) throw new Error('Download cancelled');
        if (win && !win.isDestroyed()) {
          win.webContents.send('download-update-progress', {
            downloaded: progress.downloaded,
            total: progress.total,
            percent: progress.percent,
          });
        }
      });
      if (aborted) {
        try { fs.unlinkSync(destPath); } catch (_) {}
        return { success: false, error: 'Cancelled' };
      }
      return { success: true, filePath: destPath };
    } catch (err) {
      try { fs.unlinkSync(destPath); } catch (_) {}
      return { success: false, error: err.message };
    }
  });

  ipcMain.on('cancel-update-download', () => {
    if (downloadAbort) downloadAbort();
  });

  ipcMain.on('install-update', (e, { filePath }) => {
    installUpdate(filePath);
  });
}

module.exports = { register, checkForUpdates, downloadUpdate, installUpdate, isNewer };
