mod app;
mod client;
mod render;

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

fn main() -> Result<(), &'static str> {
    let args = cef::args::Args::new();
    let Some(cmd_line) = args.as_cmd_line() else {
        return Err("Failed to parse command line");
    };

    let switch = CefString::from("type");
    let is_browser = cmd_line.has_switch(Some(&switch)) == 0;
    let ret = execute_process(Some(&args.as_main_args()), None, std::ptr::null_mut());

    if !is_browser {
        return Ok(());
    }

    assert_eq!(ret, -1, "expected browser process");

    let mut app = app::PolebrowseApp::new();

    let resources_dir = cef_resources_dir();
    eprintln!("[polebrowse] using CEF resources: {}", resources_dir.display());

    let resources_dir_path = CefString::from(resources_dir.to_string_lossy().as_ref());
    let locales_dir_path = CefString::from(resources_dir.join("locales").to_string_lossy().as_ref());

    let settings = Settings {
        no_sandbox: 1,
        disable_signal_handlers: 1,
        resources_dir_path,
        locales_dir_path,
        ..Default::default()
    };

    let ok = initialize(
        Some(&args.as_main_args()),
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
