use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::State;
use uuid::Uuid;

const MAX_BYTES: usize = 100 * 1024 * 1024;

#[derive(Clone)]
struct TrackedDocument {
    path: PathBuf,
    source_hash: [u8; 32],
}

#[derive(Default)]
pub struct NativeDocumentRegistry {
    documents: Mutex<HashMap<String, TrackedDocument>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeOpenedDocument {
    token: String,
    name: String,
    bytes: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSaveOutcome {
    token: String,
    name: String,
    backup_name: Option<String>,
}

fn digest(bytes: &[u8]) -> [u8; 32] {
    let hash = Sha256::digest(bytes);
    let mut array = [0u8; 32];
    array.copy_from_slice(&hash);
    array
}

fn check_pdf(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < 100 || bytes.len() > MAX_BYTES || !bytes.starts_with(b"%PDF-") {
        return Err("File is empty, not a PDF, or exceeds 100 MiB safety budget.".into());
    }
    Ok(())
}

fn read_pdf(path: &Path) -> Result<Vec<u8>, String> {
    let bytes = fs::read(path).map_err(|_| "Could not read the selected PDF file.")?;
    check_pdf(&bytes)?;
    Ok(bytes)
}

fn simple_name(path: &Path) -> String {
    path.file_name().and_then(|value| value.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("document.pdf").to_owned()
}

fn save_new_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    check_pdf(bytes)?;
    // create_new ensures we never destroy another existing file through Save As.
    let mut file = OpenOptions::new().write(true).create_new(true)
        .open(path).map_err(|_| "Destination already exists or is not writable; no overwrite occurred.")?;
    let result = (|| -> Result<(), String> {
        file.write_all(bytes).map_err(|_| "Could not write new PDF file.")?;
        file.flush().map_err(|_| "Could not flush new PDF file.")?;
        file.sync_all().map_err(|_| "Could not sync new PDF file.")?;
        Ok(())
    })();
    drop(file);
    if let Err(error) = result {
        let _ = fs::remove_file(path);
        return Err(error);
    }
    match read_pdf(path) {
        Ok(value) if digest(&value) == digest(bytes) => Ok(()),
        _ => Err("New PDF verification failed. Inspect or remove the incomplete output.".into()),
    }
}

#[tauri::command]
pub async fn open_native_pdf(
    registry: State<'_, NativeDocumentRegistry>
) -> Result<Option<NativeOpenedDocument>, String> {
    // File dialogs execute off the WebView's GUI thread.
    let selected = tauri::async_runtime::spawn_blocking(|| {
        // Leave Windows' picker unrestricted; the source path, extension
        // and %PDF header are checked *after* the user selects a file.
        // This gives a second independent option when WebView2 filters break.
        rfd::FileDialog::new().pick_file()
    }).await.map_err(|_| "The native Open dialog failed.")?;
    let Some(path) = selected else { return Ok(None) };
    let canonical = fs::canonicalize(path)
        .map_err(|_| "The selected PDF file is unavailable.")?;
    if canonical.extension().and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("pdf")) != Some(true) {
        return Err("Please select a PDF file.".into());
    }
    let bytes = read_pdf(&canonical)?;
    let token = Uuid::new_v4().to_string();
    let record = TrackedDocument {
        path: canonical.clone(), source_hash: digest(&bytes)
    };
    let mut registered = registry.documents.lock()
        .map_err(|_| "Native Save registry is temporarily unavailable.")?;
    registered.insert(token.clone(), record);
    Ok(Some(NativeOpenedDocument {
        token, name: simple_name(&canonical), bytes
    }))
}

#[cfg(windows)]
fn atomic_replace_with_backup(
    target: &Path,
    replacement: &Path,
    backup: &Path
) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use std::iter::once;
    use windows_sys::Win32::Storage::FileSystem::ReplaceFileW;
    let wide = |path: &Path| {
        path.as_os_str().encode_wide().chain(once(0)).collect::<Vec<u16>>()
    };
    let target = wide(target);
    let replacement = wide(replacement);
    let backup = wide(backup);
    let result = unsafe {
        ReplaceFileW(
            target.as_ptr(), replacement.as_ptr(), backup.as_ptr(),
            0, std::ptr::null(), std::ptr::null()
        )
    };
    if result == 0 {
        return Err("Windows could not atomically replace the PDF. The source was not reported as saved.".into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn atomic_replace_with_backup(
    _target: &Path, _replacement: &Path, _backup: &Path
) -> Result<(), String> {
    Err("Native overwrite requires Windows ReplaceFile support.".into())
}

#[tauri::command]
pub fn save_native_pdf(
    registry: State<'_, NativeDocumentRegistry>,
    token: String,
    edited_bytes: Vec<u8>
) -> Result<NativeSaveOutcome, String> {
    check_pdf(&edited_bytes)?;
    let mut tracked = registry.documents.lock()
        .map_err(|_| "Native Save registry is unavailable.")?;
    let entry = tracked.get_mut(&token)
        .ok_or("The source file permission is no longer valid; reopen the PDF.")?;
    let disk_bytes = read_pdf(&entry.path)?;
    if digest(&disk_bytes) != entry.source_hash {
        return Err("Another program modified the original PDF. Save was blocked.".into());
    }
    let parent = entry.path.parent()
        .ok_or("Cannot determine the original PDF's folder.")?;
    let mut temp = tempfile::Builder::new().prefix(".axik-save-").suffix(".pdf")
        .tempfile_in(parent).map_err(|_| "Cannot create same-folder temporary PDF.")?;
    temp.write_all(&edited_bytes)
        .map_err(|_| "Could not stage PDF replacement.")?;
    temp.flush().map_err(|_| "Could not flush staged PDF replacement.")?;
    temp.as_file().sync_all()
        .map_err(|_| "Could not sync staged PDF replacement.")?;

    // The backup remains in the original document folder until the user
    // explicitly deletes it; never overwrite an older backup.
    let backup_name = format!("axik-backup-{}.pdf", Uuid::new_v4());
    let backup = parent.join(&backup_name);
    if backup.exists() {
        return Err("A unique backup could not be selected.".into());
    }
    // ReplaceFileW requires exclusive access to the replacement. Close the
    // NamedTempFile handle before invoking Windows' replacement transaction.
    let (staged_handle, staged_path) = temp.keep()
        .map_err(|_| "Cannot persist staged replacement before atomic Save.")?;
    drop(staged_handle);
    if let Err(reason) = atomic_replace_with_backup(&entry.path,&staged_path,&backup) {
        let _ = fs::remove_file(&staged_path);
        return Err(reason);
    }
    // Windows ReplaceFileW handles the original/replacement/backup transaction.
    // Verify actual output bytes and retain the original in backup on failure.
    let saved = read_pdf(&entry.path)?;
    if digest(&saved) != digest(&edited_bytes) {
        return Err("Saved file did not verify. Restore the preserved backup.".into());
    }
    entry.source_hash = digest(&edited_bytes);
    Ok(NativeSaveOutcome {
        token, name: simple_name(&entry.path), backup_name: Some(backup_name)
    })
}

#[tauri::command]
pub async fn save_native_pdf_as(
    registry: State<'_, NativeDocumentRegistry>,
    edited_bytes: Vec<u8>,
    suggested_name: String
) -> Result<Option<NativeSaveOutcome>, String> {
    check_pdf(&edited_bytes)?;
    let safe_name = suggested_name
        .chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c,'.'|'_'|'-'))
        .take(100).collect::<String>();
    let name = if safe_name.to_ascii_lowercase().ends_with(".pdf") {
        safe_name
    } else {
        format!("{}.pdf",safe_name)
    };
    let selected = tauri::async_runtime::spawn_blocking(move || {
        rfd::FileDialog::new()
            .add_filter("PDF files", &["pdf"])
            .set_file_name(&name)
            .save_file()
    }).await.map_err(|_| "The Save As dialog failed.")?;
    let Some(path) = selected else { return Ok(None) };
    if path.extension().and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("pdf")) != Some(true) {
        return Err("Save As requires a PDF extension.".into());
    }
    save_new_file(&path,&edited_bytes)?;
    let canonical = fs::canonicalize(&path)
        .map_err(|_| "Could not locate newly saved file.")?;
    let token = Uuid::new_v4().to_string();
    let mut documents = registry.documents.lock()
        .map_err(|_| "Native Save registry is temporarily unavailable.")?;
    documents.insert(token.clone(),TrackedDocument {
        path:canonical.clone(),source_hash:digest(&edited_bytes)
    });
    Ok(Some(NativeSaveOutcome {
        token,name:simple_name(&canonical),backup_name:None
    }))
}
