/// Generates the JavaScript to inject the PoleBrowse chrome overlay
/// into every page after it loads.
pub fn chrome_script() -> Result<String, Box<dyn std::error::Error>> {
    let chrome_css = r#"
#polebrowse-chrome {
  all: initial;
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 2147483647;
  font-family: system-ui, -apple-system, sans-serif;
}
#polebrowse-chrome * {
  all: revert;
  box-sizing: border-box;
  margin: 0; padding: 0;
}
.pb-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: #1a1a2e;
  border-bottom: 1px solid #2a2a4a;
  height: 44px;
}
.pb-btn {
  background: none;
  border: none;
  color: #888;
  width: 28px; height: 28px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pb-btn:hover { background: #0f3460; color: #e0e0e0; }
.pb-urlbar {
  flex: 1;
  display: flex;
  align-items: center;
  background: #16213e;
  border: 1px solid #2a2a4a;
  border-radius: 8px;
  padding: 0 10px;
  height: 30px;
}
.pb-urlbar input {
  flex: 1;
  background: none;
  border: none;
  color: #e0e0e0;
  font-size: 13px;
  outline: none;
}
.pb-urlbar input::placeholder { color: #666; }
.pb-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 12px;
  background: #16213e;
  border-top: 1px solid #2a2a4a;
  font-size: 11px;
  color: #888;
  height: 24px;
}
body { padding-top: 44px !important; }
"#;

    let chrome_html = format!(r#"
(function() {{
  if (document.getElementById('polebrowse-chrome')) return;

  const container = document.createElement('div');
  container.id = 'polebrowse-chrome';
  container.innerHTML = `
    <div class="pb-toolbar">
      <button class="pb-btn" id="pb-back" title="Back">&#9664;</button>
      <button class="pb-btn" id="pb-fwd" title="Forward">&#9654;</button>
      <button class="pb-btn" id="pb-reload" title="Reload">&#8635;</button>
      <div class="pb-urlbar">
        <input type="text" id="pb-url" placeholder="Search or enter URL..." value="${{document.location.href}}">
      </div>
      <button class="pb-btn" id="pb-menu" title="Menu">&#8942;</button>
    </div>
    <div class="pb-status">
      <span id="pb-status-text">Ready</span>
      <span id="pb-url-display"></span>
    </div>
  `;
  document.body.prepend(container);

  const style = document.createElement('style');
  style.textContent = `{chrome_css}`;
  document.head.appendChild(style);

  // Adjust body padding for the chrome bar
  document.body.style.paddingTop = '44px';

  // Events
  document.getElementById('pb-back').onclick = () => window.__polebrowse?.goBack?.();
  document.getElementById('pb-fwd').onclick = () => window.__polebrowse?.goForward?.();
  document.getElementById('pb-reload').onclick = () => window.__polebrowse?.reload?.();

  const urlInput = document.getElementById('pb-url');
  urlInput.addEventListener('keydown', (e) => {{
    if (e.key === 'Enter') {{
      let url = urlInput.value.trim();
      if (!url) return;
      if (!/^[a-zA-Z]+:\\/\\//.test(url)) url = 'https://' + url;
      window.__polebrowse?.navigate?.(url);
      urlInput.blur();
    }}
  }});

  // Update URL display
  const obs = new MutationObserver(() => {{
    const urlDisplay = document.getElementById('pb-url-display');
    if (urlDisplay && urlDisplay.textContent !== document.location.href) {{
      urlInput.value = document.location.href;
    }}
  }});
  obs.observe(document.body, {{ childList: true, subtree: true }});
}})();
"#, chrome_css = chrome_css);

    Ok(chrome_html)
}
