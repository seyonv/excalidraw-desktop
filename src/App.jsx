import { useCallback, useEffect, useRef, useState } from "react";
import {
  Excalidraw,
  CaptureUpdateAction,
  sceneCoordsToViewportCoords,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import "./App.css";
import Sidebar from "./components/Sidebar";
import RichTextOverlay, { ACT_FOR_KEY } from "./components/RichTextOverlay";
import { fromText } from "./lib/richtext/model";
import { layout } from "./lib/richtext/layout";
import { canvasMeasure, fontsReady } from "./lib/richtext/measure";
import { isRichText, readModel, toElements } from "./lib/richtext/elements";
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
const BOX_PADDING = 6;

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

  // { doc, base, elementIds, hidden, initialAct } while a rich text block is
  // being edited. `hidden` is exactly what we removed from the scene, so a
  // cancelled edit can put it back rather than losing the block.
  const [editing, setEditing] = useState(null);
  const [editScreen, setEditScreen] = useState(null);

  const apiRef = useRef(null);
  const canvasAreaRef = useRef(null);
  const editingRef = useRef(null);
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

  useEffect(() => {
    window.EXCALIDRAW_ASSET_PATH = "/";
  }, []);

  const handleChange = useCallback((_elements, appState) => {
    setTheme(appState.theme ?? "light");
    // While editing, the scene is missing the block being edited. Saving that
    // would write a file without it, and quitting mid-edit would lose it.
    if (editingRef.current) return;
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

  /* ---------- inline text emphasis ---------- */

  /** Where a scene point sits inside `.canvas-area`, plus the current zoom. */
  const screenFor = useCallback((base) => {
    const api = apiRef.current;
    const area = canvasAreaRef.current;
    if (!api || !area) return null;
    const appState = api.getAppState();
    const { x, y } = sceneCoordsToViewportCoords(
      { sceneX: base.x, sceneY: base.y },
      appState,
    );
    const box = area.getBoundingClientRect();
    return { left: x - box.left, top: y - box.top, zoom: appState.zoom.value };
  }, []);

  const openEditor = useCallback(
    (blocks, base, elementIds, initialAct) => {
      const api = apiRef.current;
      if (!api) return;
      const all = api.getSceneElements();
      const hidden = all.filter((el) => elementIds.includes(el.id));
      const next = { doc: blocks, base, elementIds, hidden, initialAct };
      editingRef.current = next;
      // NEVER keeps this transient removal out of undo history, so the whole
      // edit is one undo step rather than two.
      api.updateScene({
        elements: all.filter((el) => !elementIds.includes(el.id)),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      setEditing(next);
      setEditScreen(screenFor(base));
    },
    [screenFor],
  );

  const commitEditing = useCallback(async (doc) => {
    const current = editingRef.current;
    if (!current) return;
    const { base, elementIds } = current;
    // Clear first: the updateScene below must be seen by handleChange so the
    // finished edit is autosaved.
    editingRef.current = null;
    await fontsReady();
    const api = apiRef.current;
    if (!api) return;
    const laidOut = layout(doc, {
      measure: canvasMeasure(base.fontSize, base.fontFamily),
      maxWidth: base.maxWidth,
      fontSize: base.fontSize,
      lineHeight: base.lineHeight,
      boxPadding: BOX_PADDING,
    });
    const rest = api.getSceneElements().filter((el) => !elementIds.includes(el.id));
    api.updateScene({
      elements: [...rest, ...toElements(doc, laidOut, base)],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    setEditing(null);
    setEditScreen(null);
  }, []);

  /** Nothing changed, so put back exactly what was hidden. */
  const cancelEditing = useCallback(() => {
    const current = editingRef.current;
    if (!current) return;
    editingRef.current = null;
    const api = apiRef.current;
    if (api) {
      api.updateScene({
        elements: [...api.getSceneElements(), ...current.hidden],
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }
    setEditing(null);
    setEditScreen(null);
  }, []);

  // Double-clicking a rich text block opens our editor instead of Excalidraw's.
  useEffect(() => {
    const area = canvasAreaRef.current;
    if (!area) return undefined;
    const onDoubleClick = (event) => {
      const api = apiRef.current;
      if (!api || editingRef.current) return;
      const { selectedElementIds } = api.getAppState();
      const all = api.getSceneElements();
      const hit = all.find((el) => selectedElementIds[el.id] && isRichText(el));
      if (!hit) return;
      const richTextId = hit.customData.richTextId;
      const group = all.filter((el) => el.customData?.richTextId === richTextId);
      const model = readModel(group);
      if (!model) return;
      // Stop it here: Excalidraw's own double-click handler is a bubble-phase
      // listener at the React root, so it never sees the event.
      event.preventDefault();
      event.stopPropagation();
      openEditor(
        model.blocks,
        { ...model.base, id: richTextId, groupId: hit.groupIds?.[0] ?? `rtg-${richTextId}` },
        group.map((el) => el.id),
      );
    };
    area.addEventListener("dblclick", onDoubleClick, true);
    return () => area.removeEventListener("dblclick", onDoubleClick, true);
  }, [openEditor]);

  // An emphasis shortcut on a selected plain text element converts it.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (editingRef.current) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      const act = ACT_FOR_KEY[event.key.toLowerCase()];
      if (!act) return;
      const api = apiRef.current;
      if (!api) return;
      const { selectedElementIds } = api.getAppState();
      const selected = api.getSceneElements().filter((el) => selectedElementIds[el.id]);
      if (selected.length !== 1) return;
      const el = selected[0];
      if (el.type !== "text" || isRichText(el)) return;
      event.preventDefault();
      const id = `rt-${el.id}`;
      openEditor(
        fromText(el.originalText ?? el.text),
        {
          id,
          x: el.x,
          y: el.y,
          maxWidth: Math.max(el.width, el.fontSize * 4),
          fontSize: el.fontSize,
          fontFamily: el.fontFamily,
          lineHeight: el.lineHeight ?? 1.25,
          strokeColor: el.strokeColor,
          groupId: `rtg-${id}`,
        },
        [el.id],
        act,
      );
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [openEditor]);

  // Panning or zooming mid-edit must not leave the editor over the wrong part
  // of the canvas.
  useEffect(() => {
    if (!editing) return undefined;
    const api = apiRef.current;
    if (!api?.onScrollChange) return undefined;
    return api.onScrollChange(() => setEditScreen(screenFor(editing.base)));
  }, [editing, screenFor]);

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
