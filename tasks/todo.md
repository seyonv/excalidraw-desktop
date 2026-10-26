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
- [x] Build 5 uploaded (fix 1); build 6 (both fixes) is the one to attach.
- [ ] Record the review video with a dev-signed copy of build 6
      (`scratchpad/take.sh` drives it with cliclick; 60–120 s, from Finder launch).
- [ ] Convert to 1080p mp4, attach as a review attachment, attach build 6 to the
      version, resubmit for review.
- [ ] Resolution Center reply: `appstore/review/resolution-center-reply.txt`
      (needs the ASC website; no API).
- [ ] Commit (no attribution trailers), push, update the release memory.

## Follow-ups (not blocking)
- Switch the listing's privacy/support/marketing URLs to sketchshelf.pages.dev.
- The "Updated externally" notice only clears on click; consider a timeout.
