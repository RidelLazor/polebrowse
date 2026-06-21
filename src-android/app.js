'use strict';

var tabs = [], activeId = null, tid = 0;
var hist = JSON.parse(localStorage.getItem('pb_hist') || '[]');
var downloads = {};
var isUrlFocused = false;

function fixUrl(raw) {
  raw = (raw || '').trim();
  if (!raw) return null;
  if (/^ridell:\/\//.test(raw)) return raw;
  if (/^https?:\/\//.test(raw)) return raw;
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(raw) && !raw.includes(' ')) return 'https://' + raw;
  var base = window._searchBase || 'https://www.google.com/search?q=';
  return base + encodeURIComponent(raw);
}

function favUrl(url) {
  try { return 'https://www.google.com/s2/favicons?domain=' + new URL(url).hostname + '&sz=32'; }
  catch { return null; }
}

function showToast(msg) {
  var t = document.getElementById('pb-toast');
  if (!t) return;
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(t._hide);
  t._hide = setTimeout(function() { t.style.display = 'none'; }, 2500);
}

function closeAllSheets() {
  document.getElementById('tab-switcher').classList.remove('open');
  document.getElementById('settings-sheet').classList.remove('open');
  document.getElementById('history-sheet').classList.remove('open');
  document.getElementById('downloads-sheet').classList.remove('open');
  document.getElementById('bmenu').classList.add('bmenu-hidden');
}

// ── TABS

function addTab(url, title) {
  var id = ++tid;
  var tab = { id: id, url: url || '', title: title || 'New Tab', webview: null };
  tabs.push(tab);
  if (!activeId) { activeId = id; }
  renderTabs();
  if (url) { navigateTab(id, url); }
  else { showHomepage(); }
  return id;
}

function removeTab(id) {
  var idx = tabs.findIndex(function(t) { return t.id === id; });
  if (idx === -1) return;
  tabs.splice(idx, 1);
  if (id === activeId) {
    activeId = tabs.length ? tabs[tabs.length - 1].id : null;
  }
  renderTabs();
  if (activeId) { var t = tabs.find(function(x) { return x.id === activeId; }); if (t && t.url) navigateTab(t.id, t.url); else showHomepage(); }
  else { showHomepage(); }
}

function activateTab(id) {
  activeId = id;
  renderTabs();
  closeAllSheets();
  var t = tabs.find(function(x) { return x.id === id; });
  if (t && t.url) { showWebview(); updateUrlbar(t.url); }
  else { showHomepage(); }
}

function navigateTab(id, url) {
  var t = tabs.find(function(x) { return x.id === id; });
  if (!t) return;
  t.url = url;
  t.title = url;
  addHist(url, url);
  showWebview();
  updateUrlbar(url);
  renderTabs();
  // In Tauri, we'd dispatch to the native webview
  window.ipc.send('view-navigate', { tabId: id, url: url });
}

function renderTabs() {
  var counter = document.getElementById('ts-counter');
  if (counter) counter.textContent = tabs.length + ' tab' + (tabs.length !== 1 ? 's' : '');
  var list = document.getElementById('ts-list');
  if (!list) return;
  list.innerHTML = '';
  tabs.forEach(function(t) {
    var card = document.createElement('div');
    card.className = 'ts-card' + (t.id === activeId ? ' active' : '');
    card.innerHTML = '<img class="ts-card-fav" src="' + (favUrl(t.url) || '') + '" onerror="this.style.display=\'none\'">' +
      '<span class="ts-card-title">' + escapeHtml(t.title || 'New Tab') + '</span>' +
      '<button class="ts-card-x" data-id="' + t.id + '">&#x2715;</button>';
    card.addEventListener('click', function(e) {
      if (e.target.closest('.ts-card-x')) return;
      activateTab(t.id);
    });
    var xBtn = card.querySelector('.ts-card-x');
    if (xBtn) xBtn.addEventListener('click', function(e) { e.stopPropagation(); removeTab(t.id); });
    list.appendChild(card);
  });
}

// ── URL BAR

var urlbar = document.getElementById('urlbar');
var hpSearch = document.getElementById('hp-search');

function updateUrlbar(url) {
  urlbar.value = url || '';
  urlbar.classList.remove('focused');
}

urlbar.addEventListener('focus', function() {
  isUrlFocused = true;
  urlbar.select();
});

urlbar.addEventListener('blur', function() {
  isUrlFocused = false;
});

urlbar.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    navigateFromUrlbar(urlbar.value);
    urlbar.blur();
  }
});

hpSearch.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    navigateFromUrlbar(hpSearch.value);
    hpSearch.blur();
  }
});

function navigateFromUrlbar(val) {
  var url = fixUrl(val);
  if (!url) return;
  if (!activeId) { addTab(url, val); return; }
  var t = tabs.find(function(x) { return x.id === activeId; });
  if (t) navigateTab(activeId, url);
  else addTab(url, val);
}

function showHomepage() {
  document.getElementById('homepage').style.display = 'flex';
  document.getElementById('webview-container').classList.remove('active');
  document.getElementById('webview-container').style.display = 'none';
  urlbar.value = '';
}

function showWebview() {
  document.getElementById('homepage').style.display = 'none';
  document.getElementById('webview-container').style.display = 'block';
  document.getElementById('webview-container').classList.add('active');
}

// ── NAVIGATION BUTTONS

document.getElementById('tb-back').addEventListener('click', function() {
  if (activeId) window.ipc.send('view-back', { tabId: activeId });
});
document.getElementById('tb-fwd').addEventListener('click', function() {
  if (activeId) window.ipc.send('view-fwd', { tabId: activeId });
});
document.getElementById('tb-refresh').addEventListener('click', function() {
  if (activeId) window.ipc.send('view-reload', { tabId: activeId });
});
document.getElementById('tb-home').addEventListener('click', function() {
  showHomepage();
  if (activeId) {
    var t = tabs.find(function(x) { return x.id === activeId; });
    if (t) { t.url = ''; t.title = 'New Tab'; }
  }
  renderTabs();
});

document.getElementById('tb-tabs').addEventListener('click', function() {
  closeAllSheets();
  renderTabs();
  document.getElementById('tab-switcher').classList.add('open');
});

document.getElementById('tb-menu').addEventListener('click', function() {
  closeAllSheets();
  document.getElementById('bmenu').classList.toggle('bmenu-hidden');
});

document.getElementById('ts-close').addEventListener('click', function() {
  document.getElementById('tab-switcher').classList.remove('open');
});

document.getElementById('ts-newtab').addEventListener('click', function() {
  addTab('', 'New Tab');
  document.getElementById('tab-switcher').classList.remove('open');
  showHomepage();
});

// ── BOTTOM MENU

document.querySelectorAll('.bmenu-item').forEach(function(item) {
  item.addEventListener('click', function() {
    var action = item.dataset.action;
    document.getElementById('bmenu').classList.add('bmenu-hidden');
    switch (action) {
      case 'history': openHistory(); break;
      case 'downloads': openDownloads(); break;
      case 'settings': openSettings(); break;
      case 'adblock': toggleAdblock(); break;
      case 'dns': toggleDns(); break;
      case 'exit': window.ipc.send('app-exit'); break;
    }
  });
});

// ── HISTORY

function addHist(url, title) {
  hist.unshift({ url: url, title: title || url, time: Date.now() });
  if (hist.length > 500) hist.length = 500;
  localStorage.setItem('pb_hist', JSON.stringify(hist));
}

function openHistory() {
  closeAllSheets();
  var list = document.getElementById('hs-list');
  list.innerHTML = '';
  if (!hist.length) { list.innerHTML = '<div class="empty-state">No history yet</div>'; }
  else {
    hist.forEach(function(h) {
      var el = document.createElement('div');
      el.className = 'hs-item';
      el.innerHTML = '<img class="hs-fav" src="' + (favUrl(h.url) || '') + '" onerror="this.style.display=\'none\'">' +
        '<div style="flex:1;min-width:0"><div class="hs-url">' + escapeHtml(h.url) + '</div><div class="hs-title">' + escapeHtml(h.title) + '</div></div>';
      el.addEventListener('click', function() { navigateFromUrlbar(h.url); closeAllSheets(); });
      list.appendChild(el);
    });
  }
  document.getElementById('history-sheet').classList.add('open');
}

document.getElementById('hs-close').addEventListener('click', function() {
  document.getElementById('history-sheet').classList.remove('open');
});
document.getElementById('hs-clear').addEventListener('click', function() {
  hist = [];
  localStorage.removeItem('pb_hist');
  openHistory();
  showToast('History cleared');
});

// ── DOWNLOADS

function openDownloads() {
  closeAllSheets();
  var list = document.getElementById('ds-list');
  list.innerHTML = '';
  var items = Object.values(downloads);
  if (!items.length) { list.innerHTML = '<div class="empty-state">No downloads</div>'; }
  else {
    items.forEach(function(d) {
      var el = document.createElement('div');
      el.className = 'ds-item';
      el.innerHTML = '<span class="ds-name">' + escapeHtml(d.name || 'file') + '</span><span class="ds-status">' + (d.status || '') + '</span>';
      list.appendChild(el);
    });
  }
  document.getElementById('downloads-sheet').classList.add('open');
}

document.getElementById('ds-close').addEventListener('click', function() {
  document.getElementById('downloads-sheet').classList.remove('open');
});

// ── SETTINGS

function openSettings() {
  closeAllSheets();
  renderSettings();
  document.getElementById('settings-sheet').classList.add('open');
}

document.getElementById('ss-close').addEventListener('click', function() {
  document.getElementById('settings-sheet').classList.remove('open');
});

function renderSettings() {
  var body = document.getElementById('ss-body');
  body.innerHTML =
    // Appearance
    '<div class="ss-section"><div class="ss-section-title">Appearance</div>' +
    '<div class="ss-row"><div class="ss-row-left"><div class="ss-row-label">Theme</div><div class="ss-row-desc">' + themeName() + '</div></div>' +
    '<div class="ss-toggle-group"><button class="ss-tog' + (currentTheme === 'dark' ? ' active' : '') + '" data-theme="dark">Dark</button>' +
    '<button class="ss-tog' + (currentTheme === 'light' ? ' active' : '') + '" data-theme="light">Light</button></div></div>' +
    '<div class="ss-row"><div class="ss-row-left"><div class="ss-row-label">Search engine</div><div class="ss-row-desc">' + window._searchBase + '</div></div>' +
    '<select class="ss-select" id="ss-search-engine">' +
    '<option value="https://www.google.com/search?q=" ' + (window._searchBase === 'https://www.google.com/search?q=' ? 'selected' : '') + '>Google</option>' +
    '<option value="https://duckduckgo.com/?q=" ' + (window._searchBase === 'https://duckduckgo.com/?q=' ? 'selected' : '') + '>DuckDuckGo</option>' +
    '<option value="https://www.bing.com/search?q=" ' + (window._searchBase === 'https://www.bing.com/search?q=' ? 'selected' : '') + '>Bing</option>' +
    '<option value="https://search.brave.com/search?q=" ' + (window._searchBase === 'https://search.brave.com/search?q=' ? 'selected' : '') + '>Brave</option>' +
    '</select></div></div>' +
    // DNS
    '<div class="ss-section"><div class="ss-section-title">Security & DNS</div>' +
    '<div class="ss-row"><div class="ss-row-left"><div class="ss-row-label">DNS Protection</div><div class="ss-row-desc">Encrypts DNS queries</div></div>' +
    '<label class="ss-switch"><input type="checkbox" id="ss-dns-toggle"><span class="ss-slider"></span></label></div>' +
    '<div class="ss-row"><div class="ss-row-left"><div class="ss-row-label">DNS Provider</div><div class="ss-row-desc" id="ss-dns-provider">Cloudflare</div></div>' +
    '<select class="ss-select" id="ss-dns-provider-select">' +
    '<option value="cloudflare">Cloudflare</option><option value="google">Google</option><option value="quad9">Quad9</option>' +
    '<option value="adguard">AdGuard</option><option value="nextdns">NextDNS</option></select></div></div>' +
    // VPN
    '<div class="ss-section"><div class="ss-section-title">VPN & Proxy</div>' +
    '<div class="ss-row"><div class="ss-row-left"><div class="ss-row-label">VPN</div><div class="ss-row-desc" id="ss-vpn-status">Off</div></div>' +
    '<label class="ss-switch"><input type="checkbox" id="ss-vpn-toggle"><span class="ss-slider"></span></label></div>' +
    '<div class="ss-row"><div class="ss-row-left"><div class="ss-row-label">Provider</div></div>' +
    '<select class="ss-select" id="ss-vpn-provider">' +
    '<option value="none">Direct</option><option value="tor">Tor</option><option value="i2p">I2P</option>' +
    '<option value="privoxy">Privoxy</option><option value="mullvad">Mullvad</option><option value="custom">Custom</option></select></div></div>' +
    // AdBlock
    '<div class="ss-section"><div class="ss-section-title">Ad Blocker</div>' +
    '<div class="ss-row"><div class="ss-row-left"><div class="ss-row-label">Block ads & trackers</div></div>' +
    '<label class="ss-switch"><input type="checkbox" id="ss-adb-toggle"><span class="ss-slider"></span></label></div></div>' +
    // Data
    '<div class="ss-section"><div class="ss-section-title">Data</div>' +
    '<div class="ss-row"><div class="ss-row-left"><div class="ss-row-label">Clear all browsing data</div><div class="ss-row-desc">History, downloads, cache</div></div>' +
    '<button class="ss-btn danger" id="ss-clear-data">Clear</button></div></div>' +
    '<div class="ss-section"><div class="ss-section-title">About</div>' +
    '<div class="ss-row"><div class="ss-row-left"><div class="ss-row-label">PoleBrowse for Android</div><div class="ss-row-desc">v1.5.0</div></div></div></div>';

  // Wire up settings events
  body.querySelectorAll('.ss-tog').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var theme = btn.dataset.theme;
      setTheme(theme);
      renderSettings();
    });
  });

  var searchSelect = document.getElementById('ss-search-engine');
  if (searchSelect) searchSelect.addEventListener('change', function() {
    window._searchBase = searchSelect.value;
    localStorage.setItem('pb_search_engine', searchSelect.value);
  });

  var dnsToggle = document.getElementById('ss-dns-toggle');
  if (dnsToggle) {
    window.ipc.invoke('get-dns-state').then(function(s) { dnsToggle.checked = s && s.enabled; }).catch(function() {});
    dnsToggle.addEventListener('change', function() {
      window.ipc.send('toggle-dns', { enabled: dnsToggle.checked });
    });
  }

  var vpnToggle = document.getElementById('ss-vpn-toggle');
  if (vpnToggle) {
    vpnToggle.addEventListener('change', function() {
      window.ipc.send('toggle-vpn', { enabled: vpnToggle.checked });
    });
  }

  var dnsSelect = document.getElementById('ss-dns-provider-select');
  if (dnsSelect) dnsSelect.addEventListener('change', function() {
    window.ipc.send('set-dns-provider', { provider: dnsSelect.value });
  });

  var vpnSelect = document.getElementById('ss-vpn-provider');
  if (vpnSelect) vpnSelect.addEventListener('change', function() {
    window.ipc.send('set-vpn-provider', { provider: vpnSelect.value });
  });

  var adbToggle = document.getElementById('ss-adb-toggle');
  if (adbToggle) {
    window.ipc.invoke('get-adblock-state').then(function(s) { adbToggle.checked = s && s.enabled; }).catch(function() {});
    adbToggle.addEventListener('change', function() {
      window.ipc.send('toggle-adblock', { enabled: adbToggle.checked });
    });
  }

  var clearBtn = document.getElementById('ss-clear-data');
  if (clearBtn) clearBtn.addEventListener('click', function() {
    hist = []; localStorage.removeItem('pb_hist');
    downloads = {};
    showToast('Browsing data cleared');
  });
}

// ── THEME

var currentTheme = localStorage.getItem('pb_theme') || 'dark';

function themeName() {
  return currentTheme === 'dark' ? 'Dark theme' : 'Light theme';
}

function setTheme(t) {
  currentTheme = t;
  localStorage.setItem('pb_theme', t);
  document.body.className = t === 'light' ? 'light' : '';
}

setTheme(currentTheme);

// ── ADBLOCK / DNS QUICK TOGGLE

function toggleAdblock() {
  window.ipc.invoke('get-adblock-state').then(function(s) {
    var enabled = s ? !s.enabled : true;
    window.ipc.send('toggle-adblock', { enabled: enabled });
    var el = document.getElementById('bmenu-adb-status');
    if (el) el.textContent = enabled ? 'On' : 'Off';
    showToast(enabled ? 'Ad Block enabled' : 'Ad Block disabled');
  }).catch(function() {
    var el = document.getElementById('bmenu-adb-status');
    if (el) el.textContent = el.textContent === 'On' ? 'Off' : 'On';
  });
}

function toggleDns() {
  window.ipc.invoke('get-dns-state').then(function(s) {
    var enabled = s ? !s.enabled : true;
    window.ipc.send('toggle-dns', { enabled: enabled });
    var el = document.getElementById('bmenu-dns-status');
    if (el) el.textContent = enabled ? 'Protected' : 'Off';
    showToast(enabled ? 'DNS Protection on' : 'DNS Protection off');
  }).catch(function() {
    var el = document.getElementById('bmenu-dns-status');
    if (el) el.textContent = el.textContent === 'Protected' ? 'Off' : 'Protected';
  });
}

// ── HOMEPAGE SHORTCUTS

var defaultShortcuts = [
  { name: 'YouTube', url: 'https://youtube.com' },
  { name: 'GitHub', url: 'https://github.com' },
  { name: 'Reddit', url: 'https://reddit.com' },
  { name: 'X', url: 'https://x.com' },
  { name: 'Google', url: 'https://google.com' },
];

function loadShortcuts() {
  var container = document.getElementById('hp-shortcuts');
  if (!container) return;
  container.innerHTML = '';
  defaultShortcuts.forEach(function(s) {
    var sc = document.createElement('div');
    sc.className = 'sc';
    sc.innerHTML = '<div class="sc-icon"><img src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(s.url) + '&sz=64" onerror="this.style.display=\'none\'"></div><div class="sc-label">' + escapeHtml(s.name) + '</div>';
    sc.addEventListener('click', function() { navigateFromUrlbar(s.url); });
    container.appendChild(sc);
  });
}

loadShortcuts();

// ── IPC EVENTS

window.ipc.on('download-start', function(payload) {
  var id = payload && payload.id;
  if (id) downloads[id] = payload;
});

window.ipc.on('download-update', function(payload) {
  if (payload && payload.id) downloads[payload.id] = downloads[payload.id] || {};
  if (payload && payload.id) Object.assign(downloads[payload.id], payload);
});

window.ipc.on('download-done', function(payload) {
  if (payload && payload.id) {
    downloads[payload.id] = downloads[payload.id] || {};
    downloads[payload.id].status = 'done';
  }
});

window.ipc.on('open-url-on-start', function(payload) {
  if (payload && payload.url) navigateFromUrlbar(payload.url);
});

window.ipc.on('receive-tab', function(payload) {
  if (payload && payload.url) navigateFromUrlbar(payload.url);
});

window.ipc.on('view-event', function(payload) {
  if (!payload) return;
  switch (payload.type) {
    case 'url-changed':
      updateUrlbar(payload.url);
      if (payload.title) {
        var t = tabs.find(function(x) { return x.id === activeId; });
        if (t) { t.title = payload.title; t.url = payload.url; }
      }
      break;
    case 'can-go-back':
      document.getElementById('tb-back').disabled = !payload.value;
      break;
    case 'can-go-forward':
      document.getElementById('tb-fwd').disabled = !payload.value;
      break;
    case 'load-start':
      progStart();
      break;
    case 'load-stop':
      progEnd();
      break;
    case 'title-changed':
      if (payload.title) {
        var t2 = tabs.find(function(x) { return x.id === (payload.tabId || activeId); });
        if (t2) t2.title = payload.title;
      }
      break;
  }
});

// ── PROGRESS

function progStart() {
  var f = document.getElementById('progress-fill');
  f.style.transition = 'none'; f.style.width = '0%';
  requestAnimationFrame(function() {
    f.style.transition = 'width 0.3s ease';
    setTimeout(function() { f.style.width = '40%'; }, 20);
    setTimeout(function() { f.style.width = '70%'; }, 500);
    setTimeout(function() { f.style.width = '88%'; }, 1200);
  });
}

function progEnd() {
  var f = document.getElementById('progress-fill');
  f.style.width = '100%';
  setTimeout(function() { f.style.transition = 'none'; f.style.width = '0%'; }, 350);
}

// ── UTILITY

function escapeHtml(str) {
  if (!str) return '';
  var d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── INIT

// Restore search engine
var savedEngine = localStorage.getItem('pb_search_engine');
if (savedEngine) window._searchBase = savedEngine;

// Open a default tab
addTab('', 'New Tab');
showHomepage();
