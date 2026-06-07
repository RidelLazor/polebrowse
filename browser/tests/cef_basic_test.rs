#[test]
fn test_command_line_create() {
    let cmd = unsafe { cef_dll_sys::cef_command_line_create() };
    assert!(!cmd.is_null(), "cef_command_line_create returned null");
}

#[test]
fn test_api_hash() {
    let hash_platform =
        unsafe { std::ffi::CStr::from_ptr(cef_dll_sys::cef_api_hash(0, 0)) }.to_str().unwrap();
    let hash_universal =
        unsafe { std::ffi::CStr::from_ptr(cef_dll_sys::cef_api_hash(0, 1)) }.to_str().unwrap();
    eprintln!("platform hash: {hash_platform}, universal hash: {hash_universal}");
}
