import { useEffect } from "react";
import {
  CaptureUpdateAction,
  getCommonBounds,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import { layout } from "./layout";
import { canvasMeasure } from "./measure";
import { isRichText, readModel, readTransform, toElements } from "./elements";
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
    // from, the anchored right edge for a `w` drag, and the ids we last wrote.
    let drag = null;

    /** Lay the block out at `maxWidth`/`x` and put it in the scene. */
    const render = (base, capture) => {
      const api = apiRef.current;
      const laidOut = layout(drag.doc, {
        measure: canvasMeasure(base.fontSize, base.fontFamily),
        maxWidth: base.maxWidth,
        fontSize: base.fontSize,
        lineHeight: base.lineHeight,
        boxPadding: BOX_PADDING,
      });
      const next = toElements(drag.doc, laidOut, base);
      const rest = api.getSceneElements().filter((el) => !drag.ids.has(el.id));
      api.updateScene({ elements: [...rest, ...next], captureUpdate: capture });
      drag.ids = new Set(next.map((el) => el.id));
    };

    const finish = () => {
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("keydown", onKeyDown, true);
      drag = null;
    };

    const onPointerMove = (event) => {
      if (!drag) return;
      const api = apiRef.current;
      const { x } = viewportCoordsToSceneCoords(event, api.getAppState());
      const min = drag.base.fontSize * 4;
      const base = drag.edge === "e"
        ? { ...drag.base, maxWidth: Math.max(min, x - drag.base.x) }
        // dragging the left border leaves the right edge where it is
        : { ...drag.base, x: Math.min(x, drag.right - min), maxWidth: Math.max(min, drag.right - x) };
      drag.base = base;
      render(base, CaptureUpdateAction.NEVER);
    };

    const onPointerUp = () => {
      if (!drag) return;
      // One undo step for the whole drag: every frame so far was NEVER.
      render(drag.base, CaptureUpdateAction.IMMEDIATELY);
      finish();
    };

    const onKeyDown = (event) => {
      if (!drag || event.key !== "Escape") return;
      const api = apiRef.current;
      const rest = api.getSceneElements().filter((el) => !drag.ids.has(el.id));
      api.updateScene({
        elements: [...rest, ...drag.hidden],
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      finish();
    };

    const onPointerDown = (event) => {
      const api = apiRef.current;
      if (!api || drag || isEditingRef?.current) return;
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
      // Same rule as the editor: a copy stops answering to the original's id.
      const id = groupId !== `rtg-${richTextId}` ? `rt-${groupId}` : richTextId;
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
      drag = {
        edge,
        base,
        doc: model.blocks,
        hidden: group,
        ids: new Set(group.map((el) => el.id)),
        right: base.x + base.maxWidth,
      };
      window.addEventListener("pointermove", onPointerMove, true);
      window.addEventListener("pointerup", onPointerUp, true);
      window.addEventListener("keydown", onKeyDown, true);
    };

    area.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      area.removeEventListener("pointerdown", onPointerDown, true);
      if (drag) finish();
    };
  }, [apiRef, containerRef, isEditingRef]);
}
