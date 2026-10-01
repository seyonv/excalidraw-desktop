use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use tauri::menu::{Menu, MenuItem, MenuItemKind, Submenu};
use tauri::Emitter;
use tauri::webview::DownloadEvent;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

const EXT: &str = "excalidraw";
const OPEN_REQUEST_FILE: &str = ".open-request";
const OPEN_MENU_ID: &str = "open-file";
/// Where the version replaced by each write is kept. A subdirectory of the
/// library, so a drawing and its history travel together if the folder moves.
/// Deliberately not `*.excalidraw` inside: `list_drawings` and `drawing_names`
/// filter on the extension, so backups can never surface as drawings.
const HISTORY_DIR: &str = ".history";
/// Versions kept per drawing. Identical consecutive writes are not stored, so
/// this is 20 *distinct* previous states, not 20 autosaves.
const HISTORY_KEEP: usize = 20;
/// An open-request older than this is ignored, so a request written long ago
/// (the machine slept, the app crashed before consuming it, ...) can't hijack
/// a much later cold launch with a stale target.
///
/// Deliberately generous: the cold-launch path this file exists for is the
/// MCP server writing the request and then spawning the `EXCALIDRAW_APP`
/// launcher, which (via the default `open -a "Excalidraw Dev"` applet, and
/// for anyone running the dev build) opens a terminal and runs
/// `npm run tauri dev` — a cold `cargo build` of the Tauri debug binary
/// routinely takes well over five minutes on a first run or after a
/// dependency bump. A short window would silently drop the very request this
/// file is for: written at T, discarded as "stale" by the time bootstrap
/// finally runs at T+8min, with no error. 30 minutes comfortably covers a
/// cold build plus app startup while still discarding a request left over
/// from a previous day or session. Do not tighten this without accounting
/// for that build time.
const OPEN_REQUEST_MAX_AGE: Duration = Duration::from_secs(30 * 60);
const WATCH_DEBOUNCE: Duration = Duration::from_millis(150);

/// `.excalidraw` files the OS asked us to open (file association), waiting for
/// the frontend to take them.
struct PendingFiles(Mutex<Vec<PendingOpen>>);

/// `contents` is `None` for a file that already lives in the library: it is
/// opened by name rather than copied in as a duplicate of itself.
#[derive(Clone, Serialize)]
struct PendingOpen {
    name: String,
    contents: Option<String>,
}

#[derive(Serialize)]
struct Drawing {
    name: String,
    modified: u64,
}

/// `~/Library/Application Support/Excalidraw` (and platform equivalents),
/// created on first use. Overridable with `EXCALIDRAW_LIBRARY_DIR` to
/// relocate the library (also used by tests).
///
/// Deliberately NOT `~/Documents`: macOS gates that folder behind a TCC
/// permission prompt, and an ad-hoc-signed dev build gets a new signature
/// hash on every `cargo build`, so macOS treats each rebuild as a new app
/// and re-prompts on every launch. App-support directories carry no such
/// gate.
fn library_dir() -> Result<PathBuf, String> {
    let dir = match std::env::var_os("EXCALIDRAW_LIBRARY_DIR") {
        Some(custom) => PathBuf::from(custom),
        None => {
            let support =
                dirs_app_support_dir().ok_or("could not locate the app support directory")?;
            support.join("Excalidraw")
        }
    };
    fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn dirs_app_support_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"))
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA").map(PathBuf::from)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
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

/// Writes via a temp file, fsync, and an atomic rename.
///
/// `fs::write` truncates the destination *before* streaming the new bytes and
/// never fsyncs. For a multi-megabyte scene that leaves a window — long enough
/// to matter on a 9MB drawing — in which a crash, a SIGKILL, or a power cut
/// leaves a truncated or empty `.excalidraw` file. A rename on the same
/// filesystem is atomic, so a reader (the watcher, the MCP server, the next
/// launch) sees either the whole old file or the whole new one.
fn write_atomic(path: &Path, contents: &str) -> std::io::Result<()> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    // Same directory, so the rename stays on one filesystem. The pid keeps two
    // processes from picking the same temp path, and the leading dot plus the
    // `.tmp` extension keeps it out of both drawing listings.
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("drawing");
    let tmp = dir.join(format!(".{stem}.{}.tmp", std::process::id()));

    let result = (|| {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(contents.as_bytes())?;
        // The bytes must be on disk before the rename publishes them, or a
        // power cut can leave the name pointing at an empty file.
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp, path)
    })();

    if result.is_err() {
        let _ = fs::remove_file(&tmp);
        return result;
    }
    // Durability of the directory entry itself. Best-effort: some filesystems
    // reject fsync on a directory, and that must not fail the user's save.
    if let Ok(handle) = fs::File::open(dir) {
        let _ = handle.sync_all();
    }
    Ok(())
}

/// Live (non-deleted) element count of a serialised scene.
///
/// `None` means "not a scene I can read" — never treated as empty, because the
/// empty-scene guard must not fire on input it does not understand.
fn live_element_count(contents: &str) -> Option<usize> {
    let value: serde_json::Value = serde_json::from_str(contents).ok()?;
    let elements = value.get("elements")?.as_array()?;
    Some(
        elements
            .iter()
            .filter(|e| {
                !e.get("isDeleted")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false)
            })
            .count(),
    )
}

/// `<library>/.history/<drawing>` — where that drawing's previous versions live.
fn history_dir_for(path: &Path) -> Option<PathBuf> {
    let stem = path.file_stem()?.to_str()?;
    Some(path.parent()?.join(HISTORY_DIR).join(sanitize(stem)))
}

/// Fingerprint of what actually matters in a scene: its elements and its
/// embedded files.
///
/// Scroll position, zoom and window size live in `appState` and change on
/// virtually every interaction without the drawing itself changing. Hashing the
/// whole file would let a minute of panning around evict twenty real versions.
fn content_fingerprint(contents: &str) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    match serde_json::from_str::<serde_json::Value>(contents) {
        Ok(value) => {
            for key in ["elements", "files"] {
                value
                    .get(key)
                    .map(|v| v.to_string())
                    .unwrap_or_default()
                    .hash(&mut hasher);
            }
        }
        // Not a scene we can read — fall back to the raw bytes so an
        // unparseable file is still deduplicated rather than snapshotted twice.
        Err(_) => contents.hash(&mut hasher),
    }
    hasher.finish()
}

/// The fingerprint a snapshot filename carries, so deduplicating never has to
/// re-read and re-parse a multi-megabyte backup.
fn snapshot_fingerprint(path: &Path) -> Option<u64> {
    let stem = path.file_stem()?.to_str()?;
    u64::from_str_radix(stem.split('-').nth(1)?, 16).ok()
}

/// Copies the version about to be replaced into the drawing's history.
///
/// The library has no other history: there is no in-app undo across restarts,
/// and a `.excalidraw` overwritten with a bad scene was, before this, gone for
/// good. States whose content is unchanged are not stored — the app rewrites the
/// active drawing on every switch and on every scroll, so without that check a
/// single afternoon would evict every genuinely different version.
fn keep_previous_version(path: &Path) -> std::io::Result<()> {
    let Ok(current) = fs::read_to_string(path) else {
        return Ok(()); // nothing there yet — first write of a new drawing
    };
    let Some(dir) = history_dir_for(path) else {
        return Ok(());
    };
    fs::create_dir_all(&dir)?;

    let mut versions: Vec<PathBuf> = fs::read_dir(&dir)?
        .filter_map(|e| Some(e.ok()?.path()))
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("bak"))
        .collect();
    // Names lead with a zero-padded timestamp, so this is chronological.
    versions.sort();

    let fingerprint = content_fingerprint(&current);
    if versions.last().and_then(|p| snapshot_fingerprint(p)) == Some(fingerprint) {
        return Ok(()); // same drawing as the newest snapshot
    }

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let snapshot = dir.join(format!("{stamp:013}-{fingerprint:016x}.bak"));
    write_atomic(&snapshot, &current)?;

    versions.push(snapshot);
    for stale in versions.iter().rev().skip(HISTORY_KEEP) {
        let _ = fs::remove_file(stale);
    }
    Ok(())
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
fn write_drawing(name: String, contents: String, allow_empty: Option<bool>) -> Result<(), String> {
    let path = path_for(&name)?;
    // A scene is momentarily empty while a large drawing is still loading, and
    // an autosave landing in that window is exactly how a 9MB drawing became a
    // 2KB one. The frontend passes `allow_empty` only once it has seen the
    // loaded scene, so a user who genuinely deletes everything still saves.
    if !allow_empty.unwrap_or(false) && live_element_count(&contents) == Some(0) {
        if let Ok(existing) = fs::read_to_string(&path) {
            if live_element_count(&existing).unwrap_or(0) > 0 {
                return Err(format!(
                    "refusing to replace {name} with an empty scene — \
                     the drawing on disk still has content"
                ));
            }
        }
    }

    // Best-effort: never let a failed snapshot block the user's save.
    if let Err(e) = keep_previous_version(&path) {
        eprintln!("could not snapshot the previous version of {name}: {e}");
    }
    write_atomic(&path, &contents).map_err(|e| format!("could not save {name}: {e}"))
}

/// Creates an empty drawing under a free name and returns the name actually used.
#[tauri::command]
fn create_drawing(name: Option<String>, contents: Option<String>) -> Result<String, String> {
    let name = unique_name(name.as_deref().unwrap_or("Untitled"), None)?;
    let body = contents.unwrap_or_else(|| {
        r#"{"type":"excalidraw","version":2,"source":"sketchshelf","elements":[],"appState":{},"files":{}}"#
            .to_string()
    });
    write_atomic(&path_for(&name)?, &body).map_err(|e| format!("could not create {name}: {e}"))?;
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
fn take_pending_files(state: tauri::State<'_, PendingFiles>) -> Result<Vec<PendingOpen>, String> {
    let mut data = state.0.lock().map_err(|e| e.to_string())?;
    Ok(std::mem::take(&mut *data))
}

/// What opening `path` from outside the app should do, or `None` if it is not
/// a readable drawing.
fn pending_open(path: &Path, library: &Path) -> Option<PendingOpen> {
    if path.extension().and_then(|e| e.to_str()) != Some(EXT) {
        return None;
    }
    let name = path.file_stem()?.to_str()?.to_string();
    let in_library = path
        .parent()
        .and_then(|p| p.canonicalize().ok())
        .is_some_and(|p| library.canonicalize().is_ok_and(|l| l == p));
    let contents = if in_library {
        None
    } else {
        Some(fs::read_to_string(path).ok()?)
    };
    Some(PendingOpen { name, contents })
}

/// Queues drawings the OS asked us to open and tells the frontend they are
/// waiting. Queued as well as emitted because on a cold launch the request can
/// arrive before the frontend is listening; bootstrap takes the queue instead.
fn queue_files(app: &tauri::AppHandle, paths: impl IntoIterator<Item = PathBuf>) {
    let Ok(library) = library_dir() else { return };
    let opened: Vec<PendingOpen> = paths
        .into_iter()
        .filter_map(|p| pending_open(&p, &library))
        .collect();
    if opened.is_empty() {
        return;
    }
    app.state::<PendingFiles>().0.lock().unwrap().extend(opened);
    let _ = app.emit("files-opened", ());
}

/// Shows the native file picker and feeds whatever is chosen through the same
/// queue as a file opened from Finder. Does not block: the picker reports back
/// on its own.
#[tauri::command]
fn pick_drawings(app: tauri::AppHandle) {
    let handle = app.clone();
    app.dialog()
        .file()
        .add_filter("Excalidraw drawing", &[EXT])
        .pick_files(move |files| {
            let paths = files
                .unwrap_or_default()
                .into_iter()
                .filter_map(|f| f.into_path().ok());
            queue_files(&handle, paths);
        });
}

/// Excalidraw saves and exports (`Save to…`, `Export image`) as browser
/// downloads, and the webview cancels every download nobody handles — those
/// menu items silently did nothing. Each download now lands in a temp file and
/// then goes wherever the user picks in a Save dialog, which is also what lets
/// the sandboxed build write outside its container.
fn download_handler() -> impl Fn(tauri::Webview, DownloadEvent<'_>) -> bool + Send + Sync + 'static {
    // macOS reports a finished download without its path, so remember where
    // each one was sent when it was requested.
    let sent_to = Mutex::new(HashMap::<String, PathBuf>::new());
    move |webview, event| {
        match event {
            DownloadEvent::Requested { url, destination } => {
                let name = destination
                    .file_name()
                    .map(|n| n.to_owned())
                    .unwrap_or_else(|| "Drawing".into());
                *destination = std::env::temp_dir().join(name);
                let _ = fs::remove_file(&*destination);
                sent_to.lock().unwrap().insert(url.to_string(), destination.clone());
            }
            DownloadEvent::Finished { url, success, .. } => {
                let Some(path) = sent_to.lock().unwrap().remove(&url.to_string()) else {
                    return true;
                };
                if success {
                    save_download(webview.app_handle().clone(), path);
                } else {
                    let _ = fs::remove_file(&path);
                }
            }
            _ => {}
        }
        true
    }
}

/// Asks where a finished download should go, and moves it there.
fn save_download(app: tauri::AppHandle, path: PathBuf) {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let dialogs = app.clone();
    app.dialog().file().set_file_name(name).save_file(move |target| {
        if let Some(target) = target.and_then(|t| t.into_path().ok()) {
            if let Err(e) = fs::copy(&path, &target) {
                dialogs
                    .dialog()
                    .message(format!("Could not save {}: {e}", target.display()))
                    .kind(MessageDialogKind::Error)
                    .show(|_| {});
            }
        }
        let _ = fs::remove_file(&path);
    });
}

/// The default menu bar with `File → Open…` added. Its ⌘O also takes the
/// shortcut away from Excalidraw's own "Open", which loads a file *over* the
/// active drawing — and autosave would then write it there.
fn app_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::default(app)?;
    let open = MenuItem::with_id(app, OPEN_MENU_ID, "Open…", true, Some("CmdOrCtrl+O"))?;
    let file = menu.items()?.into_iter().find_map(|item| match item {
        MenuItemKind::Submenu(sub) if sub.text().is_ok_and(|t| t == "File") => Some(sub),
        _ => None,
    });
    match file {
        Some(file) => file.prepend(&open)?,
        None => menu.append(&Submenu::with_items(app, "File", true, &[&open])?)?,
    }
    Ok(menu)
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
///
/// The file is read, then removed, then parsed — deliberately in that order.
/// If parsing happened before removal, a malformed file would fail to parse,
/// never get removed, and be re-read (and re-fail) on every subsequent watch
/// event forever. Removing first means a bad file is consumed exactly once,
/// whatever its contents turn out to be.
fn open_request_name(dir: &Path) -> Option<String> {
    let path = dir.join(OPEN_REQUEST_FILE);
    let contents = fs::read_to_string(&path).ok()?;
    let _ = fs::remove_file(&path);
    let value: serde_json::Value = serde_json::from_str(&contents).ok()?;

    // Ignore a request that's too old to still be actionable — see
    // OPEN_REQUEST_MAX_AGE. A request without a usable `at` is treated as
    // fresh rather than rejected, since older writers may not have set it.
    if let Some(at_ms) = value.get("at").and_then(|v| v.as_u64()) {
        let written = UNIX_EPOCH + Duration::from_millis(at_ms);
        if let Ok(age) = SystemTime::now().duration_since(written) {
            if age > OPEN_REQUEST_MAX_AGE {
                return None;
            }
        }
    }

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
        .manage(PendingFiles(Mutex::new(Vec::new())))
        // Must be the first plugin registered. A second launch (e.g. the MCP
        // server's `open -a`, or a second `tauri dev`) would otherwise start
        // its own window onto the same library directory — two windows then
        // autosave the same files independently and clobber each other.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            queue_files(app, argv.into_iter().skip(1).map(PathBuf::from));
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .menu(app_menu)
        .on_menu_event(|app, event| {
            if event.id() == OPEN_MENU_ID {
                pick_drawings(app.clone());
            }
        })
        .setup(|app| {
            // Built here rather than from the config so it can take a download
            // handler; `create: false` in tauri.conf.json leaves this to us.
            let main = app.config().app.windows[0].clone();
            tauri::WebviewWindowBuilder::from_config(app.handle(), &main)?
                .on_download(download_handler())
                .build()?;
            // Windows and Linux pass an opened file as an argument. macOS
            // does not — it arrives as `RunEvent::Opened`, handled below.
            queue_files(app.handle(), std::env::args().skip(1).map(PathBuf::from));
            spawn_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_pending_files,
            pick_drawings,
            take_open_request,
            list_drawings,
            read_drawing,
            write_drawing,
            create_drawing,
            rename_drawing,
            delete_drawing
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, _event| {
            // Finder's double-click, "Open With" and `open -a` all deliver the
            // file as an Apple Event, never in argv — whether or not the app
            // was already running.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                queue_files(_app, urls.iter().filter_map(|u| u.to_file_path().ok()));
            }
        });
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
        write_drawing(first.clone(), "{\"elements\":[1]}".into(), None).unwrap();
        assert_eq!(read_drawing(first.clone()).unwrap(), "{\"elements\":[1]}");

        // An empty scene must not silently replace one that has content — the
        // failure that cost a real 9MB drawing. Deliberate clearing is covered
        // in the durability section below.
        let empty_scene = r#"{"elements":[],"appState":{}}"#;
        assert!(write_drawing(first.clone(), empty_scene.into(), None).is_err());
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

        // A real rich-text scene, captured out of the running app, must come
        // back byte-identical. Inline emphasis lives in each element's
        // `customData`, so anything this layer normalised would silently strip
        // a drawing's formatting on the next open.
        let captured = include_str!("../tests/fixtures/rich-text-scene.excalidraw");
        let rich = create_drawing(Some("Rich text".into()), Some(captured.into())).unwrap();
        let read_back = read_drawing(rich.clone()).unwrap();
        assert_eq!(read_back, captured);
        assert!(read_back.contains("richTextId"));
        assert!(read_back.contains("\"color\":\"#1971c2\""));
        // and it still survives a rename, which moves the file
        let moved = rename_drawing(rich, "Rich text renamed".into()).unwrap();
        assert_eq!(read_drawing(moved).unwrap(), captured);


        // --- durability: atomic writes, bounded history, empty-scene guard ---
        // Same serial test on purpose: EXCALIDRAW_LIBRARY_DIR is process-global.
        let durable = create_drawing(Some("Durable".into()), None).unwrap();
        let durable_path = path_for(&durable).unwrap();
        for i in 1..=3 {
            write_drawing(durable.clone(), format!(r#"{{"elements":[{i}]}}"#), None).unwrap();
        }
        // The temp file the atomic write goes through is always cleaned up, and
        // never shows up as a drawing.
        assert!(
            !fs::read_dir(&dir)
                .unwrap()
                .any(|e| e.unwrap().path().extension().and_then(|x| x.to_str()) == Some("tmp")),
            "a temp file survived the write"
        );

        // Each distinct state is kept; the newest snapshot is the state
        // immediately before the file as it now stands.
        let history = history_dir_for(&durable_path).unwrap();
        let mut snaps: Vec<_> = fs::read_dir(&history)
            .unwrap()
            .filter_map(|e| Some(e.ok()?.path()))
            .collect();
        snaps.sort();
        assert_eq!(snaps.len(), 3, "the empty original plus two superseded states");
        assert_eq!(
            fs::read_to_string(snaps.last().unwrap()).unwrap(),
            r#"{"elements":[2]}"#
        );
        assert_eq!(read_drawing(durable.clone()).unwrap(), r#"{"elements":[3]}"#);

        // Panning and zooming must not push real versions out of the history.
        // These differ only in appState, exactly as the running app's saves do.
        let before_viewport = fs::read_dir(&history).unwrap().count();
        for i in 0..8 {
            write_drawing(
                durable.clone(),
                format!(r#"{{"elements":[3],"appState":{{"scrollX":{i},"zoom":{i}}}}}"#),
                None,
            )
            .unwrap();
        }
        assert_eq!(
            fs::read_dir(&history).unwrap().count(),
            before_viewport + 1,
            "viewport-only saves must not fill the history"
        );

        // Rewriting identical bytes stops adding snapshots — the app rewrites
        // the active drawing on every switch, and that churn must not evict
        // real history. The first such write still snapshots the current state
        // (it is not in history yet); every repeat after that is a no-op.
        write_drawing(durable.clone(), r#"{"elements":[3]}"#.into(), None).unwrap();
        let settled = fs::read_dir(&history).unwrap().count();
        for _ in 0..5 {
            write_drawing(durable.clone(), r#"{"elements":[3]}"#.into(), None).unwrap();
        }
        assert_eq!(fs::read_dir(&history).unwrap().count(), settled);

        // History is bounded.
        for i in 0..(HISTORY_KEEP + 10) {
            write_drawing(durable.clone(), format!(r#"{{"elements":[{i},"x"]}}"#), None).unwrap();
        }
        assert_eq!(fs::read_dir(&history).unwrap().count(), HISTORY_KEEP);

        // An empty scene must not silently replace one with content — the
        // failure that cost a real 9MB drawing — but a deliberate clear saves.
        let before = read_drawing(durable.clone()).unwrap();
        let empty = r#"{"elements":[],"appState":{}}"#;
        assert!(write_drawing(durable.clone(), empty.into(), None).is_err());
        assert_eq!(read_drawing(durable.clone()).unwrap(), before);
        write_drawing(durable.clone(), empty.into(), Some(true)).unwrap();
        assert_eq!(read_drawing(durable.clone()).unwrap(), empty);

        // Unreadable input is never mistaken for an empty scene, so the guard
        // cannot block a save it does not understand.
        assert_eq!(live_element_count("not json"), None);
        assert_eq!(live_element_count(r#"{"elements":[]}"#), Some(0));
        assert_eq!(
            live_element_count(r#"{"elements":[{"isDeleted":true}]}"#),
            Some(0)
        );

        std::env::remove_var("EXCALIDRAW_LIBRARY_DIR");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn pending_open_copies_outside_files_and_names_library_ones() {
        let root = std::env::temp_dir().join(format!("excalidraw-open-{}", std::process::id()));
        let library = root.join("library");
        let elsewhere = root.join("elsewhere");
        fs::create_dir_all(&library).unwrap();
        fs::create_dir_all(&elsewhere).unwrap();
        fs::write(library.join("mine.excalidraw"), "{}").unwrap();
        fs::write(elsewhere.join("factory.excalidraw"), "{\"a\":1}").unwrap();
        fs::write(elsewhere.join("notes.txt"), "hi").unwrap();

        let outside = pending_open(&elsewhere.join("factory.excalidraw"), &library).unwrap();
        assert_eq!(outside.name, "factory");
        assert_eq!(outside.contents.as_deref(), Some("{\"a\":1}"));

        // Already in the library: open it by name, never copy it onto itself.
        let inside = pending_open(&library.join("mine.excalidraw"), &library).unwrap();
        assert_eq!(inside.name, "mine");
        assert!(inside.contents.is_none());

        assert!(pending_open(&elsewhere.join("notes.txt"), &library).is_none());
        assert!(pending_open(&elsewhere.join("missing.excalidraw"), &library).is_none());

        fs::remove_dir_all(&root).unwrap();
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

        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        fs::write(&path, format!(r#"{{"name":"Auth flow","at":{now_ms}}}"#)).unwrap();
        assert_eq!(open_request_name(&dir), Some("Auth flow".to_string()));
        assert!(!path.exists(), "the request must be consumed");
        assert_eq!(open_request_name(&dir), None);

        // Malformed input is ignored, and still cleaned up.
        fs::write(&path, "not json").unwrap();
        assert_eq!(open_request_name(&dir), None);
        assert!(!path.exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_request_ignores_a_stale_timestamp() {
        let dir = std::env::temp_dir().join(format!("excalidraw-req-stale-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(OPEN_REQUEST_FILE);

        // `at: 1` is 1970-01-01 — many hours (in fact decades) outside
        // OPEN_REQUEST_MAX_AGE, unambiguously stale regardless of exactly
        // where the cutoff sits. Must be ignored, but still consumed so it
        // can't be re-read on the next event.
        fs::write(&path, r#"{"name":"Auth flow","at":1}"#).unwrap();
        assert_eq!(open_request_name(&dir), None);
        assert!(!path.exists(), "a stale request must still be consumed");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_request_accepts_a_timestamp_just_under_the_window() {
        // Pins the other side of the OPEN_REQUEST_MAX_AGE boundary: a request
        // written well within the window — comfortably covering a cold
        // `cargo build` of the Tauri debug binary plus app startup — must
        // still be honoured, not just a request written "now".
        let dir = std::env::temp_dir().join(format!("excalidraw-req-fresh-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(OPEN_REQUEST_FILE);

        let almost_expired = SystemTime::now() - (OPEN_REQUEST_MAX_AGE - Duration::from_secs(30));
        let at_ms = almost_expired.duration_since(UNIX_EPOCH).unwrap().as_millis();
        fs::write(&path, format!(r#"{{"name":"Auth flow","at":{at_ms}}}"#)).unwrap();
        assert_eq!(open_request_name(&dir), Some("Auth flow".to_string()));

        let _ = fs::remove_dir_all(&dir);
    }
}
