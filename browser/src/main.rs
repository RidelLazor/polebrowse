mod app;
mod client;
mod ipc;
mod ui;

use std::ffi::CString;
use std::os::raw::c_char;
use std::path::PathBuf;

use cef::*;

/// Build-time embedded path to the CEF resources directory.
/// Set by build.rs via `cargo::rustc-env`; falls back to Resources/ next to the executable.
fn cef_resources_dir() -> PathBuf {
    if let Some(dir) = option_env!("CEF_RESOURCES_DIR") {
        let p = PathBuf::from(dir);
        if p.exists() {
            return p;
        }
        eprintln!("[polebrowse] embedded CEF_RESOURCES_DIR={} does not exist, falling back", dir);
    }
    let exe = std::env::current_exe().ok();
    if let Some(dir) = exe.as_ref().and_then(|p| p.parent()) {
        let resources = dir.join("Resources");
        if resources.exists() {
            return resources;
        }
    }
    PathBuf::from("Resources")
}

/// Build a custom argc/argv with performance-enhancing CEF/Chromium switches.
fn build_perf_args() -> (Vec<CString>, Vec<*mut c_char>, MainArgs) {
    let perf_switches: &[&str] = &[
        // Single process avoids all subprocess crashes (GPU, network, etc.) on this system
        "--single-process",
        // Linux sandbox fixes
        "--no-sandbox",
        "--no-zygote",
        // GPU fixes for Linux/Arch
        "--disable-gpu",
        "--disable-gpu-compositing",
        // Rendering threads
        "--num-raster-threads=4",
        // Kill unnecessary background noise
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-component-update",
        "--disable-domain-reliability",
        "--disable-breakpad",
        "--disable-background-timer-throttling",
        "--disable-features=AutofillServerCommunication,TranslateUI,InterestFeedContentSuggestions,MediaRouter,ReadingList,TabGroupsSave",
        // Network tuning
        "--enable-quic",
    ];

    let mut cstrings: Vec<CString> = Vec::new();
    // argv[0] = program path
    if let Some(exe) = std::env::args().next() {
        cstrings.push(CString::new(exe).expect("invalid program name"));
    } else {
        cstrings.push(CString::new("polebrowse").unwrap());
    }
    for s in perf_switches {
        cstrings.push(CString::new(*s).expect("invalid switch"));
    }

    let mut argv: Vec<*mut c_char> = cstrings
        .iter()
        .map(|s| s.as_ptr() as *mut c_char)
        .collect();

    let main_args = MainArgs {
        #[cfg(windows)]
        instance: std::ptr::null_mut(),
        #[cfg(not(windows))]
        argc: argv.len() as i32,
        #[cfg(not(windows))]
        argv: argv.as_mut_ptr(),
    };

    (cstrings, argv, main_args)
}

fn main() -> Result<(), &'static str> {
    // Must be the very first CEF API call — configures the API version
    // that libcef.so uses internally. Without this, modern CEF (148+)
    // crashes with SIGTRAP at any CppToC-wrapped function.
    api_hash(cef::sys::CEF_API_VERSION_LAST, 0);

    // Build custom argv with performance flags.
    // cstrings and argv_ptrs must outlive the CEF calls below.
    let (_cstrings, _argv_ptrs, perf_args) = build_perf_args();

    // Read the original command line to detect subprocess type.
    // (CEF adds --type=renderer etc. to subprocess invocations.)
    let orig_args = cef::args::Args::new();
    let Some(cmd_line) = orig_args.as_cmd_line() else {
        return Err("Failed to parse command line");
    };
    let switch = CefString::from("type");
    let is_browser = cmd_line.has_switch(Some(&switch)) == 0;
    let mut app = app::PolebrowseApp::new();

    let ret = execute_process(
        Some(&perf_args),
        Some(&mut app),
        std::ptr::null_mut(),
    );

    if !is_browser {
        return Ok(());
    }

    assert_eq!(ret, -1, "expected browser process");

    let resources_dir = cef_resources_dir();
    eprintln!("[polebrowse] using CEF resources: {}", resources_dir.display());

    let resources_dir_path = CefString::from(resources_dir.to_string_lossy().as_ref());
    let locales_dir_path = CefString::from(resources_dir.join("locales").to_string_lossy().as_ref());
    let cache_path = CefString::from("/tmp/polebrowse-cache");
    let subprocess_path = CefString::from(
        std::env::current_exe()
            .unwrap_or_default()
            .to_string_lossy()
            .as_ref(),
    );

    let settings = Settings {
        no_sandbox: 1,
        disable_signal_handlers: 1,
        log_file: CefString::from("/tmp/polebrowse-cef.log"),
        root_cache_path: cache_path,
        browser_subprocess_path: subprocess_path,
        resources_dir_path,
        locales_dir_path,
        // V8 JS engine flags
        javascript_flags: CefString::from("--opt"),
        ..Default::default()
    };

    eprintln!("[polebrowse] settings:");
    eprintln!("  resources_dir_path: {}", resources_dir.to_string_lossy());
    eprintln!("  cache_path: /tmp/polebrowse-cache");
    eprintln!("  subprocess_path: {}", std::env::current_exe().unwrap_or_default().to_string_lossy());
    eprintln!("  log_file: /tmp/polebrowse-cef.log");

    let ok = initialize(
        Some(&perf_args),
        Some(&settings),
        Some(&mut app),
        std::ptr::null_mut(),
    );
    assert_eq!(ok, 1, "CEF init failed");

    eprintln!("[polebrowse] running message loop");
    run_message_loop();
    shutdown();
    Ok(())
}
