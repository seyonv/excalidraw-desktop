use std::sync::Mutex;
use tauri::Manager;

struct PendingFile(Mutex<Option<String>>);

#[tauri::command]
fn get_pending_file(state: tauri::State<'_, PendingFile>) -> Result<Option<String>, String> {
    let mut data = state.0.lock().map_err(|e| e.to_string())?;
    Ok(data.take())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PendingFile(Mutex::new(None)))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            if let Some(file_path) = args.iter().find(|a| a.ends_with(".excalidraw")) {
                if let Ok(content) = std::fs::read_to_string(file_path) {
                    let state = app.state::<PendingFile>();
                    *state.0.lock().unwrap() = Some(content);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_pending_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
