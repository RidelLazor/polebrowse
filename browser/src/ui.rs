use cef::*;
use std::cell::RefCell;
use std::rc::Rc;

// ── Shared state ──
pub struct BrowserState {
    pub ui_view: Option<BrowserView>,
    pub content_view: Option<BrowserView>,
}

pub type SharedState = Rc<RefCell<BrowserState>>;

pub fn new_shared_state() -> SharedState {
    Rc::new(RefCell::new(BrowserState {
        ui_view: None,
        content_view: None,
    }))
}

// ── Manual Layout Engine ──
// This delegate handles the resizing of the children (UI + Content)
wrap_panel_delegate! {
    struct RootPanelDelegate {
        state: SharedState,
    }

    impl ViewDelegate {
        fn on_layout_changed(&self, _view: Option<&mut View>, new_bounds: Option<&Rect>) {
            if let Some(bounds) = new_bounds {
                manual_resize(&self.state, bounds);
            }
        }
    }

    impl PanelDelegate {
    }
}

// ── Build the entire native UI inside the window ──
pub fn build_ui(window: &mut Window, state: &SharedState) {
    let s = state.borrow();
    let ui_view = s.ui_view.clone().expect("no ui view");
    let content_view = s.content_view.clone().expect("no content view");

    // 1. Create a Root Panel with our manual resizing logic
    let mut root_delegate = RootPanelDelegate::new(state.clone());
    let root_panel = panel_create(Some(&mut root_delegate)).expect("failed to create root panel");
    
    // 2. Add the views to the Root Panel
    root_panel.add_child_view(Some(&mut View::from(&ui_view)));
    root_panel.add_child_view(Some(&mut View::from(&content_view)));

    // 3. Attach Root Panel to the Window and make it fill the whole thing
    window.set_to_fill_layout();
    window.add_child_view(Some(&mut View::from(&root_panel)));

    // Initial positioning
    manual_resize(state, &window.bounds());
    
    window.show();
    eprintln!("[polebrowse] manual-layout ui built");
}

pub fn manual_resize(state: &SharedState, bounds: &Rect) {
    if bounds.width <= 0 || bounds.height <= 0 { return; }
    
    let s = state.borrow();
    if let (Some(ui_view), Some(content_view)) = (&s.ui_view, &s.content_view) {
        let uv = View::from(ui_view);
        let cv = View::from(content_view);
        
        let ui_height = 88;
        let content_height = if bounds.height > ui_height { bounds.height - ui_height } else { 0 };
        
        uv.set_bounds(Some(&Rect { 
            x: 0, 
            y: 0, 
            width: bounds.width, 
            height: ui_height 
        }));
        
        cv.set_bounds(Some(&Rect { 
            x: 0, 
            y: ui_height, 
            width: bounds.width, 
            height: content_height 
        }));
    }
}

// Kept for signature compatibility in app.rs
pub fn resize_ui_explicit(state: &SharedState, bounds: &Rect) {
    manual_resize(state, bounds);
}
