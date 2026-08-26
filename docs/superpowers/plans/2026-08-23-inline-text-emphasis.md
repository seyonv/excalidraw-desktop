# Inline Text Emphasis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a single Excalidraw text block carry different styles per phrase — colour, highlight, underline, box, and breakout — applied in one keystroke instead of eight manual steps.

**Architecture:** A rich-text layer owned entirely by this app. `customData.richText` on the generated elements is the source of truth; a pure model → layout → elements pipeline regenerates ordinary Excalidraw elements from it, so files stay portable. Editing happens in a fully controlled `contenteditable` overlay positioned over the canvas — the same technique Excalidraw uses for its own text editor. Excalidraw is never forked or patched.

**Tech Stack:** React 18, `@excalidraw/excalidraw` 0.18 (unmodified npm package), Vite, `node:test` for unit tests, gstack `browse` for headless interaction tests. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-23-inline-text-emphasis-design.md`

**Reference implementation:** `docs/prototypes/inline-emphasis/prototype.html` contains a working, tested version of the model and every interaction. Its `RT` module is the model this plan ports. Read it before Task 1. `model-test.mjs` (30 tests) and `e2e.sh` (28 tests) both pass against it today.

## Global Constraints

- **No fork, no patching.** `@excalidraw/excalidraw` is consumed as published. Never edit `public/` — it is a vendored copy of the same bundle.
- **`src/lib/drawings.js` stays the only `invoke()` caller.** This feature never touches Rust.
- **`Sidebar.jsx` is untouched.** New UI components are presentational and raise events, the same way it does.
- **Never bump `sceneKey`.** Committing an edit must not remount Excalidraw and discard scroll/zoom.
- **Files stay plain `.excalidraw`.** Formatting is carried by real elements plus `customData`; other viewers must see correct pixels.
- **No bold, no italic, no per-run font size.** Every canvas font ships Regular only; elements have `angle` (rotation), not shear. Out of scope — do not add them.
- **`Esc` is never bound to formatting.** Excalidraw uses it to exit the text editor. Strip-formatting is `⌘\`.
- **A run's style keys are absent when off, never `false`.**
- **Revert `public/` churn before every commit:** `git checkout -- public/` (the formatter hook rewrites vendored assets on every edit).
- **README updates in the same commit as user-facing behaviour** (CLAUDE.md rule).
- Colours: blue `#1971c2`, red `#e03131`, green `#2f9e44`, orange `#f08c00`. Highlight fill `#ffec99`. Default ink `#1e1e1e`.

---

### Task 1: The model

Pure run/block operations. No DOM, no Excalidraw imports — this file must be importable by `node --test`.

**Files:**
- Create: `src/lib/richtext/model.js`
- Create: `src/lib/richtext/model.test.js`
- Modify: `package.json` (add the `test:richtext` script)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `fromText(text) -> doc`
  - `docText(doc) -> string`
  - `blockSpans(doc) -> [{ index, block, start, end }]`
  - `insertText(doc, at, text, style?) -> doc`
  - `deleteRange(doc, start, end) -> doc`
  - `applyStyle(doc, start, end, act, on) -> doc`
  - `isApplied(doc, start, end, act) -> boolean`
  - `runsInRange(doc, start, end) -> run[]`
  - `breakout(doc, start, end) -> doc`
  - `styleAt(doc, offset) -> style`
  - `styleKey(run) -> string`
  - `COLOURS`, `MARKS` constants
  - A doc is `[{ type: "paragraph"|"breakout", runs: [{ text, color?, highlight?, underline?, box? }] }]`. Offsets run over all run text with **one implicit separator character between adjacent blocks**.

- [x] **Step 1: Port the model out of the prototype**

Open `docs/prototypes/inline-emphasis/prototype.html`, find the `const RT = (() => {` block (marked `MODEL — pure functions, no DOM`), and copy it into `src/lib/richtext/model.js` as ES module exports. Convert the IIFE's returned object into named `export`s; the function bodies transfer unchanged. Keep every comment.

`act` is one of `"c-blue" | "c-red" | "c-green" | "c-orange" | "hl" | "ul" | "box" | "plain"` — a literal union, no enums.

- [x] **Step 2: Port the tests**

Copy `docs/prototypes/inline-emphasis/model-test.mjs` to `src/lib/richtext/model.test.js` and change the harness: delete the `readFileSync` + `eval` extraction and replace it with a direct import, and swap the hand-rolled `t()` helper for `node:test`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import * as RT from "./model.js";
```

Each existing `t("name", () => ...)` becomes `test("name", () => ...)`. Keep all 30 cases, including the 400-iteration fuzz — its three invariants are the point:
- text length changes only by exactly what the operation should change
- every block has at least one run
- no two adjacent runs share a `styleKey`

- [x] **Step 3: Add the test script**

In `package.json`, alongside `test:mcp`:

```json
"test:richtext": "node --test 'src/lib/richtext/*.test.js'"
```

- [x] **Step 4: Run the tests**

Run: `npm run test:richtext`
Expected: 30 passing, 0 failing.

- [x] **Step 5: Commit**

```bash
git checkout -- public/
git add src/lib/richtext/model.js src/lib/richtext/model.test.js package.json
git commit -m "Add rich text model with run/block operations"
```

---

### Task 2: Text measurement

Isolates everything that needs a browser or the Excalidraw package, so layout can stay pure.

**Files:**
- Create: `src/lib/richtext/measure.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `fontString(fontSize, fontFamily) -> string`
  - `canvasMeasure(fontSize, fontFamily) -> (text) => number` — a measure function bound to a font
  - `fontsReady() -> Promise<void>`

- [x] **Step 1: Write the module**

```js
import { FONT_FAMILY } from "@excalidraw/excalidraw";

// FONT_FAMILY maps name -> numeric id. Elements store the id, canvas needs the
// name, so invert it rather than hardcoding ids that the bundle minifies away.
const NAME_BY_ID = Object.fromEntries(
  Object.entries(FONT_FAMILY).map(([name, id]) => [id, name]),
);

const FALLBACK = "Segoe UI Emoji";

export function fontString(fontSize, fontFamily) {
  return `${fontSize}px ${NAME_BY_ID[fontFamily] ?? "Excalifont"}, ${FALLBACK}`;
}

let ctx = null;

/** Returns a width function bound to one font. Excalidraw measures the same way,
 *  so our line breaks agree with the ones it would have chosen. */
export function canvasMeasure(fontSize, fontFamily) {
  ctx ||= document.createElement("canvas").getContext("2d");
  const font = fontString(fontSize, fontFamily);
  return (text) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
}

/** Measuring before the web font loads yields fallback metrics and every line
 *  break is wrong. Always await this before the first layout. */
export function fontsReady() {
  return document.fonts ? document.fonts.ready : Promise.resolve();
}
```

- [x] **Step 2: Verify it loads in the app**

Run: `npm run tauri dev`, and in the devtools console:

```js
(await import("/src/lib/richtext/measure.js")).fontString(20, 5)
```

Expected: a string of the form `"20px <FamilyName>, Segoe UI Emoji"`. Any family name is fine — the point is that the id → name inversion resolved rather than falling through to the default.

- [x] **Step 3: Commit**

```bash
git checkout -- public/
git add src/lib/richtext/measure.js
git commit -m "Add canvas text measurement bound to Excalidraw font families"
```

---

### Task 3: Layout

Turns a model plus a width into positioned line fragments. Takes its measure function as a parameter, so it never imports `measure.js` and stays node-testable.

**Files:**
- Create: `src/lib/richtext/layout.js`
- Create: `src/lib/richtext/layout.test.js`

**Interfaces:**
- Consumes: `model.js` (`blockSpans`).
- Produces: `layout(doc, opts) -> { lines, width, height }` where
  `opts = { measure, maxWidth, fontSize, lineHeight, boxPadding }` and
  `lines = [{ y, height, type, indent, fragments: [{ run, text, x, width }] }]`.

- [x] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { layout } from "./layout.js";
import { fromText, applyStyle } from "./model.js";

// 10px per character makes every expectation arithmetic instead of guesswork.
const measure = (text) => text.length * 10;
const opts = { measure, maxWidth: 100, fontSize: 20, lineHeight: 1.25, boxPadding: 6 };

test("wraps on whitespace at the max width", () => {
  const { lines } = layout(fromText("aaa bbb ccc ddd"), opts);
  assert.deepEqual(lines.map((l) => l.fragments.map((f) => f.text).join("")),
    ["aaa bbb ", "ccc ddd"]);
});

test("splits a line into one fragment per run", () => {
  const doc = applyStyle(fromText("aaa bbb"), 4, 7, "c-blue", true);
  const { lines } = layout(doc, { ...opts, maxWidth: 200 });
  assert.deepEqual(lines[0].fragments.map((f) => [f.text, f.run.color ?? null]),
    [["aaa ", null], ["bbb", "#1971c2"]]);
});

test("positions fragments left to right", () => {
  const doc = applyStyle(fromText("aaa bbb"), 4, 7, "c-blue", true);
  const { lines } = layout(doc, { ...opts, maxWidth: 200 });
  assert.deepEqual(lines[0].fragments.map((f) => f.x), [0, 40]);
});

test("a boxed run moves to the next line rather than breaking", () => {
  // "aaa " is 40 wide; the boxed "bbbbbb" is 60 + 12 padding = 72, so it cannot
  // share the 100-wide line and must move down whole.
  const doc = applyStyle(fromText("aaa bbbbbb"), 4, 10, "box", true);
  const { lines } = layout(doc, opts);
  assert.equal(lines.length, 2);
  assert.equal(lines[1].fragments.length, 1);
  assert.equal(lines[1].fragments[0].text, "bbbbbb");
});

test("a boxed run wider than a line falls back to breaking", () => {
  const doc = applyStyle(fromText("aaaaaaaaaaaaaaa"), 0, 15, "box", true);
  const { lines } = layout(doc, opts);
  assert.ok(lines.length > 1, "an over-wide boxed run must still wrap");
});

test("a breakout block gets its own lines and an indent", () => {
  const doc = [
    { type: "paragraph", runs: [{ text: "aaa" }] },
    { type: "breakout", runs: [{ text: "bbb" }] },
    { type: "paragraph", runs: [{ text: "ccc" }] },
  ];
  const { lines } = layout(doc, opts);
  assert.deepEqual(lines.map((l) => l.type), ["paragraph", "breakout", "paragraph"]);
  assert.ok(lines[1].indent > 0);
  assert.ok(lines[2].y > lines[1].y);
});

test("reports total height as the last line's bottom", () => {
  const { lines, height } = layout(fromText("aaa bbb ccc ddd"), opts);
  const last = lines[lines.length - 1];
  assert.equal(height, last.y + last.height);
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npm run test:richtext`
Expected: FAIL — `Cannot find module './layout.js'`.

- [x] **Step 3: Implement layout**

```js
import { blockSpans } from "./model.js";

const BREAKOUT_INDENT = 30;
const BREAKOUT_GAP = 0.5;   // extra blank line above and below, in line heights

/** Splits a run into word-sized pieces, keeping the trailing space with its word
 *  so a line break never loses a character. */
function words(text) {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

export function layout(doc, opts) {
  const { measure, maxWidth, fontSize, lineHeight, boxPadding = 0 } = opts;
  const lineHeightPx = fontSize * lineHeight;

  const lines = [];
  let y = 0;

  for (const { block } of blockSpans(doc)) {
    const indent = block.type === "breakout" ? BREAKOUT_INDENT : 0;
    const available = maxWidth - indent;
    if (block.type === "breakout") y += lineHeightPx * BREAKOUT_GAP;

    let fragments = [];
    let x = 0;

    const flush = () => {
      lines.push({ y, height: lineHeightPx, type: block.type, indent, fragments });
      y += lineHeightPx;
      fragments = [];
      x = 0;
    };

    for (const run of block.runs) {
      // A box implies one enclosed thing, so a boxed run is placed whole unless
      // it cannot possibly fit on a line of its own.
      if (run.box) {
        const width = measure(run.text) + boxPadding * 2;
        if (width <= available) {
          if (x + width > available && fragments.length) flush();
          fragments.push({ run, text: run.text, x, width });
          x += width;
          continue;
        }
        // Wider than a whole line: fall through and break it like normal text.
      }

      for (const word of words(run.text)) {
        const width = measure(word);
        if (x + width > available && fragments.length) flush();
        const last = fragments[fragments.length - 1];
        if (last && last.run === run) {
          last.text += word;
          last.width += width;
        } else {
          fragments.push({ run, text: word, x, width });
        }
        x += width;
      }
    }

    if (fragments.length) flush();
    else { lines.push({ y, height: lineHeightPx, type: block.type, indent, fragments: [] }); y += lineHeightPx; }

    if (block.type === "breakout") y += lineHeightPx * BREAKOUT_GAP;
  }

  const last = lines[lines.length - 1];
  return { lines, width: maxWidth, height: last ? last.y + last.height : 0 };
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npm run test:richtext`
Expected: all layout tests pass alongside the 30 model tests.

- [x] **Step 5: Commit**

```bash
git checkout -- public/
git add src/lib/richtext/layout.js src/lib/richtext/layout.test.js
git commit -m "Add rich text layout with boxed-run and breakout rules"
```

---

### Task 4: Element generation

The only file that knows what an `.excalidraw` element looks like.

**Files:**
- Create: `src/lib/richtext/elements.js`
- Create: `src/lib/richtext/elements.test.js`

**Interfaces:**
- Consumes: `layout.js` output.
- Produces:
  - `toElements(doc, laidOut, base) -> element[]` where `base = { x, y, id, fontSize, fontFamily, lineHeight, strokeColor, groupId, maxWidth }`. `toElements` ignores `maxWidth`; it travels on `base` because Task 7 needs it to lay out and to size the overlay, and one object beats two.
  - `readModel(elements) -> { id, blocks } | null`
  - `isRichText(element) -> boolean`

- [x] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { toElements, readModel, isRichText } from "./elements.js";
import { layout } from "./layout.js";
import { fromText, applyStyle } from "./model.js";

const measure = (text) => text.length * 10;
const opts = { measure, maxWidth: 500, fontSize: 20, lineHeight: 1.25, boxPadding: 6 };
const base = { x: 100, y: 50, id: "rt1", fontSize: 20, fontFamily: 5,
               lineHeight: 1.25, strokeColor: "#1e1e1e", groupId: "g1" };

const build = (doc) => toElements(doc, layout(doc, opts), base);

test("emits one text element per fragment", () => {
  const els = build(applyStyle(fromText("aaa bbb"), 4, 7, "c-blue", true));
  const texts = els.filter((e) => e.type === "text");
  assert.deepEqual(texts.map((t) => t.text), ["aaa ", "bbb"]);
});

test("carries the run colour onto the text element", () => {
  const els = build(applyStyle(fromText("aaa bbb"), 4, 7, "c-blue", true));
  const blue = els.find((e) => e.type === "text" && e.text === "bbb");
  assert.equal(blue.strokeColor, "#1971c2");
});

test("positions elements relative to the base origin", () => {
  const els = build(fromText("aaa"));
  const text = els.find((e) => e.type === "text");
  assert.equal(text.x, 100);
  assert.equal(text.y, 50);
});

test("a highlighted run gets a filled rectangle behind the text", () => {
  const els = build(applyStyle(fromText("aaa"), 0, 3, "hl", true));
  const rect = els.find((e) => e.type === "rectangle");
  const textIndex = els.findIndex((e) => e.type === "text");
  assert.equal(rect.backgroundColor, "#ffec99");
  assert.equal(rect.strokeColor, "transparent");
  assert.ok(els.indexOf(rect) < textIndex, "highlight must render behind the text");
});

test("a boxed run gets a stroked rectangle with no fill", () => {
  const els = build(applyStyle(fromText("aaa"), 0, 3, "box", true));
  const rect = els.find((e) => e.type === "rectangle" && e.backgroundColor === "transparent");
  assert.equal(rect.strokeColor, "#1e1e1e");
});

test("an underlined run gets a line element", () => {
  const els = build(applyStyle(fromText("aaa"), 0, 3, "ul", true));
  assert.ok(els.some((e) => e.type === "line"));
});

test("every element shares the group and carries the model", () => {
  const doc = applyStyle(fromText("aaa bbb"), 4, 7, "c-blue", true);
  const els = build(doc);
  assert.ok(els.every((e) => e.groupIds.includes("g1")));
  assert.ok(els.every((e) => e.customData.richTextId === "rt1"));
  assert.deepEqual(readModel(els).blocks, doc);
});

test("readModel returns null for ordinary elements", () => {
  assert.equal(readModel([{ type: "text", text: "plain", customData: undefined }]), null);
  assert.equal(isRichText({ type: "text" }), false);
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npm run test:richtext`
Expected: FAIL — `Cannot find module './elements.js'`.

- [x] **Step 3: Implement element generation**

```js
const HIGHLIGHT_FILL = "#ffec99";
const BOX_PADDING = 6;
const HIGHLIGHT_BLEED = 2;

let seq = 0;
const nextId = (prefix) => `${prefix}-${Date.now().toString(36)}-${seq++}`;

/** Fields every Excalidraw element needs. Kept in one place so the four element
 *  builders below stay readable. */
function common(overrides) {
  return {
    id: nextId("rt"),
    angle: 0,
    strokeWidth: 1,
    strokeStyle: "solid",
    fillStyle: "solid",
    roughness: 0,
    opacity: 100,
    seed: Math.floor(Math.random() * 2 ** 31),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    index: null,
    isDeleted: false,
    frameId: null,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    roundness: null,
    ...overrides,
  };
}

export function toElements(doc, laidOut, base) {
  const { x: originX, y: originY, id, fontSize, fontFamily, lineHeight, strokeColor, groupId } = base;
  const meta = { richTextId: id, richText: { id, blocks: doc } };
  const behind = [];
  const front = [];

  for (const line of laidOut.lines) {
    for (const frag of line.fragments) {
      const x = originX + line.indent + frag.x;
      const y = originY + line.y;
      const boxed = Boolean(frag.run.box);
      const textX = boxed ? x + BOX_PADDING : x;
      const textWidth = boxed ? frag.width - BOX_PADDING * 2 : frag.width;

      if (frag.run.highlight) {
        behind.push(common({
          type: "rectangle",
          x: textX - HIGHLIGHT_BLEED, y: y - HIGHLIGHT_BLEED,
          width: textWidth + HIGHLIGHT_BLEED * 2, height: line.height + HIGHLIGHT_BLEED,
          strokeColor: "transparent", backgroundColor: HIGHLIGHT_FILL,
          groupIds: [groupId], customData: meta,
        }));
      }

      front.push(common({
        type: "text",
        x: textX, y,
        width: textWidth, height: line.height,
        strokeColor: frag.run.color ?? strokeColor,
        backgroundColor: "transparent",
        text: frag.text, originalText: frag.text,
        fontSize, fontFamily, lineHeight,
        textAlign: "left", verticalAlign: "top",
        containerId: null, autoResize: true,
        groupIds: [groupId], customData: meta,
      }));

      if (frag.run.underline) {
        const uy = y + line.height - 2;
        front.push(common({
          type: "line",
          x: textX, y: uy, width: textWidth, height: 0,
          points: [[0, 0], [textWidth, 0]],
          strokeColor: frag.run.color ?? strokeColor,
          backgroundColor: "transparent",
          groupIds: [groupId], customData: meta,
        }));
      }

      if (boxed) {
        front.push(common({
          type: "rectangle",
          x, y: y - 2, width: frag.width, height: line.height + 4,
          strokeColor: frag.run.color ?? strokeColor,
          backgroundColor: "transparent",
          roundness: { type: 3 },
          groupIds: [groupId], customData: meta,
        }));
      }
    }
  }

  return [...behind, ...front];
}

export const isRichText = (element) => Boolean(element?.customData?.richTextId);

/** The model is stored identically on every generated element, so any survivor
 *  can rebuild the block. Returns the first one found. */
export function readModel(elements) {
  for (const el of elements) {
    if (el?.customData?.richText?.blocks) return el.customData.richText;
  }
  return null;
}
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npm run test:richtext`
Expected: all element tests pass.

- [x] **Step 5: Commit**

```bash
git checkout -- public/
git add src/lib/richtext/elements.js src/lib/richtext/elements.test.js
git commit -m "Generate Excalidraw elements from a laid-out rich text model"
```

---

### Task 5: The emphasis bubble

Presentational only. It renders buttons and raises `onAction`; it never touches the model or the scene.

**Files:**
- Create: `src/components/EmphasisBubble.jsx`
- Create: `src/components/EmphasisBubble.css`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `<EmphasisBubble rect={{left,top,width}} active={string[]} dirty={boolean} onAction={(act) => void} />`

- [x] **Step 1: Write the component**

`rect` is the selection rectangle in canvas-container coordinates. `active` is the list of acts already applied across the whole selection; `dirty` is whether anything is applied at all.

```jsx
import "./EmphasisBubble.css";

const COLOURS = [
  { act: "c-blue", hex: "#1971c2", key: "⌘B", label: "Blue" },
  { act: "c-red", hex: "#e03131", key: "⌘1", label: "Red" },
  { act: "c-green", hex: "#2f9e44", key: "⌘2", label: "Green" },
  { act: "c-orange", hex: "#f08c00", key: "⌘3", label: "Orange" },
];

const MARKS = [
  { act: "hl", glyph: "▮", key: "⌘H", label: "Highlight" },
  { act: "ul", glyph: "U̲", key: "⌘U", label: "Underline" },
  { act: "box", glyph: "▭", key: "⌘E", label: "Box" },
  { act: "breakout", glyph: "⏎", key: "⌘⇧B", label: "Break out" },
];

export default function EmphasisBubble({ rect, active, dirty, onAction }) {
  if (!rect) return null;

  // mousedown + preventDefault, never onClick: clicking must not collapse the
  // selection the action is about to operate on.
  const press = (act) => (event) => {
    event.preventDefault();
    onAction(act);
  };

  const button = (act, label, key, children) => (
    <button
      key={act}
      type="button"
      title={`${label} (${key})`}
      className={active.includes(act) ? "active" : ""}
      onMouseDown={press(act)}
    >
      {children}
      <span className="key">{key}</span>
    </button>
  );

  return (
    <div
      className="emphasis-bubble"
      style={{ left: rect.left + rect.width / 2, top: rect.top }}
      role="toolbar"
      aria-label="Text emphasis"
    >
      <button type="button" title="Back to plain (⌘\)" disabled={!dirty} onMouseDown={press("plain")}>
        <i className="dot plain" />
        <span className="key">⌘\</span>
      </button>
      <span className="sep" />
      {COLOURS.map((c) => button(c.act, c.label, c.key, <i className="dot" style={{ background: c.hex }} />))}
      <span className="sep" />
      {MARKS.map((m) => button(m.act, m.label, m.key, <span>{m.glyph}</span>))}
    </div>
  );
}
```

- [x] **Step 2: Write the stylesheet**

```css
.emphasis-bubble {
  position: absolute;
  transform: translate(-50%, calc(-100% - 9px));
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 5px;
  border-radius: 9px;
  background: #2b2926;
  color: #fff;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.22);
  z-index: 20;
}
.emphasis-bubble button {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.emphasis-bubble button:hover { background: #ffffff22; }
.emphasis-bubble button.active { background: #ffffff2e; box-shadow: inset 0 0 0 1.5px #ffffff88; }
.emphasis-bubble button.active .key::after { content: " · off"; }
.emphasis-bubble button[disabled] { opacity: 0.28; cursor: default; }
.emphasis-bubble .key { font-size: 9px; opacity: 0.55; }
.emphasis-bubble .sep { width: 1px; height: 18px; background: #ffffff26; margin: 0 3px; }
.emphasis-bubble .dot { width: 13px; height: 13px; border-radius: 50%; display: inline-block; }
.emphasis-bubble .dot.plain { background: #1e1e1e; box-shadow: inset 0 0 0 1px #ffffff55; }
```

- [x] **Step 3: Commit**

```bash
git checkout -- public/
git add src/components/EmphasisBubble.jsx src/components/EmphasisBubble.css
git commit -m "Add emphasis bubble toolbar"
```

---

### Task 6: The editing overlay

A fully controlled `contenteditable`. Port the `editor()` IIFE from the prototype — it is already correct and browser-tested.

**Files:**
- Create: `src/components/RichTextOverlay.jsx`
- Create: `src/components/RichTextOverlay.css`

**Interfaces:**
- Consumes: `model.js`.
- Produces: `<RichTextOverlay doc={doc} style={{left,top,fontSize,fontFamily,lineHeight,maxWidth,zoom}} onCommit={(doc) => void} onCancel={() => void} />`

- [x] **Step 1: Port the controlled editor**

From `docs/prototypes/inline-emphasis/prototype.html`, the `editor()` IIFE. Port these pieces unchanged in behaviour, into a component whose `doc` lives in `useState` and whose DOM is rendered from it:

- `render()` — model → spans, each `[data-block]` / `[data-run]`
- `offsetToDom` / `domToOffset` / `readSelection` / `writeSelection`
- the `beforeinput` handler covering `insertText`, `insertParagraph`, `insertLineBreak`, `insertFromPaste`, `deleteContentBackward`, `deleteContentForward`, `deleteByCut`, `deleteWordBackward`, `deleteWordForward`, with `default: e.preventDefault()`
- `wordBoundary`, the markdown `TRIGGERS`, sticky mode, and the keyboard map

**These invariants are load-bearing — do not simplify them:**

- **Every `beforeinput` is prevented and applied to the model.** `contenteditable` must never invent DOM structure. Prototype v2 read the model back out of whatever the browser produced; Enter made `<div>`s the reader did not model, and the next keystroke destroyed characters around the line break.
- **The `default` branch prevents anything unmodelled**, so an unhandled input type is inert rather than silently corrupting.
- **`Esc` passes through unless sticky mode is on.** Excalidraw needs it to exit the editor.
- **`⌘\` strips formatting.**

Wire the emphasis actions through one `apply(act)` that reads the selection, and — when the selection is collapsed — toggles sticky mode instead.

- [x] **Step 2: Style the overlay to match the canvas**

```css
.richtext-overlay {
  position: absolute;
  outline: none;
  white-space: pre-wrap;
  transform-origin: top left;
  z-index: 15;
}
.richtext-overlay .blk { min-height: 1em; }
.richtext-overlay .breakout { margin: 0.7em 0; padding-left: 12px; border-left: 3px solid currentColor; }
.richtext-overlay .hl { background: #ffec99; box-decoration-break: clone; padding: 1px 3px; border-radius: 2px; }
.richtext-overlay .ul { border-bottom: 2px solid currentColor; }
.richtext-overlay .box {
  border: 1.5px solid currentColor; border-radius: 4px; padding: 1px 5px;
  white-space: nowrap; box-decoration-break: clone;
}
.richtext-overlay .box.too-wide { white-space: pre-wrap; padding-left: 0; padding-right: 0; }
```

Apply the caller's font via inline style, and `transform: scale(zoom)` so the overlay tracks Excalidraw's zoom. Set `left`/`top` from `sceneCoordsToViewportCoords`.

- [ ] **Step 3: Verify by hand**

Run `npm run tauri dev`, mount the overlay temporarily on load with a hardcoded doc, then check every row of this table:

| Check | Expected |
| --- | --- |
| Type in the middle of a word | Character lands at the caret |
| Enter, then Backspace | Line break added, then removed, no other characters change |
| Select across a line break, press `⌘B` | Every character survives; both lines colour |
| Select across a line break, press Backspace | Only the selection is deleted |
| Type `==hi==` | Delimiters vanish, `hi` is highlighted |
| `⌘B` with nothing selected, then type | Typed text is blue, chip visible near the caret |
| `Esc` with sticky on | Chip clears, text stays |
| `⌘\` on a styled selection | Everything strips to plain |

- [x] **Step 4: Commit**

```bash
git checkout -- public/
git add src/components/RichTextOverlay.jsx src/components/RichTextOverlay.css
git commit -m "Add controlled contenteditable overlay for rich text editing"
```

---

### Task 7: Wire it into the app

**Files:**
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: everything above.
- Produces: no exports — this is the integration point.

- [ ] **Step 1: Open the overlay on demand**

Add `const [editing, setEditing] = useState(null)` holding `{ doc, base, elementIds }`.

Open it when either happens:
- **Double-click a rich text group.** Subscribe with `apiRef.current.onPointerDown`, detect a double click on an element where `isRichText(element)`, gather every element sharing its `customData.richTextId`, and `readModel` them.
- **A plain text element is selected and an emphasis shortcut is pressed.** Convert with `fromText(element.originalText ?? element.text)`.

Compute `base` from the source element: `x`, `y`, `fontSize`, `fontFamily`, `lineHeight`, `strokeColor`, a fresh `groupId` and rich text `id`. Screen position comes from `sceneCoordsToViewportCoords`.

- [ ] **Step 2: Hide the underlying elements while editing**

```js
api.updateScene({
  elements: api.getSceneElements().filter((el) => !elementIds.includes(el.id)),
  captureUpdate: CaptureUpdateAction.NEVER,
});
```

`NEVER` keeps this transient removal out of undo history, so the edit is one undo step rather than two.

- [ ] **Step 3: Commit the edit back to the scene**

```js
const commit = useCallback(async (doc) => {
  const { base, elementIds } = editing;
  await fontsReady();
  const measure = canvasMeasure(base.fontSize, base.fontFamily);
  const laidOut = layout(doc, {
    measure,
    maxWidth: base.maxWidth,
    fontSize: base.fontSize,
    lineHeight: base.lineHeight,
    boxPadding: 6,
  });
  const api = apiRef.current;
  const rest = api.getSceneElements().filter((el) => !elementIds.includes(el.id));
  api.updateScene({
    elements: [...rest, ...toElements(doc, laidOut, base)],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  setEditing(null);
}, [editing]);
```

`IMMEDIATELY` makes the whole edit one undo step. **Do not touch `sceneKey`** — bumping it remounts Excalidraw and throws away scroll and zoom.

- [ ] **Step 4: Keep the overlay glued to the canvas**

Subscribe with `apiRef.current.onScrollChange` and recompute the overlay's
`left`/`top` from `sceneCoordsToViewportCoords` plus its `scale(zoom)` on every
change, so panning or zooming mid-edit does not leave the editor floating over
the wrong part of the canvas.

If that proves jittery, the acceptable fallback is to commit and close the
overlay on scroll or zoom — an edit that ends cleanly beats one that drifts.

- [ ] **Step 5: Verify the autosave path is unharmed**

Run `npm run tauri dev`. Edit a rich block, commit, wait for the autosave debounce (600ms), then confirm in the library directory that the `.excalidraw` file contains the new elements and that the app does **not** show the "changed on disk" notice. That notice appearing would mean the write was not recognised as our own echo — `lastWrittenRef` records before awaiting the write, and that ordering must stay.

- [ ] **Step 6: Commit**

```bash
git checkout -- public/
git add src/App.jsx
git commit -m "Wire rich text editing into the app"
```

---

### Task 8: Round-trip and interaction tests

**Files:**
- Create: `src/lib/richtext/roundtrip.test.js`
- Create: `docs/prototypes/inline-emphasis/e2e-app.sh` (adapted from `e2e.sh`)

- [ ] **Step 1: Write the round-trip test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { fromText, applyStyle, docText } from "./model.js";
import { layout } from "./layout.js";
import { toElements, readModel } from "./elements.js";

const measure = (text) => text.length * 10;
const base = { x: 0, y: 0, id: "rt1", fontSize: 20, fontFamily: 5,
               lineHeight: 1.25, strokeColor: "#1e1e1e", groupId: "g1" };

test("model survives a trip through elements and back", () => {
  let doc = fromText("The migration ran clean. Every write goes through the new path now.");
  doc = applyStyle(doc, 25, 60, "c-blue", true);
  doc = applyStyle(doc, 25, 60, "hl", true);
  const els = toElements(doc, layout(doc, { measure, maxWidth: 300, fontSize: 20, lineHeight: 1.25, boxPadding: 6 }), base);
  assert.deepEqual(readModel(els).blocks, doc);
});

test("no character is lost between model and rendered elements", () => {
  const doc = applyStyle(fromText("aaa bbb ccc ddd eee"), 4, 11, "box", true);
  const els = toElements(doc, layout(doc, { measure, maxWidth: 100, fontSize: 20, lineHeight: 1.25, boxPadding: 6 }), base);
  const rendered = els.filter((e) => e.type === "text").map((e) => e.text).join("");
  assert.equal(rendered, docText(doc));
});
```

- [ ] **Step 2: Run it**

Run: `npm run test:richtext`
Expected: PASS. If the second test fails, layout is dropping or duplicating text at a wrap point — fix `layout.js`, not the test.

- [ ] **Step 3: Adapt the browser suite to the real app**

Copy `docs/prototypes/inline-emphasis/e2e.sh` to `e2e-app.sh` and repoint it: `goto http://localhost:1420` (the Vite dev server) instead of the prototype URL, and replace `window.__select` / `window.__runs` with equivalents that drive the real overlay — select via the overlay's DOM, and read the model from the committed elements with `readModel`. Keep every assertion; they encode real bugs.

- [ ] **Step 4: Run both suites**

```bash
npm run test:richtext
cd src-tauri && cargo test && cd ..
npm run test:mcp
```

Expected: all green. `cargo test` and `test:mcp` must be unaffected — this feature touches neither.

- [ ] **Step 5: Commit**

```bash
git checkout -- public/
git add src/lib/richtext/roundtrip.test.js docs/prototypes/inline-emphasis/e2e-app.sh
git commit -m "Add round-trip and app-level interaction tests for rich text"
```

---

### Task 9: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the feature**

Add an "Inline emphasis" section: what it does, the shortcut table from the spec, the two forward-typing paths (sticky and markdown triggers), and a plain statement of the limits — no bold, no italic, one size per block, because Excalidraw's canvas fonts ship a single weight.

- [ ] **Step 2: Update the comparison table**

Add a row to "What this adds on top of Excalidraw": the web editor has one colour per text block; this has many, plus highlight, underline, box and breakout.

- [ ] **Step 3: Tick the roadmap**

If inline formatting appears on the Roadmap, move it into the features list.

- [ ] **Step 4: Commit**

```bash
git checkout -- public/
git add README.md
git commit -m "Document inline text emphasis"
```

---

## Verification

Before calling this done:

```bash
npm run test:richtext      # model, layout, elements, round-trip
npm run test:mcp           # unaffected
cd src-tauri && cargo test # unaffected
npm run build              # frontend compiles
npm run tauri dev          # real E2E pass
```

In the running app, reproduce the original complaint end to end: type a paragraph, select a phrase in the middle, press `⌘B`, and confirm it turns blue in place with no elements to group by hand. Then quit, reopen, and confirm the drawing reloads with the formatting intact — that proves `customData` survived the file round-trip, which is the whole basis of the design.
