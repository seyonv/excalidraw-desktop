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

  window.__dblclick = () => {
    const ev = new MouseEvent("dblclick", { bubbles: true, cancelable: true });
    area.dispatchEvent(ev);
    // defaultPrevented means our handler claimed it; the overlay itself renders
    // on React's next pass, so the caller checks __overlayOpen() separately.
    return ev.defaultPrevented;
  };

  window.__overlayOpen = () => Boolean(document.querySelector(".richtext-overlay"));

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
