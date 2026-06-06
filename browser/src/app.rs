use cef::*;

use crate::client::PolebrowseClient;

// ── Browser Process Handler ──
wrap_browser_process_handler! {
    pub struct BrowserProcHandler;

    impl BrowserProcessHandler {
        fn on_context_initialized(&self) {
            eprintln!("[polebrowse] context initialized");

            let client = PolebrowseClient;
            let url = CefString::from("https://www.google.com/");
            let window_info = WindowInfo {
                ..Default::default()
            };

            browser_host_create_browser(
                Some(&window_info),
                Some(&client),
                Some(&url),
                None, None, None,
            );
            eprintln!("[polebrowse] browser created");
        }

        fn default_client(&self) -> Option<Client> {
            Some(PolebrowseClient)
        }
    }
}

// ── CEF App ──
wrap_app! {
    pub struct PolebrowseApp;

    impl App {
        fn browser_process_handler(&self) -> Option<BrowserProcessHandler> {
            Some(BrowserProcHandler)
        }
    }
}
