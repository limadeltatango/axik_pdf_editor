mod native_files;
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, io::Write, path::Path, time::{Duration, SystemTime}};
use tauri::Manager;

const MAX_PRINT_BYTES: usize = 100 * 1024 * 1024;

fn remove_stale_previews(folder: &Path) {
    let Ok(entries) = fs::read_dir(folder) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else { continue };
        if !name.starts_with("axik-print-") || !name.ends_with(".pdf") { continue; }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() { continue; }
        let Ok(modified) = meta.modified() else { continue };
        if SystemTime::now().duration_since(modified)
            .unwrap_or_default() > Duration::from_secs(48 * 3600) {
            let _ = fs::remove_file(path);
        }
    }
}

/**
 * Windows alpha print handoff:
 * - ONLY takes prepared PDF bytes supplied by the trusted local frontend.
 * - never accepts an unvalidated arbitrary path or runs a shell command.
 * - creates a random temporary file in this application's data directory.
 * - opens the prepared file using the installed default PDF viewer so users
 *   can access their normal physical Windows printer dialog.
 *
 * It does NOT print silently or claim to have reached a printer. A future
 * native WebView2/WinSpool backend will replace the external viewer handoff.
 */
#[tauri::command]
fn open_print_ready_pdf(app: tauri::AppHandle, pdf_data: Vec<u8>) -> Result<(), String> {
    if pdf_data.len() < 100 || pdf_data.len() > MAX_PRINT_BYTES
        || !pdf_data.starts_with(b"%PDF-") {
        return Err("Invalid or oversized print-ready PDF.".into());
    }
    let folder = app.path().app_local_data_dir()
        .map_err(|_| "Cannot resolve protected application data directory.")?
        .join("print-preview");
    fs::create_dir_all(&folder)
        .map_err(|_| "Cannot create the local print-preview directory.")?;
    remove_stale_previews(&folder);
    let mut output = tempfile::Builder::new()
        .prefix("axik-print-").suffix(".pdf")
        .tempfile_in(&folder)
        .map_err(|_| "Cannot create protected temporary print file.")?;
    output.write_all(&pdf_data)
        .map_err(|_| "Cannot write print-ready PDF to temporary file.")?;
    output.flush()
        .map_err(|_| "Cannot flush print-ready PDF.")?;
    output.as_file().sync_all()
        .map_err(|_| "Cannot sync print-ready PDF.")?;
    let (_handle, path) = output.keep()
        .map_err(|_| "Cannot persist temporary print-preview file.")?;
    open::that(&path)
        .map_err(|_| "No system PDF viewer could be opened for printing.")?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(native_files::NativeDocumentRegistry::default())
        .invoke_handler(tauri::generate_handler![
            open_print_ready_pdf,
            native_files::open_native_pdf,
            native_files::save_native_pdf,
            native_files::save_native_pdf_as
        ])
        .run(tauri::generate_context!())
        .expect("unable to start Axik PDF Editor");
}
