const { app, BrowserWindow, BrowserView, ipcMain, shell, session, net } = require('electron');

// ── DNS-over-HTTPS CONFIG ─────────────────────────────────────────
const DNS_PROVIDERS = {
  cloudflare:  { name: 'Cloudflare',       url: 'https://cloudflare-dns.com/dns-query',          ips: ['1.1.1.1', '1.0.0.1'] },
  google:      { name: 'Google',           url: 'https://dns.google/dns-query',                  ips: ['8.8.8.8', '8.8.4.4'] },
  quad9:       { name: 'Quad9',            url: 'https://dns.quad9.net/dns-query',               ips: ['9.9.9.9', '149.112.112.112'] },
  adguard:     { name: 'AdGuard',          url: 'https://dns.adguard-dns.com/dns-query',         ips: ['94.140.14.14', '94.140.15.15'] },
  nextdns:     { name: 'NextDNS',          url: 'https://dns.nextdns.io/dns-query',              ips: ['45.90.28.0', '45.90.30.0'] },
  opendns:     { name: 'OpenDNS',          url: 'https://doh.opendns.com/dns-query',             ips: ['208.67.222.222', '208.67.220.220'] },
  mullvad:     { name: 'Mullvad',          url: 'https://dns.mullvad.net/dns-query',             ips: ['194.242.2.2', '194.242.2.3'] },
  controld:    { name: 'Control D',        url: 'https://freedns.controld.com/p0',               ips: ['76.76.2.0', '76.76.10.0'] },
};


// ── VPN / PROXY CONFIG ────────────────────────────────────────────
const VPN_PROVIDERS = {
  none:       { name: 'No VPN (Direct)',    type: null,     info: 'Direct connection, no proxy' },
  tor:        { name: 'Tor Network',        type: 'socks5', host: '127.0.0.1', port: 9050,  info: 'Requires Tor Browser or tor service running' },
  i2p:        { name: 'I2P',               type: 'socks5', host: '127.0.0.1', port: 4444,  info: 'Requires I2P running locally' },
  privoxy:    { name: 'Privoxy',           type: 'http',   host: '127.0.0.1', port: 8118,  info: 'Requires Privoxy running locally' },
  mullvad:    { name: 'Mullvad SOCKS',     type: 'socks5', host: 'socks5.mullvad.net', port: 1080, info: 'Requires Mullvad account' },
  windscribe: { name: 'Windscribe SOCKS',  type: 'socks5', host: 'nl.windscribe.com', port: 1080,  info: 'Requires Windscribe account' },
  custom:     { name: 'Custom Proxy',      type: 'socks5', host: '127.0.0.1', port: 1080,  info: 'Enter your own proxy address' },
};

let activeVpnKey   = 'none';
let vpnEnabled     = false;
let customProxyHost = '127.0.0.1';
let customProxyPort = 1080;
let customProxyType = 'socks5';

function applyProxy(ses, providerKey) {
  const provider = VPN_PROVIDERS[providerKey] || VPN_PROVIDERS.none;
  activeVpnKey = providerKey;
  if (!provider.type || !vpnEnabled) {
    ses.setProxy({ proxyRules: 'direct://' });
    console.log('[VPN] Direct connection');
    return;
  }
  const host = providerKey === 'custom' ? customProxyHost : provider.host;
  const port = providerKey === 'custom' ? customProxyPort : provider.port;
  const rule = `${provider.type}://${host}:${port}`;
  ses.setProxy({ proxyRules: rule });
  console.log('[VPN] Proxy active:', rule);
}

function disableProxy(ses) {
  vpnEnabled = false;
  ses.setProxy({ proxyRules: 'direct://' });
  console.log('[VPN] Proxy disabled');
}


// ── AD BLOCKER ────────────────────────────────────────────────────
let adBlockEnabled = true;
let globalBlockedCount = 0;
const AD_HOSTS = new Set([
  'doubleclick.net','googlesyndication.com','googleadservices.com',
  'adnxs.com','adsafeprotected.com','moatads.com','scorecardresearch.com',
  'quantserve.com','outbrain.com','taboola.com','criteo.com','rubiconproject.com',
  'openx.net','pubmatic.com','advertising.com','amazon-adsystem.com',
  'facebook.com/tr','connect.facebook.net','analytics.twitter.com',
  'google-analytics.com','googletagmanager.com','hotjar.com','mixpanel.com',
  'segment.com','amplitude.com','fullstory.com','logrocket.com',
]);
function isAdHost(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    const blocked = adBlockEnabled && (AD_HOSTS.has(h) || [...AD_HOSTS].some(d => h.endsWith('.' + d)));
    if (blocked) globalBlockedCount++;
    return blocked;
  } catch(e) { return false; }
}

let activeDnsKey = 'cloudflare'; // default
let dnsEnabled = true; // default ON

function disableDns() {
  dnsEnabled = false;
  app.configureHostResolver({
    secureDnsMode: 'off',
  });
  console.log('[DNS] Protection DISABLED');
}

function applyDns(ses, providerKey) {
  dnsEnabled = true;
  const provider = DNS_PROVIDERS[providerKey] || DNS_PROVIDERS['cloudflare'];
  activeDnsKey = providerKey;
  // Electron 22+ supports setSSLKeyLogFile, resolveHost — use built-in DoH
  ses.setSSLConfig({ disabledCipherSuites: [] }); // ensure TLS not broken
  if (ses.setResolveProxyHandler) ses.setResolveProxyHandler(null); // clear any proxy
  // Primary: use Chromium's built-in DoH via secure DNS mode
  app.configureHostResolver({
    secureDnsMode: 'secure',
    secureDnsServers: [provider.url],
  });
  console.log('[DNS] Active provider:', provider.name, provider.url);
}

const path = require('path');
const fs = require('fs');


try { const sq = require('electron-squirrel-startup'); if (sq && sq.default) app.quit(); } catch(e) { /* not installed, skip */ }



// ── PER-WINDOW STATE
const winState = new Map();
const BAR_HEIGHT = 122;

function getViewBounds(win) {
  const [w, h] = win.getContentSize();
  return { x: 0, y: BAR_HEIGHT, width: w, height: h - BAR_HEIGHT };
}
function getState(win) {
  if (!winState.has(win.id)) winState.set(win.id, { views: {}, activeViewId: null });
  return winState.get(win.id);
}
function winFromEvent(e) {
  return BrowserWindow.fromWebContents(e.sender);
}





// CWS inject script inlined
var CWS_INJECT_SCRIPT = ["(function() {","  if (window.__pbInjected) return;","  window.__pbInjected = true;","","  var BLUE = '#5b8af5';","  var GREEN = '#4ade80';","  var RED = '#e05c5c';","","  function getExtId() {","    var m = location.pathname.match(/\\/detail\\/[^/]+\\/([a-z]{32})/);","    if (m) return m[1];","    var p = new URLSearchParams(location.search);","    var id = p.get('id');","    if (id && /^[a-z]{32}$/.test(id)) return id;","    return null;","  }","","  function showOverlay(msg, color) {","    var o = document.getElementById('__pb_overlay');","    if (!o) {","      o = document.createElement('div');","      o.id = '__pb_overlay';","      o.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;background:#12121f;color:#7fa3ff;border:1.5px solid #5b8af5;border-radius:12px;padding:13px 20px;font-family:-apple-system,sans-serif;font-size:13px;font-weight:500;box-shadow:0 6px 28px rgba(0,0,0,.7);display:flex;align-items:center;gap:10px;min-width:230px;transition:all .25s;';","      document.body.appendChild(o);","    }","    o.style.display = 'flex';","    o.innerHTML = msg;","    o.style.borderColor = color || BLUE;","    o.style.color = color || '#7fa3ff';","    return o;","  }","","  function hideOverlay() {","    var o = document.getElementById('__pb_overlay');","    if (o) o.style.display = 'none';","  }","","  function triggerInstall() {","    var extId = getExtId();","    if (!extId) { showOverlay('Could not detect extension ID', RED); return; }","    showOverlay('\u23f3 Installing...');","    if (window.ipc && window.ipc.send) {","      window.ipc.send('cws-install-ext', { extId: extId });","    } else {","      fetch('pb-install://' + extId).catch(function(){});","    }","  }","","  window.addEventListener('__pb_status', function(e) {","    var d = e.detail;","    if (d.status === 'downloading') showOverlay('Downloading .crx...');","    else if (d.status === 'extracting') showOverlay('Extracting...');","    else if (d.status === 'loading') showOverlay('Loading into browser...');","    else if (d.status === 'installed') {","      showOverlay('Installed! Active now.', GREEN);","      var btn = document.getElementById('__pb_install_btn');","      if (btn) { btn.textContent = 'Installed'; btn.style.background = GREEN; }","      setTimeout(hideOverlay, 3500);","    } else if (d.status === 'already') {","      showOverlay('Already installed', GREEN);","      setTimeout(hideOverlay, 2000);","    } else if (d.status === 'error') {","      showOverlay('Failed: ' + (d.message || 'Unknown error'), RED);","      setTimeout(hideOverlay, 5000);","    }","  });","","  function hideBanners() {","    document.querySelectorAll('div,section,aside,c-wiz').forEach(function(el) {","      if (el.id === '__pb_overlay' || el.id === '__pb_bar') return;","      var t = el.innerText || '';","      if (el.children.length < 8 && (","        t.includes('Switch to Chrome') ||","        t.includes('Item currently unavailable') ||","        t.includes('troubleshooting guide') ||","        t.includes('Install Chrome')","      )) {","        el.style.display = 'none';","      }","    });","  }","","  function makeInstallBtn() {","    var btn = document.createElement('button');","    btn.id = '__pb_install_btn';","    btn.textContent = '+ Add to PoleBrowse';","    btn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 22px;background:' + BLUE + ';color:#fff;border:none;border-radius:18px;font-family:-apple-system,sans-serif;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 2px 10px rgba(91,138,245,.4);margin-left:10px;flex-shrink:0;';","    btn.onmouseover = function() { btn.style.background = '#7fa3ff'; };","    btn.onmouseout = function() { btn.style.background = BLUE; };","    btn.onclick = function(ev) { ev.preventDefault(); ev.stopPropagation(); triggerInstall(); };","    return btn;","  }","","  function injectButton() {","    if (!getExtId()) return false;","    if (document.getElementById('__pb_install_btn')) return true;","","    // Find Add to Chrome button (disabled or not)","    var addBtn = null;","    var allBtns = document.querySelectorAll('button');","    for (var i = 0; i < allBtns.length; i++) {","      var t = allBtns[i].textContent.trim();","      var label = allBtns[i].getAttribute('aria-label') || '';","      if (t === 'Add to Chrome' || t === 'Add extension' || label.includes('Add to Chrome')) {","        addBtn = allBtns[i];","        break;","      }","    }","","    var btn = makeInstallBtn();","","    if (addBtn && addBtn.parentNode) {","      addBtn.style.display = 'none';","      addBtn.parentNode.insertBefore(btn, addBtn.nextSibling);","      return true;","    }","","    // Fallback sticky bar","    if (document.getElementById('__pb_bar')) return false;","    var bar = document.createElement('div');","    bar.id = '__pb_bar';","    bar.style.cssText = 'position:sticky;top:0;z-index:9999;background:#12121f;border-bottom:1px solid #2c2c3a;padding:10px 24px;display:flex;align-items:center;gap:14px;';","    var label2 = document.createElement('span');","    label2.textContent = 'PoleBrowse Extension Store';","    label2.style.cssText = 'color:#7fa3ff;font-size:13px;font-family:sans-serif;';","    bar.appendChild(label2);","    bar.appendChild(btn);","    var main = document.querySelector('main') || document.body;","    main.insertBefore(bar, main.firstChild);","    return true;","  }","","  var retries = 0;","  var iv = setInterval(function() {","    hideBanners();","    if (injectButton() || retries++ > 40) clearInterval(iv);","  }, 250);","","  // SPA navigation handling","  var lastPath = location.pathname;","  setInterval(function() {","    hideBanners();","    if (location.pathname !== lastPath) {","      lastPath = location.pathname;","      ['__pb_install_btn','__pb_bar'].forEach(function(id) {","        var el = document.getElementById(id);","        if (el) el.remove();","      });","      retries = 0;","      clearInterval(iv);","      iv = setInterval(function() {","        hideBanners();","        if (injectButton() || retries++ > 40) clearInterval(iv);","      }, 250);","    }","  }, 500);","","})();",""].join("\n");

function injectCWS(view, win, tabId) {
  if (!CWS_INJECT_SCRIPT) return;
  view.webContents.executeJavaScript(CWS_INJECT_SCRIPT).catch(function() {});
  // Dispatch status updates back into the page using CustomEvent
  // Store tabId on the view so protocol handler can find it

}

function dispatchStatusToPage(view, status, extra) {
  if (!view || view.webContents.isDestroyed()) return;
  const payload = JSON.stringify(Object.assign({ status: status }, extra));
  view.webContents.executeJavaScript(
    'window.dispatchEvent(new CustomEvent("__pb_status", { detail: ' + payload + ' }));'
  ).catch(function() {});
}

// ── CREATE WINDOW
function createWindow(openUrl) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,
    webPreferences: {
      preload: require('path').join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.maximize();
  win.loadFile(require('path').join(__dirname, 'index.html'));
  win.setTitle('PoleBrowse Unstable');

  win.webContents.once('did-finish-load', function() {
    if (openUrl) win.webContents.send('open-url-on-start', { url: openUrl });
    // Check default browser status and prompt if needed
    if (process.platform === 'win32' && !isDefaultBrowser()) {
      setTimeout(function() {
        win.webContents.send('check-default-browser', { isDefault: false });
      }, 2000);
    }
  });

  win.on('resize', function() {
    const state = getState(win);
    if (state.activeViewId && state.views[state.activeViewId]) {
      state.views[state.activeViewId].setBounds(getViewBounds(win));
    }
  });

  win.on('closed', function() {
    const state = getState(win);
    Object.values(state.views).forEach(function(v) { try { v.webContents.destroy(); } catch(e) {} });
    winState.delete(win.id);
  });

  return win;
}

// ── WINDOW CONTROLS
ipcMain.on('win-min', function(e) { winFromEvent(e).minimize(); });
ipcMain.on('win-max', function(e) { const w = winFromEvent(e); w.isMaximized() ? w.unmaximize() : w.maximize(); });
ipcMain.on('win-close', function(e) { winFromEvent(e).close(); });

// ── DEVTOOLS
ipcMain.on('open-devtools', function(e, data) {
  const win = winFromEvent(e);
  const state = getState(win);
  if (state.views[data.tabId]) state.views[data.tabId].webContents.openDevTools({ mode: 'detach' });
  else win.webContents.openDevTools({ mode: 'detach' });
});

// ── FILE
ipcMain.on('open-file', function(e, data) { shell.openPath(data.path); });
ipcMain.on('show-file', function(e, data) { shell.showItemInFolder(data.path); });

// ── TAB DETACH
ipcMain.on('detach-tab', function(e, data) {
  const sourceWin = winFromEvent(e);
  const target = BrowserWindow.getAllWindows().find(function(w) {
    if (w.id === sourceWin.id || w.isDestroyed()) return false;
    const pos = w.getPosition();
    const size = w.getSize();
    return data.x >= pos[0] && data.x <= pos[0] + size[0] && data.y >= pos[1] && data.y <= pos[1] + size[1];
  });
  if (target) {
    target.focus();
    target.webContents.send('receive-tab', { url: data.url, title: data.title });
  } else {
    createWindow(data.url);
  }
});

// ── VIEW HANDLERS
// ── Dangerous site blocklist ─────────────────────────────────────────
const DANGEROUS_HOSTS = new Set([
  'malware.testing.google.test',
  'testsafebrowsing.appspot.com',
  'reddit.com', 'www.reddit.com',
  'vimeo.com', 'www.vimeo.com',
]);
function isDangerous(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return DANGEROUS_HOSTS.has(h) || DANGEROUS_HOSTS.has(h.replace(/^www\./, ''));
  } catch(e) { return false; }
}

ipcMain.on('view-navigate', function(e, data) {
  const tabId = data.tabId;
  const url = data.url;
  const win = winFromEvent(e);
  const state = getState(win);

  // Dangerous site check
  if (url && /^https?:/.test(url) && !data.bypassDangerous && isDangerous(url)) {
    win.webContents.send('site-dangerous', { tabId: tabId, url: url });
    return;
  }

  if (!state.views[tabId]) {
    const view = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        session: session.defaultSession,
        preload: path.join(__dirname, 'preload.js'),
      }
    });
    state.views[tabId] = view;

    // Set Chrome UA on this view's webContents directly
    var CHROME_UA_VIEW = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    view.webContents.setUserAgent(CHROME_UA_VIEW);

    view.webContents.on('context-menu', function(ev, params) {
      ev.preventDefault();
      win.webContents.send('view-contextmenu', {
        x: params.x,
        y: params.y + BAR_HEIGHT,
        linkURL: params.linkURL,
        srcURL: params.srcURL,
        selectionText: params.selectionText,
        isEditable: params.isEditable,
      });
    });

    view.webContents.on('did-start-loading', function() {
      win.webContents.send('view-event', { tabId: tabId, type: 'loading' });
    });

    view.webContents.on('dom-ready', function() {
    });

    view.webContents.on('did-stop-loading', function() {
      const pageUrl = view.webContents.getURL();
      win.webContents.send('view-event', {
        tabId: tabId, type: 'loaded',
        url: pageUrl,
        title: view.webContents.getTitle(),
      });
    });

    view.webContents.on('page-title-updated', function(ev, title) {
      win.webContents.send('view-event', { tabId: tabId, type: 'title', title: title });
    });

    view.webContents.on('did-navigate', function(ev, navUrl) {
      win.webContents.send('view-event', { tabId: tabId, type: 'navigate', url: navUrl });
    });

    view.webContents.on('did-navigate-in-page', function(ev, navUrl) {
      win.webContents.send('view-event', { tabId: tabId, type: 'navigate', url: navUrl });
    });

    view.webContents.on('did-fail-load', function(ev, errCode, errDesc, validatedUrl, isMainFrame) {
      if (!isMainFrame) return;
      if (!validatedUrl || validatedUrl.startsWith('data:') || validatedUrl.startsWith('file:')) return;
      const desc = errDesc || '';
      const dangerErrors = ['ERR_CONNECTION_REFUSED','ERR_SSL_VERSION_OR_CIPHER_MISMATCH','ERR_SSL_PROTOCOL_ERROR','ERR_CERT_AUTHORITY_INVALID','ERR_CERT_COMMON_NAME_INVALID','ERR_CERT_DATE_INVALID','ERR_SSL_OBSOLETE_CIPHER'];
      const netErrors = ['ERR_INTERNET_DISCONNECTED','ERR_NAME_NOT_RESOLVED','ERR_NETWORK_CHANGED','ERR_CONNECTION_TIMED_OUT','ERR_CONNECTION_RESET','ERR_ADDRESS_UNREACHABLE'];
      if (dangerErrors.some(e => desc.includes(e))) {
        win.webContents.send('site-dangerous', { tabId: tabId, errorCode: desc, url: validatedUrl });
      } else if (netErrors.some(e => desc.includes(e))) {
        win.webContents.send('page-load-error', { tabId: tabId, errorCode: desc, url: validatedUrl });
      }
    });

    view.webContents.setWindowOpenHandler(function(details) {
      const url = details.url;
      // External protocol (not http/https/about/data) → ask user first
      if (url && !/^(https?:|about:|data:)/i.test(url)) {
        win.webContents.send('proto-launch-request', { url: url });
        return { action: 'deny' };
      }
      win.webContents.send('view-event', { tabId: tabId, type: 'new-window', url: url });
      return { action: 'deny' };
    });

    // Also intercept will-navigate for external protocols (links clicked inside page)
    view.webContents.on('will-navigate', function(event, navUrl) {
      if (navUrl && !/^(https?:|about:|data:|file:|ridell:)/i.test(navUrl)) {
        event.preventDefault();
        win.webContents.send('proto-launch-request', { url: navUrl });
      }
    });

    view.webContents.session.on('will-download', function(event, item) {
      const dlId = Date.now().toString();
      win.webContents.send('download-start', { id: dlId, filename: item.getFilename(), total: item.getTotalBytes() });
      item.on('updated', function(ev, st) {
        if (st === 'progressing') {
          win.webContents.send('download-update', { id: dlId, received: item.getReceivedBytes(), total: item.getTotalBytes() });
        }
      });
      item.once('done', function(ev, st) {
        win.webContents.send('download-done', { id: dlId, state: st, filename: item.getFilename(), savePath: st === 'completed' ? item.getSavePath() : null });
      });
    });
  }

  state.activeViewId = tabId;
  win.setBrowserView(state.views[tabId]);
  state.views[tabId].setBounds(getViewBounds(win));
  state.views[tabId].webContents.loadURL(url);
});

ipcMain.on('view-show', function(e, data) {
  const win = winFromEvent(e);
  const state = getState(win);
  if (state.views[data.tabId]) {
    state.activeViewId = data.tabId;
    win.setBrowserView(state.views[data.tabId]);
    state.views[data.tabId].setBounds(getViewBounds(win));
  }
});

ipcMain.on('view-hide', function(e) {
  const win = winFromEvent(e);
  const state = getState(win);
  win.setBrowserView(null);
  state.activeViewId = null;
});

ipcMain.on('view-destroy', function(e, data) {
  const win = winFromEvent(e);
  const state = getState(win);
  if (state.views[data.tabId]) {
    if (state.activeViewId === data.tabId) { win.setBrowserView(null); state.activeViewId = null; }
    state.views[data.tabId].webContents.destroy();
    delete state.views[data.tabId];
  }
});

ipcMain.on('view-back', function(e, data) { const s = getState(winFromEvent(e)); if (s.views[data.tabId]) s.views[data.tabId].webContents.goBack(); });
ipcMain.on('view-fwd', function(e, data) { const s = getState(winFromEvent(e)); if (s.views[data.tabId]) s.views[data.tabId].webContents.goForward(); });
ipcMain.on('view-reload', function(e, data) { const s = getState(winFromEvent(e)); if (s.views[data.tabId]) s.views[data.tabId].webContents.reload(); });

ipcMain.on('view-zoom', function(e, data) {
  const s = getState(winFromEvent(e));
  if (s.views[data.tabId]) s.views[data.tabId].webContents.setZoomFactor(data.factor);
});

ipcMain.on('view-find', function(e, data) {
  const s = getState(winFromEvent(e));
  if (s.views[data.tabId]) s.views[data.tabId].webContents.executeJavaScript(
    'window.find && window.find("", false, false, true)'
  );
});

ipcMain.on('win-fullscreen', function(e) {
  const win = winFromEvent(e);
  win.setFullScreen(!win.isFullScreen());
});

ipcMain.on('new-window', function(e) {
  createWindow(null);
});

// ── CONTEXT MENU ACTIONS
ipcMain.on('ctx-action', function(e, data) {
  const win = winFromEvent(e);
  const state = getState(win);
  const view = state.views[data.tabId];
  if (!view) return;
  if (data.action === 'saveas') view.webContents.downloadURL(view.webContents.getURL());
  if (data.action === 'print') view.webContents.print();
});

// ── BROWSER IMPORT
const os = require('os');
const { dialog } = require('electron');

function getBrowserProfiles() {
  const home = os.homedir();
  const win = process.platform === 'win32';
  const mac = process.platform === 'darwin';
  const found = [];

  const candidates = [
    {
      id: 'chrome', name: 'Google Chrome', icon: '🌐',
      paths: win
        ? [path.join(process.env.LOCALAPPDATA||'', 'Google','Chrome','User Data')]
        : mac
          ? [path.join(home,'Library','Application Support','Google','Chrome')]
          : [path.join(home,'.config','google-chrome')]
    },
    {
      id: 'edge', name: 'Microsoft Edge', icon: '🔵',
      paths: win
        ? [path.join(process.env.LOCALAPPDATA||'', 'Microsoft','Edge','User Data')]
        : mac
          ? [path.join(home,'Library','Application Support','Microsoft Edge')]
          : [path.join(home,'.config','microsoft-edge')]
    },
    {
      id: 'brave', name: 'Brave', icon: '🦁',
      paths: win
        ? [path.join(process.env.LOCALAPPDATA||'', 'BraveSoftware','Brave-Browser','User Data')]
        : mac
          ? [path.join(home,'Library','Application Support','BraveSoftware','Brave-Browser')]
          : [path.join(home,'.config','BraveSoftware','Brave-Browser')]
    },
    {
      id: 'firefox', name: 'Firefox', icon: '🦊',
      paths: win
        ? [path.join(process.env.APPDATA||'', 'Mozilla','Firefox','Profiles')]
        : mac
          ? [path.join(home,'Library','Application Support','Firefox','Profiles')]
          : [path.join(home,'.mozilla','firefox')]
    },
    {
      id: 'opera', name: 'Opera', icon: '🔴',
      paths: win
        ? [path.join(process.env.APPDATA||'', 'Opera Software','Opera Stable')]
        : mac
          ? [path.join(home,'Library','Application Support','com.operasoftware.Opera')]
          : [path.join(home,'.config','opera')]
    },
  ];

  for (const c of candidates) {
    for (const p of c.paths) {
      if (fs.existsSync(p)) {
        found.push({ id: c.id, name: c.name, icon: c.icon, profilePath: p });
        break;
      }
    }
  }
  return found;
}

function readChromeBookmarks(profilePath) {
  const results = [];
  // Chrome/Edge/Brave store bookmarks in Default/Bookmarks (JSON)
  const bookmarkFile = path.join(profilePath, 'Default', 'Bookmarks');
  if (!fs.existsSync(bookmarkFile)) return results;
  try {
    const data = JSON.parse(fs.readFileSync(bookmarkFile, 'utf8'));
    function walk(node) {
      if (!node) return;
      if (node.type === 'url') results.push({ title: node.name, url: node.url });
      if (node.children) node.children.forEach(walk);
    }
    const roots = data.roots || {};
    Object.values(roots).forEach(walk);
  } catch(e) {}
  return results.slice(0, 500);
}

function readChromeHistory(profilePath) {
  // Chrome history is SQLite — we can't read it while Chrome is open (locked)
  // We copy to temp then read
  const results = [];
  const histFile = path.join(profilePath, 'Default', 'History');
  if (!fs.existsSync(histFile)) return results;
  const tmp = path.join(os.tmpdir(), 'pb_chrome_hist_' + Date.now());
  try {
    fs.copyFileSync(histFile, tmp);
    // Use better-sqlite3 if available, otherwise skip
    try {
      const Database = require('better-sqlite3');
      const db = new Database(tmp, { readonly: true });
      const rows = db.prepare('SELECT url, title, last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT 500').all();
      db.close();
      rows.forEach(r => results.push({ url: r.url, title: r.title || r.url, ts: Date.now() }));
    } catch(e) {
      // better-sqlite3 not available — return empty, UI will show warning
    }
  } catch(e) {}
  try { fs.unlinkSync(tmp); } catch(e) {}
  return results;
}

function readFirefoxBookmarks(profilePath) {
  const results = [];
  // Firefox profiles are subdirs ending in .default or .default-release
  let dirs = [];
  try { dirs = fs.readdirSync(profilePath); } catch(e) { return results; }
  const profileDir = dirs.find(d => d.endsWith('.default-release') || d.endsWith('.default') || d.includes('default'));
  if (!profileDir) return results;
  const placesSqlite = path.join(profilePath, profileDir, 'places.sqlite');
  if (!fs.existsSync(placesSqlite)) return results;
  const tmp = path.join(os.tmpdir(), 'pb_ff_places_' + Date.now());
  try {
    fs.copyFileSync(placesSqlite, tmp);
    try {
      const Database = require('better-sqlite3');
      const db = new Database(tmp, { readonly: true });
      const rows = db.prepare(
        `SELECT moz_bookmarks.title, moz_places.url
         FROM moz_bookmarks JOIN moz_places ON moz_bookmarks.fk = moz_places.id
         WHERE moz_bookmarks.type = 1 AND moz_places.url NOT LIKE 'place:%'
         LIMIT 500`
      ).all();
      db.close();
      rows.forEach(r => results.push({ title: r.title || r.url, url: r.url }));
    } catch(e) {}
  } catch(e) {}
  try { fs.unlinkSync(tmp); } catch(e) {}
  return results;
}

// ── DEFAULT BROWSER (Windows only)
const { execSync } = require('child_process');

function getExePath() {
  // In packaged app: process.execPath. In dev: use electron itself.
  return app.isPackaged ? process.execPath : process.execPath;
}

function regSet(key, name, type, value) {
  // name='' means default value
  const n = name ? `/v "${name}"` : '/ve';
  const t = `/t ${type}`;
  const v = `/d "${value.replace(/"/g, '\\"')}"`;
  try {
    execSync(`reg add "${key}" ${n} ${t} ${v} /f`, { stdio: 'pipe' });
  } catch(e) {}
}

function registerDefaultBrowser() {
  if (process.platform !== 'win32') return false;
  const exe = getExePath();
  const appId = 'PoleBrowse';
  const capKey = `HKCU\\Software\\${appId}\\Capabilities`;

  // App capabilities
  regSet(`HKCU\\Software\\${appId}`, '', 'REG_SZ', 'PoleBrowse');
  regSet(capKey, 'ApplicationName', 'REG_SZ', 'PoleBrowse');
  regSet(capKey, 'ApplicationDescription', 'REG_SZ', 'Fast, private browser by RidelL');
  regSet(`${capKey}\\URLAssociations`, 'http',  'REG_SZ', appId + 'URL');
  regSet(`${capKey}\\URLAssociations`, 'https', 'REG_SZ', appId + 'URL');
  regSet(`${capKey}\\URLAssociations`, 'ftp',   'REG_SZ', appId + 'URL');
  regSet(`${capKey}\\FileAssociations`, '.htm',  'REG_SZ', appId + 'HTML');
  regSet(`${capKey}\\FileAssociations`, '.html', 'REG_SZ', appId + 'HTML');

  // Register as application in Windows
  regSet('HKCU\\Software\\RegisteredApplications', appId, 'REG_SZ', capKey);

  // URL handler class (http/https/ftp)
  const urlClass = `HKCU\\Software\\Classes\\${appId}URL`;
  regSet(urlClass, '', 'REG_SZ', 'PoleBrowse URL');
  regSet(urlClass, 'FriendlyTypeName', 'REG_SZ', 'PoleBrowse URL');
  regSet(`${urlClass}\\shell\\open\\command`, '', 'REG_SZ', `"${exe}" "%1"`);
  regSet(urlClass, 'URL Protocol', 'REG_SZ', '');

  // HTML file handler
  const htmlClass = `HKCU\\Software\\Classes\\${appId}HTML`;
  regSet(htmlClass, '', 'REG_SZ', 'PoleBrowse HTML Document');
  regSet(`${htmlClass}\\shell\\open\\command`, '', 'REG_SZ', `"${exe}" "%1"`);

  // Map http/https/ftp to our class under User Choice (preferred, no UAC needed)
  for (const proto of ['http', 'https', 'ftp']) {
    try {
      execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\${proto}\\UserChoice" /v ProgId /t REG_SZ /d "${appId}URL" /f`, { stdio: 'pipe' });
    } catch(e) {}
  }

  return true;
}

function isDefaultBrowser() {
  if (process.platform !== 'win32') return false;
  try {
    const out = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice" /v ProgId', { stdio: 'pipe' }).toString();
    return out.includes('PoleBrowseURL');
  } catch(e) { return false; }
}

ipcMain.handle('default-browser-status', function() {
  return { isDefault: isDefaultBrowser(), isWindows: process.platform === 'win32' };
});

ipcMain.handle('set-default-browser', function() {
  if (process.platform !== 'win32') return { ok: false, reason: 'Not Windows' };
  const ok = registerDefaultBrowser();
  // Open Windows default apps settings so user can confirm
  try { execSync('start ms-settings:defaultapps', { stdio: 'pipe' }); } catch(e) {}
  return { ok, isDefault: isDefaultBrowser() };
});

ipcMain.handle('import-list-browsers', function() {
  return getBrowserProfiles();
});

ipcMain.handle('import-browser-data', function(e, { browserId, profilePath, what }) {
  const result = { bookmarks: [], history: [], warnings: [] };
  if (browserId === 'firefox') {
    if (what.bookmarks) result.bookmarks = readFirefoxBookmarks(profilePath);
    if (what.history) result.warnings.push('Firefox history import requires better-sqlite3.');
  } else {
    // Chrome-family
    if (what.bookmarks) result.bookmarks = readChromeBookmarks(profilePath);
    if (what.history) {
      result.history = readChromeHistory(profilePath);
      if (!result.history.length) result.warnings.push('History requires better-sqlite3 to be installed (npm i better-sqlite3). Bookmarks still imported.');
    }
  }
  return result;
});

ipcMain.handle('import-pick-folder', async function() {
  const { filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Select browser profile folder' });
  return filePaths[0] || null;
});

// ── EXTERNAL PROTOCOL HANDLER
ipcMain.on('proto-open-external', function(e, data) {
  if (data && data.url) shell.openExternal(data.url).catch(function() {});
});

// ── AUTOCOMPLETE IPC ──────────────────────────────────────────────────────────
// Fetch from main process to avoid CORS restrictions in renderer
function netFetch(url, headers) {
  return new Promise(function(resolve, reject) {
    const req = net.request({ url: url, method: 'GET' });
    if (headers) Object.keys(headers).forEach(k => req.setHeader(k, headers[k]));
    var body = '';
    req.on('response', function(resp) {
      resp.on('data', function(chunk) { body += chunk.toString(); });
      resp.on('end', function() { resolve(body); });
      resp.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

ipcMain.handle('autocomplete', async function(e, { query }) {
  if (!query || !query.trim()) return [];
  const q = query.trim();
  const results = [];

  try {
    // ── Google autocomplete (same API Chrome uses)
    const googleUrl = 'https://suggestqueries.google.com/complete/search?client=chrome&q=' + encodeURIComponent(q);
    const googleRaw = await netFetch(googleUrl, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    });
    const googleJson = JSON.parse(googleRaw);
    // Format: [query, [suggestions], [], [], {google:{ ...relevance data}}]
    const suggestions = googleJson[1] || [];
    const relevance   = (googleJson[4] && googleJson[4]['google:suggestrelevance']) || [];
    suggestions.forEach(function(s, i) {
      results.push({ type: 'search', text: s, relevance: relevance[i] || (1000 - i * 10) });
    });
  } catch(err) {
    // Google failed — fall through to DDG
  }

  // ── DuckDuckGo fallback if Google returned nothing
  if (!results.length) {
    try {
      const ddgUrl = 'https://duckduckgo.com/ac/?q=' + encodeURIComponent(q) + '&type=list';
      const ddgRaw = await netFetch(ddgUrl, { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' });
      const ddgJson = JSON.parse(ddgRaw);
      const ddgSugs = Array.isArray(ddgJson[1]) ? ddgJson[1] : ddgJson.map(x => x.phrase || x).filter(Boolean);
      ddgSugs.forEach(function(s, i) {
        results.push({ type: 'search', text: s, relevance: 900 - i * 10 });
      });
    } catch(err) {}
  }

  // Sort by relevance desc, dedupe, cap at 8
  const seen = new Set();
  return results
    .sort((a, b) => b.relevance - a.relevance)
    .filter(function(r) {
      if (seen.has(r.text)) return false;
      seen.add(r.text);
      return true;
    })
    .slice(0, 8);
});

// ── APP READY
app.whenReady().then(function() {
  // Apply DNS-over-HTTPS immediately
  applyDns(session.defaultSession, activeDnsKey);

  const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  session.defaultSession.setUserAgent(CHROME_UA);

  // Ad blocker
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['*://*/*'] },
    function(details, callback) {
      if (isAdHost(details.url)) {
        callback({ cancel: true });
      } else {
        callback({ cancel: false });
      }
    }
  );

  // Allow Google Fonts in the app renderer (Electron enforces real CSP, <meta> tags are ignored)
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*'] },
    function(details, callback) {
      var h = details.responseHeaders || {};
      delete h['content-security-policy'];
      delete h['Content-Security-Policy'];
      h['Access-Control-Allow-Origin'] = ['*'];
      callback({ responseHeaders: h });
    }
  );

  createWindow();

  app.on('activate', function() {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function() {
  if (process.platform !== 'darwin') app.quit();
});

// ── VPN IPC HANDLERS ─────────────────────────────────────────
ipcMain.handle('get-vpn-state', function() {
  return { providers: VPN_PROVIDERS, active: activeVpnKey, enabled: vpnEnabled };
});

ipcMain.handle('set-vpn-provider', function(e, key) {
  if (!VPN_PROVIDERS[key]) return { success: false, error: 'Unknown provider' };
  activeVpnKey = key;
  if (vpnEnabled) applyProxy(session.defaultSession, key);
  return { success: true, provider: VPN_PROVIDERS[key].name };
});

ipcMain.handle('toggle-vpn', function(e, enable) {
  vpnEnabled = enable;
  if (enable) {
    applyProxy(session.defaultSession, activeVpnKey);
  } else {
    disableProxy(session.defaultSession);
  }
  return { success: true, enabled: vpnEnabled };
});

ipcMain.handle('set-custom-proxy', function(e, data) {
  customProxyHost = data.host || '127.0.0.1';
  customProxyPort = parseInt(data.port) || 1080;
  customProxyType = data.type || 'socks5';
  VPN_PROVIDERS.custom.host = customProxyHost;
  VPN_PROVIDERS.custom.port = customProxyPort;
  VPN_PROVIDERS.custom.type = customProxyType;
  if (vpnEnabled && activeVpnKey === 'custom') applyProxy(session.defaultSession, 'custom');
  return { success: true };
});

ipcMain.handle('test-vpn', async function() {
  try {
    const result = await session.defaultSession.resolveHost('example.com');
    return { success: true, addresses: result.endpoints ? result.endpoints.map(e => e.address) : [] };
  } catch(err) {
    return { success: false, error: err.message };
  }
});

// ── ADBLOCKER IPC ────────────────────────────────────────────────
ipcMain.handle('get-adblocker-state', function() {
  return { enabled: adBlockEnabled, blockedCount: globalBlockedCount };
});

ipcMain.handle('toggle-adblocker', function(e, enable) {
  adBlockEnabled = enable;
  return { success: true, enabled: adBlockEnabled };
});

// ── DNS IPC HANDLERS ─────────────────────────────────────────────
ipcMain.handle('get-dns-providers', function() {
  return { providers: DNS_PROVIDERS, active: activeDnsKey, enabled: dnsEnabled };
});

ipcMain.handle('set-dns-provider', function(e, key) {
  if (!DNS_PROVIDERS[key]) return { success: false, error: 'Unknown provider' };
  applyDns(session.defaultSession, key);
  return { success: true, provider: DNS_PROVIDERS[key].name };
});

ipcMain.handle('toggle-dns', function(e, enable) {
  if (enable) {
    applyDns(session.defaultSession, activeDnsKey);
  } else {
    disableDns();
  }
  return { success: true, enabled: dnsEnabled };
});

ipcMain.handle('test-dns', async function() {
  try {
    const result = await session.defaultSession.resolveHost('cloudflare.com');
    return { success: true, addresses: result.endpoints ? result.endpoints.map(e => e.address) : [] };
  } catch(err) {
    return { success: false, error: err.message };
  }
});

// ── VPN IPC HANDLERS ─────────────────────────────────────────────
ipcMain.handle('get-vpn-state', function() {
  return { providers: VPN_PROVIDERS, active: activeVpnKey, enabled: vpnEnabled,
           customHost: customProxyHost, customPort: customProxyPort, customType: customProxyType };
});

ipcMain.handle('set-vpn-provider', function(e, key) {
  if (!VPN_PROVIDERS[key]) return { success: false, error: 'Unknown provider' };
  activeVpnKey = key;
  if (vpnEnabled) applyProxy(session.defaultSession, key);
  return { success: true, provider: VPN_PROVIDERS[key].name };
});

ipcMain.handle('toggle-vpn', function(e, enable, opts) {
  vpnEnabled = enable;
  if (opts) {
    if (opts.host) customProxyHost = opts.host;
    if (opts.port) customProxyPort = parseInt(opts.port);
    if (opts.type) customProxyType = opts.type;
    VPN_PROVIDERS.custom.host = customProxyHost;
    VPN_PROVIDERS.custom.port = customProxyPort;
    VPN_PROVIDERS.custom.type = customProxyType;
  }
  if (enable) {
    applyProxy(session.defaultSession, activeVpnKey);
  } else {
    disableProxy(session.defaultSession);
  }
  return { success: true, enabled: vpnEnabled };
});

ipcMain.handle('test-proxy', async function() {
  try {
    const { net } = require('electron');
    const req = net.request({ method: 'GET', url: 'https://api.ipify.org?format=json', useSessionCookies: false });
    return await new Promise((resolve) => {
      req.on('response', (resp) => {
        let data = '';
        resp.on('data', chunk => data += chunk);
        resp.on('end', () => {
          try { resolve({ success: true, ip: JSON.parse(data).ip }); }
          catch(e) { resolve({ success: true, ip: data.trim() }); }
        });
      });
      req.on('error', err => resolve({ success: false, error: err.message }));
      req.end();
    });
  } catch(err) {
    return { success: false, error: err.message };
  }
});

// ── ADBLOCK IPC ──────────────────────────────────────────────────
ipcMain.handle('get-adblock-state', function() {
  return { enabled: adBlockEnabled, blockedCount: global._blockedCount || 0 };
});
ipcMain.handle('toggle-adblock', function(e, enable) {
  adBlockEnabled = enable;
  return { success: true, enabled: adBlockEnabled };
});

