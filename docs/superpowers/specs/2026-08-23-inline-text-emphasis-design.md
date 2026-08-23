# Inline text emphasis — design

**Date:** 2026-08-23
**Status:** approved design, pre-implementation
**Prototype:** `docs/prototypes/inline-emphasis/prototype.html` (working, tested)

## Goal

Let one text block hold more than one style. Today, colour is a property of the
whole text element, so emphasising a phrase mid-paragraph means: select the
text, cut it, paste it as a new text block, recolour it, position it between the
two halves, and group all three. Eight steps to make four words blue.

After this change it is one keystroke: select the phrase, press `⌘B`.

## Scope

**In:** colour, highlight, underline, box-around-a-range, and breakout (promote a
range to its own indented block). Applied by selection *or* while typing forward.

**Out, deliberately:**

- **Bold and italic.** Every Excalidraw canvas font ships Regular only —
  Excalifont, Virgil, Nunito, Comic Shanns, Cascadia, Lilita One (verified in
  `public/fonts/`). There is no `fontWeight` or `fontStyle` on a text element.
  Bold could be faked by double-striking, italic cannot be faked at all: faux
  italic needs a horizontal **shear**, and an element only has `angle`, a
  rotation. Emphasis is carried by colour, highlight, underline and box instead.
- **Per-run font size.** A taller run inside a line forces mixed line heights and
  baseline alignment — the single hardest part of text layout — for a gain that
  colour and highlight already deliver. One size per block.
- **Margin notes** (pulling a range into the gutter beside the block). Considered
  and cut: it is the only emphasis form that requires reflowing the remaining
  text around a hole. Breakout gives most of the benefit for a fraction of the
  cost because it only moves things **vertically**.

## Why not fork Excalidraw

The app renders the published `@excalidraw/excalidraw` npm package as a React
component (`src/App.jsx:2`). `public/` is a byte-for-byte vendored copy of that
same published bundle, not a build of our own — it is 502,071 bytes against the
package's 502,077, the difference being the formatter hook. **Nothing in this
repo is a fork today.**

Forking to add native run support would mean owning the most-churned files
upstream has (text editor, canvas renderer, SVG export, wrapping, bound text),
building the monorepo, vendoring the result, and rebasing forever. It buys
exactly one of our five features — per-run rendering. Boxing a range and
breaking one out are element composition; they need a layer above Excalidraw
either way.

So: **we own the content model and the editing surface; Excalidraw stays a
renderer.** The editing overlay is the same technique Excalidraw itself uses —
its editor is a `<textarea class="excalidraw-wysiwyg">` floated over the canvas
at the right position and zoom. We use a `contenteditable` in the same way.

## Architecture

```
src/lib/richtext/model.js      pure run/block operations — no DOM, no Excalidraw
src/lib/richtext/measure.js    canvas text measurement + font strings
src/lib/richtext/layout.js     model + width -> positioned line fragments
src/lib/richtext/elements.js   fragments -> Excalidraw elements (the only file
                               that knows what an .excalidraw element looks like)
src/components/RichTextOverlay.jsx  the contenteditable editing surface
src/components/EmphasisBubble.jsx   selection toolbar (presentational)
src/App.jsx                    mounts the overlay, commits via updateScene
```

The existing boundaries hold: `src/lib/drawings.js` remains the only `invoke()`
caller (this feature never touches Rust), `Sidebar.jsx` is untouched, and
`App.jsx` still owns scene state. `EmphasisBubble.jsx` raises events only, in
the same spirit as `Sidebar.jsx`.

The pipeline is one direction, and each stage is independently testable:

```
model (blocks/runs)  ──layout──▶  positioned fragments  ──elements──▶  scene
       ▲                                                                  │
       └──────────────── parsed back from customData ◀────────────────────┘
```

## Data model

```js
// blocks -> runs. Flat: runs never nest.
[
  { type: "paragraph", runs: [
      { text: "The migration ran clean. " },
      { text: "Every write goes through the new path", color: "#1971c2" },
      { text: " now." },
  ]},
  { type: "breakout", runs: [{ text: "Ship it.", highlight: true }] },
]
```

A run is `{ text, color?, highlight?, underline?, box? }`. Absent key means off —
never `false` — so `JSON.stringify` stays small and run comparison is trivial.

Offsets used by every operation run over the concatenation of all run text, with
**one implicit separator character between adjacent blocks**. This single rule is
what makes selections spanning a breakout behave.

### Where it is stored

Every generated element carries an identical copy in
`customData.richText = { id, blocks }`, plus `customData.richTextId = id`.

Redundant on purpose. The elements are grouped, so they are deleted, copied and
moved as a unit; any survivor can rebuild the whole block, and there is no
"anchor element" whose deletion silently destroys editability. The cost is the
model repeated per element — acceptable for annotation-sized text, and worth
revisiting only if drawings with very large rich blocks get slow to save.

Files stay plain `.excalidraw`. `customData` is a supported field that survives
`restore()`. Other viewers see ordinary text, highlight rectangles and boxes —
correct pixels, no editability. That was the explicit requirement.

## Layout

Inputs: blocks, `fontSize`, `fontFamily`, `lineHeight`, `maxWidth` (the original
element's width), `textAlign`. Output: for each line, a list of
`{ run, text, x, width }` plus the line's `y`.

- **Measurement** uses canvas `measureText` with Excalidraw's own font string
  (`${fontSize}px ${familyName}`). Excalidraw measures the same way, so the two
  agree. Wait on `document.fonts.ready` before the first layout — measuring
  Excalifont before it loads yields fallback metrics and everything is wrong by a
  few percent.
- **Wrapping** is greedy on whitespace across run boundaries, because a wrap
  point may fall inside a styled run.
- **A boxed run never breaks across lines.** A box implies one enclosed thing;
  fragmenting it reads as broken rather than emphasised. It moves to the next
  line whole. The one exception is a boxed range wider than a full line, which
  cannot stay intact — it falls back to per-line rectangles.
- **Reserve the box's stroke width when choosing the wrap point.** Discovered by
  rendering it: browsers do *not* account for an inline box's padding when
  wrapping, so a boxed run overshoots the line by exactly its padding. We own the
  line breaker, so we subtract the rectangle's stroke and padding from the
  available width for boxed runs. Miss this and boxes hang off the right edge.
- **Breakout blocks** get vertical padding above and below, a left indent, and a
  left rule (a line element). They never sit on the same line as anything else.

## Element generation

Per line fragment, in this z-order:

1. **Highlight** — a rectangle behind the fragment: `backgroundColor` set,
   `fillStyle: "solid"`, `strokeColor: "transparent"`, sized to the fragment plus
   a couple of px of bleed.
2. **Text** — one text element per fragment, `strokeColor` = the run's colour or
   the block default, positioned at the fragment's `x`/`y`.
3. **Underline** — a line element under the fragment's baseline.
4. **Box** — a rectangle around the fragment, transparent background.

All elements of one rich block share a `groupId` so they drag as a unit, and
carry `customData.richTextId`.

## Editing

1. Double-click a rich block (or select a plain text element and press any
   emphasis shortcut) opens `RichTextOverlay` — a `contenteditable` positioned
   with `sceneCoordsToViewportCoords`, scaled to the current zoom, in the same
   font, size and line height as the block.
2. While open, the generated elements are removed from the scene with
   `CaptureUpdateAction.NEVER` so the transient removal never lands in undo
   history. The overlay is the only thing visible.
3. On commit (blur, or `Escape`), the model is laid out, regenerated into
   elements, and applied with `updateScene` + `CaptureUpdateAction.IMMEDIATELY` —
   one undo step for the whole edit.

**The overlay is a fully controlled editor.** Every `beforeinput` — typing,
Enter, Backspace, word-delete, paste, cut — is intercepted, applied to the model
as a pure function, and re-rendered from the model. `contenteditable` is never
allowed to invent DOM structure.

This is not defensive over-engineering; it is the direct lesson of prototype v2,
which let the browser mutate the DOM and then read the model back out of it.
Enter created `<div>`s the reader did not model, line breaks vanished, and the
next keystroke re-rendered from the damaged model and **destroyed characters
around the break**. Controlled input eliminates that entire class of bug.

## Interaction

Both directions are first-class: mark up text you already wrote, and format as
you type.

**Retrospective** — select a range, a bubble toolbar appears above it. Every
button shows its shortcut, so the slow path teaches the fast one. Active styles
are lit with a ring and read `⌘B · off`: the button that turned it on is the
button that turns it off.

**Forward** — two paths, both wired:

- *Sticky*: press a shortcut with nothing selected, a chip appears near the
  caret, everything typed carries that style until you press it again or `Esc`.
- *Markdown triggers*: `**text**`, `==text==`, `__text__`, `[[text]]` transform
  on the closing delimiter.

**Everything is a toggle.** `⌘B` on blue text turns it black. Mixed selections use
the standard rule: if not everything has the style, add it; otherwise remove it.

| Action | Key |
| --- | --- |
| Blue (primary emphasis) | `⌘B` |
| Red / green / orange | `⌘1` `⌘2` `⌘3` |
| Highlight | `⌘H` |
| Underline | `⌘U` |
| Box | `⌘E` |
| Break out | `⌘⇧B` |
| Strip all formatting | `⌘\` |
| Cancel sticky mode | `Esc` |

`⌘B` means *blue*, not bold — a deliberate hijack of bold muscle memory, since
real bold does not exist here and "primary emphasis" is what the finger means.

**`Esc` must never be claimed for formatting.** Excalidraw uses it to exit the
text editor. It cancels sticky mode when sticky mode is on, and otherwise passes
straight through. Strip-formatting lives on `⌘\`, matching Google Docs.

## Integration risks

- **Autosave echo.** Regenerating elements fires `onChange` and therefore an
  autosave. `App.jsx` already suppresses watcher echoes by remembering the exact
  bytes it last wrote; that path is unchanged and must stay unchanged.
- **`sceneKey`.** Never bump it. Committing an edit must not remount Excalidraw
  and throw away scroll and zoom — same rule that governs rename.
- **Undo.** The transient removal is `NEVER`; the commit is `IMMEDIATELY`. One
  edit, one undo step.
- **Zoom and scroll while editing.** The overlay subscribes to `onScrollChange`
  and repositions. Simplest correct alternative if it fights: close the overlay
  on scroll or zoom.

## Testing

| Layer | How | Where |
| --- | --- | --- |
| Model | `node --test`, pure functions | port of `docs/prototypes/inline-emphasis/model-test.mjs` |
| Layout | injected fixed-width metrics provider, no browser | new |
| Elements | assert generated element shapes | new |
| Interaction | headless browser driving real key events | port of `docs/prototypes/inline-emphasis/e2e.sh` |

The prototype ships **30 model tests** (including a 400-iteration fuzz asserting
no edit sequence drops a character, orphans a block, or leaves unmerged adjacent
runs) and **28 browser tests**. Both suites pass and both should be ported rather
than rewritten — they already encode the bugs we hit.

The fuzz invariants are the valuable part. Keep them:

- text length changes only by exactly what the operation should change
- every block has at least one run
- no two adjacent runs share a style key

## Rejected alternatives

| Option | Why not |
| --- | --- |
| Fork Excalidraw | Multi-week, permanent rebase burden, buys one of five features |
| Overlay-only rendering | To hide native text you must mutate saved properties; exports and other viewers lose the formatting |
| Store model on one anchor element | Deleting the anchor silently destroys editability of the rest |
| Derive the model from element geometry | Fragile; positions drift the moment anyone drags a fragment |

## README

User-facing, so the README changes in the same commit: a section on inline
emphasis with the shortcut table, and the "What this adds on top of Excalidraw"
table gains a row — the web editor has one colour per text block, this has many.
