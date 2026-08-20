use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::sync::Mutex;
use std::time::{Duration, UNIX_EPOCH};

use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use tauri::Emitter;
use tauri::Manager;

const EXT: &str = "excalidraw";
const OPEN_REQUEST_FILE: &str = ".open-request";
const WATCH_DEBOUNCE: Duration = Duration::from_millis(150);

/// A `.excalidraw` passed on the command line (file association), consumed once
/// by the frontend on startup.
struct PendingFile(Mutex<Option<PendingOpen>>);

#[derive(Clone, Serialize)]
struct PendingOpen {
    name: String,
    contents: String,
}

#[derive(Serialize)]
struct Drawing {
    name: String,
    modified: u64,
}

/// `~/Documents/Excalidraw`, created on first use. Overridable with
/// `EXCALIDRAW_LIBRARY_DIR` to relocate the library (also used by tests).
fn library_dir() -> Result<PathBuf, String> {
    let dir = match std::env::var_os("EXCALIDRAW_LIBRARY_DIR") {
        Some(custom) => PathBuf::from(custom),
        None => {
            let docs = dirs_document_dir().ok_or("could not locate the Documents directory")?;
            docs.join("Excalidraw")
        }
    };
    fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn dirs_document_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Documents"))
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join("Documents"))
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        std::env::var_os("XDG_DOCUMENTS_DIR")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Documents")))
    }
}

/// Strips anything that could escape the library directory or break a filename.
/// The result is always a plain, non-empty file stem.
fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => '-',
            c if c.is_control() => '-',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "Untitled".to_string()
    } else {
        trimmed.chars().take(120).collect()
    }
}

/// Resolves a user-supplied name to a path guaranteed to sit directly inside the
/// library directory.
fn path_for(name: &str) -> Result<PathBuf, String> {
    let dir = library_dir()?;
    let path = dir.join(format!("{}.{EXT}", sanitize(name)));
    if path.parent() != Some(dir.as_path()) {
        return Err("invalid drawing name".to_string());
    }
    Ok(path)
}

/// Appends " 2", " 3", ... until the name is free. `skip` is the one existing
/// path allowed to collide (used by rename, so renaming to the same name is a no-op).
fn unique_name(base: &str, skip: Option<&Path>) -> Result<String, String> {
    let base = sanitize(base);
    let mut candidate = base.clone();
    let mut n = 1;
    loop {
        let path = path_for(&candidate)?;
        if !path.exists() || Some(path.as_path()) == skip {
            return Ok(candidate);
        }
        n += 1;
        candidate = format!("{base} {n}");
    }
}

fn modified_secs(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[tauri::command]
fn list_drawings() -> Result<Vec<Drawing>, String> {
    let dir = library_dir()?;
    let mut drawings: Vec<Drawing> = fs::read_dir(&dir)
        .map_err(|e| format!("could not read {}: {e}", dir.display()))?
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            if path.extension()?.to_str()? != EXT {
                return None;
            }
            Some(Drawing {
                name: path.file_stem()?.to_str()?.to_string(),
                modified: modified_secs(&path),
            })
        })
        .collect();
    drawings.sort_by(|a, b| b.modified.cmp(&a.modified).then(a.name.cmp(&b.name)));
    Ok(drawings)
}

#[tauri::command]
fn read_drawing(name: String) -> Result<String, String> {
    let path = path_for(&name)?;
    fs::read_to_string(&path).map_err(|e| format!("could not read {name}: {e}"))
}

#[tauri::command]
fn write_drawing(name: String, contents: String) -> Result<(), String> {
    let path = path_for(&name)?;
    fs::write(&path, contents).map_err(|e| format!("could not save {name}: {e}"))
}

/// Creates an empty drawing under a free name and returns the name actually used.
#[tauri::command]
fn create_drawing(name: Option<String>, contents: Option<String>) -> Result<String, String> {
    let name = unique_name(name.as_deref().unwrap_or("Untitled"), None)?;
    let body = contents.unwrap_or_else(|| {
        r#"{"type":"excalidraw","version":2,"source":"excalidraw-desktop","elements":[],"appState":{},"files":{}}"#
            .to_string()
    });
    fs::write(path_for(&name)?, body).map_err(|e| format!("could not create {name}: {e}"))?;
    Ok(name)
}

/// Returns the name actually used, which may differ from `new_name` if it collided.
#[tauri::command]
fn rename_drawing(old_name: String, new_name: String) -> Result<String, String> {
    let from = path_for(&old_name)?;
    if !from.exists() {
        return Err(format!("{old_name} no longer exists"));
    }
    let resolved = unique_name(&new_name, Some(from.as_path()))?;
    let to = path_for(&resolved)?;
    if from != to {
        fs::rename(&from, &to).map_err(|e| format!("could not rename {old_name}: {e}"))?;
    }
    Ok(resolved)
}

#[tauri::command]
fn delete_drawing(name: String) -> Result<(), String> {
    let path = path_for(&name)?;
    if !path.exists() {
        return Ok(());
    }
    fs::remove_file(&path).map_err(|e| format!("could not delete {name}: {e}"))
}

#[tauri::command]
fn get_pending_file(state: tauri::State<'_, PendingFile>) -> Result<Option<PendingOpen>, String> {
    let mut data = state.0.lock().map_err(|e| e.to_string())?;
    Ok(data.take())
}

/// Maps raw watcher paths to the drawing names the frontend cares about,
/// dropping control files, non-drawings, and duplicate events.
fn drawing_names(paths: &[PathBuf]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut names = Vec::new();
    for path in paths {
        if path.extension().and_then(|e| e.to_str()) != Some(EXT) {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if seen.insert(stem.to_string()) {
            names.push(stem.to_string());
        }
    }
    names
}

/// Reads and removes the MCP server's open request, if there is one.
fn open_request_name(dir: &Path) -> Option<String> {
    let path = dir.join(OPEN_REQUEST_FILE);
    let contents = fs::read_to_string(&path).ok()?;
    let _ = fs::remove_file(&path);
    let value: serde_json::Value = serde_json::from_str(&contents).ok()?;
    value.get("name")?.as_str().map(|s| s.to_string())
}

/// Watches the library directory and forwards changes to the frontend.
/// Debounced, because a single save produces several filesystem events.
fn spawn_watcher(app: tauri::AppHandle) {
    let Ok(dir) = library_dir() else {
        eprintln!("could not resolve the library directory for the watcher");
        return;
    };
    std::thread::spawn(move || {
        let (tx, rx) = channel();
        let mut watcher = match notify::recommended_watcher(tx) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("could not start the library watcher: {e}");
                return;
            }
        };
        if let Err(e) = watcher.watch(&dir, RecursiveMode::NonRecursive) {
            eprintln!("could not watch {}: {e}", dir.display());
            return;
        }

        loop {
            // Block for the first event, then drain whatever arrives inside
            // the debounce window so one save is one emit.
            let Ok(first) = rx.recv() else { return };
            let mut paths: Vec<PathBuf> = first.map(|e| e.paths).unwrap_or_default();
            while let Ok(next) = rx.recv_timeout(WATCH_DEBOUNCE) {
                if let Ok(event) = next {
                    paths.extend(event.paths);
                }
            }

            if let Some(name) = open_request_name(&dir) {
                let _ = app.emit("open-request", serde_json::json!({ "name": name }));
            }
            let names = drawing_names(&paths);
            if !names.is_empty() {
                let _ = app.emit("library-changed", serde_json::json!({ "names": names }));
            }
        }
    });
}

/// Lets the frontend pick up a request written before the app was running.
#[tauri::command]
fn take_open_request() -> Result<Option<String>, String> {
    Ok(open_request_name(&library_dir()?))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PendingFile(Mutex::new(None)))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            if let Some(file_path) = args.iter().find(|a| a.ends_with(".excalidraw")) {
                if let Ok(contents) = std::fs::read_to_string(file_path) {
                    let name = Path::new(file_path)
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("Imported drawing")
                        .to_string();
                    let state = app.state::<PendingFile>();
                    *state.0.lock().unwrap() = Some(PendingOpen { name, contents });
                }
            }
            spawn_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_pending_file,
            take_open_request,
            list_drawings,
            read_drawing,
            write_drawing,
            create_drawing,
            rename_drawing,
            delete_drawing
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The invariant that matters: whatever comes out is a single path
    /// component that cannot escape the library directory.
    #[test]
    fn sanitize_strips_path_traversal() {
        for input in [
            "../../etc/passwd",
            "a/b",
            "..",
            ".",
            "   ",
            "",
            "~/.ssh/id_rsa",
            "C:\\Windows\\system32",
            "back\\slash",
            "null\0byte",
        ] {
            let out = sanitize(input);
            assert!(!out.is_empty(), "{input:?} produced an empty name");
            assert!(
                !out.contains('/') && !out.contains('\\'),
                "{input:?} produced {out:?}, which still contains a separator"
            );
            assert!(
                !out.starts_with('.'),
                "{input:?} produced the hidden/relative name {out:?}"
            );
            assert_eq!(
                Path::new(&format!("{out}.{EXT}")).components().count(),
                1,
                "{input:?} produced the multi-component path {out:?}"
            );
        }
        assert_eq!(sanitize("a/b"), "a-b");
        assert_eq!(sanitize(".."), "Untitled");
        assert_eq!(sanitize(""), "Untitled");
    }

    #[test]
    fn sanitize_keeps_ordinary_names() {
        assert_eq!(sanitize("My Diagram"), "My Diagram");
        assert_eq!(sanitize("v1.2 sketch"), "v1.2 sketch");
    }

    #[test]
    fn sanitize_caps_length() {
        assert_eq!(sanitize(&"x".repeat(500)).chars().count(), 120);
    }

    /// The JS mirror in `mcp/lib/sanitize.js` must agree with this function on
    /// every fixture case, or the MCP server predicts the wrong filename.
    #[test]
    fn sanitize_matches_shared_fixture() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("mcp/fixtures/sanitize-cases.json");
        let raw = fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("could not read {}: {e}", path.display()));
        let cases: Vec<serde_json::Value> = serde_json::from_str(&raw).unwrap();
        assert!(!cases.is_empty(), "fixture is empty");
        for case in cases {
            let input = case["input"].as_str().unwrap();
            let expected = case["expected"].as_str().unwrap();
            assert_eq!(sanitize(input), expected, "mismatch for {input:?}");
        }
    }

    /// Collects all Unicode code points where char::is_whitespace() and
    /// char::is_control() are true, pinning them to a fixture so the JS
    /// mirror can build its character classification from the same authority.
    /// Run with UPDATE_SANITIZE_FIXTURE=1 to regenerate the fixture.
    #[test]
    fn sanitize_classification_fixture_is_current() {
        let mut whitespace = Vec::new();
        let mut control = Vec::new();

        for i in 0u32..=0x10FFFFu32 {
            if let Some(ch) = char::from_u32(i) {
                if ch.is_whitespace() {
                    whitespace.push(i as u64);
                }
                if ch.is_control() {
                    control.push(i as u64);
                }
            }
        }

        let fixture = serde_json::json!({
            "whitespace": whitespace,
            "control": control,
        });

        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("mcp/fixtures/sanitize-classification.json");

        if std::env::var("UPDATE_SANITIZE_FIXTURE").is_ok() {
            fs::write(&path, fixture.to_string() + "\n")
                .unwrap_or_else(|e| panic!("could not write {}: {e}", path.display()));
        } else {
            let raw = fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("could not read {}: {e}", path.display()));
            let expected: serde_json::Value = serde_json::from_str(&raw).unwrap();
            assert_eq!(fixture, expected, "Unicode classification fixture is out of date. Run with UPDATE_SANITIZE_FIXTURE=1");
        }
    }

    /// One test for all filesystem behaviour: `EXCALIDRAW_LIBRARY_DIR` is
    /// process-global, so these cannot safely run in parallel.
    #[test]
    fn library_operations() {
        let dir = std::env::temp_dir().join(format!("excalidraw-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        std::env::set_var("EXCALIDRAW_LIBRARY_DIR", &dir);

        // Starts empty.
        assert_eq!(list_drawings().unwrap().len(), 0);

        // Creating twice under the same base name de-duplicates instead of clobbering.
        let first = create_drawing(None, None).unwrap();
        let second = create_drawing(None, None).unwrap();
        assert_eq!(first, "Untitled");
        assert_eq!(second, "Untitled 2");
        assert_eq!(list_drawings().unwrap().len(), 2);

        // Round-trips contents.
        write_drawing(first.clone(), "{\"elements\":[1]}".into()).unwrap();
        assert_eq!(read_drawing(first.clone()).unwrap(), "{\"elements\":[1]}");

        // Rename moves the file and keeps the contents.
        let renamed = rename_drawing(first.clone(), "My Diagram".into()).unwrap();
        assert_eq!(renamed, "My Diagram");
        assert_eq!(read_drawing(renamed.clone()).unwrap(), "{\"elements\":[1]}");
        assert!(read_drawing(first).is_err());

        // Renaming onto a taken name de-duplicates rather than overwriting it.
        let collided = rename_drawing(second, "My Diagram".into()).unwrap();
        assert_eq!(collided, "My Diagram 2");
        assert_eq!(list_drawings().unwrap().len(), 2);

        // Renaming a drawing to its own name is a no-op, not a de-duplication.
        assert_eq!(
            rename_drawing(renamed.clone(), "My Diagram".into()).unwrap(),
            "My Diagram"
        );

        // A malicious name stays inside the library directory.
        let escaped = create_drawing(Some("../../escaped".into()), None).unwrap();
        assert!(dir.join(format!("{escaped}.{EXT}")).exists());
        assert!(!dir.parent().unwrap().join("escaped.excalidraw").exists());

        // Delete removes it; deleting again is not an error.
        delete_drawing(renamed.clone()).unwrap();
        delete_drawing(renamed.clone()).unwrap();
        assert!(!list_drawings().unwrap().iter().any(|d| d.name == renamed));

        std::env::remove_var("EXCALIDRAW_LIBRARY_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn drawing_names_keeps_only_library_drawings() {
        let dir = PathBuf::from("/tmp/lib");
        let paths = vec![
            dir.join("Auth flow.excalidraw"),
            dir.join("notes.txt"),
            dir.join(".open-request"),
            dir.join("Auth flow.excalidraw"), // duplicate event, common with editors
        ];
        assert_eq!(drawing_names(&paths), vec!["Auth flow".to_string()]);
    }

    /// Hidden by extension, not by leading dot: `.open-request` is dropped
    /// because it has no `.excalidraw` extension, but a drawing that happens
    /// to be named `.hidden` is a real drawing and must be reported.
    #[test]
    fn drawing_names_hides_by_extension_not_by_leading_dot() {
        let dir = PathBuf::from("/tmp/lib");
        let paths = vec![dir.join(".hidden.excalidraw"), dir.join(".open-request")];
        assert_eq!(drawing_names(&paths), vec![".hidden".to_string()]);
    }

    #[test]
    fn open_request_is_read_once_and_removed() {
        let dir = std::env::temp_dir().join(format!("excalidraw-req-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(OPEN_REQUEST_FILE);

        assert_eq!(open_request_name(&dir), None);

        fs::write(&path, r#"{"name":"Auth flow","at":1}"#).unwrap();
        assert_eq!(open_request_name(&dir), Some("Auth flow".to_string()));
        assert!(!path.exists(), "the request must be consumed");
        assert_eq!(open_request_name(&dir), None);

        // Malformed input is ignored, and still cleaned up.
        fs::write(&path, "not json").unwrap();
        assert_eq!(open_request_name(&dir), None);
        assert!(!path.exists());

        let _ = fs::remove_dir_all(&dir);
    }
}
