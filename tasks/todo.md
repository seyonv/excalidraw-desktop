# Current work — inline text emphasis

**Next action:** run gauntlet loop 6 in `tasks/gauntlet-loops.md`.

Say "continue where you left off" and that is what starts. It is a long
unattended run, intended for overnight.

## Done (commit `2f91194`)

- [x] Investigate feasibility — established the app is **not** a fork of
      Excalidraw, so this is a layer on top, not a patch
- [x] Settle scope interactively: colour, highlight, underline, box-around-a-range,
      breakout. No bold, italic or per-run size (canvas fonts ship Regular only;
      elements have `angle`, not shear)
- [x] Prototype the interaction and test it —
      `docs/prototypes/inline-emphasis/`, 30 model tests (incl. a 400-iteration
      fuzz) + 28 browser tests, all passing
- [x] Write the spec — `docs/superpowers/specs/2026-08-23-inline-text-emphasis-design.md`
- [x] Write the 9-task plan — `docs/superpowers/plans/2026-08-23-inline-text-emphasis.md`
- [x] Write gauntlet loop 6, bar = Figma text editing on canvas

## Before starting the loop

- [x] 5 open decisions resolved 2026-08-26. **Breakout ships in v1** — the block
      model stays and the prototype ports over as-is. The remaining four take the
      spec's recommended defaults; any that turns out to be load-bearing during
      the loop gets written up here as it is hit.

## Loop progress (live — gauntlet loop 6 running)

- [x] **Task 1 — the model.** `src/lib/richtext/model.js` ported verbatim from
      the prototype's `RT` module; all 30 tests ported to `node:test` in
      `model.test.js` (incl. the 400-iteration fuzz). Commit `cc39b35`.
- [x] **Task 2 — text measurement.** `src/lib/richtext/measure.js`. Verified the
      `FONT_FAMILY` id→name inversion against the shipped bundle
      (`{Virgil:1,…,Excalifont:5,…}`). Extended the fallback chain to mirror
      Excalidraw's own (`Xiaolai, Segoe UI Emoji` for Excalifont) — a shorter
      chain than the renderer uses puts our line breaks out of step on
      non-Latin text. Commit `61e4bf8`. The in-app devtools check folds into
      the Task 7/8 app run.
- [x] **Task 3 — layout.** `src/lib/richtext/layout.js` + tests, written
      test-first. Two fixes on top of the plan's draft, both found by its own
      tests: an unbreakable word wider than a line (including an over-wide
      boxed run falling through) never broke, so layout now breaks per
      character the way Excalidraw does; and a breakout indent wider than the
      element left nothing to lay out into, now clamped. Added the layout
      analogue of the model fuzz. Commit `370a7f5`.
- [x] **Task 4 — element generation.** `src/lib/richtext/elements.js` + tests.
      Found a defect that only exists across two pieces: generation re-derived
      box padding from `run.box`, but a boxed run too wide to fit falls through
      layout's character-breaking path and its width carries no padding — those
      fragments were drawn inset 6px each side with a 12px-short text width.
      Layout now records `padding` on the fragment and generation trusts it.
      Highlight bleed made symmetric. Both non-negotiables pinned here: the
      model survives `JSON.parse(JSON.stringify())`, exactly the trip it makes
      through the file, and the text elements reassemble to the model's text.
      Commit `4ac98ad`.
- [x] **Task 5 — the emphasis bubble.** `src/components/EmphasisBubble.jsx`
      + `.css`, presentational, raises `onAction` and nothing else. Added edge
      handling the plan's draft did not have: a selection near the top of the
      canvas left no room above it and the bubble rendered off-screen, and one
      near a side edge pushed the centred bubble out of view. It now measures
      itself and flips below or clamps horizontally, which is what Figma's own
      bar does. Commit `2fb19f1`.
- [x] **Layout fix forced by Task 6.** Pressing Enter puts a real `\n` into the
      run's text, but layout treated it as ordinary whitespace — it only broke
      the canvas line when it happened to overflow, so the text elements either
      side would have sat on top of each other. Layout now breaks at an
      explicit newline and marks the line `hardBreak`, which tells a reader
      where to put the character back; no fragment ever carries a `\n`, since
      each canvas line is its own text element. The layout fuzz now includes
      newlines and blank lines. Commit `70877a9`.
- [x] **Task 6 — the editing overlay.** `src/components/RichTextOverlay.jsx`
      + `.css`. Every `beforeinput` is prevented and applied to the model, with
      the `default` branch refusing anything unmodelled; offsets↔DOM, sticky
      mode, the markdown triggers, the keyboard map and undo/redo all ported.
      Commit `d7198b8`.

      Deviation from the plan, deliberately: the plan says render the editable
      DOM declaratively from React state. React reconciling the children of a
      `contenteditable` is the same class of hazard that produced the v2
      character-destroying bug, approached from the other side. React owns
      *when* to render; the DOM build stays the prototype's exact imperative
      `replaceChildren`. Behaviour is what the plan asked to preserve.

      One contract change: the overlay ends by calling exactly one of
      `onCommit(doc)` or `onCancel()` — cancel when nothing changed, so an edit
      that changed nothing costs the caller no scene update and no undo step.

      **Not yet verified in the app.** The plan's hand-verification table needs
      the overlay mounted, which is Task 7. Verifying it in a synthetic page
      would be weaker evidence than the real thing and throwaway work, so the
      whole table folds into the app run — that is where this piece's critic
      pass happens.
- [x] **Task 7 — wire it into the app** (code landed, *not yet verified*).
      `App.jsx` opens the overlay on double-click of a rich block, or on an
      emphasis shortcut with a single plain text element selected; hides the
      underlying elements with `CaptureUpdateAction.NEVER` and commits with
      `IMMEDIATELY`, so the whole edit is one undo step; tracks pan and zoom
      through `onScrollChange`. `sceneKey` is untouched.

      Three things the plan's sketch did not cover, all of which would have
      lost work:
      - A cancelled edit had nothing to restore. `openEditor` now stashes the
        exact elements it removed, and cancel puts them back.
      - Autosave fires on the transient removal, so the file would have been
        written *without* the block being edited — quitting mid-edit would have
        lost it. `handleChange` now returns early while an edit is open, and
        `commitEditing` clears the flag before `updateScene` so the finished
        edit still saves.
      - Reopening a block could not reproduce its own wrap width or origin: a
        highlight bleeds 2px left of the origin, and a block that happens not
        to wrap says nothing about the width it was wrapped to. The base now
        travels with the model in `customData`.

- [ ] **Task 8 — verification and round-trip tests** ← next

      **This is the critic pass for Tasks 5, 6 and 7 together**, none of which
      has been driven in a running app yet. Blocker found: `src/lib/drawings.js`
      calls Tauri `invoke` with no web fallback, so the app cannot bootstrap in
      a plain browser and the plan's `e2e-app.sh` against `localhost:1420`
      cannot work as written. The contained fix is a dev-only Vite entry that
      mounts real Excalidraw plus the real overlay without the drawings layer —
      a test harness, never shipped — and to run the ported assertions against
      that. The file-write path itself is unchanged code and the round trip is
      already pinned by the JSON tests.
- [ ] Task 9 — README (lands with the verified feature, not before — there is
      no user-facing behaviour to document until it is shown to work)

**Flagged for Seyon, not changed:** the plan stores the whole model in
`customData` on *every* generated element, deliberately, so any surviving
element can rebuild the block. That means a 40-fragment text block writes ~40
copies of the model into the `.excalidraw` file. It is a settled design
decision, so the loop is not touching it — but if file size matters, storing it
on the first text element only (with `richTextId` still on all) is the obvious
reduction. Worth a look at Task 8 when there are real files to measure.

## Notes for whoever picks this up

The design is settled and was prototyped with Seyon in the loop — the gauntlet
loop is for execution quality, not rediscovery. Do not reopen the fork question;
`docs/superpowers/specs/…-design.md` records why it lost.

The prototype is the reference implementation of the model. Port it rather than
rewriting it: its tests already encode the bugs we hit, in particular the v2
regression where an uncontrolled `contenteditable` destroyed characters around a
line break.
