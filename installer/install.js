const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const os = require('os');

const HUB_URL = process.env.POLEBROWSE_HUB_URL || 'https://polebrowse.vercel.app';
const API_URL = `${HUB_URL}/api/latest`;

// ── Detect install destination ──────────────────────────────────────
function getDefaultInstallDir() {
  const home = os.homedir();
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'PoleBrowse');
    case 'darwin':
      return '/Applications';
    default:
      return path.join(home, '.local', 'share', 'polebrowse');
  }
}

function getInstallDir() {
  const configPath = path.join(os.homedir(), '.polebrowse-install-path');
  try {
    if (fs.existsSync(configPath)) {
      return fs.readFileSync(configPath, 'utf-8').trim();
    }
  } catch (_) {}
  return getDefaultInstallDir();
}

function saveInstallDir(dir) {
  const configPath = path.join(os.homedir(), '.polebrowse-install-path');
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, dir, 'utf-8');
  } catch (_) {}
}

// ── Parse & compare versions ────────────────────────────────────────
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

// ── Hub API request ─────────────────────────────────────────────────
function hubRequest(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'PoleBrowse-Installer/1.0' } }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
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

async function checkLatestVersion() {
  try {
    const info = await hubRequest(API_URL);
    if (info.noReleases) {
      return { hasUpdate: false, latestVersion: null, currentVersion: '0.0.0', downloadUrl: null, error: null, noReleases: true };
    }
    const plat = process.platform;
    const asset = info.platforms ? info.platforms[plat] : null;
    const appPkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')
    );
    const currentVer = appPkg.version || '0.0.0';
    return {
      hasUpdate: isNewer(info.latestVersion, currentVer),
      latestVersion: info.latestVersion,
      currentVersion: currentVer,
      downloadUrl: asset ? asset.blobUrl : null,
      assetName: asset ? asset.fileName : null,
      assetSize: asset ? asset.size : 0,
      releaseNotes: (info.releaseNotes || '').substring(0, 2000),
      publishedAt: info.publishedAt || null,
      error: info.error || null,
    };
  } catch (err) {
    return { hasUpdate: false, latestVersion: null, currentVersion: '0.0.0', downloadUrl: null, error: err.message };
  }
}

// ── Download ────────────────────────────────────────────────────────
function download(url, destPath, onProgress) {
  let aborted = false;
  let req = null;

  const promise = new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const httpMod = url.startsWith('https') ? https : http;

    function cleanup(err) {
      file.close();
      try { fs.unlinkSync(destPath); } catch (_) {}
      if (req) { try { req.destroy(); } catch (_) {} }
    }

    function handleResponse(res) {
      if (aborted) { cleanup(); return reject(new Error('Cancelled')); }
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        cleanup();
        return download(res.headers.location, destPath, onProgress).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        cleanup();
        return reject(new Error(`Server returned ${res.statusCode}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;
      res.on('data', (chunk) => {
        if (aborted) { cleanup(); return reject(new Error('Cancelled')); }
        downloaded += chunk.length;
        file.write(chunk);
        if (onProgress) {
          onProgress({ downloaded, total, percent: total ? Math.round((downloaded / total) * 100) : 0 });
        }
      });
      res.on('end', () => {
        if (aborted) { cleanup(); return reject(new Error('Cancelled')); }
        file.end();
        resolve(destPath);
      });
      res.on('error', (err) => {
        if (aborted) { cleanup(); return reject(new Error('Cancelled')); }
        cleanup();
        reject(err);
      });
    }

    req = httpMod.get(url, { headers: { 'User-Agent': 'PoleBrowse-Installer/1.0' } }, handleResponse);
    req.on('error', (err) => {
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

// ── Extract / Install (ZIP only) ──────────────────────────────────────
const AdmZip = require('adm-zip');

async function install(zipPath, installDir, onStatus) {
  if (onStatus) onStatus({ stage: 'extracting', message: 'Extracting…' });

  fs.mkdirSync(installDir, { recursive: true });
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(installDir, true);

  // Make the binary executable on Linux/macOS
  const plat = process.platform;
  if (plat !== 'win32') {
    const binaryName = plat === 'darwin' ? 'PoleBrowse.app' : 'polebrowse';
    const binaryPath = path.join(installDir, binaryName);
    if (fs.existsSync(binaryPath) && fs.statSync(binaryPath).isDirectory()) {
      const appPath = path.join(binaryPath, 'Contents', 'MacOS', 'PoleBrowse');
      if (fs.existsSync(appPath)) fs.chmodSync(appPath, '755');
    } else if (fs.existsSync(binaryPath)) {
      fs.chmodSync(binaryPath, '755');
    }
  }

  saveInstallDir(installDir);
  if (onStatus) onStatus({ stage: 'done', message: 'Installation complete!' });
  return true;
}

module.exports = { checkLatestVersion, download, install, getDefaultInstallDir, getInstallDir, saveInstallDir };
