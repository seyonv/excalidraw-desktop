import { useCallback, useEffect, useRef, useState } from "react";
import { CaptureUpdateAction, sceneCoordsToViewportCoords } from "@excalidraw/excalidraw";
import { ACT_FOR_KEY } from "../../components/RichTextOverlay";
import { fromText } from "./model";
import { layout } from "./layout";
import { canvasMeasure, fontsReady } from "./measure";
import { blockIdFor, isRichText, readModel, readTransform, toElements } from "./elements";

const BOX_PADDING = 6;

/**
 * Owns rich text editing on top of an Excalidraw canvas: when the overlay opens,
 * what it edits, and how the result goes back into the scene. Kept out of the
 * app so it can be mounted against a bare Excalidraw and driven by a browser.
 *
 * `containerRef` must be the positioned element the overlay renders into — the
 * overlay's coordinates are relative to it.
 *
 * `isEditingRef` is a ref rather than state on purpose: the caller reads it
 * synchronously inside Excalidraw's `onChange` to suppress autosave while the
 * block's elements are out of the scene.
 */
export function useRichTextEditing({ apiRef, containerRef }) {
  // { doc, base, elementIds, hidden, initialAct } while a rich text block is
  // being edited. `hidden` is exactly what we removed from the scene, so a
  // cancelled edit can put it back rather than losing the block.
  const [editing, setEditing] = useState(null);
  const [editScreen, setEditScreen] = useState(null);
  const editingRef = useRef(null);



  /** Where a scene point sits inside the container, plus the current zoom. */
  const screenFor = useCallback((base) => {
    const api = apiRef.current;
    const area = containerRef.current;
    if (!api || !area) return null;
    const appState = api.getAppState();
    const { x, y } = sceneCoordsToViewportCoords(
      { sceneX: base.x, sceneY: base.y },
      appState,
    );
    const box = area.getBoundingClientRect();
    return { left: x - box.left, top: y - box.top, zoom: appState.zoom.value };
  }, [apiRef, containerRef]);

  /** The base for converting an ordinary text element into a rich one. */
  const baseForPlain = useCallback((el) => {
    const id = `rt-${el.id}`;
    return {
      id,
      x: el.x,
      y: el.y,
      maxWidth: Math.max(el.width, el.fontSize * 4),
      fontSize: el.fontSize,
      fontFamily: el.fontFamily,
      lineHeight: el.lineHeight ?? 1.25,
      strokeColor: el.strokeColor,
      groupId: `rtg-${id}`,
    };
  }, []);

  const openEditor = useCallback(
    (blocks, base, elementIds, initialAct) => {
      const api = apiRef.current;
      if (!api) return;
      const all = api.getSceneElements();
      const hidden = all.filter((el) => elementIds.includes(el.id));
      const next = { doc: blocks, base, elementIds, hidden, initialAct };
      editingRef.current = next;
      // EVENTUALLY defers this into the next IMMEDIATELY rather than excluding
      // it from history: NEVER instead replaces the undo baseline with "block
      // absent", so the commit's IMMEDIATELY would capture a delta from that —
      // undoing a finished edit would delete the block instead of restoring
      // the previous text. EVENTUALLY keeps the baseline at the pre-edit state
      // and folds this removal into the commit's step, so the whole edit is
      // one undo step rather than two.
      api.updateScene({
        elements: all.filter((el) => !elementIds.includes(el.id)),
        captureUpdate: CaptureUpdateAction.EVENTUALLY,
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
    const area = containerRef.current;
    if (!area) return undefined;
    const onDoubleClick = (event) => {
      const api = apiRef.current;
      if (!api || editingRef.current) return;
      const { selectedElementIds } = api.getAppState();
      const all = api.getSceneElements();
      const hit = all.find((el) => selectedElementIds[el.id] && isRichText(el));
      // Stop it here: Excalidraw's own double-click handler is a bubble-phase
      // listener at the React root, so it never sees the event.
      const claim = () => { event.preventDefault(); event.stopPropagation(); };

      if (hit) {
        const richTextId = hit.customData.richTextId;
        // Scope the block by its Excalidraw group, not by `richTextId`.
        // Duplicating or pasting copies `customData` verbatim but regenerates
        // group ids, so a copy and its original share a `richTextId`: gathering
        // by that id swallowed the original into the copy's edit and committed
        // one block over the two. The group id is what makes a copy its own block.
        const groupId = hit.groupIds?.[0];
        const group = groupId
          ? all.filter((el) => isRichText(el) && el.groupIds?.[0] === groupId)
          : all.filter((el) => el.customData?.richTextId === richTextId);
        const model = readModel(group);
        if (!model) return;
        claim();
        // A copy has to stop answering to the original's id, or the next edit
        // of either one finds both again through the model stored on it.
        const id = blockIdFor(groupId, richTextId);
        // The block may have been scaled since it was written. Reading the
        // scale off the elements is what stops the edit from snapping it back.
        const t = readTransform(group);
        const scale = t?.scale ?? 1;
        openEditor(
          model.blocks,
          {
            ...model.base,
            ...(t ? { x: t.x, y: t.y } : {}),
            fontSize: model.base.fontSize * scale,
            maxWidth: model.base.maxWidth * scale,
            id,
            groupId: groupId ?? `rtg-${id}`,
          },
          group.map((el) => el.id),
        );
        return;
      }

      // ⌘/Ctrl double-click converts ordinary text. A plain double-click is
      // left to Excalidraw: most text never needs to be rich, and claiming the
      // gesture meant you could not get into a block to fix a typo without it
      // becoming rich for good. An already-rich block above has no such choice
      // — Excalidraw would open one generated fragment, and typing into it
      // would desync the model from the elements.
      if (!(event.metaKey || event.ctrlKey)) return;
      const plain = all.find(
        (el) => selectedElementIds[el.id] && el.type === "text" && !isRichText(el),
      );
      if (!plain) return;
      claim();
      openEditor(fromText(plain.originalText ?? plain.text), baseForPlain(plain), [plain.id]);
    };
    area.addEventListener("dblclick", onDoubleClick, true);
    return () => area.removeEventListener("dblclick", onDoubleClick, true);
  }, [openEditor, baseForPlain]);

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
      openEditor(fromText(el.originalText ?? el.text), baseForPlain(el), [el.id], act);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [openEditor, baseForPlain]);

  // Panning or zooming mid-edit must not leave the editor over the wrong part
  // of the canvas.
  useEffect(() => {
    if (!editing) return undefined;
    const api = apiRef.current;
    if (!api?.onScrollChange) return undefined;
    return api.onScrollChange(() => setEditScreen(screenFor(editing.base)));
  }, [editing, screenFor]);

  return { editing, editScreen, commitEditing, cancelEditing, isEditingRef: editingRef };
}
