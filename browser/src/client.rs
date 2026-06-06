use cef::*;
use crate::render;

// ── LoadHandler ──
wrap_load_handler! {
    pub struct PolebrowseLoadHandler;

    impl LoadHandler {
        fn on_load_end(&self,
            browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            _http_code: i32,
        ) {
            let Some(browser) = browser else { return };
            let Some(main_frame) = browser.main_frame() else { return };

            if let Ok(js) = render::chrome_script() {
                let code = CefString::from(js.as_str());
                main_frame.execute_java_script(Some(&code), None, 0);
            }
        }
    }
}

// ── Client ──
wrap_client! {
    pub struct PolebrowseClient;

    impl Client {
        fn load_handler(&self) -> Option<LoadHandler> {
            Some(PolebrowseLoadHandler::new())
        }
    }
}

impl PolebrowseClient {
    pub fn new_client() -> Client {
        PolebrowseClient::new()
    }
}
