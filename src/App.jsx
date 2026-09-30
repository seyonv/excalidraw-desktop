import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import "./App.css";
import Sidebar from "./components/Sidebar";
import RichTextOverlay from "./components/RichTextOverlay";
import { useRichTextEditing } from "./lib/richtext/useRichTextEditing";
import { useRichTextResize } from "./lib/richtext/useRichTextResize";
import {
  createDrawing,
  deleteDrawing,
  importPendingFiles,
  onFilesOpened,
  pickDrawings,
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
  // A non-alarming counterpart to `error` — e.g. "a drawing changed on disk
  // while you had it open." Reuses the same toast element, styled neutrally.
  const [notice, setNotice] = useState(null);

  const apiRef = useRef(null);
  const canvasAreaRef = useRef(null);
  const activeNameRef = useRef(null);
  const dirtyRef = useRef(false);
  const timerRef = useRef(null);
  const bootstrappedRef = useRef(false);
  const bootstrapRef = useRef(null);
  // The exact bytes we last wrote per drawing. A watcher event whose contents
  // match one of these is our own autosave echoing back — dropping it is what
  // stops write → watch → reload → change → write from looping forever.
  const lastWrittenRef = useRef(new Map());
  // False from the moment a drawing is opened until the mounted Excalidraw has
  // actually reported the elements it was opened with. A big, image-heavy scene
  // reads as empty for a while during that window, and an autosave landing in
  // it is what replaced a 9MB drawing with a blank one. Starts true for a
  // drawing that really is empty, which has nothing to protect.
  const sceneSettledRef = useRef(true);

  const {
    editing,
    editScreen,
    commitEditing,
    cancelEditing,
    isEditingRef,
  } = useRichTextEditing({ apiRef, containerRef: canvasAreaRef });
  useRichTextResize({ apiRef, containerRef: canvasAreaRef, isEditingRef });

  const refreshList = useCallback(async () => {
    setDrawings(await listDrawings());
  }, []);

  /** Writes the live scene to disk if it has unsaved changes. */
  const flush = useCallback(async () => {
    clearTimeout(timerRef.current);
    // The scene is missing the block currently being edited — writing it
    // would lose that block. Leave dirtyRef alone: the commit re-marks the
    // drawing dirty, so the finished edit still saves.
    if (isEditingRef.current) return;
    const name = activeNameRef.current;
    if (!dirtyRef.current || !name || !apiRef.current) return;
    const api = apiRef.current;
    const elements = api.getSceneElements();
    // Still loading, not emptied. Stay dirty so the real scene saves once it
    // arrives, and never hand this to disk.
    if (elements.length === 0 && !sceneSettledRef.current) return;
    dirtyRef.current = false;
    try {
      const contents = serializeScene(
        elements,
        api.getAppState(),
        api.getFiles(),
      );
      lastWrittenRef.current.set(name, contents);
      await writeDrawing(name, contents, sceneSettledRef.current);
    } catch (e) {
      dirtyRef.current = true;
      setError(String(e));
    }
  }, [isEditingRef]);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  /** Discards any pending write — used when the target file is going away. */
  const discardPendingSave = useCallback(() => {
    clearTimeout(timerRef.current);
    dirtyRef.current = false;
  }, []);

  const openScene = useCallback((name, contents) => {
    const parsed = parseScene(contents);
    sceneSettledRef.current = (parsed.elements?.length ?? 0) === 0;
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

    bootstrapRef.current = (async () => {
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

      let target = await importPendingFiles();
      if (target) list = await listDrawings();

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
      // SceneData has no `files` field — binary files (embedded images) must
      // be registered separately before the elements referencing them render,
      // or the image shows up broken.
      const files = Object.values(parsed.files ?? {});
      if (files.length) apiRef.current.addFiles(files);
      // captureUpdate: IMMEDIATELY puts this in the undo stack, so Cmd+Z
      // restores whatever the user had. Never bump sceneKey here — remounting
      // Excalidraw would throw away scroll and zoom.
      // This updateScene fires onChange, which schedules one autosave. That
      // write normalises the file to Excalidraw's own serialisation (usually
      // not byte-identical to what was just read), so one extra disk write
      // follows every external reload. It settles: flush() records what it
      // wrote into lastWrittenRef, so the watcher event that write triggers
      // is recognised as an echo and dropped.
      apiRef.current.updateScene({
        elements: parsed.elements,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      // Cmd+Z is the user's remedy for this, and they cannot know it's
      // available unless we tell them.
      setNotice("Updated externally — Cmd+Z to undo");
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

  // The OS handed us a file — Finder double-click, "Open With", `open -a`.
  useEffect(() => {
    const unlisten = onFilesOpened(async () => {
      // A file that arrives mid-bootstrap would be opened and then replaced
      // by the last-active drawing bootstrap is about to open.
      await bootstrapRef.current;
      try {
        const name = await importPendingFiles();
        if (!name) return;
        await refreshList();
        if (name === activeNameRef.current) return;
        await flushRef.current();
        openScene(name, await readDrawing(name));
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

  const handleChange = useCallback((elements, appState) => {
    setTheme(appState.theme ?? "light");
    // The scene has produced its contents, so from here an empty scene is a
    // real deletion rather than a half-loaded drawing.
    if (elements.length > 0) sceneSettledRef.current = true;
    // While editing, the scene is missing the block being edited. Saving that
    // would write a file without it, and quitting mid-edit would lose it.
    // Cancel any save armed before the edit opened too, or it would still
    // fire mid-edit and write the scene without the block.
    if (isEditingRef.current) {
      clearTimeout(timerRef.current);
      return;
    }
    dirtyRef.current = true;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flushRef.current(), SAVE_DEBOUNCE_MS);
  }, [isEditingRef]);

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
          // Re-key alongside activeNameRef so the two can never drift apart:
          // the rename's own filesystem event otherwise looks unrecognised
          // under the new name and reads as a spurious external change.
          if (lastWrittenRef.current.has(oldName)) {
            lastWrittenRef.current.set(
              resolved,
              lastWrittenRef.current.get(oldName),
            );
            lastWrittenRef.current.delete(oldName);
          }
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
        lastWrittenRef.current.delete(name);
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
      <div className="canvas-area" ref={canvasAreaRef}>
        {ready && scene ? (
          <Excalidraw
            key={sceneKey}
            excalidrawAPI={(api) => {
              apiRef.current = api;
              // Dev only: lets a devtools console inspect the live scene. Vite
              // strips this from a production build.
              if (import.meta.env.DEV) window.__excalidrawApi = api;
            }}
            initialData={scene}
            onChange={handleChange}
          >
            {/* Excalidraw's default menu, with its "Open" swapped for ours:
                the stock one loads a file over the active drawing, where
                autosave would then write it. */}
            <MainMenu>
              <MainMenu.Item onSelect={pickDrawings} shortcut="⌘O">
                Open…
              </MainMenu.Item>
              <MainMenu.DefaultItems.SaveToActiveFile />
              <MainMenu.DefaultItems.Export />
              <MainMenu.DefaultItems.SaveAsImage />
              <MainMenu.DefaultItems.SearchMenu />
              <MainMenu.DefaultItems.Help />
              <MainMenu.DefaultItems.ClearCanvas />
              <MainMenu.Separator />
              <MainMenu.Group title="Excalidraw links">
                <MainMenu.DefaultItems.Socials />
              </MainMenu.Group>
              <MainMenu.Separator />
              <MainMenu.DefaultItems.ToggleTheme />
              <MainMenu.DefaultItems.ChangeCanvasBackground />
            </MainMenu>
          </Excalidraw>
        ) : (
          <div className="loading">
            <div className="loading-spinner"></div>
            <p>Loading...</p>
          </div>
        )}
        {editing && editScreen && (
          <RichTextOverlay
            key={editing.base.id}
            doc={editing.doc}
            initialAct={editing.initialAct}
            style={{
              left: editScreen.left,
              top: editScreen.top,
              zoom: editScreen.zoom,
              maxWidth: editing.base.maxWidth,
              fontSize: editing.base.fontSize,
              fontFamily: editing.base.fontFamily,
              lineHeight: editing.base.lineHeight,
              strokeColor: editing.base.strokeColor,
            }}
            onCommit={commitEditing}
            onCancel={cancelEditing}
          />
        )}
        {error && (
          <div className="error-toast" onClick={() => setError(null)}>
            {error}
          </div>
        )}
        {!error && notice && (
          <div className="error-toast info-toast" onClick={() => setNotice(null)}>
            {notice}
          </div>
        )}
      </div>
    </main>
  );
}

export default App;
