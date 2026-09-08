# Resizing a text block — design

**Date:** 2026-09-08
**Status:** approved design, pre-implementation

## Goal

Make a rich text block resizable the way a text box is resizable everywhere
else: **drag its left or right edge to change where the text wraps, at the same
font size**. Scaling the whole thing — box *and* type — stays available, and
starts sticking, which today it does not.

Right now a rich text block can only be scaled. It is a group of text elements,
and Excalidraw forces proportional scaling on any selection containing a text
element, a rotated element, or anything in a group:

```js
// resizeMultipleElements, chunk-4FTI6OG3.js:24270
const keepAspectRatio = shouldMaintainAspectRatio || targetElements.some(
  (item) => item.latest.angle !== 0 || isTextElement(item.latest) || isInGroup(item.latest));
if (keepAspectRatio) { scaleX = scale; scaleY = scale; }
```

So every handle and every edge scales the font too, and the wrap width —
`base.maxWidth` in the block's model — is fixed when the block is created and
editable by nothing afterwards.

## The gesture

| drag | result |
| --- | --- |
| left or right **edge** of the selection | re-wrap at the new width, font unchanged |
| a **corner**, or the top/bottom edge | scale box and font together (unchanged) |
| **shift** + any of the above | scale box and font together (unchanged) |

The vocabulary is Excalidraw's own, not something new to learn: on desktop
Excalidraw draws no side handles at all, it lets you grab the selection
**border** within `SIDE_RESIZING_THRESHOLD` (4 scene px ÷ zoom) and reports that
as the `e`/`w` handle (`getTransformHandleTypeFromCoords` →
`getSelectionBorders`, `chunk-4FTI6OG3.js:23263`). Dragging the middle of a
block's left or right edge is therefore already a gesture people reach for. It
simply does the wrong thing today.

Top and bottom edges scale rather than doing nothing. Height never re-wraps
text — a text block's height is whatever the wrapped text comes out to — but
*undoing* an n/s drag on release would mean the text visibly grows under the
cursor and then snaps back, which reads as a bug. Scaling is the honest answer
and matches what a plain text element does.

Plain, non-rich text elements are **out of scope**. Excalidraw already re-wraps
them on an e/w drag without touching the font (`resizeSingleTextElement`, the
`e`/`w` branch, `chunk-4FTI6OG3.js:23614`); after this change a rich block
behaves the same way, which is the point.

## Two halves, deliberately different

The two halves of the gesture have very different costs, and only one of them
needs us to be in the drag at all.

### Re-wrap: we own the drag

Excalidraw cannot be asked to re-wrap a group, so an edge drag has to be ours
from the start. A new `useRichTextResize` hook adds a capture-phase
`pointerdown` listener on the same container element the double-click handler
already claims events on (`useRichTextEditing.js:179`):

1. If a rich text edit is already open, ignore.
2. If shift is held, ignore — that is the scale gesture.
3. If the selection is not exactly one rich block, ignore.
4. Compute the block's bounds with the exported `getCommonBounds`, convert the
   pointer with the exported `viewportCoordsToSceneCoords`, and test it against
   the left and right edge bands — the same 4px ÷ zoom threshold Excalidraw
   uses, on the same edge segments. Miss → ignore.
5. Otherwise claim it (`preventDefault` + `stopPropagation`, so Excalidraw's own
   pointer handling never starts a resize) and run the drag ourselves.

During the drag, each `pointermove` re-lays the block out at the width the
pointer implies and writes it back with `CaptureUpdateAction.NEVER`; `pointerup`
commits the final layout with `CaptureUpdateAction.IMMEDIATELY`, so the whole
drag is one undo step. The user sees the text re-wrap live under the cursor,
which is the whole product argument for owning the drag rather than correcting
its result afterwards.

- **`e`**: the origin stays put, `maxWidth` follows the pointer.
- **`w`**: the *right* edge stays put — the origin moves left as the width grows.
- **Minimum width**: `fontSize * 4`, the same floor `baseForPlain` already uses
  for a converted text element (`useRichTextEditing.js:54`). Narrower than that
  and a paragraph turns into a column of single characters.
- **Escape** during the drag restores the block as it was and cancels.

### Scale: nobody owns the drag

A corner, an n/s edge, or any shift-drag is left entirely to Excalidraw. It
already does the right thing visually — for a text element in a group it
recomputes `fontSize` from the new width (`measureFontSizeFromWidth`,
`chunk-4FTI6OG3.js:24344`) — and the result is only wrong later, when the block
is reopened: the model still carries the `fontSize` and `maxWidth` it was
created with, so the edit is laid out at the old size and the block snaps back.
That is the same class of bug as the stale origin fixed in `1a5d0cd`, and it
gets the same kind of fix: **read the truth back from the elements instead of
tracking the gesture.**

`toElements` already stamps each element with its offset from the origin. It
gains one more number — the width the element was generated at:

```js
customData.richTextOffset = { dx, dy, w }
```

From any surviving element, `readTransform(elements)` then returns both the
scale and the origin:

```
scale  = el.width / off.w                 // 1 if the block was never scaled
origin = { x: el.x - off.dx * scale,
           y: el.y - off.dy * scale }
```

and opening a block applies that scale to the base it lays out from:
`fontSize * scale`, `maxWidth * scale`. No pointer tracking, no gesture
detection, and it self-heals for a block scaled by any route at all — including
one scaled in a different app window, or by hand in the file.

This also **replaces `readOrigin`**, which is wrong for a scaled block today: it
reads `el.x - off.dx` with an unscaled `dx`, so a block that was scaled and then
moved reopens in the wrong place. `readOrigin` is two weeks old and has one
caller; it becomes `readTransform` rather than gaining a sibling.

Only text elements are read for the scale: they always have a positive width,
where an underline is a `line` whose width can be 0 for an empty fragment.

## Files

| file | change |
| --- | --- |
| `src/lib/richtext/elements.js` | `richTextOffset` gains `w`; `readOrigin` → `readTransform` returning `{ x, y, scale }` |
| `src/lib/richtext/useRichTextResize.js` | new — the edge-drag hook: hit test, live re-layout, commit/cancel |
| `src/lib/richtext/useRichTextEditing.js` | open a block from `readTransform`, scaling `fontSize`/`maxWidth` |
| `src/App.jsx` | mount the new hook beside the editing one |
| `dev/app-harness.jsx` | mount it in the harness so a browser can drive it |
| `dev/app-harness.js`, `dev/e2e-app.sh` | helpers + the E2E cases below |
| `src/lib/richtext/elements.test.js` | unit tests for `readTransform` |
| `README.md`, `CLAUDE.md` | the new gesture; the rules that came out of this |

`layout.js`, `model.js` and `RichTextOverlay.jsx` are untouched: the width a
block wraps to is a property of the base, and laying out at a different one is
what `layout()` already does.

## Testing

**Unit** (`node --test`, no browser):

- `readTransform` returns `scale: 1` and the true origin for an untouched block.
- For a block whose elements were scaled by 1.5 about an arbitrary anchor and
  then translated, it returns `scale: 1.5` and the correct origin — the case
  `readOrigin` gets wrong today.
- It returns `null` for elements that predate the stamp, and callers fall back
  to the stored base.
- Laying the same doc out at half the width produces more lines and identical
  font size — the property the gesture exists to deliver.

**E2E** (`dev/e2e-app.sh`, real Excalidraw in a real browser). Every case below
except the shift-drag one fails before the change; the shift-drag case is there
to pin behaviour we are deliberately *not* changing:

- Dragging the right edge of a selected block re-wraps it: more lines than
  before, `fontSize` identical, origin unmoved.
- Dragging the left edge re-wraps and leaves the block's *right* edge where it
  was.
- Dragging past the minimum stops at `fontSize * 4` instead of collapsing.
- A shift-drag on an edge still scales: `fontSize` changes, and the drag is not
  claimed by us.
- Undo after an edge drag restores the previous wrap in one step.
- Scaling a block and then editing it keeps the scaled size — the reopened
  overlay's font size matches the scaled elements, and committing does not snap
  the block back.
- A block that was scaled *and* moved reopens at the right place.

Excalidraw's own resize cannot be driven from the headless harness (its shortcut
and pointer paths need canvas focus the harness never gets, and
`Input.dispatchMouseEvent` is not on the browse CDP allowlist), so the scale
cases apply the scale through `updateScene` the way `resizeMultipleElements`
would — the same technique `__duplicateSelection` already uses for copies, and
noted as such in the harness.

## Risks

- **The edge hit test drifting from Excalidraw's.** Ours must agree with the one
  that draws the cursor, or the affordance and the behaviour part company. It is
  four numbers (`SIDE_RESIZING_THRESHOLD`, the bounds, the edge segments, zoom)
  and they are pinned by the E2E cases; if a future Excalidraw changes them, the
  drag stops being claimed and the old scaling behaviour returns — degraded, not
  broken.
- **Live re-layout cost.** Each `pointermove` re-measures the block through
  `canvasMeasure`. A paragraph is a few hundred `measureText` calls on a cached
  canvas context; if a very large block stutters, the fix is to coalesce moves
  with `requestAnimationFrame`, not to abandon live feedback.
- **Scale read from a single element.** A user who ungroups a block and resizes
  one fragment by hand would give a wrong scale. Ungrouping already breaks a
  block in more fundamental ways (the group id is its identity); this does not
  make it worse.
