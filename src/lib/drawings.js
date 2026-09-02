import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// The only module that talks to the Rust side. Drawings live as real
// `.excalidraw` files in ~/Library/Application Support/Excalidraw, named by their file stem.

export const listDrawings = () => invoke("list_drawings");

export const readDrawing = (name) => invoke("read_drawing", { name });

/** `allowEmpty` confirms a scene with no elements is the user's doing rather
 *  than a drawing that has not finished loading — see the guard in lib.rs. */
export const writeDrawing = (name, contents, allowEmpty = false) =>
  invoke("write_drawing", { name, contents, allowEmpty });

/** Returns the name actually used, which may differ if the requested one was taken. */
export const createDrawing = (name, contents) =>
  invoke("create_drawing", { name, contents });

/** Returns the name actually used, which may differ if the requested one was taken. */
export const renameDrawing = (oldName, newName) =>
  invoke("rename_drawing", { oldName, newName });

export const deleteDrawing = (name) => invoke("delete_drawing", { name });

export const getPendingFile = () => invoke("get_pending_file");

export const takeOpenRequest = () => invoke("take_open_request");

/** Fires when drawings change on disk — including changes made by the MCP server. */
export const onLibraryChanged = (handler) =>
  listen("library-changed", (event) => handler(event.payload?.names ?? []));

/** Fires when something outside the app asks for a drawing to be opened. */
export const onOpenRequest = (handler) =>
  listen("open-request", (event) => handler(event.payload?.name));

/** Serializes a live Excalidraw scene into the standard export format. */
export function serializeScene(elements, appState, files) {
  const { collaborators, ...rest } = appState ?? {};
  return JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "excalidraw-desktop",
    elements: elements ?? [],
    appState: rest,
    files: files ?? {},
  });
}

/** Parses file contents into `initialData` for Excalidraw, tolerating junk. */
export function parseScene(contents) {
  const empty = { elements: [], appState: {}, files: {} };
  if (!contents) return empty;
  try {
    const data = JSON.parse(contents);
    const { collaborators, ...appState } = data.appState ?? {};
    return {
      elements: Array.isArray(data.elements) ? data.elements : [],
      appState,
      files: data.files ?? {},
    };
  } catch (e) {
    console.error("Failed to parse drawing:", e);
    return empty;
  }
}
