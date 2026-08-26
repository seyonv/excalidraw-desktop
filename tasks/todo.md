# Current work — inline text emphasis

**Status: built, committed, and verified except one manual check.**
13 commits on `main` (`cc39b35`..`0cf960a`), working tree clean, **not pushed**.

**Next action — needs you at the machine:**

1. `npm run tauri dev` (kill any `npm run dev` first, or port 1420 collides —
   `tauri dev` starts its own Vite). Confirm the app launches and renders.
2. Autosave echo suppression: select a text element, `⌘B` to convert and open the
   editor, style a phrase, `Esc`, wait past the 600 ms debounce. The file in
   `~/Documents/Excalidraw` should have the new elements, and **no "changed on
   disk" notice** should appear. That notice would mean the write was not
   recognised as our own echo.

Nothing else is outstanding. Everything below the app layer is proven by tests:
`npm run test:richtext` (54), `npm run test:overlay` (36), `npm run test:app`
(23), `npm run test:mcp` (93), `cd src-tauri && cargo test` (11). The two browser
suites need `npm run dev` running.

Two things were flagged for you and deliberately **not** changed — see
"Flagged for Seyon" below.

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

- [x] **Task 8 — browser verification of the overlay.** The plan's `e2e-app.sh`
      against `localhost:1420` could not work: `drawings.js` calls Tauri
      `invoke` with no web fallback, so the app cannot bootstrap in a browser,
      and stubbing `invoke` in production code for a test is not worth it.
      Instead: `dev/richtext-harness.{html,jsx}` mounts the **real** overlay on
      its own, `dev/harness.js` reads the model back **out of the rendered DOM**
      (render is a pure function of the model, so this asserts on what the user
      actually sees), and `dev/e2e-overlay.sh` drives it with real keyboard and
      typing events. `npm run test:overlay`. The `dev/` entry is never shipped —
      `vite build` takes only `index.html`, confirmed against `dist/`.

      **36 assertions, all passing**, ported from the prototype's suite rather
      than rewritten, because they encode real bugs: the colour toggle round
      trip, `⌘\` on a mixed selection, typing/Enter/Backspace around a line
      break, the v2 regression (styling *across* a break losing characters),
      deleting across a break, both markdown triggers, sticky mode on and off,
      breakout producing three blocks with every character intact, undo, the
      bubble showing for a selection but not a caret, and no console errors.

      Two added beyond the port: the character-loss non-negotiable driven
      through actual keystrokes (interleaved typing, newline and deletion, with
      every character accounted for exactly), and the commit/cancel contract
      (an unchanged edit reports a cancel; a changed one commits the edited doc).

- [x] **Task 9 — README.** New "Inline emphasis" section: what it does, the
      shortcut table, both forward-typing paths (sticky and markdown triggers),
      and a plain statement of the limits and why — no bold, no italic, one size
      per block, because every canvas font ships a single weight and elements
      have a rotation angle rather than a shear. Added the comparison-table row
      (one colour per block on the web vs many styles here), the two new test
      commands, and the new modules in the architecture map. Nothing on the
      Roadmap to tick — inline formatting was never listed there.

      Also added five entries to CLAUDE.md's "Rules that came from real bugs",
      one per defect this loop found, so the next person does not rediscover
      them.

- [x] **Integration verified in a browser.** Extracted the ~150 lines of editing
      logic out of `App.jsx` into `src/lib/richtext/useRichTextEditing.js`, so
      it can be mounted against a bare Excalidraw and driven. `App.jsx` is back
      to owning library state and autosave. `dev/app-harness.{html,jsx}` mounts
      real Excalidraw + the real hook + the real overlay;
      `dev/e2e-app.sh` (`npm run test:app`) drives it. **18 assertions, all
      passing**: the block generates into the scene as real elements,
      double-click opens our editor rather than Excalidraw's, the emphasis comes
      back **out of `customData`** rather than being rebuilt as plain text, the
      elements are hidden mid-edit, committing puts them back with the edit and
      the styling intact, reopening reads the committed model, a cancelled edit
      restores exactly what was hidden, the overlay follows a zoom change, and
      no console errors.

      Two bugs the extraction caught, both mine: `isEditingRef` was referenced
      in `handleChange`'s dependency array before the hook that defines it ran —
      a temporal dead zone error that the build does not catch — and the test
      helper's `updateScene({appState})` wiped the whole scene, because
      Excalidraw treats a missing `elements` key as an empty scene. The second
      is now a CLAUDE.md rule; the app code was always passing elements.

**What still needs you — one `npm run tauri dev` pass.** Only the file layer is
unverified now: autosave echo suppression while editing, and the quit-and-reopen
round trip through a real `.excalidraw` file on disk. Everything above it is
covered — 54 unit tests, 36 overlay assertions, 18 integration assertions. The
model's trip through JSON is pinned by unit test, and the trip through a live
Excalidraw scene by the integration suite; what is untested is only the bytes
going to and from disk, which is unchanged code plus the `handleChange` guard.
