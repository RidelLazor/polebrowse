use cef::*;

mod app;
mod handler;
mod render;

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

    let mut app = app::PolebrowseApp;

    let settings = Settings {
        no_sandbox: 1,
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
