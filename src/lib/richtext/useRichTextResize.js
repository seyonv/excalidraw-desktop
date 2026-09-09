import { useEffect } from "react";
import {
  CaptureUpdateAction,
  getCommonBounds,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import { layout } from "./layout";
import { canvasMeasure } from "./measure";
import { blockIdFor, isRichText, readModel, readTransform, toElements } from "./elements";
import { edgeAt } from "./resizeGeometry";

// Must match useRichTextEditing, or a block re-wrapped by a drag and a block
// committed from the editor would pad their boxed runs differently.
const BOX_PADDING = 6;

/**
 * Dragging a rich text block's left or right border re-wraps it at the new
 * width, at the same font size. Every other drag — a corner, the top or bottom
 * border, or anything with shift held — falls through to Excalidraw, which
 * scales box and font together; `readTransform` picks that scale up later.
 *
 * Excalidraw cannot be asked to re-wrap a group (`resizeMultipleElements`
 * forces proportional scaling on anything in a group), so the drag has to be
 * ours from the first pointer event.
 */
export function useRichTextResize({ apiRef, containerRef, isEditingRef }) {
  useEffect(() => {
    const area = containerRef.current;
    if (!area) return undefined;

    // Set while we own a drag: the block's model, the base it is being laid out
    // from, the anchored right edge for a `w` drag, the offset between the
    // grabbed point and the box edge being dragged, whether any pointermove
    // has landed yet, and the ids we last wrote.
    let drag = null;

    /** Lay the block out at `maxWidth`/`x` and put it in the scene, keeping it
     *  selected — `toElements` mints fresh ids every render, so without this
     *  the stale selection matches nothing and the block ends the drag
     *  deselected, which makes a second consecutive drag impossible. */
    const render = (base, capture) => {
      const api = apiRef.current;
      if (!api) return;
      const laidOut = layout(drag.doc, {
        measure: canvasMeasure(base.fontSize, base.fontFamily),
        maxWidth: base.maxWidth,
        fontSize: base.fontSize,
        lineHeight: base.lineHeight,
        boxPadding: BOX_PADDING,
      });
      const next = toElements(drag.doc, laidOut, base);
      const rest = api.getSceneElements().filter((el) => !drag.ids.has(el.id));
      // updateScene merges partial appState through setState, so the rest of
      // the current appState doesn't need spreading back in here.
      api.updateScene({
        elements: [...rest, ...next],
        appState: { selectedElementIds: Object.fromEntries(next.map((el) => [el.id, true])) },
        captureUpdate: capture,
      });
      drag.ids = new Set(next.map((el) => el.id));
    };

    const finish = () => {
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
      window.removeEventListener("keydown", onKeyDown, true);
      drag = null;
    };

    /** Put back exactly what the drag hid, reselect it, and leave no trace in
     *  history. Shared by Escape and a cancelled pointer stream: both are an
     *  aborted gesture, not a completed one, and the intermediate geometry
     *  must not be left sitting in the scene — the undo baseline is still the
     *  pre-drag state (every frame so far was EVENTUALLY, not IMMEDIATELY), so
     *  leaving it there would let the next unrelated IMMEDIATELY anywhere in
     *  the app fold it into that step's undo delta. */
    const cancel = () => {
      const api = apiRef.current;
      if (api) {
        const rest = api.getSceneElements().filter((el) => !drag.ids.has(el.id));
        api.updateScene({
          elements: [...rest, ...drag.hidden],
          appState: {
            selectedElementIds: Object.fromEntries(drag.hidden.map((el) => [el.id, true])),
          },
          captureUpdate: CaptureUpdateAction.EVENTUALLY,
        });
      }
      finish();
    };

    const onPointerMove = (event) => {
      if (!drag) return;
      try {
        drag.moved = true;
        const api = apiRef.current;
        if (!api) return;
        const { x } = viewportCoordsToSceneCoords(event, api.getAppState());
        // The border is drawn on the ink (where `edgeAt` hit-tests), but the
        // value being dragged is the box edge, and greedy wrapping leaves a
        // ragged gap between them — 64px on the fixture. Without this offset
        // the block would jump by that gap the instant the drag started.
        const edgeX = x + drag.grabOffset;
        const min = drag.base.fontSize * 4;
        const base = drag.edge === "e"
          ? { ...drag.base, maxWidth: Math.max(min, edgeX - drag.base.x) }
          // dragging the left border leaves the right edge where it is
          : { ...drag.base, x: Math.min(edgeX, drag.right - min), maxWidth: Math.max(min, drag.right - edgeX) };
        drag.base = base;
        // EVENTUALLY defers this frame into the next IMMEDIATELY rather than
        // excluding it from history: NEVER instead replaces the undo baseline
        // with this frame's state, so pointerup's IMMEDIATELY would capture a
        // delta from the *last* intermediate frame — same geometry, different
        // element ids — and undo would appear to do nothing.
        render(base, CaptureUpdateAction.EVENTUALLY);
      } catch (e) {
        finish();
        throw e;
      }
    };

    const onPointerUp = () => {
      if (!drag) return;
      try {
        if (drag.moved) {
          // One undo step for the whole drag: every intermediate frame was
          // EVENTUALLY — deferred, not discarded — and this IMMEDIATELY folds
          // all of them into one delta from the pre-drag baseline.
          render(drag.base, CaptureUpdateAction.IMMEDIATELY);
        }
        // No pointermove landed: a stray click on the border. Rendering anyway
        // would regenerate every element with fresh ids and seeds for no visible
        // change — an undo step and a full file rewrite with nothing to show.
        finish();
      } catch (e) {
        finish();
        throw e;
      }
    };

    const onPointerCancel = () => {
      if (!drag) return;
      cancel();
    };

    const onKeyDown = (event) => {
      if (!drag || event.key !== "Escape") return;
      // Two separate things keep the restored block selected and usable:
      // stopPropagation here keeps Excalidraw's own Escape handler — which
      // deselects — from also seeing this event, and cancel() below is what
      // re-points the selection at the restored elements' ids (the last
      // render's ids, which cancel() replaces, no longer exist).
      event.stopPropagation();
      cancel();
    };

    const onPointerDown = (event) => {
      const api = apiRef.current;
      if (!api || drag || isEditingRef?.current) return;
      // The container wraps the whole editor, toolbar and islands included, so
      // a press on Excalidraw's own UI reaches this handler too. Claiming one
      // would swallow the click and arm a drag on the user's text.
      if (!event.target?.closest?.("canvas.interactive")) return;
      // Shift is the scale gesture; Excalidraw already does it.
      if (event.shiftKey || event.button !== 0) return;

      const appState = api.getAppState();
      const all = api.getSceneElements();
      const selected = all.filter((el) => appState.selectedElementIds[el.id]);
      if (!selected.length || !selected.every(isRichText)) return;
      const groupId = selected[0].groupIds?.[0];
      if (!groupId || !selected.every((el) => el.groupIds?.[0] === groupId)) return;

      const group = all.filter((el) => isRichText(el) && el.groupIds?.[0] === groupId);
      const point = viewportCoordsToSceneCoords(event, appState);
      const edge = edgeAt(getCommonBounds(group), point, appState.zoom.value);
      if (!edge) return;

      const model = readModel(group);
      if (!model) return;
      const t = readTransform(group);
      const scale = t?.scale ?? 1;
      const richTextId = selected[0].customData.richTextId;
      const id = blockIdFor(groupId, richTextId);
      const base = {
        ...model.base,
        ...(t ? { x: t.x, y: t.y } : {}),
        fontSize: model.base.fontSize * scale,
        maxWidth: model.base.maxWidth * scale,
        id,
        groupId,
      };

      // Claim it before Excalidraw's own pointer handling starts a resize.
      event.preventDefault();
      event.stopPropagation();
      const right = base.x + base.maxWidth;
      const grabbed = edge === "e" ? right : base.x;
      drag = {
        edge,
        base,
        doc: model.blocks,
        hidden: group,
        ids: new Set(group.map((el) => el.id)),
        right,
        grabOffset: grabbed - point.x,
        moved: false,
      };
      window.addEventListener("pointermove", onPointerMove, true);
      window.addEventListener("pointerup", onPointerUp, true);
      window.addEventListener("pointercancel", onPointerCancel, true);
      window.addEventListener("keydown", onKeyDown, true);
    };

    area.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      area.removeEventListener("pointerdown", onPointerDown, true);
      if (drag) finish();
    };
  }, [apiRef, containerRef, isEditingRef]);
}
