use cef::V8Context;

/// Handles V8-based IPC between the injected chrome JavaScript
/// and the Rust backend.
pub struct IpcBridge;

impl IpcBridge {
    pub fn init() {
        // Register V8 handler for window.__polebrowse
        eprintln!("[polebrowse] IPC bridge ready");
    }
}
