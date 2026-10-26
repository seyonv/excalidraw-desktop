# Current work — Mac App Store resubmission (1.0.0)

Apple's 2.1 "Information Needed" request (2026-10-02) needs a screen recording,
answers in the Review Notes, and a Resolution Center reply. Build 4 was attached
but never resubmitted because no recording existed.

- [x] Reproduce the review flow in the sandboxed build. Found a spurious
      "Updated externally — Cmd+Z to undo" notice on New drawing: the watcher
      saw the new file's own creation as an external change. Fixed in `App.jsx`
      (`create()` records the created file's bytes). Verified in the real app.
- [x] A drawing saved with the export dialog open reopened with the dialog
      open: `appState.openDialog` was written to the file. `drawings.js` now
      strips transient UI keys on save and load.
- [x] ⌘O ran Excalidraw's own file chooser as well as ours, loading the file
      over the active drawing. Claimed the key in `App.jsx`. Build 7.
- [x] Recorded the review video (2026-10-26, 129 s, 1080p, scripted with
      cliclick against a dev-signed copy of build 7); copy at
      `~/Desktop/sketchshelf-review.mp4`.
- [x] Attached it as a review attachment, attached build 7, answered the new
      age-rating questions (social media: no), cancelled the stale submission
      and submitted a new one: WAITING_FOR_REVIEW since 2026-10-26 13:18 PT.
- [ ] Resolution Center reply still needs pasting by hand from
      `appstore/review/resolution-center-reply.txt` (website only, no API).
- [ ] Push `main` (3 commits ahead) once you've had a look.

## Follow-ups (not blocking)
- Switch the listing's privacy/support/marketing URLs to sketchshelf.pages.dev.
- The "Updated externally" notice only clears on click; consider a timeout.
