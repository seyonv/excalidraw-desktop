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

- [x] **Task 1 — the model.** `src/lib/richtext/model.js` ported verbatim from the
      prototype's `RT` module; all 30 tests ported to `node:test` in
      `model.test.js` (incl. the 400-iteration fuzz). `npm run test:richtext`
      green, 30/30. Commit `cc39b35`.
- [x] **Task 2 — text measurement.** `src/lib/richtext/measure.js`. Verified the
      `FONT_FAMILY` id→name inversion statically against the shipped bundle
      (`{Virgil:1,…,Excalifont:5,…}`), so `fontString(20, 5)` resolves to
      `20px Excalifont, …`. Extended the fallback chain to mirror Excalidraw's
      own (`Xiaolai, Segoe UI Emoji` for Excalifont) — a shorter chain than the
      renderer uses puts our line breaks out of step on non-Latin text.
      Commit `61e4bf8`. The in-app devtools check folds into the Task 7/8 E2E run.
- [ ] **Task 3 — layout** ← next
- [ ] Task 4 — element generation
- [ ] Task 5 — the emphasis bubble
- [ ] Task 6 — the editing overlay
- [ ] Task 7 — wire it into the app
- [ ] Task 8 — round-trip and interaction tests
- [ ] Task 9 — README

## Notes for whoever picks this up

The design is settled and was prototyped with Seyon in the loop — the gauntlet
loop is for execution quality, not rediscovery. Do not reopen the fork question;
`docs/superpowers/specs/…-design.md` records why it lost.

The prototype is the reference implementation of the model. Port it rather than
rewriting it: its tests already encode the bugs we hit, in particular the v2
regression where an uncontrolled `contenteditable` destroyed characters around a
line break.
