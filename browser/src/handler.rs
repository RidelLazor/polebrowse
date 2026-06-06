use cef::*;
use crate::render;

wrap_client! {
    pub struct PolebrowseClient;

    impl DisplayHandler {}
    impl LifeSpanHandler {}
    impl LoadHandler {
        fn on_load_end(&self,
            browser: Option<&Browser>,
            _frame: Option<&Frame>,
            _http_code: i32,
        ) {
            let Some(browser) = browser else { return };
            let Some(main_frame) = browser.main_frame() else { return };

            if let Ok(js) = render::chrome_script() {
                main_frame.execute_java_script(Some(&js), None, 0);
            }
        }
    }
}

impl PolebrowseClient {
    pub fn new_client() -> Client {
        Client::new(Box::new(Self))
    }
}
