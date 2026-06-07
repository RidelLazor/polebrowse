use cef::*;

use crate::client::PolebrowseClient;
use crate::ipc;
use crate::ui;

// ── Browser View Delegates ──

wrap_browser_view_delegate! {
    pub struct UiViewDelegate {
        height: i32,
    }
    impl ViewDelegate {
        fn preferred_size(&self, _view: Option<&mut View>) -> Size {
            Size { width: 0, height: self.height }
        }
    }
    impl BrowserViewDelegate {
        fn browser_runtime_style(&self) -> RuntimeStyle { RuntimeStyle::ALLOY }
        fn chrome_toolbar_type(&self, _bv: Option<&mut BrowserView>) -> ChromeToolbarType { ChromeToolbarType::NONE }
    }
}

wrap_browser_view_delegate! {
    pub struct ContentViewDelegate {}
    impl ViewDelegate {
    }
    impl BrowserViewDelegate {
        fn browser_runtime_style(&self) -> RuntimeStyle { RuntimeStyle::ALLOY }
        fn chrome_toolbar_type(&self, _bv: Option<&mut BrowserView>) -> ChromeToolbarType { ChromeToolbarType::NONE }
    }
}

// ── Window Delegate ──
wrap_window_delegate! {
    pub struct PolebrowseWindowDelegate {
        state: ui::SharedState,
    }

    impl ViewDelegate {}
    impl PanelDelegate {}

    impl WindowDelegate {
        fn window_runtime_style(&self) -> RuntimeStyle { RuntimeStyle::ALLOY }
        fn can_maximize(&self, _window: Option<&mut Window>) -> i32 { 1 }
        fn can_resize(&self, _window: Option<&mut Window>) -> i32 { 1 }
        fn on_window_created(&self, window: Option<&mut Window>) {
            if let Some(window) = window {
                ui::build_ui(window, &self.state);
                // Force initial layout
                ui::manual_resize(&self.state, &window.bounds());
            }
        }
        fn on_window_bounds_changed(&self, window: Option<&mut Window>, _new_bounds: Option<&Rect>) {
            if let Some(window) = window {
                ui::manual_resize(&self.state, &window.bounds());
            }
        }
        fn initial_bounds(&self, _window: Option<&mut Window>) -> Rect {
            Rect { x: 100, y: 100, width: 1280, height: 800 }
        }
    }
}

// ── Browser Process Handler ──
wrap_browser_process_handler! {
    pub struct BrowserProcHandler;

    impl BrowserProcessHandler {
        fn on_context_initialized(&self) {
            eprintln!("[polebrowse] context initialized");

            let state = ui::new_shared_state();
            let browser_settings = BrowserSettings::default();

            // 1. Create UI View
            let mut ui_client = PolebrowseClient::new(state.clone());
            let mut ui_delegate = UiViewDelegate::new(88); // Fixed 88px height
            
            let exe_path = std::env::current_exe().unwrap_or_default();
            let mut ui_path = exe_path.parent().unwrap().to_path_buf();
            ui_path.push("www");
            ui_path.push("index.html");
            let ui_url = CefString::from(format!("file://{}", ui_path.display()).as_str());

            let ui_view = browser_view_create(
                Some(&mut ui_client),
                Some(&ui_url),
                Some(&browser_settings),
                None, None,
                Some(&mut ui_delegate),
            ).expect("failed to create ui view");

            // 2. Create Content View
            let mut content_client = PolebrowseClient::new(state.clone());
            let mut content_delegate = ContentViewDelegate::new();
            let content_url = CefString::from("https://www.google.com/");

            let content_view = browser_view_create(
                Some(&mut content_client),
                Some(&content_url),
                Some(&browser_settings),
                None, None,
                Some(&mut content_delegate),
            ).expect("failed to create content view");

            // Store in shared state
            {
                let mut s = state.borrow_mut();
                s.ui_view = Some(ui_view);
                s.content_view = Some(content_view);
            }

            let mut wd = PolebrowseWindowDelegate::new(state.clone());
            let _window = window_create_top_level(Some(&mut wd));
        }

        fn default_client(&self) -> Option<Client> {
            None
        }
    }
}

// ── Render Process Handler ──
wrap_render_process_handler! {
    pub struct PolebrowseRenderHandler;

    impl RenderProcessHandler {
        fn on_context_created(&self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            context: Option<&mut V8Context>,
        ) {
            if let Some(ctx) = context {
                ipc::register_bridge(ctx);
            }
        }
    }
}

// ── CEF App ──
wrap_app! {
    pub struct PolebrowseApp;

    impl App {
        fn browser_process_handler(&self) -> Option<BrowserProcessHandler> {
            Some(BrowserProcHandler::new())
        }

        fn render_process_handler(&self) -> Option<RenderProcessHandler> {
            Some(PolebrowseRenderHandler::new())
        }
    }
}
