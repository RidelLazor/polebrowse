'use strict';

// ── STATE
let tabs = [], activeId = null, tid = 0;
let hist = JSON.parse(localStorage.getItem('pb_hist') || '[]');
let downloads = {}, activeDownloads = 0;
let zoomLevel = 1.0;
let _importFromWelcome = false;

// ── UTILITY
function fixUrl(raw) {
  raw = (raw || '').trim();
  if (!raw) return null;
  if (/^ridell:\/\//.test(raw)) return raw;
  if (/^https?:\/\//.test(raw)) return raw;
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(raw) && !raw.includes(' ')) return 'https://' + raw;
  const base = window._searchBase || 'https://www.google.com/search?q=';
  return base + encodeURIComponent(raw);
}
function fmtBytes(b) {
  if (!b) return '?';
  if (b < 1024) return b + ' B';
  if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
  return (b/1024/1024).toFixed(1) + ' MB';
}
function fileIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const map = { pdf:'📄', zip:'🗜', rar:'🗜', '7z':'🗜', mp4:'🎬', mkv:'🎬', mp3:'🎵', png:'🖼', jpg:'🖼', jpeg:'🖼', gif:'🖼', exe:'⚙', msi:'⚙', dmg:'💿', apk:'📱' };
  return map[ext] || '📥';
}
function favUrl(url) {
  try { return 'https://www.google.com/s2/favicons?domain=' + new URL(url).hostname + '&sz=32'; }
  catch { return null; }
}

// ── TIME
const _days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const _months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function tick() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2,'0');
  const m = String(now.getMinutes()).padStart(2,'0');
  const el = document.getElementById('hp-time');
  if (el) el.textContent = h + ':' + m;
  const dateEl = document.getElementById('hp-date');
  if (dateEl) dateEl.textContent = _days[now.getDay()] + ', ' + _months[now.getMonth()] + ' ' + now.getDate();
}
setInterval(tick, 1000); tick();

// ── PROGRESS
function progStart() {
  const f = document.getElementById('progress-fill');
  f.style.transition = 'none'; f.style.width = '0%';
  requestAnimationFrame(() => {
    f.style.transition = 'width 0.3s ease';
    setTimeout(() => f.style.width = '40%', 20);
    setTimeout(() => f.style.width = '70%', 500);
    setTimeout(() => f.style.width = '88%', 1200);
  });
}
function progEnd() {
  const f = document.getElementById('progress-fill');
  f.style.width = '100%';
  setTimeout(() => { f.style.transition = 'none'; f.style.width = '0%'; }, 350);
}

// ── TOAST
function showToast(msg, type = 'success') {
  let t = document.getElementById('pb-toast');
  if (!t) return;
  const prefix = type === 'success' ? '✓ ' : type === 'error' ? '✕ ' : '';
  t.textContent = prefix + msg;
  t.style.display = 'flex';
  t.style.borderColor = type === 'success' ? 'var(--green)' : type === 'error' ? 'var(--red)' : 'var(--border2)';
  t.style.color = type === 'success' ? 'var(--green)' : type === 'error' ? 'var(--red)' : 'var(--text)';
  clearTimeout(t._hide);
  t._hide = setTimeout(() => { t.style.display = 'none'; }, 3500);
}

// ── PANELS
function closeAllPanels() {
  document.getElementById('history-panel').classList.remove('open');
  document.getElementById('downloads-panel').classList.remove('open');
}
function togglePanel(panelId, btnId) {
  const panel = document.getElementById(panelId);
  const isOpen = panel.classList.contains('open');
  closeAllPanels();
  window.ipc.send('view-hide');
  document.getElementById('homepage').style.display = 'none';
  if (!isOpen) {
    panel.classList.add('open');
  } else {
    showActiveTab();
  }
}

// ── HISTORY
function addHist(url, title) {
  hist.unshift({ url, title: title || url, time: Date.now() });
  if (hist.length > 200) hist = hist.slice(0, 200);
  localStorage.setItem('pb_hist', JSON.stringify(hist));
}
function renderHist() {
  const list = document.getElementById('history-list');
  if (!hist.length) { list.innerHTML = '<div class="panel-empty">No history yet.</div>'; return; }
  list.innerHTML = hist.map((h, i) => {
    const fav = favUrl(h.url);
    return `
    <div class="hist-item" data-i="${i}">
      ${fav ? `<img class="hist-fav" src="${fav}" onerror="this.style.display='none'">` : ''}
      <div class="hist-url">${h.url}</div>
      <div class="hist-title">${h.title}</div>
      <div class="hist-time">${new Date(h.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>
    </div>`;
  }).join('');
  list.querySelectorAll('.hist-item').forEach(el => {
    el.addEventListener('click', () => { closeAllPanels(); navigate(hist[+el.dataset.i].url); });
  });
}

// ── DOWNLOADS
function renderDownloads() {
  const list = document.getElementById('downloads-list');
  const items = Object.values(downloads).reverse();
  if (!items.length) { list.innerHTML = '<div class="panel-empty">No downloads yet.</div>'; return; }
  list.innerHTML = items.map(d => {
    const pct = d.total ? Math.round(d.received / d.total * 100) : 0;
    const isDone = d.state === 'completed', isFail = d.state === 'interrupted' || d.state === 'cancelled', isActive = d.state === 'progressing';
    return `<div class="dl-item">
      <div class="dl-item-top">
        <div class="dl-icon">${fileIcon(d.filename)}</div>
        <div class="dl-info">
          <div class="dl-name">${d.filename}</div>
          <div class="dl-size">${isDone ? fmtBytes(d.total) : isActive ? fmtBytes(d.received)+' / '+fmtBytes(d.total) : ''}</div>
        </div>
        <div class="dl-actions">
          ${isDone ? `<button class="dl-btn open-btn" onclick="window.ipc.send('open-file',{path:'${(d.savePath||'').replace(/\\/g,'\\\\')}'})">▶ Open</button>
          <button class="dl-btn" onclick="window.ipc.send('show-file',{path:'${(d.savePath||'').replace(/\\/g,'\\\\')}'})">📁</button>` : ''}
        </div>
      </div>
      ${isActive ? `<div class="dl-bar-wrap"><div class="dl-bar" style="width:${pct}%"></div></div>` : ''}
      <div class="dl-status ${isDone?'done':isFail?'fail':'prog'}">${isDone?'✓ Complete':isFail?'✕ Failed':pct+'% — downloading...'}</div>
    </div>`;
  }).join('');
}
function updateDlBadge() {
  const badge = document.getElementById('dl-badge-count');
  if (!badge) return;
  if (activeDownloads > 0) { badge.textContent = activeDownloads; badge.classList.add('show'); }
  else badge.classList.remove('show');
}
function renderRidelDownloads() {
  const body = document.getElementById('rp-dl-body');
  if (!body) return;
  const keys = Object.keys(downloads);
  if (!keys.length) { body.innerHTML = '<div style="color:var(--muted);font-size:13px;margin-top:24px;">No downloads yet.</div>'; return; }
  body.innerHTML = keys.reverse().map(id => {
    const d = downloads[id];
    const pct = d.total ? Math.round(d.received / d.total * 100) : 0;
    const isDone = d.state === 'completed'; const isErr = d.state === 'interrupted';
    return '<div class="dl-item">' +
      '<div class="dl-item-top"><div class="dl-icon">' + fileIcon(d.filename) + '</div>' +
      '<div class="dl-info"><div class="dl-name">' + d.filename + '</div>' +
      '<div class="dl-size">' + (isDone ? fmtBytes(d.total) + ' — Done' : isErr ? 'Failed' : fmtBytes(d.received) + ' / ' + fmtBytes(d.total)) + '</div></div>' +
      (isDone ? '<div class="dl-actions"><button class="dl-btn open-btn" onclick="window.ipc.send(\'open-file\',{path:\'' + (d.savePath||'').replace(/\\/g,'\\\\') + '\'})">Open</button>' +
      '<button class="dl-btn" onclick="window.ipc.send(\'show-file\',{path:\'' + (d.savePath||'').replace(/\\/g,'\\\\') + '\'})">Show</button></div>' : '') +
      '</div></div>';
  }).join('');
}
function renderRidelHistory() {
  const body = document.getElementById('rp-hist-body');
  if (!body) return;
  if (!hist.length) { body.innerHTML = '<div style="color:var(--muted);font-size:13px;margin-top:24px;">No history yet.</div>'; return; }
  body.innerHTML = hist.slice().reverse().map((h, i) =>
    '<div class="hist-item" data-i="' + (hist.length - 1 - i) + '" style="cursor:pointer;">' +
    '<img class="hist-fav" src="' + (favUrl(h.url) || '') + '" onerror="this.style.display=\'none\'">' +
    '<div style="flex:1;min-width:0;"><div style="font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (h.title || h.url) + '</div>' +
    '<div style="font-size:11px;color:var(--muted);font-family:var(--mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + h.url + '</div></div>' +
    '<div style="font-size:11px;color:var(--muted);flex-shrink:0;">' + new Date(h.time).toLocaleString() + '</div></div>'
  ).join('');
  body.querySelectorAll('.hist-item').forEach(el => el.onclick = () => navigate(hist[+el.dataset.i].url));
}

// ── TAB DRAG DETACH
let dragTab = null, dragStartY = 0, dragActive = false;
const ghost = document.getElementById('detach-ghost');
document.addEventListener('mousemove', (e) => {
  if (!dragTab) return;
  ghost.style.left = e.clientX + 12 + 'px';
  ghost.style.top = e.clientY + 8 + 'px';
  if (e.clientY > 50 && !dragActive) {
    dragActive = true;
    ghost.classList.add('show');
    document.querySelectorAll('.tab').forEach(t => { if (t._tabId === dragTab.id) t.classList.add('dragging'); });
  }
  if (e.clientY <= 50 && dragActive) {
    dragActive = false;
    ghost.classList.remove('show');
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('dragging'));
  }
});
document.addEventListener('mouseup', (e) => {
  if (!dragTab) return;
  ghost.classList.remove('show');
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('dragging'));
  if (dragActive && dragTab.url) {
    window.ipc.send('detach-tab', {
      url: dragTab.url, title: dragTab.title,
      x: window.screenX + e.clientX, y: window.screenY + e.clientY,
    });
    closeTab(dragTab.id);
  }
  dragTab = null; dragActive = false;
});
function startTabDrag(tab, e) {
  if (e.target.classList.contains('tab-x')) return;
  dragTab = tab; dragStartY = e.clientY; dragActive = false;
  ghost.textContent = tab.title;
  ghost.style.left = e.clientX + 12 + 'px';
  ghost.style.top = e.clientY + 8 + 'px';
}

// ── TABS
function getTab(id) { return tabs.find(t => t.id === id); }
function newTab(url) {
  const id = ++tid;
  tabs.push({ id, url: url || null, title: 'New Tab', fav: null });
  renderTabs(); switchTab(id);
  if (url) navigate(url, id);
}
function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  window.ipc.send('view-destroy', { tabId: id });
  tabs = tabs.filter(t => t.id !== id);
  if (!tabs.length) { newTab(null); return; }
  if (activeId === id) switchTab(tabs[Math.min(idx, tabs.length-1)].id);
  renderTabs();
}
function switchTab(id) { activeId = id; showActiveTab(); renderTabs(); updateNav(); }
function renderTabs() {
  const wrap = document.getElementById('tabs-wrap');
  wrap.innerHTML = '';
  tabs.forEach(tab => {
    const el = document.createElement('div');
    el._tabId = tab.id;
    el.className = 'tab' + (tab.id === activeId ? ' active' : '');
    const favImg = tab.fav
      ? `<img class="tab-fav" src="${tab.fav}" onerror="this.style.display='none'">`
      : `<img class="tab-fav" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='6' fill='%236a6a80'/%3E%3C/svg%3E">`;
    el.innerHTML = `${favImg}<span class="tab-title">${tab.title}</span><button class="tab-x">✕</button>`;
    el.addEventListener('mousedown', (e) => { if (!e.target.classList.contains('tab-x')) startTabDrag(tab, e); });
    el.addEventListener('click', e => { if (!e.target.classList.contains('tab-x')) switchTab(tab.id); });
    el.querySelector('.tab-x').addEventListener('click', e => { e.stopPropagation(); closeTab(tab.id); });
    wrap.appendChild(el);
  });
}
function updateNav() {
  const tab = getTab(activeId);
  const has = tab && !!tab.url;
  ['btn-back','btn-fwd'].forEach(function(id) { const el = document.getElementById(id); if (el) el.disabled = !has; });
}

// ── NAVIGATION
function navigate(raw, tabId) {
  const url = fixUrl(raw);
  if (!url) return;
  const id = tabId !== undefined ? tabId : activeId;
  const tab = getTab(id);
  if (!tab) return;
  if (url.startsWith('ridell://')) {
    const page = url.replace('ridell://', '').replace(/\/$/, '');
    tab.url = url;
    tab.title = ({ downloads:'Downloads', history:'History', settings:'Settings' })[page] || page;
    if (id === activeId) {
      document.getElementById('urlbar').value = url;
      document.getElementById('homepage').style.display = 'none';
      window.ipc.send('view-hide');
      closeAllPanels();
      openRidellPage(page);
    }
    renderTabs(); updateNav();
    return;
  }
  tab.url = url;
  if (id === activeId) {
    closeAllPanels();
    closeAllRidellPages();
    document.getElementById('homepage').style.display = 'none';
    document.getElementById('urlbar').value = url;
  }
  window.ipc.send('view-navigate', { tabId: id, url });
  if (id === activeId) progStart();
  updateNav();
}

// ── RIDELL PAGES
function closeAllRidellPages() {
  ['ridell-downloads','ridell-history','ridell-settings','ridell-no-internet','ridell-dangerous'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
  });
}
function openRidellPage(page) {
  closeAllRidellPages();
  const el = document.getElementById('ridell-' + page);
  if (!el) return;
  el.classList.add('open');
  if (page === 'history') renderRidelHistory();
  if (page === 'downloads') renderRidelDownloads();
  if (page === 'settings') renderSettings();
}
function showActiveTab() {
  const tab = tabs.find(t => t.id === activeId);
  if (!tab) return;
  closeAllPanels();
  if (tab.url && tab.url.startsWith('ridell://')) {
    closeAllRidellPages();
    window.ipc.send('view-hide');
    document.getElementById('homepage').style.display = 'none';
    document.getElementById('urlbar').value = tab.url;
    const page = tab.url.replace('ridell://', '').replace(/\/$/, '');
    openRidellPage(page);
  } else if (tab.url) {
    closeAllRidellPages();
    document.getElementById('homepage').style.display = 'none';
    document.getElementById('urlbar').value = tab.url;
    window.ipc.send('view-show', { tabId: tab.id });
  } else {
    closeAllRidellPages();
    window.ipc.send('view-hide');
    document.getElementById('homepage').style.display = 'flex';
    document.getElementById('urlbar').value = '';
  }
}

// ── SUGGESTIONS
(function() {
  const urlbar = document.getElementById('urlbar');
  const sgBox = document.getElementById('suggestions');
  let sgIdx = -1, sgItems = [], ddgTimer = null;
  function closeSg() { sgBox.classList.remove('open'); sgBox.innerHTML = ''; sgItems = []; sgIdx = -1; }
  function buildItem(icon, title, subtitle, badge, onPick) {
    const btn = document.createElement('button');
    btn.className = 'sg-item';
    if (icon && icon.startsWith('http')) {
      const img = document.createElement('img'); img.className = 'sg-icon'; img.src = icon;
      img.onerror = () => { img.style.display='none'; }; btn.appendChild(img);
    } else {
      const sp = document.createElement('span'); sp.className = 'sg-icon-char'; sp.textContent = icon || '🔍'; btn.appendChild(sp);
    }
    const txt = document.createElement('span'); txt.className = 'sg-text';
    const t1 = document.createElement('div'); t1.className = 'sg-title'; t1.textContent = title; txt.appendChild(t1);
    if (subtitle) { const t2 = document.createElement('div'); t2.className = 'sg-url'; t2.textContent = subtitle; txt.appendChild(t2); }
    btn.appendChild(txt);
    if (badge) { const b = document.createElement('span'); b.className = 'sg-badge'; b.textContent = badge; btn.appendChild(b); }
    btn.addEventListener('mousedown', e => { e.preventDefault(); onPick(); });
    return btn;
  }
  function section(label, items) {
    if (!items.length) return null;
    const wrap = document.createElement('div'); wrap.className = 'sg-section';
    if (label) { const lbl = document.createElement('div'); lbl.className = 'sg-label'; lbl.textContent = label; wrap.appendChild(lbl); }
    items.forEach(it => wrap.appendChild(it));
    return wrap;
  }
  function renderSg(histMatches, bmMatches, ddgMatches, query) {
    sgBox.innerHTML = ''; sgItems = [];
    const pick = u => { closeSg(); navigate(u); };
    const search = q => { closeSg(); navigate(q); };
    const searchItems = query ? [buildItem('🔍', query, null, 'Search', () => search(query))] : [];
    const histItems = histMatches.slice(0,4).map(h => buildItem(favUrl(h.url), h.title || h.url, h.url, 'History', () => pick(h.url)));
    const bmItems = bmMatches.slice(0,3).map(b => buildItem(favUrl(b.url), b.title || b.url, b.url, 'Bookmark', () => pick(b.url)));
    const ddgItems = ddgMatches.slice(0,5).map(s => buildItem('🔍', s, null, null, () => search(s)));
    [section(null, searchItems), section('History', histItems), section('Bookmarks', bmItems), section('Suggestions', ddgItems)].forEach(s => { if (s) sgBox.appendChild(s); });
    sgItems = Array.from(sgBox.querySelectorAll('.sg-item'));
    if (sgItems.length) sgBox.classList.add('open'); else sgBox.classList.remove('open');
  }
  function matchHistory(q) {
    const ql = q.toLowerCase();
    return (hist || []).filter(h => (h.url && h.url.toLowerCase().includes(ql)) || (h.title && h.title.toLowerCase().includes(ql))).slice(0, 5);
  }
  function matchBookmarks(q) {
    const ql = q.toLowerCase();
    return (JSON.parse(localStorage.getItem('pb_bookmarks') || '[]')).filter(b => (b.url && b.url.toLowerCase().includes(ql)) || (b.title && b.title.toLowerCase().includes(ql))).slice(0, 4);
  }
  async function fetchSuggestions(q) {
    try { const r = await window.ipc.invoke('autocomplete', { query: q }); return (r||[]).map(x => x.text).filter(Boolean); }
    catch { return []; }
  }
  function onInput() {
    const q = urlbar.value.trim(); if (!q) { closeSg(); return; }
    const hm = matchHistory(q), bm = matchBookmarks(q);
    renderSg(hm, bm, [], q);
    clearTimeout(ddgTimer);
    ddgTimer = setTimeout(async () => {
      const ddg = await fetchSuggestions(q);
      if (urlbar.value.trim() === q) renderSg(hm, bm, ddg, q);
    }, 180);
  }
  function setActive(idx) { sgItems.forEach((el, i) => el.classList.toggle('active', i === idx)); sgIdx = idx; }
  urlbar.addEventListener('input', onInput);
  urlbar.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(sgIdx + 1, sgItems.length - 1)); if (sgIdx >= 0) urlbar.value = sgItems[sgIdx].querySelector('.sg-title').textContent; }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(sgIdx - 1, -1)); if (sgIdx >= 0) urlbar.value = sgItems[sgIdx].querySelector('.sg-title').textContent; }
    else if (e.key === 'Enter') { e.preventDefault(); if (sgIdx >= 0 && sgItems[sgIdx]) { sgItems[sgIdx].dispatchEvent(new MouseEvent('mousedown')); } else { closeSg(); navigate(urlbar.value); } }
    else if (e.key === 'Escape') { closeSg(); urlbar.blur(); }
  });
  urlbar.addEventListener('focus', () => { urlbar.select(); if (urlbar.value.trim()) onInput(); });
  urlbar.addEventListener('blur', () => { setTimeout(closeSg, 150); });
})();

// ── CONTEXT MENU
const ctxMenu = document.getElementById('ctx-menu');
function showCtx(x, y) {
  ctxMenu.style.left = x + 'px'; ctxMenu.style.top = y + 'px';
  ctxMenu.classList.add('show');
  const tab = getTab(activeId);
  const hasPage = tab && !!tab.url;
  ['ctx-back','ctx-fwd','ctx-reload','ctx-saveas','ctx-print','ctx-viewsrc','ctx-inspect','ctx-copyurl'].forEach(id => {
    document.getElementById(id).classList.toggle('disabled', !hasPage);
  });
  const hasDynamic = ['ctx-openlink','ctx-copylink','ctx-search','ctx-copytext'].some(id => document.getElementById(id).style.display !== 'none');
  document.getElementById('ctx-sep-dynamic').style.display = hasDynamic ? '' : 'none';
  requestAnimationFrame(() => {
    const r = ctxMenu.getBoundingClientRect();
    if (r.right > window.innerWidth) ctxMenu.style.left = (x - r.width) + 'px';
    if (r.bottom > window.innerHeight) ctxMenu.style.top = (y - r.height) + 'px';
  });
}
function hideCtx() {
  ctxMenu.classList.remove('show');
  if (ctxMenu._viewHidden) { ctxMenu._viewHidden = false; window.ipc.send('view-show', { tabId: activeId }); }
}
document.addEventListener('mousedown', e => { if (ctxMenu.classList.contains('show') && !ctxMenu.contains(e.target)) hideCtx(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCtx(); });
document.addEventListener('contextmenu', e => {
  if (e.target.closest('input,textarea')) return;
  e.preventDefault();
  ['ctx-openlink','ctx-copylink','ctx-search','ctx-copytext'].forEach(id => { document.getElementById(id).style.display = 'none'; });
  ctxMenu._linkURL = null; ctxMenu._selectionText = null;
  showCtx(e.clientX, e.clientY);
});
window.ipc.on('view-contextmenu', (data) => {
  const hasLink = !!data.linkURL;
  const hasText = !!(data.selectionText && data.selectionText.trim());
  ['ctx-openlink','ctx-copylink'].forEach(id => document.getElementById(id).style.display = hasLink ? '' : 'none');
  ['ctx-search','ctx-copytext'].forEach(id => document.getElementById(id).style.display = hasText ? '' : 'none');
  document.querySelector('#ctx-newtab .ctx-label').textContent = hasLink ? '＋ Open link in new tab' : '＋ Open page in new tab';
  ctxMenu._linkURL = data.linkURL; ctxMenu._selectionText = data.selectionText;
  window.ipc.send('view-hide');
  ctxMenu._viewHidden = true;
  showCtx(data.x, data.y);
});
// Context menu item actions
document.getElementById('ctx-openlink').onclick = () => { hideCtx(); if (ctxMenu._linkURL) newTab(ctxMenu._linkURL); };
document.getElementById('ctx-copylink').onclick = () => { hideCtx(); if (ctxMenu._linkURL) navigator.clipboard.writeText(ctxMenu._linkURL).then(() => showToast('Link copied', 'success')); };
document.getElementById('ctx-search').onclick = () => { hideCtx(); if (ctxMenu._selectionText) navigate('https://www.google.com/search?q=' + encodeURIComponent(ctxMenu._selectionText)); };
document.getElementById('ctx-copytext').onclick = () => { hideCtx(); if (ctxMenu._selectionText) navigator.clipboard.writeText(ctxMenu._selectionText).then(() => showToast('Copied', 'success')); };
document.getElementById('ctx-back').onclick = () => { hideCtx(); if (!document.getElementById('ctx-back').classList.contains('disabled')) window.ipc.send('view-back', { tabId: activeId }); };
document.getElementById('ctx-fwd').onclick = () => { hideCtx(); if (!document.getElementById('ctx-fwd').classList.contains('disabled')) window.ipc.send('view-fwd', { tabId: activeId }); };
document.getElementById('ctx-reload').onclick = () => { hideCtx(); if (!document.getElementById('ctx-reload').classList.contains('disabled')) window.ipc.send('view-reload', { tabId: activeId }); };
document.getElementById('ctx-saveas').onclick = () => { hideCtx(); window.ipc.send('ctx-action', { action: 'saveas', tabId: activeId }); };
document.getElementById('ctx-print').onclick = () => { hideCtx(); window.ipc.send('ctx-action', { action: 'print', tabId: activeId }); };
document.getElementById('ctx-newtab').onclick = () => { hideCtx(); const url = ctxMenu._linkURL || (getTab(activeId) && getTab(activeId).url); if (url) newTab(url); };
document.getElementById('ctx-copyurl').onclick = () => { hideCtx(); const t = getTab(activeId); if (t?.url) navigator.clipboard.writeText(t.url).then(() => showToast('URL copied', 'success')); };
document.getElementById('ctx-viewsrc').onclick = () => { hideCtx(); const t = getTab(activeId); if (t?.url) newTab('view-source:' + t.url); };
document.getElementById('ctx-inspect').onclick = () => { hideCtx(); window.ipc.send('open-devtools', { tabId: activeId }); };

// ── 3-DOT MENU
const dotMenu = document.getElementById('dotmenu');
function showDotMenu() {
  const isOpen = dotMenu.classList.contains('show');
  if (isOpen) { hideDotMenu(); return; }
  const tab = getTab(activeId);
  if (tab && tab.url && !tab.url.startsWith('ridell://')) { window.ipc.send('view-hide'); dotMenu._viewHidden = true; }
  dotMenu.classList.add('show');
}
function hideDotMenu() {
  dotMenu.classList.remove('show');
  if (dotMenu._viewHidden) { dotMenu._viewHidden = false; window.ipc.send('view-show', { tabId: activeId }); }
}
document.getElementById('btn-dotmenu').addEventListener('mousedown', e => { e.stopPropagation(); });
document.getElementById('btn-dotmenu').addEventListener('click', e => { e.stopPropagation(); showDotMenu(); });
document.addEventListener('mousedown', e => {
  if (e.target.id === 'btn-dotmenu' || e.target.closest('#btn-dotmenu')) return;
  if (dotMenu.classList.contains('show') && !dotMenu.contains(e.target)) hideDotMenu();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && dotMenu.classList.contains('show')) hideDotMenu(); });
function applyZoom(delta) {
  zoomLevel = Math.min(3, Math.max(0.25, zoomLevel + delta));
  document.getElementById('dm-zoom-val').textContent = Math.round(zoomLevel * 100) + '%';
  window.ipc.send('view-zoom', { tabId: activeId, factor: zoomLevel });
}
document.getElementById('dm-zoom-in').onclick = e => { e.stopPropagation(); applyZoom(0.1); };
document.getElementById('dm-zoom-out').onclick = e => { e.stopPropagation(); applyZoom(-0.1); };
document.getElementById('dm-zoom-full').onclick = e => { e.stopPropagation(); window.ipc.send('win-fullscreen'); };
document.getElementById('dm-history').onclick = () => { hideDotMenu(); newTab('ridell://history'); };
document.getElementById('dm-downloads').onclick = () => { hideDotMenu(); newTab('ridell://downloads'); };
document.getElementById('dm-bookmarks').onclick = () => { hideDotMenu(); showToast('Bookmarks bar is always visible below the navbar', 'info'); };
document.getElementById('dm-print').onclick = () => { hideDotMenu(); window.ipc.send('ctx-action', { action: 'print', tabId: activeId }); };
document.getElementById('dm-find').onclick = () => { hideDotMenu(); window.ipc.send('view-find', { tabId: activeId }); };
document.getElementById('dm-newtab-dm').onclick = () => { hideDotMenu(); newTab(null); };
document.getElementById('dm-newwin').onclick = () => { hideDotMenu(); window.ipc.send('new-window'); };
document.getElementById('dm-devtools').onclick = () => { hideDotMenu(); window.ipc.send('open-devtools', { tabId: activeId }); };
document.getElementById('dm-viewsrc').onclick = () => { hideDotMenu(); const t = getTab(activeId); if (t?.url) newTab('view-source:' + t.url); };
document.getElementById('dm-settings').onclick = () => { hideDotMenu(); newTab('ridell://settings'); };
document.getElementById('dm-exit').onclick = () => window.ipc.send('win-close');

// ── VPN POPUP
const vpnPopup = document.getElementById('vpn-popup');
function showVpnPopup() {
  hideDotMenu();
  if (vpnPopup.classList.contains('show')) { hideVpnPopup(); return; }
  const tab = getTab(activeId);
  if (tab && tab.url && !tab.url.startsWith('ridell://')) { window.ipc.send('view-hide'); vpnPopup._viewHidden = true; }
  vpnPopup.classList.add('show');
  initVpnPopup();
}
function hideVpnPopup() {
  vpnPopup.classList.remove('show');
  if (vpnPopup._viewHidden) { vpnPopup._viewHidden = false; window.ipc.send('view-show', { tabId: activeId }); }
}
document.getElementById('vpn-indicator').addEventListener('click', e => { e.stopPropagation(); showVpnPopup(); });
document.addEventListener('mousedown', e => {
  if (e.target.id === 'vpn-indicator' || e.target.closest('#vpn-indicator')) return;
  if (vpnPopup.classList.contains('show') && !vpnPopup.contains(e.target)) hideVpnPopup();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && vpnPopup.classList.contains('show')) hideVpnPopup(); });
document.getElementById('vp-open-settings').onclick = () => { hideVpnPopup(); newTab('ridell://settings'); };

const COUNTRY_FLAGS = {
  nl:'🇳🇱',us:'🇺🇸',ca:'🇨🇦',gb:'🇬🇧',de:'🇩🇪',fr:'🇫🇷',se:'🇸🇪',no:'🇳🇴',
  ch:'🇨🇭',at:'🇦🇹',be:'🇧🇪',dk:'🇩🇰',fi:'🇫🇮',ie:'🇮🇪',it:'🇮🇹',jp:'🇯🇵',
  lu:'🇱🇺',my:'🇲🇾',mx:'🇲🇽',nz:'🇳🇿',pl:'🇵🇱',ro:'🇷🇴',sg:'🇸🇬',za:'🇿🇦',
  kr:'🇰🇷',es:'🇪🇸',tr:'🇹🇷',ae:'🇦🇪'
};

function populateCountries(sel, countries, active) {
  sel.innerHTML = '';
  for (const [code, name] of Object.entries(countries)) {
    const flag = COUNTRY_FLAGS[code] || '';
    const opt = document.createElement('option');
    opt.value = code; opt.textContent = flag ? flag + ' ' + name : name;
    if (code === active) opt.selected = true;
    sel.appendChild(opt);
  }
}

function updateVpnCountryRow(providers, activeKey, activeCountry) {
  const countryRow = document.getElementById('vp-country-row');
  const countrySel = document.getElementById('vp-country');
  const p = providers && providers[activeKey];
  if (p && p.countries) {
    countryRow.style.display = '';
    populateCountries(countrySel, p.countries, activeCountry || p.defaultCountry);
  } else {
    countryRow.style.display = 'none';
  }
}

async function initVpnPopup() {
  if (!window.ipc) return;
  const sel = document.getElementById('vp-provider'), toggle = document.getElementById('vp-toggle');
  const dot = document.getElementById('vp-status-dot'), lbl = document.getElementById('vp-status-label');
  const customRow = document.getElementById('vp-custom-row');
  const countrySel = document.getElementById('vp-country');
  let vpnData;
  if (!sel) return;
  try {
    vpnData = await window.ipc.invoke('get-vpn-state');
    if (vpnData) {
      sel.value = vpnData.active || 'none';
      if (vpnData.enabled) { dot.style.background = 'var(--green)'; dot.style.boxShadow = '0 0 6px var(--green)'; lbl.textContent = 'VPN Active'; lbl.style.color = 'var(--green)'; }
      else { dot.style.background = 'var(--muted)'; dot.style.boxShadow = 'none'; lbl.textContent = 'VPN Off'; lbl.style.color = 'var(--muted)'; }
      if (toggle) toggle.checked = vpnData.enabled;
      if (vpnData.active === 'custom' && customRow) customRow.style.display = 'flex';
      else if (customRow) customRow.style.display = 'none';
      const ipLbl = document.getElementById('vp-ip-label');
      if (vpnData.ip && ipLbl) { ipLbl.textContent = vpnData.ip; ipLbl.style.color = 'var(--text)'; }
      updateVpnCountryRow(vpnData.providers, vpnData.active, vpnData.country);
    }
  } catch(e) {}
  sel.onchange = async () => {
    const key = sel.value;
    if (customRow) customRow.style.display = key === 'custom' ? 'flex' : 'none';
    const r = await window.ipc.invoke('set-vpn-provider', key);
    if (r && r.country) updateVpnCountryRow(vpnData ? vpnData.providers : null, key, r.country);
    else updateVpnCountryRow(vpnData ? vpnData.providers : null, key, null);
  };
  if (countrySel) countrySel.onchange = async () => {
    const key = sel.value;
    await window.ipc.invoke('set-vpn-country', key, countrySel.value);
  };
  if (toggle) toggle.onchange = async () => {
    const r = await window.ipc.invoke('toggle-vpn', toggle.checked);
    if (r) { const en = r.enabled; dot.style.background = en ? 'var(--green)' : 'var(--muted)'; dot.style.boxShadow = en ? '0 0 6px var(--green)' : 'none'; lbl.textContent = en ? 'VPN Active' : 'VPN Off'; lbl.style.color = en ? 'var(--green)' : 'var(--muted)'; }
  };
  const saveBtn = document.getElementById('vp-custom-save');
  if (saveBtn) saveBtn.onclick = async () => {
    const host = document.getElementById('vp-custom-host').value.trim(), port = document.getElementById('vp-custom-port').value.trim(), type = document.getElementById('vp-custom-type').value;
    if (!host || !port) return;
    await window.ipc.invoke('set-custom-proxy', { host, port, type });
    saveBtn.textContent = 'Saved!'; setTimeout(() => { saveBtn.textContent = 'Save'; }, 2000);
  };
  const testBtn = document.getElementById('vp-test-btn'), ipLbl = document.getElementById('vp-ip-label');
  if (testBtn) testBtn.onclick = async () => {
    testBtn.textContent = '...'; testBtn.disabled = true;
    const res = await window.ipc.invoke('test-proxy');
    if (ipLbl) { ipLbl.textContent = res.success ? res.ip : (res.error || 'Failed'); ipLbl.style.color = res.success ? 'var(--green)' : 'var(--red)'; }
    testBtn.textContent = 'Check IP'; testBtn.disabled = false;
  };
}

// ── THEME TOGGLE

// ── THEME TOGGLE
function applyTheme(theme) {
  document.body.classList.remove('light', 'glass');
  const dark = document.getElementById('st-dark'), light = document.getElementById('st-light'), glass = document.getElementById('st-glass'), desc = document.getElementById('theme-desc');
  if (theme === 'light') {
    document.body.classList.add('light');
    if (dark) dark.classList.remove('active'); if (light) light.classList.add('active'); if (glass) glass.classList.remove('active');
    if (desc) desc.textContent = 'PoleBrowse light theme';
  } else if (theme === 'glass') {
    document.body.classList.add('glass');
    if (dark) dark.classList.remove('active'); if (light) light.classList.remove('active'); if (glass) glass.classList.add('active');
    if (desc) desc.textContent = 'PoleBrowse liquid glass theme';
  } else {
    if (dark) dark.classList.add('active'); if (light) light.classList.remove('active'); if (glass) glass.classList.remove('active');
    if (desc) desc.textContent = 'PoleBrowse dark theme';
  }
  try { localStorage.setItem('pb-theme', theme); } catch(e) {}
}
try { const saved = localStorage.getItem('pb-theme'); if (saved) applyTheme(saved); } catch(e) {}

// ── DNS SETTINGS
const DNS_DESCS = {
  cloudflare: { desc: 'Cloudflare · 1.1.1.1 / 1.0.0.1', ips: 'Primary: 1.1.1.1 · Secondary: 1.0.0.1' },
  google: { desc: 'Google · 8.8.8.8 / 8.8.4.4', ips: 'Primary: 8.8.8.8 · Secondary: 8.8.4.4' },
  quad9: { desc: 'Quad9 · 9.9.9.9 — blocks malware domains', ips: 'Primary: 9.9.9.9 · Secondary: 149.112.112.112' },
  adguard: { desc: 'AdGuard DNS — blocks ads & trackers', ips: 'Primary: 94.140.14.14 · Secondary: 94.140.15.15' },
  nextdns: { desc: 'NextDNS · Customizable filtering', ips: 'Primary: 45.90.28.0 · Secondary: 45.90.30.0' },
  opendns: { desc: 'OpenDNS · 208.67.222.222 / 220', ips: 'Primary: 208.67.222.222 · Secondary: 208.67.220.220' },
  mullvad: { desc: 'Mullvad · Privacy-first, no logging', ips: 'Primary: 194.242.2.2 · Secondary: 194.242.2.3' },
  controld: { desc: 'Control D · Flexible filtering', ips: 'Primary: 76.76.2.0 · Secondary: 76.76.10.0' },
};
function setDnsProtectedUI(enabled) {
  const dot = document.getElementById('dns-status-dot'), lbl = document.getElementById('dns-status-label'), toggle = document.getElementById('dns-toggle');
  if (dot) { dot.style.background = enabled ? 'var(--green)' : 'var(--red)'; dot.style.boxShadow = enabled ? '0 0 6px var(--green)' : 'none'; }
  if (lbl) { lbl.textContent = enabled ? 'Protected' : 'Unprotected'; lbl.style.color = enabled ? 'var(--green)' : 'var(--red)'; }
  if (toggle) toggle.checked = enabled;
}
async function initDnsUI() {
  if (!window.ipc) return;
  const sel = document.getElementById('dns-provider-select'), desc = document.getElementById('dns-provider-desc'), ips = document.getElementById('dns-ips-label'), toggle = document.getElementById('dns-toggle'), overlay = document.getElementById('dns-warning-overlay');
  if (!sel) return;
  const data = await window.ipc.invoke('get-dns-providers');
  if (data) {
    sel.value = data.active; const info = DNS_DESCS[data.active] || {};
    if (desc) desc.textContent = info.desc || ''; if (ips) ips.textContent = info.ips || '';
    setDnsProtectedUI(data.enabled !== false);
  }
  if (toggle) {
    toggle.addEventListener('change', async () => {
      if (!toggle.checked) { toggle.checked = true; if (overlay) overlay.style.display = 'flex'; }
      else { setDnsProtectedUI(true); await window.ipc.invoke('toggle-dns', true); }
    });
  }
  const cancelBtn = document.getElementById('dns-warning-cancel'), confirmBtn = document.getElementById('dns-warning-confirm');
  if (cancelBtn) cancelBtn.addEventListener('click', () => { if (overlay) overlay.style.display = 'none'; setDnsProtectedUI(true); });
  if (confirmBtn) confirmBtn.addEventListener('click', async () => { if (overlay) overlay.style.display = 'none'; setDnsProtectedUI(false); await window.ipc.invoke('toggle-dns', false); });
  if (overlay) overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.style.display = 'none'; setDnsProtectedUI(true); } });
  sel.addEventListener('change', async () => {
    const key = sel.value, info = DNS_DESCS[key] || {};
    if (desc) desc.textContent = info.desc || ''; if (ips) ips.textContent = info.ips || '';
    const dot = document.getElementById('dns-status-dot'), lbl = document.getElementById('dns-status-label');
    if (dot) { dot.style.background = 'var(--muted)'; dot.style.boxShadow = 'none'; }
    if (lbl) { lbl.textContent = 'Switching...'; lbl.style.color = 'var(--muted)'; }
    const result = await window.ipc.invoke('set-dns-provider', key);
    if (result && result.success) {
      if (dot) { dot.style.background = 'var(--green)'; dot.style.boxShadow = '0 0 6px var(--green)'; }
      if (lbl) { lbl.textContent = 'Protected'; lbl.style.color = 'var(--green)'; }
    } else {
      if (dot) { dot.style.background = 'var(--red)'; dot.style.boxShadow = 'none'; }
      if (lbl) { lbl.textContent = 'Error'; lbl.style.color = 'var(--red)'; }
    }
  });
  const testBtn = document.getElementById('dns-test-btn'), resultRow = document.getElementById('dns-test-result-row'), resultEl = document.getElementById('dns-test-result');
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      testBtn.textContent = 'Testing...'; testBtn.disabled = true;
      const res = await window.ipc.invoke('test-dns');
      if (resultRow) resultRow.style.display = 'flex';
      if (res && res.success) { if (resultEl) { resultEl.textContent = '✓ DNS resolved · ' + (res.addresses || []).join(', '); resultEl.style.color = 'var(--green)'; } }
      else { if (resultEl) { resultEl.textContent = '✗ Failed · ' + (res ? res.error : 'Unknown error'); resultEl.style.color = 'var(--red)'; } }
      testBtn.textContent = 'Test DNS'; testBtn.disabled = false;
    });
  }
}

// ── VPN SETTINGS
const VPN_DESCS = {
  none: 'No proxy — direct connection', tor: 'Tor Network — requires Tor Browser or tor daemon',
  i2p: 'I2P — requires I2P running locally on port 4444', privoxy: 'Privoxy — requires Privoxy on port 8118',
  mullvad: 'Mullvad SOCKS5 — requires Mullvad subscription', windscribe: 'Windscribe SOCKS5 — requires Windscribe account',
  custom: 'Custom proxy — enter host, port and type below',
};
function setVpnUI(enabled) {
  const dot = document.getElementById('vpn-status-dot'), lbl = document.getElementById('vpn-status-label'), tog = document.getElementById('vpn-toggle');
  if (dot) { dot.style.background = enabled ? 'var(--green)' : 'var(--muted)'; dot.style.boxShadow = enabled ? '0 0 6px var(--green)' : 'none'; }
  if (lbl) { lbl.textContent = enabled ? 'Active' : 'Off'; lbl.style.color = enabled ? 'var(--green)' : 'var(--muted)'; }
  if (tog) tog.checked = enabled;
}
async function initVpnUI() {
  if (!window.ipc) return;
  const sel = document.getElementById('vpn-provider-select'), desc = document.getElementById('vpn-provider-desc'), note = document.getElementById('vpn-note-desc'), toggle = document.getElementById('vpn-toggle'), customRow = document.getElementById('vpn-custom-row');
  const countryRow = document.getElementById('vpn-country-row-settings'), countrySel = document.getElementById('vpn-country-select');
  if (!sel) return;
  const data = await window.ipc.invoke('get-vpn-state');
  if (data) {
    sel.value = data.active || 'none'; if (desc) desc.textContent = VPN_DESCS[data.active] || VPN_DESCS.none;
    if (note) note.textContent = VPN_DESCS[data.active] || VPN_DESCS.none;
    setVpnUI(data.enabled); if (data.active === 'custom' && customRow) customRow.style.display = 'flex';
    if (data.providers && data.providers[data.active] && data.providers[data.active].countries && countryRow && countrySel) {
      countryRow.style.display = '';
      populateCountries(countrySel, data.providers[data.active].countries, data.country || data.providers[data.active].defaultCountry);
    } else if (countryRow) { countryRow.style.display = 'none'; }
  }
  sel.addEventListener('change', async () => {
    const key = sel.value; if (desc) desc.textContent = VPN_DESCS[key] || ''; if (note) note.textContent = VPN_DESCS[key] || '';
    if (customRow) customRow.style.display = key === 'custom' ? 'flex' : 'none';
    const r = await window.ipc.invoke('set-vpn-provider', key);
    if (r && r.country && countryRow && countrySel && data && data.providers && data.providers[key] && data.providers[key].countries) {
      countryRow.style.display = '';
      populateCountries(countrySel, data.providers[key].countries, r.country);
    } else if (countryRow) { countryRow.style.display = 'none'; }
  });
  if (countrySel) countrySel.addEventListener('change', async () => {
    await window.ipc.invoke('set-vpn-country', sel.value, countrySel.value);
  });
  if (toggle) toggle.addEventListener('change', async () => { const r = await window.ipc.invoke('toggle-vpn', toggle.checked); setVpnUI(r.enabled); });
  const saveBtn = document.getElementById('vpn-custom-save');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    const host = document.getElementById('vpn-custom-host').value.trim(), port = document.getElementById('vpn-custom-port').value.trim(), type = document.getElementById('vpn-custom-type').value;
    if (!host || !port) return;
    await window.ipc.invoke('set-custom-proxy', { host, port, type });
    saveBtn.textContent = 'Saved!'; setTimeout(() => { saveBtn.textContent = 'Save'; }, 2000);
  });
  const testBtn = document.getElementById('vpn-test-btn'), ipLbl = document.getElementById('vpn-ip-label');
  if (testBtn) testBtn.addEventListener('click', async () => {
    testBtn.textContent = 'Checking...'; testBtn.disabled = true;
    const res = await window.ipc.invoke('test-proxy');
    if (ipLbl) { ipLbl.textContent = res.success ? '🌍 ' + res.ip : '✗ ' + (res.error || 'Failed'); ipLbl.style.color = res.success ? 'var(--green)' : 'var(--red)'; }
    testBtn.textContent = 'Check IP'; testBtn.disabled = false;
  });
}

// ── AD BLOCK UI
async function initAdBlockUI() {
  if (!window.ipc) return;
  const toggle = document.getElementById('adb-toggle'), count = document.getElementById('adb-count');
  if (!toggle) return;
  const data = await window.ipc.invoke('get-adblocker-state');
  if (data) { toggle.checked = data.enabled; if (count) count.textContent = (data.blockedCount || 0).toLocaleString() + ' blocked'; }
  toggle.addEventListener('change', async () => { await window.ipc.invoke('toggle-adblocker', toggle.checked); });
  setInterval(async () => { const d = await window.ipc.invoke('get-adblocker-state'); if (d && count) count.textContent = (d.blockedCount || 0).toLocaleString() + ' blocked'; }, 5000);
}

// ── SETTINGS
let pbSettings = {};
try { pbSettings = JSON.parse(localStorage.getItem('pb_settings') || '{}'); } catch(e) { pbSettings = {}; }
function saveSettings() { localStorage.setItem('pb_settings', JSON.stringify(pbSettings)); }
window._pbSettings = pbSettings;
window._saveSettings = saveSettings;

const ENGINES_MAP = {
  ridell: 'https://ridell-page-search.lovable.app/search?q=',
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  brave: 'https://search.brave.com/search?q='
};
if (pbSettings.searchEngine) window._searchBase = ENGINES_MAP[pbSettings.searchEngine];

function renderSettings() {
  const st = pbSettings;
  document.getElementById('st-bookmarks').checked = st.showBookmarks !== false;
  document.getElementById('st-compact-tabs').checked = !!st.compactTabs;
  document.getElementById('st-save-hist').checked = st.saveHist !== false;
  document.getElementById('st-clear-hist-exit').checked = !!st.clearHistExit;
  document.getElementById('st-spoof-chrome').checked = st.spoofChrome !== false;
  if (st.searchEngine) document.getElementById('st-search-engine').value = st.searchEngine;
  applySettings();
}
function applySettings() {
  const st = pbSettings;
  document.getElementById('bookmarks').style.display = (st.showBookmarks !== false) ? '' : 'none';
  document.querySelectorAll('.tab').forEach(t => t.style.height = st.compactTabs ? '22px' : '');
}

// ── DANGEROUS / NO INTERNET PAGE FUNCTIONS
window.goBackFromDangerous = function() {
  closeAllRidellPages();
  window.ipc.send('view-hide');
  document.getElementById('homepage').style.display = 'flex';
  const tab = tabs.find(t => t.id === activeId);
  if (tab) { tab.url = ''; tab.title = 'New Tab'; renderTabs(); }
};
window.proceedDangerous = function() {
  const url = document.getElementById('dangerous-url-box').textContent;
  if (!url) return;
  closeAllRidellPages();
  document.getElementById('homepage').style.display = 'none';
  const tab = tabs.find(t => t.id === activeId);
  if (tab) { tab.url = url; tab.title = url; renderTabs(); }
  window.ipc.send('view-navigate', { tabId: activeId, url, bypassDangerous: true });
  window.ipc.send('view-show', { tabId: activeId });
};
window.showNoInternet = function(url) {
  closeAllRidellPages();
  window.ipc.send('view-hide');
  document.getElementById('homepage').style.display = 'none';
  const el = document.getElementById('nointernet-url');
  if (el) el.textContent = url || '';
  const pg = document.getElementById('ridell-no-internet');
  if (pg) pg.classList.add('open');
  const tab = tabs.find(t => t.id === activeId);
  if (tab) { tab.title = 'No internet'; renderTabs(); }
};
window.showDangerous = function(url, errorCode) {
  closeAllRidellPages();
  window.ipc.send('view-hide');
  document.getElementById('homepage').style.display = 'none';
  const isSsl = errorCode && (errorCode.includes('SSL') || errorCode.includes('CERT'));
  const isRefused = errorCode && errorCode.includes('ERR_CONNECTION_REFUSED');
  const headline = document.getElementById('dangerous-headline');
  const subline = document.getElementById('dangerous-subline');
  const desc = document.getElementById('dangerous-desc');
  if (isSsl) {
    if (headline) headline.textContent = 'Your connection is not private';
    if (subline) subline.textContent = 'SSL / Certificate error';
    if (desc) desc.innerHTML = 'Attackers may be trying to steal your information from <strong class="danger-host" id="dangerous-host"></strong>. The site\'s security certificate could not be verified or uses an outdated cipher.';
  } else if (isRefused) {
    if (headline) headline.textContent = 'Connection refused';
    if (subline) subline.textContent = 'PoleBrowse Safe Browsing';
    if (desc) desc.innerHTML = 'The server at <strong class="danger-host" id="dangerous-host"></strong> actively refused the connection. The site may be down, blocked, or flagged as unsafe.';
  } else {
    if (headline) headline.textContent = 'Deceptive site ahead';
    if (subline) subline.textContent = 'PoleBrowse Safe Browsing';
    if (desc) desc.innerHTML = 'Attackers on <strong class="danger-host" id="dangerous-host"></strong> may trick you into doing something dangerous — like installing harmful software or revealing your passwords, phone numbers, or credit card details.';
  }
  try { const u = new URL(url); document.querySelectorAll('#dangerous-host').forEach(el => el.textContent = u.hostname); }
  catch(e) { document.querySelectorAll('#dangerous-host').forEach(el => el.textContent = url); }
  document.getElementById('dangerous-url-box').textContent = url;
  const errEl = document.getElementById('dangerous-errcode');
  if (errEl) errEl.textContent = errorCode || '';
  const pg = document.getElementById('ridell-dangerous');
  if (pg) pg.classList.add('open');
  const tab = tabs.find(t => t.id === activeId);
  if (tab) { tab.title = isSsl ? 'Not private' : isRefused ? 'Connection refused' : 'Dangerous site'; renderTabs(); }
};

// ── ADD SHORTCUT
window.openAddShortcutModal = function() {
  const overlay = document.getElementById('add-shortcut-overlay');
  if (overlay) { overlay.style.display = 'flex'; setTimeout(() => document.getElementById('sc-add-name').focus(), 50); }
};
window.closeAddShortcutModal = function() {
  const overlay = document.getElementById('add-shortcut-overlay');
  if (overlay) overlay.style.display = 'none';
  document.getElementById('sc-add-name').value = '';
  document.getElementById('sc-add-url').value = '';
};
window.confirmAddShortcut = function() {
  const name = document.getElementById('sc-add-name').value.trim();
  let url = document.getElementById('sc-add-url').value.trim();
  if (!name || !url) return;
  if (!/^https?:\/\//.test(url)) url = 'https://' + url;
  const shortcuts = document.getElementById('hp-shortcuts');
  const addBtn = document.getElementById('sc-add-btn');
  const sc = document.createElement('div');
  sc.className = 'sc'; sc.dataset.url = url;
  const favicon = 'https://www.google.com/s2/favicons?domain=' + new URL(url).hostname + '&sz=64';
  sc.innerHTML = '<div class="sc-icon"><img src="' + favicon + '" onerror="this.replaceWith(document.createTextNode(\'🔗\'))"></div><div class="sc-label">' + name + '</div>';
  sc.addEventListener('click', () => navigate(url));
  sc.addEventListener('contextmenu', e => { e.preventDefault(); if (confirm('Remove "' + name + '" shortcut?')) sc.remove(); });
  shortcuts.insertBefore(sc, addBtn);
  window.closeAddShortcutModal();
};
document.getElementById('add-shortcut-overlay').addEventListener('click', function(e) { if (e.target === this) window.closeAddShortcutModal(); });
['sc-add-name','sc-add-url'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') window.confirmAddShortcut(); if (e.key === 'Escape') window.closeAddShortcutModal(); });
});

// ── WELCOME OVERLAY
(function() {
  if (localStorage.getItem('pb_welcomed')) return;
  let wStep = 0;
  const overlay = document.getElementById('welcome-overlay');
  const steps = overlay.querySelectorAll('.wc-step');
  const dots = overlay.querySelectorAll('.wc-dot');
  function goStep(n) { steps.forEach((s, i) => s.classList.toggle('wc-active', i === n)); dots.forEach((d, i) => d.classList.toggle('wc-dot-active', i === n)); wStep = n; }
  overlay.style.display = 'flex'; goStep(0);
  document.getElementById('wc-name-input').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('wc-next-1').click(); });
  document.getElementById('wc-next-1').onclick = () => {
    const name = document.getElementById('wc-name-input').value.trim();
    if (name) pbSettings.userName = name;
    saveSettings(); goStep(1);
  };
  document.getElementById('wc-skip-1').onclick = () => goStep(1);
  document.querySelectorAll('.wc-engine-btn').forEach(btn => { btn.onclick = () => { document.querySelectorAll('.wc-engine-btn').forEach(b => b.classList.remove('wc-engine-active')); btn.classList.add('wc-engine-active'); }; });
  document.getElementById('wc-next-2').onclick = () => {
    const active = document.querySelector('.wc-engine-btn.wc-engine-active');
    if (active) {
      const eng = active.dataset.engine; pbSettings.searchEngine = eng;
      window._searchBase = ENGINES_MAP[eng]; saveSettings();
      document.getElementById('st-search-engine').value = eng;
    }
    goStep(2);
  };
  document.getElementById('wc-skip-2').onclick = () => goStep(2);
  document.getElementById('wc-import-btn').onclick = () => openImportModal(true);
  document.getElementById('wc-skip-3').onclick = () => finishWelcome();
  document.getElementById('wc-done-btn').onclick = () => finishWelcome();
  function finishWelcome() { localStorage.setItem('pb_welcomed', '1'); overlay.style.display = 'none'; }
  window._finishWelcomeAfterImport = function() { overlay.style.display = 'none'; goStep(3); overlay.style.display = 'flex'; };
})();

// ── IMPORT MODAL
window.openImportModal = function(fromWelcome) {
  _importFromWelcome = !!fromWelcome;
  const modal = document.getElementById('import-modal');
  modal.style.display = 'flex';
  document.getElementById('import-browsers-list').innerHTML = '<div class="import-loading">🔍 Scanning for browsers…</div>';
  document.getElementById('import-result').style.display = 'none';
  window.ipc.invoke('import-list-browsers').then(browsers => {
    const list = document.getElementById('import-browsers-list');
    if (!browsers.length) { list.innerHTML = '<div class="import-empty">No browsers found on this system.<br>Use "Choose folder" to select a profile manually.</div>'; return; }
    list.innerHTML = browsers.map((b, i) =>
      '<div class="import-browser-row" data-i="' + i + '" data-id="' + b.id + '" data-path="' + b.profilePath + '">' +
      '<span class="ib-icon">' + b.icon + '</span>' +
      '<div class="ib-info"><div class="ib-name">' + b.name + '</div><div class="ib-path">' + b.profilePath + '</div></div>' +
      '<div class="ib-check">○</div></div>'
    ).join('');
    list.querySelectorAll('.import-browser-row').forEach(row => {
      row.onclick = () => {
        list.querySelectorAll('.import-browser-row').forEach(r => { r.classList.remove('selected'); r.querySelector('.ib-check').textContent = '○'; });
        row.classList.add('selected'); row.querySelector('.ib-check').textContent = '●';
        window._selectedBrowser = { id: row.dataset.id, path: row.dataset.path };
      };
    });
  }).catch(() => { document.getElementById('import-browsers-list').innerHTML = '<div class="import-empty">Could not scan for browsers.</div>'; });
};
document.getElementById('import-close').onclick = () => { document.getElementById('import-modal').style.display = 'none'; };
document.getElementById('import-modal').addEventListener('click', e => { if (e.target === document.getElementById('import-modal')) document.getElementById('import-modal').style.display = 'none'; });
document.getElementById('import-pick-folder').onclick = async () => {
  const folder = await window.ipc.invoke('import-pick-folder');
  if (!folder) return;
  let id = 'chrome';
  if (folder.toLowerCase().includes('firefox') || folder.toLowerCase().includes('mozilla')) id = 'firefox';
  else if (folder.toLowerCase().includes('edge')) id = 'edge';
  else if (folder.toLowerCase().includes('brave')) id = 'brave';
  window._selectedBrowser = { id, path: folder };
  const list = document.getElementById('import-browsers-list');
  list.innerHTML = '<div class="import-browser-row selected" style="pointer-events:none">' +
    '<span class="ib-icon">📁</span><div class="ib-info"><div class="ib-name">Custom folder</div><div class="ib-path">' + folder + '</div></div>' +
    '<div class="ib-check">●</div></div>';
};
document.getElementById('import-do-btn').onclick = async () => {
  const sel = window._selectedBrowser;
  if (!sel) { showToast('Select a browser first', 'error'); return; }
  const whatBkm = document.getElementById('import-chk-bkm').checked, whatHist = document.getElementById('import-chk-hist').checked;
  if (!whatBkm && !whatHist) { showToast('Select at least one thing to import', 'error'); return; }
  document.getElementById('import-do-btn').textContent = 'Importing…'; document.getElementById('import-do-btn').disabled = true;
  try {
    const data = await window.ipc.invoke('import-browser-data', { browserId: sel.id, profilePath: sel.path, what: { bookmarks: whatBkm, history: whatHist } });
    let msg = [];
    if (data.bookmarks.length) {
      const existing = JSON.parse(localStorage.getItem('pb_bookmarks') || '[]');
      data.bookmarks.forEach(b => { if (!existing.find(e => e.url === b.url)) existing.push(b); });
      localStorage.setItem('pb_bookmarks', JSON.stringify(existing)); msg.push(data.bookmarks.length + ' bookmarks');
    }
    if (data.history.length) {
      hist = [...data.history, ...hist].slice(0, 500);
      localStorage.setItem('pb_hist', JSON.stringify(hist)); msg.push(data.history.length + ' history entries');
    }
    const resEl = document.getElementById('import-result');
    resEl.style.display = 'block'; resEl.className = 'import-result import-result-ok';
    resEl.innerHTML = '✅ Imported: ' + (msg.join(', ') || 'nothing') + (data.warnings.length ? '<br><span style="color:var(--warn)">' + data.warnings.join(' ') + '</span>' : '');
    if (_importFromWelcome) { setTimeout(() => { document.getElementById('import-modal').style.display = 'none'; localStorage.setItem('pb_welcomed', '1'); document.getElementById('welcome-overlay').style.display = 'none'; }, 1800); }
  } catch(e) {
    const resEl = document.getElementById('import-result');
    resEl.style.display = 'block'; resEl.className = 'import-result import-result-err';
    resEl.textContent = '❌ Import failed: ' + (e.message || e);
  } finally { document.getElementById('import-do-btn').textContent = 'Import'; document.getElementById('import-do-btn').disabled = false; }
};

// ── VPN INDICATOR
async function updateVpnIndicator() {
  if (!window.ipc) return;
  const ind = document.getElementById('vpn-indicator');
  if (!ind) return;
  try {
    const data = await window.ipc.invoke('get-vpn-state');
    if (data && data.enabled) { ind.style.opacity = '1'; ind.style.filter = 'drop-shadow(0 0 4px var(--green))'; ind.title = 'VPN Active: ' + (data.active || ''); }
    else { ind.style.opacity = '0.3'; ind.style.filter = 'none'; ind.title = 'VPN Off — click to configure'; }
  } catch(e) {}
}
setInterval(updateVpnIndicator, 3000);

// ── DEFAULT BROWSER POPUP
const DISMISSED_KEY = 'pb_default_dismissed';
window.ipc.on('check-default-browser', function(data) {
  if (!data.isDefault) _dbpShow();
});
function _dbpShow() {
  if (localStorage.getItem(DISMISSED_KEY)) return;
  const popup = document.getElementById('default-browser-popup');
  if (popup) popup.classList.add('show');
}
function _dbpHide() {
  const popup = document.getElementById('default-browser-popup');
  if (popup) popup.classList.remove('show');
}
document.getElementById('dbp-close').onclick = () => { _dbpHide(); localStorage.setItem(DISMISSED_KEY, '1'); };
document.getElementById('dbp-no').onclick = () => { _dbpHide(); localStorage.setItem(DISMISSED_KEY, '1'); };
document.getElementById('dbp-yes').onclick = async () => {
  const btn = document.getElementById('dbp-yes');
  btn.textContent = 'Setting…'; btn.disabled = true;
  try {
    const res = await window.ipc.invoke('set-default-browser');
    if (res.ok) {
      btn.textContent = '✅ Done! Check Windows Settings'; btn.style.background = '#3dd68c';
      const desc = document.querySelector('.dbp-desc');
      if (desc) desc.textContent = 'Windows Settings just opened — select PoleBrowse to confirm.';
      localStorage.setItem(DISMISSED_KEY, '1'); setTimeout(_dbpHide, 3500);
    } else { btn.textContent = 'Open Windows Settings'; btn.disabled = false; btn.onclick = () => window.ipc.invoke('set-default-browser'); }
  } catch(e) { btn.textContent = 'Failed — try manually'; btn.disabled = false; }
};

// ── IPC LISTENERS
window.ipc.on('view-event', (data) => {
  const tab = tabs.find(t => t.id === data.tabId);
  if (!tab) return;
  if (data.type === 'loading') { if (activeId === data.tabId) progStart(); }
  if (data.type === 'loaded') {
    if (activeId === data.tabId) { progEnd(); document.getElementById('urlbar').value = data.url; }
    tab.url = data.url; tab.title = data.title || data.url; tab.fav = favUrl(data.url);
    addHist(data.url, data.title); renderTabs(); updateNav();
  }
  if (data.type === 'navigate') { tab.url = data.url; if (activeId === data.tabId) document.getElementById('urlbar').value = data.url; }
  if (data.type === 'title') { tab.title = data.title; renderTabs(); }
  if (data.type === 'new-window') { newTab(data.url); }
});
window.ipc.on('download-start', (data) => { downloads[data.id] = { ...data, received:0, state:'progressing' }; activeDownloads++; updateDlBadge(); if (document.getElementById('downloads-panel').classList.contains('open')) renderDownloads(); });
window.ipc.on('download-update', (data) => { if (downloads[data.id]) { downloads[data.id].received = data.received; downloads[data.id].total = data.total; if (document.getElementById('downloads-panel').classList.contains('open')) renderDownloads(); } });
window.ipc.on('download-done', (data) => {
  if (downloads[data.id]) {
    downloads[data.id].state = data.state; downloads[data.id].savePath = data.savePath;
    activeDownloads = Math.max(0, activeDownloads - 1); updateDlBadge();
    if (data.state === 'completed') { closeAllPanels(); document.getElementById('downloads-panel').classList.add('open'); window.ipc.send('view-hide'); document.getElementById('homepage').style.display = 'none'; }
    renderDownloads();
  }
});
window.ipc.on('proto-launch-request', (data) => {
  const overlay = document.getElementById('proto-popup-overlay');
  const urlEl = document.getElementById('pp-url'); const yesBtn = document.getElementById('pp-yes');
  let _pendingUrl = data.url;
  urlEl.textContent = data.url.length > 120 ? data.url.slice(0, 117) + '…' : data.url;
  try { const scheme = new URL(data.url).protocol.replace(':', ''); yesBtn.textContent = 'Open ' + scheme + '://'; } catch { yesBtn.textContent = 'Open App'; }
  overlay.classList.add('open');
  document.getElementById('pp-yes').onclick = () => { if (_pendingUrl) window.ipc.send('proto-open-external', { url: _pendingUrl }); overlay.classList.remove('open'); };
  document.getElementById('pp-no').onclick = () => { overlay.classList.remove('open'); };
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); }, { once: true });
});
window.ipc.on('open-url-on-start', (data) => { navigate(data.url); });
window.ipc.on('receive-tab', (data) => { newTab(data.url); });
window.ipc.on('page-load-error', function(data) {
  if (!data || data.tabId !== activeId) return;
  const err = data.errorCode || '';
  if (['ERR_INTERNET_DISCONNECTED','ERR_NAME_NOT_RESOLVED','ERR_CONNECTION_REFUSED','ERR_NETWORK_CHANGED','ERR_CONNECTION_TIMED_OUT','ERR_CONNECTION_RESET','ERR_ADDRESS_UNREACHABLE'].some(e => err.includes(e))) { showNoInternet(data.url || ''); }
});
window.ipc.on('site-dangerous', function(data) { if (!data || data.tabId !== activeId) return; showDangerous(data.url || '', data.errorCode || ''); });

// ── URL BAR ENTER NAVIGATION
document.getElementById('urlbar').addEventListener('keydown', e => {
  if (e.key === 'Enter') { document.getElementById('suggestions').classList.remove('open'); navigate(e.target.value); }
});

// ── DOMContentLoaded
document.addEventListener('DOMContentLoaded', function() {
  // Win controls
  document.getElementById('btn-min').onclick = () => window.ipc.send('win-min');
  document.getElementById('btn-max').onclick = () => window.ipc.send('win-max');
  document.getElementById('btn-close').onclick = () => window.ipc.send('win-close');

  // Nav + toolbar
  document.getElementById('hp-search').addEventListener('keydown', e => { if (e.key === 'Enter') navigate(e.target.value); });
  document.getElementById('hp-go-btn').onclick = () => navigate(document.getElementById('hp-search').value);
  document.querySelectorAll('.sc').forEach(el => el.addEventListener('click', () => navigate(el.dataset.url)));
  document.querySelectorAll('.bm').forEach(el => el.addEventListener('click', () => navigate(el.dataset.url)));
  document.getElementById('btn-back').onclick = () => window.ipc.send('view-back', { tabId: activeId });
  document.getElementById('btn-fwd').onclick = () => window.ipc.send('view-fwd', { tabId: activeId });
  document.getElementById('btn-reload').onclick = () => window.ipc.send('view-reload', { tabId: activeId });
  document.getElementById('btn-home').onclick = () => { const tab = getTab(activeId); if (tab) { tab.url = null; tab.title = 'New Tab'; } showActiveTab(); renderTabs(); };
  document.getElementById('btn-newtab').onclick = () => newTab(null);

  // History panel
  document.getElementById('hist-close').onclick = () => { closeAllPanels(); showActiveTab(); };
  document.getElementById('hist-clear').onclick = () => { hist = []; localStorage.removeItem('pb_hist'); renderHist(); };

  // Downloads panel
  document.getElementById('dl-close').onclick = () => { closeAllPanels(); showActiveTab(); };
  document.getElementById('dl-clear').onclick = () => { Object.keys(downloads).forEach(id => { if (downloads[id].state !== 'progressing') delete downloads[id]; }); renderDownloads(); };

  // Ridell page actions
  document.getElementById('rp-hist-clear').onclick = () => { hist = []; localStorage.removeItem('pb_hist'); renderRidelHistory(); showToast('History cleared', 'success'); };

  // Settings listeners
  document.getElementById('st-dark').onclick = () => applyTheme('dark');
  document.getElementById('st-light').onclick = () => applyTheme('light');
  document.getElementById('st-glass').onclick = () => applyTheme('glass');
  document.getElementById('st-bookmarks').onchange = e => { pbSettings.showBookmarks = e.target.checked; saveSettings(); applySettings(); };
  document.getElementById('st-compact-tabs').onchange = e => { pbSettings.compactTabs = e.target.checked; saveSettings(); applySettings(); };
  document.getElementById('st-save-hist').onchange = e => { pbSettings.saveHist = e.target.checked; saveSettings(); };
  document.getElementById('st-clear-hist-exit').onchange = e => { pbSettings.clearHistExit = e.target.checked; saveSettings(); };
  document.getElementById('st-spoof-chrome').onchange = e => { pbSettings.spoofChrome = e.target.checked; saveSettings(); window.ipc.send('setting-change', { key: 'spoofChrome', value: e.target.checked }); };
  document.getElementById('st-search-engine').onchange = e => {
    pbSettings.searchEngine = e.target.value; saveSettings();
    window._searchBase = ENGINES_MAP[e.target.value] || ENGINES_MAP.google;
  };
  document.getElementById('st-clear-all').onclick = () => {
    hist = []; localStorage.removeItem('pb_hist');
    Object.keys(downloads).forEach(k => delete downloads[k]);
    updateDlBadge(); showToast('All browsing data cleared', 'success');
  };
  document.getElementById('st-open-import').onclick = () => openImportModal(false);

  // Default browser status
  const stBtn = document.getElementById('st-set-default');
  if (stBtn) {
    window.ipc.invoke('default-browser-status').then(res => {
      if (!res || !res.isWindows) { stBtn.style.display = 'none'; return; }
      if (res.isDefault) { stBtn.textContent = '✅ Already default'; stBtn.disabled = true; stBtn.style.opacity = '.6'; }
    }).catch(() => { stBtn.style.display = 'none'; });
    stBtn.onclick = async () => {
      stBtn.textContent = 'Setting…'; stBtn.disabled = true;
      try { const res = await window.ipc.invoke('set-default-browser'); stBtn.textContent = res.isDefault ? '✅ Set as default' : 'Confirm in Windows Settings →'; stBtn.disabled = false; }
      catch(e) { stBtn.textContent = 'Failed'; stBtn.disabled = false; }
    };
  }

  // Observe settings page opening to init DNS, VPN, AdBlock
  const settingsObs = new MutationObserver(() => {
    const pg = document.getElementById('ridell-settings');
    if (pg && pg.classList.contains('open')) { initDnsUI(); initVpnUI(); initAdBlockUI(); }
  });
  const settingsPg = document.getElementById('ridell-settings');
  if (settingsPg) settingsObs.observe(settingsPg, { attributes: true, attributeFilter: ['class'] });

  // Apply settings on load
  renderSettings();

  // Initial tab
  newTab(null);

  // Logo
  const wcLogo = document.getElementById('wc-logo');
  if (wcLogo) wcLogo.src = 'assets/pb-logo.png';

  // Update VPN indicator on load
  updateVpnIndicator();
});
