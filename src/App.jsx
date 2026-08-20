import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw, CaptureUpdateAction } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import "./App.css";
import Sidebar from "./components/Sidebar";
import {
  createDrawing,
  deleteDrawing,
  getPendingFile,
  listDrawings,
  onLibraryChanged,
  onOpenRequest,
  parseScene,
  readDrawing,
  renameDrawing,
  serializeScene,
  takeOpenRequest,
  writeDrawing,
} from "./lib/drawings";

const LAST_ACTIVE_KEY = "excalidraw:lastActive";
const SIDEBAR_KEY = "excalidraw:sidebarOpen";
const MIGRATED_KEY = "excalidraw:migrated";
const SAVE_DEBOUNCE_MS = 600;

function App() {
  const [drawings, setDrawings] = useState([]);
  const [activeName, setActiveName] = useState(null);
  const [scene, setScene] = useState(null);
  // Bumped only when a genuinely different scene is loaded, so Excalidraw
  // remounts on switch but not on a rename of the current drawing.
  const [sceneKey, setSceneKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem(SIDEBAR_KEY) !== "false",
  );
  const [theme, setTheme] = useState("light");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  const apiRef = useRef(null);
  const activeNameRef = useRef(null);
  const dirtyRef = useRef(false);
  const timerRef = useRef(null);
  const bootstrappedRef = useRef(false);
  // The exact bytes we last wrote per drawing. A watcher event whose contents
  // match one of these is our own autosave echoing back — dropping it is what
  // stops write → watch → reload → change → write from looping forever.
  const lastWrittenRef = useRef(new Map());

  const refreshList = useCallback(async () => {
    setDrawings(await listDrawings());
  }, []);

  /** Writes the live scene to disk if it has unsaved changes. */
  const flush = useCallback(async () => {
    clearTimeout(timerRef.current);
    const name = activeNameRef.current;
    if (!dirtyRef.current || !name || !apiRef.current) return;
    dirtyRef.current = false;
    const api = apiRef.current;
    try {
      const contents = serializeScene(
        api.getSceneElements(),
        api.getAppState(),
        api.getFiles(),
      );
      lastWrittenRef.current.set(name, contents);
      await writeDrawing(name, contents);
    } catch (e) {
      dirtyRef.current = true;
      setError(String(e));
    }
  }, []);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  /** Discards any pending write — used when the target file is going away. */
  const discardPendingSave = useCallback(() => {
    clearTimeout(timerRef.current);
    dirtyRef.current = false;
  }, []);

  const openScene = useCallback((name, contents) => {
    const parsed = parseScene(contents);
    setScene(parsed);
    setActiveName(name);
    activeNameRef.current = name;
    setTheme(parsed.appState?.theme ?? "light");
    setSceneKey((k) => k + 1);
    localStorage.setItem(LAST_ACTIVE_KEY, name);
  }, []);

  // Bootstrap: migrate any legacy single-scene state, honour a file opened via
  // the .excalidraw association, then reopen the last drawing the user had.
  useEffect(() => {
    // Must run exactly once: it can create files, and StrictMode's double
    // invoke would otherwise produce a duplicate drawing on first launch.
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;

    (async () => {
      let list = await listDrawings();

      if (!localStorage.getItem(MIGRATED_KEY)) {
        const legacyElements = localStorage.getItem("excalidrawElements");
        if (legacyElements) {
          try {
            const legacyState = localStorage.getItem("excalidrawState");
            await createDrawing(
              "My Drawing",
              serializeScene(
                JSON.parse(legacyElements),
                legacyState ? JSON.parse(legacyState) : {},
                {},
              ),
            );
            list = await listDrawings();
          } catch (e) {
            console.error("Could not migrate previous drawing:", e);
          }
        }
        localStorage.setItem(MIGRATED_KEY, "1");
      }

      const pending = await getPendingFile();
      let target = null;
      if (pending) {
        target = await createDrawing(pending.name, pending.contents);
        list = await listDrawings();
      }

      // An MCP open request that arrived while the app was not running.
      if (!target) {
        const requested = await takeOpenRequest();
        if (requested && list.some((d) => d.name === requested)) target = requested;
      }

      if (!target) {
        const last = localStorage.getItem(LAST_ACTIVE_KEY);
        target = list.some((d) => d.name === last) ? last : list[0]?.name;
      }
      if (!target) {
        target = await createDrawing();
        list = await listDrawings();
      }

      setDrawings(list);
      openScene(target, await readDrawing(target));
      setReady(true);
    })().catch((e) => {
      setError(String(e));
      setReady(true);
    });
  }, [openScene]);

  // Saves are debounced because onChange is high-frequency; these listeners
  // force a write at the moments the app is most likely to go away.
  useEffect(() => {
    const save = () => flushRef.current();
    const onVisibility = () => {
      if (document.hidden) save();
    };
    window.addEventListener("blur", save);
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", save);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Reload drawings changed underneath us — by the MCP server, or by anything
  // else that writes to the library folder.
  useEffect(() => {
    const unlisten = onLibraryChanged(async (names) => {
      await refreshList();

      const active = activeNameRef.current;
      if (!active || !names.includes(active) || !apiRef.current) return;

      const contents = await readDrawing(active).catch(() => null);
      if (contents === null) return;
      // Our own autosave coming back around.
      if (contents === lastWrittenRef.current.get(active)) return;

      const parsed = parseScene(contents);
      lastWrittenRef.current.set(active, contents);
      dirtyRef.current = false;
      clearTimeout(timerRef.current);
      // captureUpdate: IMMEDIATELY puts this in the undo stack, so Cmd+Z
      // restores whatever the user had. Never bump sceneKey here — remounting
      // Excalidraw would throw away scroll and zoom.
      apiRef.current.updateScene({
        elements: parsed.elements,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    });
    return () => {
      unlisten.then((off) => off()).catch(() => {});
    };
  }, [refreshList]);

  // Something outside the app asked for a drawing — switch to it and come forward.
  useEffect(() => {
    const unlisten = onOpenRequest(async (name) => {
      if (!name || name === activeNameRef.current) {
        await refreshList();
        return;
      }
      await flushRef.current();
      try {
        openScene(name, await readDrawing(name));
        await refreshList();
      } catch (e) {
        setError(String(e));
      }
    });
    return () => {
      unlisten.then((off) => off()).catch(() => {});
    };
  }, [openScene, refreshList]);

  useEffect(() => {
    window.EXCALIDRAW_ASSET_PATH = "/";
  }, []);

  const handleChange = useCallback((_elements, appState) => {
    setTheme(appState.theme ?? "light");
    dirtyRef.current = true;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flushRef.current(), SAVE_DEBOUNCE_MS);
  }, []);

  const handleSelect = useCallback(
    async (name) => {
      if (name === activeNameRef.current) return;
      await flush();
      try {
        openScene(name, await readDrawing(name));
        await refreshList();
      } catch (e) {
        setError(String(e));
      }
    },
    [flush, openScene, refreshList],
  );

  const handleCreate = useCallback(async () => {
    await flush();
    try {
      const name = await createDrawing();
      openScene(name, null);
      await refreshList();
    } catch (e) {
      setError(String(e));
    }
  }, [flush, openScene, refreshList]);

  const handleRename = useCallback(
    async (oldName, newName) => {
      try {
        if (oldName === activeNameRef.current) await flush();
        const resolved = await renameDrawing(oldName, newName);
        if (oldName === activeNameRef.current) {
          setActiveName(resolved);
          activeNameRef.current = resolved;
          localStorage.setItem(LAST_ACTIVE_KEY, resolved);
        }
        await refreshList();
      } catch (e) {
        setError(String(e));
      }
    },
    [flush, refreshList],
  );

  const handleDelete = useCallback(
    async (name) => {
      try {
        // Drop any queued write first, or the debounce could recreate the file.
        if (name === activeNameRef.current) discardPendingSave();
        await deleteDrawing(name);
        let list = await listDrawings();
        if (name === activeNameRef.current) {
          if (list.length) {
            const next = list[0].name;
            openScene(next, await readDrawing(next));
          } else {
            openScene(await createDrawing(), null);
            list = await listDrawings();
          }
        }
        setDrawings(list);
      } catch (e) {
        setError(String(e));
      }
    },
    [discardPendingSave, openScene],
  );

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => {
      localStorage.setItem(SIDEBAR_KEY, String(!open));
      return !open;
    });
  }, []);

  return (
    <main className="container">
      <Sidebar
        drawings={drawings}
        activeName={activeName}
        open={sidebarOpen}
        theme={theme}
        onToggle={toggleSidebar}
        onSelect={handleSelect}
        onCreate={handleCreate}
        onRename={handleRename}
        onDelete={handleDelete}
      />
      <div className="canvas-area">
        {ready && scene ? (
          <Excalidraw
            key={sceneKey}
            excalidrawAPI={(api) => {
              apiRef.current = api;
            }}
            initialData={scene}
            onChange={handleChange}
          />
        ) : (
          <div className="loading">
            <div className="loading-spinner"></div>
            <p>Loading...</p>
          </div>
        )}
        {error && (
          <div className="error-toast" onClick={() => setError(null)}>
            {error}
          </div>
        )}
      </div>
    </main>
  );
}

export default App;
