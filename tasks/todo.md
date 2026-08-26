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

## Notes for whoever picks this up

The design is settled and was prototyped with Seyon in the loop — the gauntlet
loop is for execution quality, not rediscovery. Do not reopen the fork question;
`docs/superpowers/specs/…-design.md` records why it lost.

The prototype is the reference implementation of the model. Port it rather than
rewriting it: its tests already encode the bugs we hit, in particular the v2
regression where an uncontrolled `contenteditable` destroyed characters around a
line break.
