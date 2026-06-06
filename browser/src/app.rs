use cef::*;
use std::cell::RefCell;

use crate::handler::PolebrowseClient;

// ── Browser Process Handler ───────────────────────────────────
wrap_browser_process_handler! {
    struct BrowserProcHandler {
        client: RefCell<Option<Client>>,
    }

    impl BrowserProcessHandler {
        fn on_context_initialized(&self) {
            eprintln!("[polebrowse] context initialized");

            let mut client_ref = self.client.borrow_mut();
            if client_ref.is_none() {
                *client_ref = Some(PolebrowseClient::new_client());
            }
            let client = client_ref.as_ref().unwrap().clone();

            let url = CefString::from("https://www.google.com/");
            let window_info = WindowInfo {
                ..Default::default()
            };

            let browser = browser_host_create_browser(
                Some(&window_info),
                Some(&client),
                Some(&url),
                None, None, None,
            );
            eprintln!("[polebrowse] browser created: {browser:?}");
        }

        fn default_client(&self) -> Option<Client> {
            self.client.borrow().clone()
        }
    }
}

// ── CEF App ────────────────────────────────────────────────────
wrap_app! {
    pub struct PolebrowseApp;

    impl App {
        fn browser_process_handler(&self) -> Option<BrowserProcessHandler> {
            Some(BrowserProcHandler::new(RefCell::new(None)))
        }
    }
}
