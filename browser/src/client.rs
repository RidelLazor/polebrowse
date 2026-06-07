use cef::*;
use crate::ui;
use crate::ipc;

// ── LoadHandler ──
wrap_load_handler! {
    pub struct PolebrowseLoadHandler {
        state: ui::SharedState,
    }

    impl LoadHandler {
        fn on_load_end(&self,
            _browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            _http_code: i32,
        ) {
            let Some(frame) = frame else { return };
            if frame.is_main() == 0 { return; }

            // URL is now updated via JS in the HTML UI
        }
    }
}

// ── Client ──
wrap_client! {
    pub struct PolebrowseClient {
        state: ui::SharedState,
    }

    impl Client {
        fn load_handler(&self) -> Option<LoadHandler> {
            Some(PolebrowseLoadHandler::new(self.state.clone()))
        }

        fn on_process_message_received(&self,
            browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            _source_process: ProcessId,
            message: Option<&mut ProcessMessage>,
        ) -> i32 {
            ipc::handle_process_message(browser, frame, message, &self.state)
        }
    }
}
