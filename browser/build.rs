use std::path::PathBuf;

fn main() {
    println!("cargo::rerun-if-changed=build.rs");
    println!("cargo::rerun-if-changed=../www");

    // Locate the CEF binary distribution directory
    let Some(cef_dir) = cef_dll_sys::get_cef_dir() else {
        eprintln!("WARNING: cef_dll_sys::get_cef_dir() returned None — CEF resources path won't be embedded");
        return;
    };

    // Determine where CEF resources live and emit the path for main.rs
    let resources_dir = resolve_resources_dir(&cef_dir);

    if let Some(ref dir) = resources_dir {
        println!("cargo::rustc-env=CEF_RESOURCES_DIR={}", dir.display());
    } else {
        eprintln!("WARNING: cannot find CEF resources under {}", cef_dir.display());
        return;
    }

    let resources_dir = resources_dir.unwrap();
    let flat = resources_dir == cef_dir;

    // Copy CEF resources to the output binary directory
    // so development builds (`cargo run`) can find them.
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let target_dir = out_dir
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| out_dir.clone());

    let dest = target_dir.join("Resources");
    let _ = std::fs::create_dir_all(&dest);

    if flat {
        // Flat layout: only copy resource files, not shared libs
        copy_resource_files(&resources_dir, &dest);
    } else {
        // Nested layout: copy everything from Resources/
        copy_dir(&resources_dir, &dest);
    }

    // Copy 'www' directory from root to target
    let www_src = PathBuf::from("../www");
    let www_dest = target_dir.join("www");
    if www_src.exists() {
        copy_dir(&www_src, &www_dest);
        eprintln!("Copied 'www' resources to {}", www_dest.display());
    }

    eprintln!(
        "Copied CEF resources from {} to {}",
        resources_dir.display(),
        dest.display()
    );
}

fn resolve_resources_dir(cef_dir: &std::path::Path) -> Option<PathBuf> {
    if cef_dir.join("Resources").exists() {
        // Standard nested layout: cef_binary_X/Resources
        Some(cef_dir.join("Resources"))
    } else if cef_dir.join("resources.pak").exists() {
        // Flat layout: everything at the root of cef_dir
        Some(cef_dir.to_path_buf())
    } else if cef_dir.join("Release").join("resources.pak").exists() {
        // Release/ subdirectory as resource dir
        Some(cef_dir.join("Release"))
    } else {
        None
    }
}

/// Copy only CEF resource files (.pak, .dat, locales/) from a flat directory.
fn copy_resource_files(src: &std::path::Path, dst: &std::path::Path) {
    if !src.exists() {
        return;
    }
    if let Ok(entries) = std::fs::read_dir(src) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if path.is_dir() && name_str == "locales" {
                copy_dir(&path, &dst.join("locales"));
            } else if name_str.ends_with(".pak") || name_str == "icudtl.dat" {
                let _ = std::fs::copy(&path, &dst.join(&name));
            }
        }
    }
}

/// Recursively copy a directory tree.
fn copy_dir(src: &std::path::Path, dst: &std::path::Path) {
    if !src.exists() {
        return;
    }
    let _ = std::fs::create_dir_all(dst);
    if let Ok(entries) = std::fs::read_dir(src) {
        for entry in entries.flatten() {
            let path = entry.path();
            let dst_path = dst.join(entry.file_name());
            if path.is_dir() {
                copy_dir(&path, &dst_path);
            } else {
                let _ = std::fs::copy(&path, &dst_path);
            }
        }
    }
}
