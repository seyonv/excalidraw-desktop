// Dev-only. Mounts the real App against an in-memory library, with Tauri's IPC
// mocked and a fake watcher that echoes every write back as `library-changed`
// the way the Rust one does — so the autosave/watcher interplay can be driven
// by a browser. Never part of the production build.
import { mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";

const WATCH_DEBOUNCE_MS = 150; // mirrors WATCH_DEBOUNCE in src-tauri/src/lib.rs

const scene = (text) =>
  JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "test",
    elements: [
      {
        id: "t1", type: "text", x: 100, y: 100, width: 200, height: 25, angle: 0,
        strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid",
        strokeWidth: 1, strokeStyle: "solid", roughness: 0, opacity: 100,
        groupIds: [], frameId: null, index: "a0", roundness: null, seed: 1,
        version: 1, versionNonce: 1, isDeleted: false, boundElements: null,
        updated: 1, link: null, locked: false, text, originalText: text,
        fontSize: 20, fontFamily: 5, textAlign: "left", verticalAlign: "top",
        containerId: null, lineHeight: 1.25, autoResize: true,
      },
    ],
    appState: {},
    files: {},
  });

const disk = new Map([["Repro", scene("Box A")]]);
window.__writes = 0;

const changed = (name, delay = WATCH_DEBOUNCE_MS) =>
  setTimeout(() => emit("library-changed", { names: [name] }), delay);

mockIPC(
  (cmd, args) => {
    switch (cmd) {
      case "list_drawings":
        return [...disk.keys()].map((name) => ({ name, modified: 0 }));
      case "read_drawing":
        return disk.get(args.name);
      case "write_drawing":
        disk.set(args.name, args.contents);
        window.__writes += 1;
        changed(args.name);
        return null;
      case "take_pending_files":
        return [];
      case "take_open_request":
        return null;
      default:
        return null;
    }
  },
  { shouldMockEvents: true },
);

const textOf = (contents) =>
  JSON.parse(contents).elements.filter((e) => e.type === "text").map((e) => e.text).join();

window.__diskText = () => textOf(disk.get("Repro"));
window.__sceneText = () =>
  window.__excalidrawApi
    .getSceneElements()
    .filter((e) => e.type === "text")
    .map((e) => e.text)
    .join();
/** Another program (the MCP server, Dropbox) rewrites the open drawing. Its
 *  watcher event can be slow to arrive — a sync client writing in chunks keeps
 *  the debounce open — and the app has no reason to write in the meantime. */
window.__externalWrite = (text, eventDelay) => {
  disk.set("Repro", scene(text));
  changed("Repro", eventDelay);
  return "ok";
};

localStorage.clear();
const [{ default: React }, { createRoot }, { default: App }] = await Promise.all([
  import("react"),
  import("react-dom/client"),
  import("../src/App.jsx"),
]);
createRoot(document.getElementById("root")).render(React.createElement(App));
