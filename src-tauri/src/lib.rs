use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

// ── STATE ──────────────────────────────────────────────────────

struct AppState {
    dns_enabled: bool,
    dns_active: String,
    vpn_enabled: bool,
    vpn_active: String,
    vpn_custom_host: String,
    vpn_custom_port: u16,
    vpn_custom_type: String,
    adblock_enabled: bool,
    blocked_count: u64,
}

// ── DNS PROVIDER DATA ──────────────────────────────────────────

#[derive(Serialize, Clone)]
struct DnsProvider {
    name: String,
    url: String,
    ips: Vec<String>,
}

fn dns_providers() -> HashMap<String, DnsProvider> {
    let mut m = HashMap::new();
    m.insert("cloudflare".into(), DnsProvider { name: "Cloudflare".into(), url: "https://cloudflare-dns.com/dns-query".into(), ips: vec!["1.1.1.1".into(), "1.0.0.1".into()] });
    m.insert("google".into(), DnsProvider { name: "Google".into(), url: "https://dns.google/dns-query".into(), ips: vec!["8.8.8.8".into(), "8.8.4.4".into()] });
    m.insert("quad9".into(), DnsProvider { name: "Quad9".into(), url: "https://dns.quad9.net/dns-query".into(), ips: vec!["9.9.9.9".into(), "149.112.112.112".into()] });
    m.insert("adguard".into(), DnsProvider { name: "AdGuard".into(), url: "https://dns.adguard-dns.com/dns-query".into(), ips: vec!["94.140.14.14".into(), "94.140.15.15".into()] });
    m
}

// ── VPN PROVIDER DATA ──────────────────────────────────────────

#[derive(Serialize, Clone)]
struct VpnProvider {
    name: String,
    #[serde(rename = "type")]
    proxy_type: Option<String>,
    host: Option<String>,
    port: Option<u16>,
    info: String,
}

fn vpn_providers() -> HashMap<String, VpnProvider> {
    let mut m = HashMap::new();
    m.insert("none".into(), VpnProvider { name: "No VPN (Direct)".into(), proxy_type: None, host: None, port: None, info: "Direct connection, no proxy".into() });
    m.insert("tor".into(), VpnProvider { name: "Tor Network".into(), proxy_type: Some("socks5".into()), host: Some("127.0.0.1".into()), port: Some(9050), info: "Requires Tor Browser or tor service running".into() });
    m.insert("i2p".into(), VpnProvider { name: "I2P".into(), proxy_type: Some("socks5".into()), host: Some("127.0.0.1".into()), port: Some(4444), info: "Requires I2P running locally".into() });
    m.insert("privoxy".into(), VpnProvider { name: "Privoxy".into(), proxy_type: Some("http".into()), host: Some("127.0.0.1".into()), port: Some(8118), info: "Requires Privoxy running locally".into() });
    m.insert("mullvad".into(), VpnProvider { name: "Mullvad SOCKS".into(), proxy_type: Some("socks5".into()), host: Some("socks5.mullvad.net".into()), port: Some(1080), info: "Requires Mullvad account".into() });
    m.insert("windscribe".into(), VpnProvider { name: "Windscribe SOCKS".into(), proxy_type: Some("socks5".into()), host: Some("nl.windscribe.com".into()), port: Some(1080), info: "Requires Windscribe account".into() });
    m.insert("custom".into(), VpnProvider { name: "Custom Proxy".into(), proxy_type: Some("socks5".into()), host: Some("127.0.0.1".into()), port: Some(1080), info: "Enter your own proxy address".into() });
    m
}

#[derive(Serialize)]
struct VpnState {
    providers: HashMap<String, VpnProvider>,
    active: String,
    enabled: bool,
    custom_host: String,
    custom_port: u16,
    custom_type: String,
}

// ── INIT STATE ─────────────────────────────────────────────────

fn init_state() -> AppState {
    AppState {
        dns_enabled: true,
        dns_active: "cloudflare".into(),
        vpn_enabled: false,
        vpn_active: "none".into(),
        vpn_custom_host: "127.0.0.1".into(),
        vpn_custom_port: 1080,
        vpn_custom_type: "socks5".into(),
        adblock_enabled: true,
        blocked_count: 0,
    }
}

// ── BROWSER PROFILES ───────────────────────────────────────────

#[derive(Serialize)]
struct BrowserProfile {
    id: String,
    name: String,
    icon: String,
    profile_path: String,
}

fn get_browser_profiles() -> Vec<BrowserProfile> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/home".into());
    let candidates = vec![
        ("chrome", "Google Chrome", "🌐", vec![format!("{}/.config/google-chrome", home)]),
        ("edge", "Microsoft Edge", "🔵", vec![format!("{}/.config/microsoft-edge", home)]),
        ("brave", "Brave", "🦁", vec![format!("{}/.config/BraveSoftware/Brave-Browser", home)]),
        ("firefox", "Firefox", "🦊", vec![format!("{}/.mozilla/firefox", home)]),
        ("opera", "Opera", "🔴", vec![format!("{}/.config/opera", home)]),
    ];
    let mut found = Vec::new();
    for (id, name, icon, paths) in candidates {
        for p in paths {
            if std::path::Path::new(&p).exists() {
                found.push(BrowserProfile { id: id.into(), name: name.into(), icon: icon.into(), profile_path: p });
                break;
            }
        }
    }
    found
}

fn read_chrome_bookmarks(profile_path: &str) -> Vec<serde_json::Value> {
    let path = format!("{}/Default/Bookmarks", profile_path);
    let content = match std::fs::read_to_string(&path) { Ok(c) => c, Err(_) => return vec![] };
    let json: serde_json::Value = match serde_json::from_str(&content) { Ok(v) => v, Err(_) => return vec![] };
    let mut results = Vec::new();
    fn walk(node: &serde_json::Value, results: &mut Vec<serde_json::Value>) {
        if node.get("type").and_then(|t| t.as_str()) == Some("url") {
            if let (Some(title), Some(url)) = (node.get("name").and_then(|n| n.as_str()), node.get("url").and_then(|u| u.as_str())) {
                let entry = serde_json::json!({"title": title, "url": url});
                results.push(entry);
            }
        }
        if let Some(children) = node.get("children").and_then(|c| c.as_array()) {
            for child in children { walk(child, results); }
        }
    }
    if let Some(roots) = json.get("roots").and_then(|r| r.as_object()) {
        for (_, v) in roots { walk(v, &mut results); }
    }
    results.truncate(500);
    results
}

fn read_firefox_bookmarks(profile_path: &str) -> Vec<serde_json::Value> {
    let dirs = match std::fs::read_dir(profile_path) { Ok(d) => d, Err(_) => return vec![] };
    let profile_dir = dirs.filter_map(|e| e.ok()).find(|e| {
        let n = e.file_name().to_string_lossy().to_string();
        n.ends_with(".default-release") || n.ends_with(".default") || n.contains("default")
    });
    let profile_dir = match profile_dir { Some(d) => d, None => return vec![] };
    let places = format!("{}/{}", profile_path, profile_dir.file_name().to_string_lossy());
    let places_sqlite = format!("{}/places.sqlite", places);
    if !std::path::Path::new(&places_sqlite).exists() { return vec![]; }
    vec![]
}

#[derive(Serialize)]
struct ImportResult {
    bookmarks: Vec<serde_json::Value>,
    history: Vec<serde_json::Value>,
    warnings: Vec<String>,
}

#[derive(Deserialize)]
struct ImportWhat {
    bookmarks: bool,
    history: bool,
}

#[derive(Deserialize)]
struct ImportData {
    browser_id: String,
    profile_path: String,
    what: ImportWhat,
}

// ── COMMANDS ───────────────────────────────────────────────────

// ── DNS ──

#[derive(Serialize)]
struct DnsState {
    providers: HashMap<String, DnsProvider>,
    active: String,
    enabled: bool,
}

#[tauri::command]
fn get_dns_providers(app: tauri::AppHandle) -> DnsState {
    let state = app.state::<Mutex<AppState>>();
    let s = state.lock().unwrap();
    DnsState { providers: dns_providers(), active: s.dns_active.clone(), enabled: s.dns_enabled }
}

#[derive(Serialize)]
struct DnsResult {
    success: bool,
    provider: Option<String>,
    error: Option<String>,
}

#[tauri::command]
fn set_dns_provider(app: tauri::AppHandle, key: String) -> DnsResult {
    let providers = dns_providers();
    if !providers.contains_key(&key) {
        return DnsResult { success: false, provider: None, error: Some("Unknown provider".into()) };
    }
    let state = app.state::<Mutex<AppState>>();
    let mut s = state.lock().unwrap();
    s.dns_active = key.clone();
    DnsResult { success: true, provider: Some(providers[&key].name.clone()), error: None }
}

#[derive(Serialize)]
struct DnsToggleResult {
    success: bool,
    enabled: bool,
}

#[tauri::command]
fn toggle_dns(app: tauri::AppHandle, enable: bool) -> DnsToggleResult {
    let state = app.state::<Mutex<AppState>>();
    let mut s = state.lock().unwrap();
    s.dns_enabled = enable;
    DnsToggleResult { success: true, enabled: s.dns_enabled }
}

#[derive(Serialize)]
struct DnsTestResult {
    success: bool,
    addresses: Vec<String>,
    error: Option<String>,
}

#[tauri::command]
async fn test_dns() -> DnsTestResult {
    match reqwest::get("https://cloudflare.com").await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            DnsTestResult { success: status < 400, addresses: vec![format!("HTTP {}", status)], error: None }
        }
        Err(e) => DnsTestResult { success: false, addresses: vec![], error: Some(e.to_string()) },
    }
}

// ── VPN ──

#[tauri::command]
fn get_vpn_state(app: tauri::AppHandle) -> VpnState {
    let state = app.state::<Mutex<AppState>>();
    let s = state.lock().unwrap();
    VpnState {
        providers: vpn_providers(),
        active: s.vpn_active.clone(),
        enabled: s.vpn_enabled,
        custom_host: s.vpn_custom_host.clone(),
        custom_port: s.vpn_custom_port,
        custom_type: s.vpn_custom_type.clone(),
    }
}

#[derive(Serialize)]
struct VpnProviderResult {
    success: bool,
    provider: Option<String>,
    error: Option<String>,
}

#[tauri::command]
fn set_vpn_provider(app: tauri::AppHandle, key: String) -> VpnProviderResult {
    let providers = vpn_providers();
    if !providers.contains_key(&key) {
        return VpnProviderResult { success: false, provider: None, error: Some("Unknown provider".into()) };
    }
    let state = app.state::<Mutex<AppState>>();
    let mut s = state.lock().unwrap();
    s.vpn_active = key.clone();
    VpnProviderResult { success: true, provider: Some(providers[&key].name.clone()), error: None }
}

#[derive(Serialize)]
struct VpnToggleResult {
    success: bool,
    enabled: bool,
}

#[tauri::command]
fn toggle_vpn(app: tauri::AppHandle, enable: bool) -> VpnToggleResult {
    let state = app.state::<Mutex<AppState>>();
    let mut s = state.lock().unwrap();
    s.vpn_enabled = enable;
    VpnToggleResult { success: true, enabled: s.vpn_enabled }
}

#[derive(Serialize)]
struct SetCustomProxyResult {
    success: bool,
}

#[derive(Deserialize)]
struct CustomProxyData {
    host: String,
    port: u16,
    #[serde(rename = "type")]
    proxy_type: String,
}

#[tauri::command]
fn set_custom_proxy(app: tauri::AppHandle, data: CustomProxyData) -> SetCustomProxyResult {
    let state = app.state::<Mutex<AppState>>();
    let mut s = state.lock().unwrap();
    s.vpn_custom_host = data.host;
    s.vpn_custom_port = data.port;
    s.vpn_custom_type = data.proxy_type;
    SetCustomProxyResult { success: true }
}

#[derive(Serialize)]
struct ProxyTestResult {
    success: bool,
    ip: String,
    error: Option<String>,
}

#[tauri::command]
async fn test_proxy() -> ProxyTestResult {
    match reqwest::get("https://api.ipify.org?format=json").await {
        Ok(resp) => {
            match resp.text().await {
                Ok(body) => {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                        if let Some(ip) = json.get("ip").and_then(|v| v.as_str()) {
                            return ProxyTestResult { success: true, ip: ip.to_string(), error: None };
                        }
                    }
                    ProxyTestResult { success: true, ip: body.trim().to_string(), error: None }
                }
                Err(e) => ProxyTestResult { success: false, ip: String::new(), error: Some(e.to_string()) },
            }
        }
        Err(e) => ProxyTestResult { success: false, ip: String::new(), error: Some(e.to_string()) },
    }
}

// ── ADBLOCK ──

#[derive(Serialize)]
struct AdblockState {
    enabled: bool,
    blocked_count: u64,
}

#[tauri::command]
fn get_adblock_state(app: tauri::AppHandle) -> AdblockState {
    let state = app.state::<Mutex<AppState>>();
    let s = state.lock().unwrap();
    AdblockState { enabled: s.adblock_enabled, blocked_count: s.blocked_count }
}

#[derive(Serialize)]
struct AdblockToggleResult {
    success: bool,
    enabled: bool,
}

#[tauri::command]
fn toggle_adblock(app: tauri::AppHandle, enable: bool) -> AdblockToggleResult {
    let state = app.state::<Mutex<AppState>>();
    let mut s = state.lock().unwrap();
    s.adblock_enabled = enable;
    AdblockToggleResult { success: true, enabled: s.adblock_enabled }
}

// ── AUTOCOMPLETE ──

#[derive(Serialize)]
struct AutocompleteItem {
    #[serde(rename = "type")]
    item_type: String,
    text: String,
    relevance: i64,
}

#[tauri::command]
async fn autocomplete(query: String) -> Vec<AutocompleteItem> {
    if query.trim().is_empty() { return vec![]; }
    let q = query.trim();
    let mut results = Vec::new();

    let google_url = format!("https://suggestqueries.google.com/complete/search?client=chrome&q={}", urlencoding(&q));
    if let Ok(resp) = reqwest::get(&google_url).await {
        if let Ok(body) = resp.text().await {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                if let Some(suggestions) = json.get(1).and_then(|a| a.as_array()) {
                    for (i, s) in suggestions.iter().enumerate() {
                        if let Some(text) = s.as_str() {
                            results.push(AutocompleteItem { item_type: "search".into(), text: text.to_string(), relevance: 1000 - i as i64 * 10 });
                        }
                    }
                }
            }
        }
    }

    results.truncate(8);
    results
}

fn urlencoding(s: &str) -> String {
    s.chars().map(|c| match c {
        'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
        ' ' => "+".to_string(),
        _ => format!("%{:02X}", c as u8),
    }).collect()
}

// ── IMPORT ──

#[tauri::command]
fn import_list_browsers() -> Vec<BrowserProfile> {
    get_browser_profiles()
}

#[tauri::command]
fn import_browser_data(data: ImportData) -> ImportResult {
    let mut result = ImportResult { bookmarks: vec![], history: vec![], warnings: vec![] };
    if data.browser_id == "firefox" {
        if data.what.bookmarks { result.bookmarks = read_firefox_bookmarks(&data.profile_path); }
        if data.what.history { result.warnings.push("Firefox history import requires rusqlite.".into()); }
    } else {
        if data.what.bookmarks { result.bookmarks = read_chrome_bookmarks(&data.profile_path); }
        if data.what.history { result.warnings.push("History import requires SQLite support in Rust. Bookmarks still imported.".into()); }
    }
    result
}

// ── DEFAULT BROWSER ──

#[derive(Serialize)]
struct DefaultBrowserStatus {
    is_default: bool,
    is_windows: bool,
}

#[tauri::command]
fn default_browser_status() -> DefaultBrowserStatus {
    DefaultBrowserStatus { is_default: false, is_windows: cfg!(target_os = "windows") }
}

#[derive(Serialize)]
struct SetDefaultResult {
    ok: bool,
    is_default: bool,
    reason: Option<String>,
}

#[tauri::command]
fn set_default_browser() -> SetDefaultResult {
    if cfg!(target_os = "windows") {
        SetDefaultResult { ok: false, is_default: false, reason: Some("Not implemented on this platform".into()) }
    } else {
        SetDefaultResult { ok: false, is_default: false, reason: Some("Not supported on this platform".into()) }
    }
}

// ── RUN ────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(init_state()))
        .setup(|app| {
            #[cfg(not(mobile))]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.maximize();
            }
            let _ = app.emit("open-url-on-start", serde_json::json!({}));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_dns_providers, set_dns_provider, toggle_dns, test_dns,
            get_vpn_state, set_vpn_provider, toggle_vpn, set_custom_proxy, test_proxy,
            get_adblock_state, toggle_adblock,
            autocomplete,
            import_list_browsers, import_browser_data,
            default_browser_status, set_default_browser,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
