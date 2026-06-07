use cef::*;

/// Registered by the render process handler in on_context_created.
/// Provides `window.__polebrowse_ipc(msg)` to JS.
pub fn register_bridge(context: &mut V8Context) {
    let name = CefString::from("__polebrowse_ipc");

    // Check if already registered
    if let Some(global) = context.global() {
        if global.has_value_bykey(Some(&name)) != 0 {
            return;
        }
    }

    let Some(global) = context.global() else { return };

    let mut handler = PolebrowseIPCHandler::new();
    let Some(mut func) = v8_value_create_function(Some(&name), Some(&mut handler)) else {
        return;
    };

    global.set_value_bykey(Some(&name), Some(&mut func), V8Propertyattribute::default());
}

// ── V8 Handler (runs in renderer process) ──

wrap_v8_handler! {
    pub struct PolebrowseIPCHandler;

    impl V8Handler {
        fn execute(
            &self,
            _name: Option<&CefString>,
            _object: Option<&mut V8Value>,
            arguments: Option<&[Option<V8Value>]>,
            _retval: Option<&mut Option<V8Value>>,
            _exception: Option<&mut CefString>,
        ) -> i32 {
            let args = arguments.unwrap_or(&[]);
            let Some(Some(arg0)) = args.first() else { return 0 };
            let req_utf16 = CefStringUtf16::from(&arg0.string_value());
            let request = format!("{req_utf16}");

            let Some(context) = v8_context_get_current_context() else { return 0 };
            let Some(frame) = context.frame() else { return 0 };

            let mut message =
                process_message_create(Some(&CefString::from("__polebrowse_ipc")));
            let Some(args_list) = message.as_ref().and_then(|m| m.argument_list()) else {
                return 0;
            };
            args_list.set_string(0, Some(&CefString::from(request.as_str())));

            if let Some(msg) = message.as_mut() {
                frame.send_process_message(ProcessId::BROWSER, Some(msg));
            }

            1
        }
    }
}

use crate::ui::SharedState;

// ── Browser-side IPC handler ──

pub fn handle_process_message(
    _browser: Option<&mut Browser>,
    _frame: Option<&mut Frame>,
    message: Option<&mut ProcessMessage>,
    state: &SharedState,
) -> i32 {
    let Some(msg) = message else { return 0 };
    let name = CefStringUtf16::from(&msg.name());
    if format!("{name}") != "__polebrowse_ipc" {
        return 0;
    }

    let Some(args) = msg.argument_list() else { return 0 };
    let request = CefStringUtf16::from(&args.string(0));
    let request = format!("{request}");

    eprintln!("[polebrowse:js] {request}");

    let parts: Vec<&str> = request.splitn(2, '|').collect();
    let cmd = parts.first().copied().unwrap_or("");
    
    let s = state.borrow();
    let Some(ref content_bv) = s.content_view else { return 0 };
    let Some(browser) = content_bv.browser() else { return 0 };

    match cmd {
        "goBack" => {
            browser.go_back();
        }
        "goForward" => {
            browser.go_forward();
        }
        "reload" => {
            browser.reload();
        }
        "navigate" => {
            let url = parts.get(1).copied().unwrap_or("");
            if !url.is_empty() {
                if let Some(main_frame) = browser.main_frame() {
                    main_frame.load_url(Some(&CefString::from(url)));
                }
            }
        }
        other => {
            eprintln!("[polebrowse] unknown command: {other}");
        }
    }

    1
}
