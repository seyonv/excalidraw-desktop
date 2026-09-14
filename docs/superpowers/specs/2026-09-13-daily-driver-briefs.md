# Five changes for the daily driver — briefs

**Date:** 2026-09-13
**Status:** briefs for review. Nothing here is approved or designed to
implementation depth; each brief is meant to be argued with, then one or two of
them promoted to a real design doc.

## How these were chosen

Not from taste. From the library on this machine — ten drawings, read and
measured on 2026-09-13:

| | |
| --- | --- |
| Largest canvas extent | **41,345 × 26,463 px**; next two are 29,699 × 17,878 and 18,376 × 9,458 |
| Frames used, across all ten drawings | **0** |
| Text elements in the largest drawing | 290 |
| …with a **fractional** font size | **191 (66%)** |
| Distinct font sizes in that one drawing | **49** — 20×99, then 88, 27, 22, 67, 16, 172, 247, … |
| Images | 59 in one file (23 MB), 31 and 25 in the next two |
| Font family | `5` (Excalifont) on 630 of 640 text elements |

Two facts drive everything below.

**A fractional font size cannot be chosen.** The size picker offers 16/20/28/36
and nothing else, so every non-integer size in that file arrived by dragging a
corner. Two thirds of the text in the main drawing was sized by eyeball, one
element at a time, and the result is 49 sizes where four were meant. The
hand-dragged size is also thrown away: Excalidraw persists `currentItemFontSize`
only when you pick from the picker, so sizing a header to 88 by drag teaches the
app nothing and the next text element opens at 20 again.

**A 41,000 px canvas with zero frames is a room with no map.** At the default
zoom the viewport shows roughly 1,600 × 1,000 px of scene — about **0.15%** of
that drawing. There is no list of what is in it, no way to get back to a thing
you remember by name, and no indication of which 0.15% you are currently looking
at. "I don't know where to put this" is not a memory failure; there is nothing
to navigate by.

The five briefs are ordered by how much of that they remove.

---

## 1. A real type scale

### The problem

49 sizes, no grammar. A heading in one corner is 88 px and a heading of equal
rank in another is 67, because each was dragged separately months apart. Nothing
is comparable across a drawing, let alone across drawings, and the drawing reads
as noise at low zoom where size is the only signal left.

### What it is

Four **named levels**, not pixel values:

| Level | Size | Shortcut |
| --- | --- | --- |
| Title | 96 | `⌘⌥1` |
| Section | 56 | `⌘⌥2` |
| Subhead | 32 | `⌘⌥3` |
| Body | 20 | `⌘⌥4` |

Pressing a shortcut with text selected sets those elements to that level.
Pressing it with nothing selected sets the level for what you type next. The
sizes above are a starting proposal derived from the clusters actually present
in the library (a 20 body is unambiguous; the heading clusters sit around
27–36, 54–67 and 88–114) — they want one pass of your eye before they are
fixed.

The level is recorded on the element in `customData`, the way rich text
emphasis already is, so a Section stays a Section through a resize and can be
re-snapped later. The file stays a valid `.excalidraw`: the `fontSize` is still
the truth for rendering, the level is an annotation on top.

### Normalize

A one-shot command — **Normalize text sizes** — over a selection or a whole
drawing: round every text element to the nearest level and report what it did
("142 elements changed, 49 sizes → 4"). This is what makes the feature worth
having on day one rather than on drawing number eleven. It is destructive in the
sense that it moves text, so it goes through the undo stack as a single entry
and is offered on a selection before it is offered on a whole file.

Clustering is the open question: nearest-level snapping is crude and will pull a
deliberate 172 px banner down to 96. A k-means pass over the actual sizes in the
drawing would respect what you meant, at the cost of being unpredictable. My
instinct is nearest-level with a preview of the diff, and no automatic run.

### What it touches

`src/lib/textscale/` (new, pure: levels, snapping, clustering — testable under
`node --test`), a keydown handler alongside the one in `useRichTextEditing.js`,
and a menu entry for Normalize. Rich text blocks carry their size in
`base.fontSize`, so a level applied to a block has to go through the model and
re-layout rather than being written onto elements — that is the fiddly part and
it is the reason this brief is bigger than it looks.

### How we would know it worked

Re-run the measurement above after a month: distinct sizes per drawing should be
in single digits, and the fraction of fractional sizes should fall rather than
climb.

---

## 2. New text inherits its context

### The problem

Stated directly by you, and confirmed by the data: you drag a header to 88, then
place the next text element beside it and get 20. The app has just watched you
say what size you wanted and did not learn it.

### What it is

When a text element is created, open it at the size the surroundings imply,
rather than at the global default. In precedence order:

1. If the text is being placed **inside a container**, match the other text in
   that container.
2. Otherwise, if there are text elements **within a radius** of the insertion
   point (proposal: 400 scene px), take the **mode** of their sizes — the most
   common, not the mean, so one stray banner does not drag the answer up.
3. Otherwise, the **last size you deliberately applied**, including one you
   reached by dragging — which is the part Excalidraw does not do.

The third rule alone probably fixes most of the felt pain, and it is a handful
of lines. Rules 1 and 2 are what make it feel like the app understands the
drawing.

### Why it is not just a setting

Because the right size is not a property of you, it is a property of *where you
are*. In the same drawing, body text next to a section header should be 20, and
a new sibling header should be 56. A remembered global default gets one of those
two right.

### How it works

`currentItemFontSize` is in `appState` and the vendored bundle honours it. We
set it on pointer-down while the text tool is active, before Excalidraw reads it
to create the element. Two known hazards:

- **`updateScene` with no `elements` key wipes the scene** — the rule already in
  CLAUDE.md. Any appState-only write here must pass the current elements.
- It is **not yet verified** that the bundle accepts an arbitrary
  `currentItemFontSize` rather than snapping to its four picker values. That is
  a twenty-minute spike against `dev/app-harness` and it gates the whole brief;
  if it snaps, this becomes "create the element ourselves", which is a different
  and larger piece of work.

### Escape hatch

Inference that is wrong and silent is worse than no inference. Whatever size is
chosen, it must be visible before you commit to it (the editor opens at that
size — you can see it) and overridable by the ordinary picker without the app
arguing back. If you override, that becomes the remembered size under rule 3.

### What it touches

`src/lib/textscale/infer.js` (pure: elements + point → size), a pointer-down
listener in the canvas area. No Rust, no file format change.

---

## 3. The canvas map

**This is the one that changes what the app is. The other four are improvements
to a drawing tool; this one turns a 41,000-pixel canvas into a document you can
navigate.**

### The problem, precisely

The largest drawing is 41,345 × 26,463 scene px. A maximised window at zoom 1
shows on the order of 1,600 × 1,000 — **0.15% of the drawing**. To find the
thing you half-remember drawing, the only instruments are scroll, zoom-to-fit
(which renders 439 elements at a size where no text is legible), and memory of
roughly which quadrant you were in three weeks ago.

Excalidraw's own answer to this is frames. You have drawn **zero** frames in ten
drawings, across a year of use. That is not an oversight to be corrected with a
tooltip — it is evidence that the drawing gesture and the organising gesture are
different activities, and that you will not stop mid-thought to do the second
one. **So the map has to be built from what is already on the canvas, and
require nothing of you.**

Two instruments, one index.

### 3a. The palette — `⌘P`

One palette, two kinds of result, current drawing first:

```
┌────────────────────────────────────────────────┐
│ ⌘P  harness                                    │
├────────────────────────────────────────────────┤
│  IN THIS DRAWING                               │
│   ▸ Harness Engineering Loop        Section    │
│   ▸ the harness reads the diff      Body       │
│   ▸ harness/verify.sh               Body       │
│  DRAWINGS                                      │
│   ▸ Harness ENgineering for Self Improvement   │
│   ▸ Using Agent Harnesses in Large Codebases   │
└────────────────────────────────────────────────┘
```

Enter on a result in the current drawing **flies the viewport to it**; Enter on
a drawing opens it. That single keystroke subsumes the roadmap's "search / filter
the drawing list" and answers "where do I put this new thing" — you go to the
region you are thinking about instead of hunting for it.

**Ranking** is where this is won or lost. In rough order of weight: exact
phrase over token match; larger text over smaller (a hit on a 88 px header is
almost always what you meant, a hit in body text rarely is); and — the one worth
arguing about — **proximity to the current viewport**, so searching "loop" while
you are already in the agents region prefers the loop *there*. Without that,
search on a drawing with 290 text elements returns a list you have to read
rather than an answer.

**Flying, not jumping.** `scrollToContent(element, { fitToViewport, animate })`
exists in the vendored bundle. Animating the move is not decoration: teleporting
between two unlabelled regions of a 41k-px canvas destroys the spatial sense
that is the only reason you know where anything is. The camera should move so
you can see it move.

### 3b. The minimap

A small persistent panel — proposal: bottom-right, collapsible, ~220 × 140 —
drawing every element as a filled rectangle, with the current viewport as a
bright outline.

- **Elements are rectangles, nothing more.** Text is a grey bar, shapes are
  their stroke colour, **images are a flat box and are never decoded** — this is
  load-bearing, because a 23 MB file is 59 base64 images and decoding them to
  paint a 220 px thumbnail would stall the canvas.
- **Two redraw rates.** Geometry is cached and redrawn only when elements change
  (debounced); the viewport rectangle is redrawn on every `onScrollChange`. A
  minimap that recomputes 439 bounding boxes per scroll frame is a minimap you
  turn off.
- **Click to go, drag to pan.** The map is an instrument, not a picture.

The minimap and the palette answer different questions — "where am I" and
"where is X" — and they reinforce each other: the palette flies you somewhere,
and the minimap is what tells you *where that was*.

### The index

Both instruments read one structure: for each drawing, every text element's
string, size, and position.

For the **current drawing** that is free — the elements are already in memory,
and an index rebuild is a debounced pass over `getSceneElements()`.

For the **library** it is not. The files total ~47 MB and one of them is 23 MB;
parsing all ten on every keystroke is not viable, and neither is parsing them on
app start. This wants a **Rust-side index**: a command that walks the library,
extracts text per drawing, and caches the result keyed by file mtime under
`.index/` — rebuilt incrementally when the watcher reports a change, and
rebuilt from scratch if it is missing or stale. This is the single largest piece
of work in the brief, and it is also the reason the palette can be instant
rather than nearly instant.

`.index/` follows `.history/`'s precedent: ordinary files, deletable at any
time, rebuilt on demand. It must never be the source of truth for anything.

### Explicitly out of scope

Full-text search inside images (OCR). Semantic or embedding search. Searching
`.history/` snapshots. Any of those is a separate brief, and none of them is
needed to make a 41k-px canvas navigable.

### What it touches

`src/components/Palette.jsx` and `src/components/Minimap.jsx` (both
presentational), `src/lib/index/` (pure: extraction, ranking, minimap
projection — all testable without a browser), `src/lib/drawings.js` for the new
command, and `src-tauri/src/lib.rs` for indexing and cache invalidation. The
existing seam holds: the palette raises events, `App.jsx` acts on them, only
`drawings.js` calls `invoke`.

### Risks

- **UI collision.** Excalidraw owns the bottom-left (zoom, undo) and the
  top-left (toolbar). The bottom-right is the least contested corner, but the
  minimap still has to collapse, and it has to go dark with the theme the way
  the sidebar does.
- **Scope.** This brief is two features and an index. It can ship in that order
  — palette over the current drawing only (no Rust at all), then the library
  index, then the minimap — and each step is useful alone. **If this is the one
  we do, it should be built in those three stages, not as one landing.**

---

## 4. Sections that name themselves

### The problem

The palette finds a thing you can name. It does not tell you what is *in* a
drawing, which is the other half of being lost: there is no outline, no table of
contents, no sense of how many regions exist.

### What it is

Infer regions from spatial clustering — elements separated by large empty gaps
are different regions — and name each by the largest text element inside it.
List them in the sidebar as an outline of the drawing you are in. Click to fly
there.

```
Building Coding Agent + Harness
  ▸ The Harness Loop
  ▸ Verification Gates
  ▸ Context Engineering
  ▸ (unnamed region, 14 elements)
```

The claim being made is that **you already organise spatially** — you leave gaps
between topics because that is how thinking on a canvas works — and the app can
read that structure instead of asking you to declare it. The zero frames are the
evidence: you organise, you just do not annotate.

### Why it is separate from 3

It shares the index and the fly-to, and it is worthless without them, but its
risk is different. Clustering can be wrong in a way that search cannot: a bad
outline is a confidently mislabelled map, and a "(unnamed region)" entry is an
admission the app does not understand the drawing. It should be built after the
palette has proven the index, and it should be honest — better to show fewer,
higher-confidence regions than to name everything.

### Open question

Whether an inferred region can be **promoted** — renamed by you, and thereafter
remembered rather than re-inferred. That is the bridge to real sections without
ever asking you to draw a frame, and it is probably the whole point of the
feature. It also means regions need persistent identity, which means writing
them into the file, which is a much bigger commitment than reading clusters.
Worth deciding before this is designed, not during.

---

## 5. Fix switching drawings mid-edit

### The problem

With a rich text edit open, switching drawings splices the edited block into
whichever drawing you switch to. Known, unfixed, recorded in memory as needing a
product decision first.

### Why it is on this list

It silently corrupts two files at once — the one losing the block and the one
gaining it — and this library has one 23 MB drawing that took real work to
build. `.history/` would let you recover, but only if you noticed, and the whole
point of a corruption of this shape is that you do not.

### The decision to make first

Three options, and this brief cannot proceed without picking one:

| | Behaviour on switch mid-edit |
| --- | --- |
| **Commit** | Finish the edit into the drawing being left, then switch. Silent, never loses work, but commits something you might have been about to cancel. |
| **Cancel** | Discard the edit, restore the stashed elements, then switch. Safe, and loses whatever you had typed. |
| **Block** | Refuse the switch with an inline prompt. Explicit, and adds a modal step to something that is currently one click. |

My recommendation is **commit** — it matches the autosave contract the rest of
the app already makes ("there is no save button because there is nothing to
remember to press"), and an edit you can undo is strictly better than an edit
you have to retype. The commit path already exists and already clears
`editingRef` before `updateScene`; the fix is to call it from the switch
handler, before the flush.

### What it touches

`App.jsx`'s drawing-switch path and `useRichTextEditing.js`'s commit. Small —
the design work here is the decision, not the code. It should be regression
tested in `npm run test:app`, which already drives a real canvas.

---

## Sequencing

Briefs 1 and 2 are one coherent piece and should be designed together: both
answer "what size should this text be", both live in `src/lib/textscale/`, and
2 without 1 has no vocabulary to remember. Of the two, **2 is the one you feel
every session** — start there, and let the spike on `currentItemFontSize`
happen first because it can invalidate the approach.

Brief 3 is the large one and the one I would actually argue for. It does not
depend on 1, 2 or 4, and its first stage — a palette over the current drawing
only — touches no Rust and could be usable in a day.

Brief 4 should not start until 3's index exists.

Brief 5 is small and should be done whenever the decision above is made,
independently of everything else.

## Open questions

1. Are the four levels in brief 1 the right four, and are those the right sizes?
2. Should Normalize ever run over a whole drawing, or only a selection?
3. Does the vendored bundle honour an arbitrary `currentItemFontSize`? (spike, gates brief 2)
4. Should the palette search the library by default, or only on a modifier?
5. Can an inferred region be promoted to a named one, and if so, where is that name stored?
6. Commit, cancel, or block on switching mid-edit?

---

## Decisions taken (2026-09-13 review)

All seven open questions were answered in review; the recommendation was
accepted in each case. Recording them here so the briefs above read as settled
rather than open.

| Question | Decision |
| --- | --- |
| Which brief goes into a real design first | **Brief 3**, built in its three stages: palette → library index → minimap |
| The type scale | **Four levels: 96 / 56 / 32 / 20** |
| Normalize's scope | **Selection only**, with a diff preview. Never a whole-drawing run |
| Palette ranking | **Phrase match, then text size, then proximity to the viewport** |
| Palette scope | **Both**, current drawing first — no mode to choose |
| Promoting an inferred region | **Read-only outline for v1**; promotion is a separate design |
| Switching drawings mid-edit | **Commit the edit, then switch** |

Question 3 from the list above — whether the vendored bundle honours an
arbitrary `currentItemFontSize` — is not a decision but a spike, and it still
gates brief 2 whenever brief 2 is picked up.
