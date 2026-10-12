#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // No filesystem access, print service, redaction engine, background agent,
    // network server or Axik AI Weave integration is enabled in the foundation.
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("unable to start Axik PDF Editor");
}
