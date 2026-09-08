// Test helpers for the app harness: drive Excalidraw's selection, open the
// editor the way a user does, and read the scene back.
(() => {
  const api = window.__api;
  const area = window.__area || document.querySelector("#root > div");

  const rich = () =>
    api.getSceneElements().filter((el) => el.customData?.richTextId);

  window.__sceneRichCount = () => rich().length;

  window.__sceneModel = () => {
    const el = rich().find((e) => e.customData?.richText?.blocks);
    return el ? JSON.stringify(el.customData.richText.blocks) : "null";
  };

  window.__sceneText = () =>
    rich().filter((e) => e.type === "text").map((e) => e.text).join("");

  /** Select the block, the way the first click of a double-click does. Kept
   *  separate from the dblclick below: Excalidraw commits the selection on its
   *  own schedule, so dispatching in the same tick reads a stale appState. */
  window.__selectRich = () => {
    const ids = {};
    rich().forEach((el) => { ids[el.id] = true; });
    // elements must be passed too: updateScene treats a missing `elements`
    // key as an empty scene and wipes everything.
    api.updateScene({
      elements: api.getSceneElements(),
      appState: { ...api.getAppState(), selectedElementIds: ids },
    });
    return Object.keys(ids).length;
  };

  window.__dblclick = (opts = {}) => {
    // Aim at the middle of the selection. Our own handler ignores coordinates,
    // but Excalidraw's hit-tests them — without real ones a double-click we
    // decline to claim lands on empty canvas and opens nothing.
    const sel = api.getSceneElements().filter(
      (el) => api.getAppState().selectedElementIds[el.id],
    );
    const st = api.getAppState();
    const point = sel.length
      ? {
          clientX: (sel[0].x + sel[0].width / 2 + st.scrollX) * st.zoom.value + (st.offsetLeft ?? 0),
          clientY: (sel[0].y + sel[0].height / 2 + st.scrollY) * st.zoom.value + (st.offsetTop ?? 0),
        }
      : {};
    const ev = new MouseEvent("dblclick", {
      bubbles: true, cancelable: true, metaKey: Boolean(opts.meta), ...point,
    });
    // Dispatched on the canvas, not the container: React delivers to the
    // target's ancestors, so an event raised on the container never reaches
    // Excalidraw's own handler. It still bubbles up through the container, so
    // our capture-phase listener sees it first either way.
    (document.querySelector("canvas.interactive") ?? area).dispatchEvent(ev);
    // defaultPrevented means our handler claimed it; the overlay itself renders
    // on React's next pass, so the caller checks __overlayOpen() separately.
    return ev.defaultPrevented;
  };

  /** Select the plain (non-rich) text element, as clicking it would. */
  window.__selectPlain = () => {
    api.updateScene({
      elements: api.getSceneElements(),
      appState: { ...api.getAppState(), selectedElementIds: { "plain-1": true } },
    });
    return Object.keys(api.getAppState().selectedElementIds).join(",");
  };

  /** One entry per visual block, keyed by the Excalidraw group id: how many
   *  elements it has, its text, and where its top-left sits. Two entries after
   *  a duplicate — that is how the copy/original tests tell them apart. */
  window.__blocks = () => {
    const by = new Map();
    for (const el of rich()) {
      const g = el.groupIds?.[0] ?? "none";
      if (!by.has(g)) by.set(g, { group: g, rtId: el.customData.richTextId, n: 0, text: "", x: Infinity, y: Infinity });
      const b = by.get(g);
      b.n += 1;
      if (el.type === "text") b.text += el.text;
      b.x = Math.min(b.x, el.x);
      b.y = Math.min(b.y, el.y);
    }
    return JSON.stringify([...by.values()]);
  };

  /** Drag one border of the selected block by `dx` scene pixels. Synthetic
   *  pointer events, because the browse CDP allowlist has no
   *  Input.dispatchMouseEvent — they reach our own listener, which is a plain
   *  DOM one, exactly as a real drag would. */
  window.__dragEdge = (edge, dx, opts = {}) => {
    const block = rich();
    const xs = block.map((el) => el.x).concat(block.map((el) => el.x + el.width));
    const ys = block.map((el) => el.y).concat(block.map((el) => el.y + el.height));
    const x1 = Math.min(...xs), x2 = Math.max(...xs);
    const y1 = Math.min(...ys), y2 = Math.max(...ys);
    const at = (sceneX, sceneY) => {
      const p = window.__sceneToViewport({ sceneX, sceneY }, api.getAppState());
      return { clientX: p.x, clientY: p.y, bubbles: true, cancelable: true,
               button: 0, shiftKey: Boolean(opts.shift) };
    };
    const midY = (y1 + y2) / 2;
    const startX = edge === "e" ? x2 + 2 : x1 - 2;
    const down = new PointerEvent("pointerdown", at(startX, midY));
    // Dispatched on the canvas, not the container, matching __dblclick above:
    // React only delivers events to the target's own ancestor path, so an
    // event raised on the container is invisible to Excalidraw's handlers —
    // which matters here since the whole point of the shift-drag case is that
    // Excalidraw, not us, handles it.
    (document.querySelector("canvas.interactive") ?? area).dispatchEvent(down);
    window.dispatchEvent(new PointerEvent("pointermove", at(startX + dx, midY)));
    window.dispatchEvent(new PointerEvent("pointerup", at(startX + dx, midY)));
    return down.defaultPrevented;
  };

  /** Distinct text-element rows in the block — how many lines it wrapped to. */
  window.__lineCount = () =>
    new Set(rich().filter((e) => e.type === "text").map((e) => Math.round(e.y))).size;

  window.__fontSize = () =>
    rich().find((e) => e.type === "text")?.fontSize ?? 0;

  /** The right-hand edge of the block, for checking a `w` drag anchors it. */
  window.__rightEdge = () =>
    Math.round(Math.max(...rich().map((e) => e.x + e.width)));

  /** Excalidraw's own duplicate (element/duplicate.ts `duplicateElement`): deep
   *  copy, fresh element id, fresh group ids, everything else — customData
   *  included — carried over verbatim, offset like alt-drag or Cmd+D. Done here
   *  rather than by pressing Cmd+D because the headless canvas never takes the
   *  keyboard focus Excalidraw's shortcut handler needs. */
  window.__duplicateSelection = () => {
    const all = api.getSceneElements();
    const selected = api.getAppState().selectedElementIds;
    const groupMap = new Map();
    const copies = all.filter((el) => selected[el.id]).map((el) => {
      const copy = JSON.parse(JSON.stringify(el));
      copy.id = `dup-${Math.random().toString(36).slice(2)}`;
      copy.groupIds = (el.groupIds || []).map((g) => {
        if (!groupMap.has(g)) groupMap.set(g, `dupg-${Math.random().toString(36).slice(2)}`);
        return groupMap.get(g);
      });
      copy.x += 10;
      copy.y += 10;
      return copy;
    });
    const ids = {};
    copies.forEach((c) => { ids[c.id] = true; });
    api.updateScene({
      elements: [...all, ...copies],
      appState: { ...api.getAppState(), selectedElementIds: ids },
    });
    return copies.length;
  };

  /** Drag the whole block, as moving it with the mouse would. */
  window.__moveRich = (dx, dy) => {
    api.updateScene({
      elements: api.getSceneElements().map(
        (el) => (el.customData?.richTextId ? { ...el, x: el.x + dx, y: el.y + dy } : el),
      ),
    });
    return window.__blocks();
  };

  /** What Excalidraw's resizeMultipleElements does to a group: every element
   *  scaled about the selection anchor, text elements' fontSize with it
   *  (`measureFontSizeFromWidth`, chunk-4FTI6OG3.js:24344). Applied directly
   *  because Excalidraw's own resize needs canvas focus the harness never gets. */
  window.__scaleRich = (factor) => {
    const all = api.getSceneElements();
    const block = all.filter((el) => el.customData?.richTextId);
    const ax = Math.min(...block.map((el) => el.x));
    const ay = Math.min(...block.map((el) => el.y));
    api.updateScene({
      elements: all.map((el) => (el.customData?.richTextId
        ? {
            ...el,
            x: ax + (el.x - ax) * factor,
            y: ay + (el.y - ay) * factor,
            width: el.width * factor,
            height: el.height * factor,
            ...(el.type === "text" ? { fontSize: el.fontSize * factor } : {}),
          }
        : el)),
    });
    return window.__blocks();
  };

  /** The font size the overlay is rendering at, as a number. */
  window.__overlayFontSize = () => {
    const el = document.querySelector(".richtext-overlay");
    return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
  };

  window.__overlayOpen = () => Boolean(document.querySelector(".richtext-overlay"));

  /** Excalidraw's own text editor: the textarea it mounts over the canvas. */
  window.__nativeEditorOpen = () =>
    Boolean(api.getAppState().editingTextElement) ||
    Boolean(document.querySelector(".excalidraw-wysiwyg"));

  window.__overlayText = () => {
    const el = document.querySelector(".richtext-overlay");
    return el ? [...el.querySelectorAll("[data-block]")].map((b) => b.textContent).join("\n") : "none";
  };

  window.__overlayRuns = () => {
    const el = document.querySelector(".richtext-overlay");
    return el ? [...el.querySelectorAll("[data-run]")].map((s) => ({
      text: s.textContent, cls: [...s.classList],
    })) : [];
  };

  window.__overlayTransform = () => {
    const el = document.querySelector(".richtext-overlay");
    return el ? getComputedStyle(el).transform : "none";
  };

  window.__setZoom = (value) => {
    api.updateScene({
      elements: api.getSceneElements(),
      appState: { ...api.getAppState(), zoom: { value } },
    });
    return api.getAppState().zoom.value;
  };

  /** Serialize the scene exactly as an autosave would, then load it back
   *  exactly as opening the file would. This is the quit-and-reopen path with
   *  the disk hop removed. */
  window.__roundTripThroughFileFormat = () => {
    const contents = window.__serializeScene(
      api.getSceneElements(), api.getAppState(), api.getFiles(),
    );
    const parsed = window.__parseScene(contents);
    api.updateScene({
      elements: parsed.elements,
      appState: { ...api.getAppState(), selectedElementIds: {} },
    });
    return contents.length;
  };

  /** The serialized bytes, for writing to a real file outside the browser. */
  window.__serialized = () =>
    window.__serializeScene(api.getSceneElements(), api.getAppState(), api.getFiles());

  return "ok";
})();
