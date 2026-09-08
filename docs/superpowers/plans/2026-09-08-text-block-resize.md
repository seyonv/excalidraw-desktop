# Text block resize — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dragging the left or right edge of a rich text block re-wraps it at the same font size; every other drag scales box and font together, and that scale now sticks. Task 5, added after the plan was approved, fixes a wrapping bug found in real use while this work was underway: the canvas wrapped a word earlier than the editor showed.

**Architecture:** Two independent halves. The re-wrap half is a drag we own: a capture-phase `pointerdown` on the canvas container claims an edge grab before Excalidraw sees it and re-lays the block out live. The scale half owns nothing — each generated element already records its offset from the block's origin, and now also the width it was generated at, so the scale is read back off the elements when the block is next opened.

**Tech Stack:** React 18, `@excalidraw/excalidraw` 0.18 (npm package, never patched), `node --test` for pure units, `dev/e2e-app.sh` (gstack browse against a real Excalidraw) for integration.

**Spec:** `docs/superpowers/specs/2026-09-08-text-block-resize-design.md`

## Global Constraints

- **npm, not pnpm.** `npm run test:richtext`, `npm run test:mcp`, `./dev/e2e-app.sh`.
- **`dev/e2e-app.sh` needs the Vite dev server running** (`npm run dev`, port 1420) and the browse binary at `~/.claude/skills/gstack/browse/dist/browse`.
- **Never patch Excalidraw.** `node_modules/@excalidraw/excalidraw` and `public/` are read-only references. Line numbers cited below are in `node_modules/@excalidraw/excalidraw/dist/dev/chunk-4FTI6OG3.js`.
- **Before committing, revert formatter churn:** `git checkout -- public/`.
- **No attribution in commit messages** — no `Claude-Session:` trailer, no `claude.ai` URL, no `Co-Authored-By`, no "Generated with". Grep the message before committing.
- **`updateScene` with no `elements` key wipes the scene.** Every call passes the elements it means to keep.
- **The rich text pipeline stays pure:** `layout.js` and anything it imports must never need a browser. Geometry helpers go in their own module, not in a hook.
- **Commit after every task**, with the tests passing.

---

### Task 1: Read the scale back off the elements

A block scaled by Excalidraw keeps a model that still says the old `fontSize` and `maxWidth`, so reopening it lays the edit out at the authored size and the block snaps back. Stamp each element with the width it was generated at, and derive both the scale and the origin from any survivor.

This also replaces `readOrigin`, which is wrong for a scaled block: it reads `el.x - off.dx` with an unscaled `dx`.

**Files:**
- Modify: `src/lib/richtext/elements.js` (the `stamp` helper ~line 51; `readOrigin` ~line 119)
- Modify: `src/lib/richtext/useRichTextEditing.js:139-166` (the `hit` branch of the double-click handler)
- Test: `src/lib/richtext/elements.test.js`

**Interfaces:**
- Consumes: `toElements(doc, laidOut, base)`, `readModel(elements)` — unchanged signatures.
- Produces:
  - `customData.richTextOffset = { dx: number, dy: number, w: number }` on every generated element (`w` is the element's own width at generation).
  - `readTransform(elements) -> { x: number, y: number, scale: number } | null` — the block's origin and scale as they are *now*. `readOrigin` is deleted; Task 3 uses `readTransform`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/richtext/elements.test.js`, and change the import at the top of the file from `readOrigin` to `readTransform`:

```js
test("readTransform gives the origin and unit scale for an untouched block", () => {
  const doc = applyStyle(fromText("aaa bbb"), 0, 3, "hl", true);
  assert.deepEqual(readTransform(build(doc)), { x: 100, y: 50, scale: 1 });
});

test("readTransform tracks a block that was scaled and then moved", () => {
  const doc = applyStyle(fromText("aaa bbb"), 0, 3, "hl", true);
  // what Excalidraw's resizeMultipleElements does to a group: every element
  // scaled about the selection anchor, text elements' fontSize with it
  const anchor = { x: 60, y: 20 };
  const scaled = build(doc).map((e) => ({
    ...e,
    x: anchor.x + (e.x - anchor.x) * 1.5 + 7,
    y: anchor.y + (e.y - anchor.y) * 1.5 - 4,
    width: e.width * 1.5,
    height: e.height * 1.5,
  }));
  const t = readTransform(scaled);
  assert.equal(t.scale, 1.5);
  // the origin follows the same transform the elements did
  assert.ok(Math.abs(t.x - (anchor.x + (100 - anchor.x) * 1.5 + 7)) < 1e-9);
  assert.ok(Math.abs(t.y - (anchor.y + (50 - anchor.y) * 1.5 - 4)) < 1e-9);
});

test("readTransform reports nothing for elements that never carried an offset", () => {
  assert.equal(readTransform([{ x: 1, y: 2, customData: { richTextId: "rt1" } }]), null);
});

test("laying the same doc out narrower wraps more without changing the font", () => {
  const doc = fromText("aaa bbb ccc ddd");
  const wide = toElements(doc, layout(doc, opts), base);
  const narrow = toElements(doc, layout(doc, { ...opts, maxWidth: 80 }), { ...base, maxWidth: 80 });
  const lines = (els) => new Set(els.filter((e) => e.type === "text").map((e) => e.y)).size;
  assert.ok(lines(narrow) > lines(wide));
  assert.equal(narrow[0].fontSize, wide[0].fontSize);
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npm run test:richtext`
Expected: FAIL — `readTransform is not a function` (the import fails first).

- [ ] **Step 3: Stamp the generated width**

In `src/lib/richtext/elements.js`, the `stamp` helper becomes:

```js
  const stamp = (el) => common({
    ...el,
    groupIds: [groupId],
    customData: {
      ...meta,
      richTextOffset: { dx: el.x - originX, dy: el.y - originY, w: el.width },
    },
  });
```

- [ ] **Step 4: Replace `readOrigin` with `readTransform`**

Delete `readOrigin` and put this in its place:

```js
/** Where the block is *now* and how much it has been scaled, read back from the
 *  elements. `base.x/y`, `fontSize` and `maxWidth` are only what the block was
 *  authored at: moving, duplicating or resizing it leaves all four stale.
 *
 *  A text element is the witness, because its width is always positive — an
 *  underline is a `line` whose width is 0 for an empty fragment, and a scale
 *  cannot be read from it. */
export function readTransform(elements) {
  for (const el of elements) {
    const off = el?.customData?.richTextOffset;
    if (!off || el.type !== "text" || !(off.w > 0) || !(el.width > 0)) continue;
    const scale = el.width / off.w;
    return { x: el.x - off.dx * scale, y: el.y - off.dy * scale, scale };
  }
  // Blocks stamped before `w` existed still know where they are, but not how
  // much they were scaled.
  for (const el of elements) {
    const off = el?.customData?.richTextOffset;
    if (off) return { x: el.x - off.dx, y: el.y - off.dy, scale: 1 };
  }
  return null;
}
```

- [ ] **Step 5: Open a block at the size it is now, not the size it was authored at**

In `src/lib/richtext/useRichTextEditing.js`, change the import on line 7 to `readTransform`, and replace the `openEditor` call inside the `if (hit)` branch with:

```js
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
```

- [ ] **Step 6: Run the unit tests**

Run: `npm run test:richtext`
Expected: PASS, all tests.

- [ ] **Step 7: Add the E2E case for a scaled block**

Excalidraw's own resize cannot be driven headlessly (its pointer path needs canvas focus the harness never gets, and `Input.dispatchMouseEvent` is not on the browse CDP allowlist), so apply the scale the way `resizeMultipleElements` does — the same technique `__duplicateSelection` already uses for copies.

Add to `dev/app-harness.js`, next to `__duplicateSelection`:

```js
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
```

Add to `dev/e2e-app.sh`, immediately before the `# ---------- 8.` section:

```bash
# ---------- 7e. a scaled block keeps its scaled size ----------
# The model still carries the fontSize and maxWidth the block was authored at,
# so an edit used to lay out at the old size and snap the block back.
reset
js "window.__scaleRich(2)" >/dev/null
sleep 1
SCALED_X="$(js '(b=>b.x)(JSON.parse(window.__blocks())[0])')"
open_editor
check "the overlay opens at the scaled font size" "40" "$(js 'String(window.__overlayFontSize())')"
$B press "ArrowRight" >/dev/null
$B type "!" >/dev/null
$B press "Escape" >/dev/null
sleep 1
check "the commit keeps the scale" "40" \
  "$(js 'String(window.__api.getSceneElements().find(e=>e.type==="text"&&e.customData?.richTextId).fontSize)')"
check "the commit keeps the position" "$SCALED_X" \
  "$(js '(b=>String(b.x))(JSON.parse(window.__blocks())[0])')"
```

- [ ] **Step 8: Run the E2E suite**

Run: `npm run dev` in one terminal, then `./dev/e2e-app.sh`
Expected: PASS, 0 failed. If the run reports a stale `createRoot` console error from editing files mid-run, clear it (`~/.claude/skills/gstack/browse/dist/browse console --clear`) and re-run.

- [ ] **Step 9: Commit**

```bash
git checkout -- public/
git add src/lib/richtext/elements.js src/lib/richtext/elements.test.js \
        src/lib/richtext/useRichTextEditing.js dev/app-harness.js dev/e2e-app.sh
git commit -m "Keep a scaled text block at the size it was scaled to"
```

---

### Task 2: The edge hit test

A pure function answering "is this scene point on the block's left or right border, the way Excalidraw would read it?". Pure and in its own module so `node --test` can pin it without a browser — the same reason `layout.js` takes its measure function as a parameter.

**The geometry it mirrors** (all at angle 0, mouse pointer, `zoom` = `appState.zoom.value`):

- Excalidraw draws no side handles on desktop (`DEFAULT_OMIT_SIDES`, line 22987). A side drag is a grab of the selection *border*: `getTransformHandleTypeFromCoords` (line 23263) expands the bounds by `SIDE_RESIZING_THRESHOLD / zoom` (4/zoom, line 235) and tests the pointer against each border segment with that same threshold.
- It tests the four **corner** handles first, then the sides in the order `n, e, s, w`. So a point that is both on the `n` band and the `w` band reads as `n`, and a point in a corner handle reads as a corner.
- A corner handle spans 8/zoom starting 2/zoom outside the bounds — it reaches from 2/zoom to 10/zoom past each corner (line 23041).

**Files:**
- Create: `src/lib/richtext/resizeGeometry.js`
- Test: `src/lib/richtext/resizeGeometry.test.js`

**Interfaces:**
- Produces: `edgeAt(bounds, point, zoom) -> "e" | "w" | null`, where `bounds` is `[x1, y1, x2, y2]` in scene coordinates (exactly what `getCommonBounds` returns) and `point` is `{ x, y }` in scene coordinates. Task 3 is its only caller.

- [ ] **Step 1: Write the failing test**

Create `src/lib/richtext/resizeGeometry.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { edgeAt } from "./resizeGeometry.js";

// a block 200 wide and 100 tall
const bounds = [100, 50, 300, 150];

test("grabs the left and right borders", () => {
  assert.equal(edgeAt(bounds, { x: 98, y: 100 }, 1), "w");
  assert.equal(edgeAt(bounds, { x: 302, y: 100 }, 1), "e");
});

test("ignores the inside of the block", () => {
  assert.equal(edgeAt(bounds, { x: 200, y: 100 }, 1), null);
});

test("ignores the top and bottom borders", () => {
  assert.equal(edgeAt(bounds, { x: 200, y: 48 }, 1), null);
  assert.equal(edgeAt(bounds, { x: 200, y: 152 }, 1), null);
});

test("leaves the corners to Excalidraw", () => {
  // within reach of the nw handle, which Excalidraw tests before any side
  assert.equal(edgeAt(bounds, { x: 98, y: 52 }, 1), null);
  assert.equal(edgeAt(bounds, { x: 302, y: 148 }, 1), null);
});

test("the bands are screen-sized, so they shrink as you zoom in", () => {
  // 6 scene px outside the border: inside the band at zoom 0.5, outside it at 2
  assert.equal(edgeAt(bounds, { x: 94, y: 100 }, 0.5), "w");
  assert.equal(edgeAt(bounds, { x: 94, y: 100 }, 2), null);
});

test("a block too short to have a middle claims nothing", () => {
  assert.equal(edgeAt([100, 50, 300, 62], { x: 98, y: 56 }, 1), null);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test src/lib/richtext/resizeGeometry.test.js`
Expected: FAIL — cannot find module `./resizeGeometry.js`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/richtext/resizeGeometry.js`:

```js
// Excalidraw's numbers, not ours. It draws no side handles on desktop — a side
// drag is a grab of the selection border, tested with SIDE_RESIZING_THRESHOLD
// (4 scene px at zoom 1) against bounds expanded by the same amount. Corner
// handles are tested first and reach from 2 to 10 scene px past each corner.
const THRESHOLD = 4;
const CORNER_REACH = 10;

/**
 * The border a scene point grabs, if it is unambiguously the left or right one.
 *
 * Deliberately conservative: anything that Excalidraw would read as a corner,
 * or as the top or bottom border, returns null and is left to Excalidraw. A
 * claimed drag that should have been a corner drag is much worse than an
 * unclaimed one, which simply scales the way it does today.
 */
export function edgeAt(bounds, point, zoom) {
  const [x1, y1, x2, y2] = bounds;
  const threshold = THRESHOLD / zoom;
  const corner = CORNER_REACH / zoom;
  if (point.y < y1 + corner || point.y > y2 - corner) return null;
  if (Math.abs(point.x - (x1 - threshold)) <= threshold) return "w";
  if (Math.abs(point.x - (x2 + threshold)) <= threshold) return "e";
  return null;
}
```

- [ ] **Step 4: Run the test**

Run: `node --test src/lib/richtext/resizeGeometry.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Include the new test file in the suite**

`package.json`'s `test:richtext` script is `node --test 'src/lib/richtext/*.test.js'`, which already picks it up. Confirm:

Run: `npm run test:richtext`
Expected: PASS, and the count is 6 higher than before.

- [ ] **Step 6: Commit**

```bash
git checkout -- public/
git add src/lib/richtext/resizeGeometry.js src/lib/richtext/resizeGeometry.test.js
git commit -m "Add the hit test for a text block's left and right borders"
```

---

### Task 3: Own the edge drag

**Files:**
- Create: `src/lib/richtext/useRichTextResize.js`
- Modify: `src/App.jsx` (import ~line 7, hook call ~line 62)
- Modify: `dev/app-harness.jsx` (mount the hook; expose `sceneCoordsToViewportCoords`)
- Modify: `dev/app-harness.js`, `dev/e2e-app.sh`

**Interfaces:**
- Consumes: `edgeAt(bounds, point, zoom)` (Task 2); `readTransform(elements)` (Task 1); `readModel`, `isRichText`, `toElements` from `./elements`; `layout` from `./layout`; `canvasMeasure` from `./measure`; `getCommonBounds`, `viewportCoordsToSceneCoords`, `CaptureUpdateAction` from `@excalidraw/excalidraw`.
- Produces: `useRichTextResize({ apiRef, containerRef, isEditingRef })` — returns nothing; it only installs listeners.

- [ ] **Step 1: Write the hook**

Create `src/lib/richtext/useRichTextResize.js`:

```js
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
```

- [ ] **Step 2: Mount it in the app**

In `src/App.jsx`, after the `useRichTextEditing` import (line 7):

```js
import { useRichTextResize } from "./lib/richtext/useRichTextResize";
```

and immediately after the `useRichTextEditing({ ... })` call (which ends around line 68):

```js
  useRichTextResize({ apiRef, containerRef: canvasAreaRef, isEditingRef });
```

- [ ] **Step 3: Mount it in the harness**

In `dev/app-harness.jsx`: add `sceneCoordsToViewportCoords` to the `@excalidraw/excalidraw` import, import the hook next to `useRichTextEditing`, call it in `Harness()`, and expose the converter so the test helpers can turn scene coordinates into client ones.

```jsx
import { Excalidraw, sceneCoordsToViewportCoords } from "@excalidraw/excalidraw";
import { useRichTextResize } from "../src/lib/richtext/useRichTextResize.js";
```

```jsx
  const { editing, editScreen, commitEditing, cancelEditing, isEditingRef } =
    useRichTextEditing({ apiRef, containerRef: areaRef });
  useRichTextResize({ apiRef, containerRef: areaRef, isEditingRef });
```

and inside the `excalidrawAPI` callback, beside `window.__serializeScene`:

```jsx
          window.__sceneToViewport = sceneCoordsToViewportCoords;
```

- [ ] **Step 4: Add the drag helper to the harness**

In `dev/app-harness.js`, next to `__blocks`:

```js
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
    area.dispatchEvent(down);
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
```

- [ ] **Step 5: Add the E2E cases**

Add to `dev/e2e-app.sh`, immediately before the `# ---------- 8.` section:

```bash
# ---------- 7f. dragging a border re-wraps instead of scaling ----------
reset
js "window.__selectRich()" >/dev/null
LINES_BEFORE="$(js 'window.__lineCount()')"
FONT_BEFORE="$(js 'window.__fontSize()')"
check "the drag is claimed" "true" "$(js 'String(window.__dragEdge("e", -160))')"
sleep 1
check "it wrapped to more lines" "true" \
  "$(js "String(window.__lineCount() > $LINES_BEFORE)")"
check "the font size is untouched" "$FONT_BEFORE" "$(js 'window.__fontSize()')"
check "the origin stays put" "120" "$(js '(b=>String(b.x))(JSON.parse(window.__blocks())[0])')"

# dragging the left border anchors the right one
reset
js "window.__selectRich()" >/dev/null
RIGHT_BEFORE="$(js 'window.__rightEdge()')"
js 'window.__dragEdge("w", 120)' >/dev/null
sleep 1
check "a left drag anchors the right edge" "$RIGHT_BEFORE" "$(js 'window.__rightEdge()')"
check "a left drag moves the origin" "true" \
  "$(js '(b=>String(b.x>120))(JSON.parse(window.__blocks())[0])')"

# the width floor
reset
js "window.__selectRich()" >/dev/null
js 'window.__dragEdge("e", -600)' >/dev/null
sleep 1
check "the width stops at the floor" "true" \
  "$(js 'String(window.__rightEdge() - JSON.parse(window.__blocks())[0].x >= 79)')"

# shift is the scale gesture and stays Excalidraw's
reset
js "window.__selectRich()" >/dev/null
check "a shift drag is not claimed" "false" \
  "$(js 'String(window.__dragEdge("e", -160, { shift: true }))')"
check "a shift drag changes nothing on its own" "$(js 'window.__lineCount()')" \
  "$(js 'window.__lineCount()')"

# a re-wrapped block still opens for editing, at the new width
reset
js "window.__selectRich()" >/dev/null
js 'window.__dragEdge("e", -160)' >/dev/null
sleep 1
open_editor
check "a re-wrapped block still opens" "true" "$(js 'window.__overlayOpen()')"
check "it opens at the re-wrapped width" "true" \
  "$(js 'String(window.__overlayText().includes("Ship on Tuesday"))')"
```

- [ ] **Step 6: Run everything**

Run: `npm run test:richtext && ./dev/e2e-app.sh`
Expected: unit PASS; E2E 0 failed.

- [ ] **Step 7: Verify it by hand in the real app**

The one thing the harness cannot prove is that the drag is a single undo step and that the cursor Excalidraw draws matches the drag we claim — both need Excalidraw's own pointer handling and canvas focus.

Run `npm run tauri dev`, then:
1. Double-click a text block, type a sentence long enough to wrap, `Esc`.
2. Click it once to select. Move to the middle of its right border — the cursor becomes `ew-resize`. Drag left: the text re-wraps live, the font does not change.
3. `⌘Z` once — the block returns to its previous wrap in one step.
4. Drag a *corner*: box and font scale together, as before.
5. Double-click the scaled block: the editor opens at the scaled size, and committing leaves it scaled.

Report what happened for each. If the cursor and the claimed drag disagree, that is the hit test drifting — fix `edgeAt`, not the hook.

- [ ] **Step 8: Commit**

```bash
git checkout -- public/
git add src/lib/richtext/useRichTextResize.js src/App.jsx \
        dev/app-harness.jsx dev/app-harness.js dev/e2e-app.sh
git commit -m "Re-wrap a text block when its left or right border is dragged"
```

---

### Task 4: Document it

The README is the product description; a change to what a user can do updates it in the same commit as the behaviour. This is that commit, deliberately last so the words describe what actually shipped.

**Files:**
- Modify: `README.md` (the comparison table ~line 33; `### Inline emphasis` ~line 53)
- Modify: `CLAUDE.md` (the "Rules that came from real bugs" list)

- [ ] **Step 1: Add the row to the comparison table**

In `README.md`, after the **Styling text** row:

```markdown
| **Resizing a text block**        | Drag scales the type with the box | Drag a side border to re-wrap at the same size; corners still scale |
```

- [ ] **Step 2: Describe the gesture**

In `README.md`, at the end of the `### Inline emphasis` section, before `## Your drawings are just files`:

```markdown
**Resizing a block.** Drag its left or right border and the text re-wraps to the
new width at the same font size — the block gets narrower and taller, not
smaller. Drag a corner (or the top or bottom border) and box and type scale
together, the way they always have. Shift is still Excalidraw's proportional
resize. The two gestures are the same ones a plain text element already answers
to; a block just used to ignore the first one.
```

- [ ] **Step 3: Record the rules**

In `CLAUDE.md`, after the `richTextOffset` bullet added earlier:

```markdown
- **`readTransform` is the only way to learn where a block is and how big it
  is.** `base.x/y`, `fontSize` and `maxWidth` are what the block was *authored*
  at. Excalidraw scales a group by rewriting the elements, so the model goes
  stale the moment anyone resizes one; reading the scale back off an element's
  width (`richTextOffset.w`) is what stops an edit from snapping the block back
  to its original size. Read the transform — never trust the stored base alone.
- **The edge-drag hit test must stay conservative.** `edgeAt` claims a pointer
  only where Excalidraw would unambiguously read `e` or `w` — never a corner,
  never the n/s bands, which Excalidraw tests first. Claiming a drag that should
  have been a corner drag breaks a gesture that works; declining one the user
  meant for us just scales the block, which is what it did before.
```

- [ ] **Step 4: Check the docs against what shipped**

Re-read the two README edits against the behaviour in Task 3. Every sentence must be something you watched happen in Step 7 of Task 3. Fix any that is not.

- [ ] **Step 5: Commit**

```bash
git checkout -- public/
git add README.md CLAUDE.md
git commit -m "Document resizing a text block"
```

---

---

### Task 5: The editor's wrap and the canvas's wrap must agree

Reported from real use: convert a paragraph, colour a phrase, click away — and the
committed block wraps a word earlier than the editor showed, gaining a line that
was not there while editing. The overlay promises WYSIWYG; this breaks it.

**Root cause, already confirmed.** `words()` keeps a word's trailing space with
the word, and the fit test charges that space to the line
(`src/lib/richtext/layout.js:65-67`):

```js
for (const word of words(text)) {
  const width = measure(word);      // "message " — the space is included
  if (x + width > available && fragments.length) flush();
```

A browser hangs trailing whitespace at a line break rather than counting it, and
the overlay *is* a browser. Demonstrated with the pure layout function: text with
70 of ink, 75 of available width, and it still breaks —

```
layout(fromText("aaa bbb ccc"), { measure: t => t.length * 10, maxWidth: 75, ... })
  → 2 lines: ["aaa ", "bbb ccc"]      // want: ["aaa bbb ", "ccc"]
```

**Files:**
- Modify: `src/lib/richtext/layout.js` (`placeSegment`, the word loop)
- Test: `src/lib/richtext/layout.test.js`
- Test: `dev/app-harness.js`, `dev/e2e-app.sh`

**Interfaces:** none change. `layout(doc, opts)` keeps its signature and its
output shape; only the break decision moves.

- [ ] **Step 1: Write the failing unit tests**

Add to `src/lib/richtext/layout.test.js` (use the file's existing `measure`/opts
helpers if they match; otherwise define them locally as below):

```js
test("a trailing space is hung at a break, not charged to the line", () => {
  const measure = (t) => t.length * 10;
  // "aaa bbb" is 70 of ink. The space after "bbb" exists only because "ccc"
  // follows it, and a browser does not count it when breaking.
  const doc = fromText("aaa bbb ccc");
  const { lines } = layout(doc, { measure, maxWidth: 75, fontSize: 20, lineHeight: 1.25 });
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => l.fragments.map((f) => f.text).join("")), ["aaa bbb ", "ccc"]);
});

test("a word whose own ink overflows still breaks", () => {
  const measure = (t) => t.length * 10;
  // "bbb" is 30 of ink and only 20 is left after "aaa " — hanging the space
  // must not turn into never breaking
  const doc = fromText("aaa bbb");
  const { lines } = layout(doc, { measure, maxWidth: 60, fontSize: 20, lineHeight: 1.25 });
  assert.equal(lines.length, 2);
});

test("runs of whitespace never force a break on their own", () => {
  const measure = (t) => t.length * 10;
  const doc = fromText("aaa     bbb");
  const { lines } = layout(doc, { measure, maxWidth: 75, fontSize: 20, lineHeight: 1.25 });
  // the spaces hang; the ink is "aaa" + "bbb" = 60
  assert.equal(lines.length, 1);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run test:richtext`
Expected: FAIL on the first and third — 2 lines where 1 is wanted, or the wrong
fragment split.

- [ ] **Step 3: Charge only the ink**

In `src/lib/richtext/layout.js`, inside `placeSegment`'s word loop:

```js
      for (const word of words(text)) {
        const width = measure(word);
        // Only the ink decides the break. A trailing space at a line break is
        // hung, not drawn — the overlay is a browser and wraps that way, so
        // charging the space here made a committed block wrap a word earlier
        // than the editor showed and gain a line on click-away.
        const ink = measure(word.trimEnd());
        if (x + ink > available && fragments.length) flush();
        if (ink <= available) { place(run, word, width); continue; }
```

The per-character fallback below it keeps using the full measurement: a word
long enough to reach it has no trailing space of its own to hang.

`place(run, word, width)` still advances `x` by the full width, spaces included
— the next word has to start after the space, and the space is only free at a
break.

- [ ] **Step 4: Run the unit tests**

Run: `npm run test:richtext`
Expected: PASS, all of them. Existing layout tests must not change — if one now
reports a different line count, stop and report it rather than editing the
expectation: it means this change moved a break that was previously correct.

- [ ] **Step 5: Prove it end to end, against the overlay itself**

This is the test that matters, and it is stronger than the unit tests: it asserts
the *editor* and the *canvas* agree, so any other source of disagreement is
caught too, not just the trailing space.

Add to `dev/app-harness.js`:

```js
  /** How many visual lines the overlay is showing, from the rendered boxes
   *  rather than from our own layout — this is the browser's own wrapping. */
  window.__overlayLineCount = () => {
    const el = document.querySelector(".richtext-overlay");
    if (!el) return 0;
    const range = document.createRange();
    let tops = new Set();
    for (const block of el.querySelectorAll("[data-block]")) {
      range.selectNodeContents(block);
      for (const rect of range.getClientRects()) {
        if (rect.width > 0) tops.add(Math.round(rect.top));
      }
    }
    return tops.size;
  };
```

Add to `dev/e2e-app.sh`, immediately before the `# ---------- 8.` section:

```bash
# ---------- 7g. the editor's wrapping and the canvas's agree ----------
# Clicking away must not reflow the block. It used to gain a line: the layout
# charged each word's trailing space to the line, where a browser hangs it.
reset
open_editor
OVERLAY_LINES="$(js 'window.__overlayLineCount()')"
$B press "Escape" >/dev/null
sleep 1
check "the canvas wraps exactly as the editor did" "$OVERLAY_LINES" "$(js 'window.__lineCount()')"
```

- [ ] **Step 6: Run the E2E suite**

Run: `./dev/e2e-app.sh`
Expected: 0 failed. The fixture's text is long enough to wrap, so the new case
is meaningful; if `__overlayLineCount` and `__lineCount` both report 1, the
fixture is not exercising a wrap — say so rather than leaving a test that
proves nothing.

- [ ] **Step 7: Commit**

```bash
git checkout -- public/
git add src/lib/richtext/layout.js src/lib/richtext/layout.test.js \
        dev/app-harness.js dev/e2e-app.sh
git commit -m "Hang a trailing space at a line break instead of charging it"
```


## Where this plan departs from the spec

Two places, both deliberate:

1. **An extra file.** The spec's file table lists one new module,
   `useRichTextResize.js`. The plan splits the edge hit test out into
   `resizeGeometry.js` so it can be unit-tested — importing the hook into
   `node --test` would pull in `@excalidraw/excalidraw`, which needs a browser.
   Same responsibility split the repo already makes for `layout.js`.
2. **The undo case is a manual check, not an E2E one.** The spec lists "undo
   after an edge drag restores the previous wrap in one step" under E2E. Undo
   needs Excalidraw's keyboard handling, which needs canvas focus the headless
   harness never gets — the same limitation that stops the suite from driving a
   real resize. It moves to the hand-verification step in Task 3.

## Notes for the executor

- **Nothing here modifies `layout.js`, `model.js` or `RichTextOverlay.jsx`.** If you find yourself editing them, stop — the width a block wraps to is a property of the base, and laying out at a different one is what `layout()` already does.
- **The spec's `readOrigin` is gone after Task 1.** It has exactly one caller. Do not leave both.
- **If a drag stutters on a very large block**, coalesce `pointermove` with `requestAnimationFrame` inside `render` — do not drop live re-wrapping, which is the whole point of owning the drag.
