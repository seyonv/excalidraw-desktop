# App Review screen recording — shot list

Apple asked for a recording made on a physical device **running the latest operating system**, starting from launch.
Update the Mac to the current macOS first (System Settings → General → Software Update).
For a Mac app, a recording of a real Mac counts. Target length: 60–90 seconds.

## Before recording

1. Quit Sketchshelf if it is running.
2. Build the sandboxed copy of the build being submitted (build 4) and copy it
   to Applications, so the recording shows the same code Apple has:
   `scripts/appstore-build.sh --dev && cp -R dist-appstore/Sketchshelf.app /Applications/`
3. Have one `.excalidraw` file on the Desktop for step 7. Copy one out of the
   library, for example `Kitchen remodel.excalidraw`, and rename it `Floor plan.excalidraw`.
4. Hide the Dock clutter and close notifications (Focus → Do Not Disturb).
5. Press ⌘⇧5 → "Record Entire Screen" → Options → set Microphone to None. Narration is optional.
   Click Record.

## Shots (one take)

1. **Launch.** Open Finder → Applications → double-click Sketchshelf. Show the
   window appear with the drawing library in the sidebar. *(About 5 seconds)*
2. **Draw.** Click "+ New drawing", draw a rectangle and an arrow. Press T, click
   empty canvas (not inside the rectangle) and type a short sentence. Pause for a
   second so the autosave happens. *(About 15 seconds)*
3. **Switch drawings.** Click another drawing in the sidebar, then click back.
   The new drawing is still there, which shows it was saved. *(About 8 seconds)*
4. **Rename.** Double-click the new drawing's name, type "Demo", then press Return. *(About 5 seconds)*
5. **Emphasis.** ⌘-double-click the sentence you typed to open the rich-text editor,
   select one word, press ⌘B (blue), then ⌘U (underline). Click away. (Don't use
   ⌘H; macOS may treat it as Hide.) *(About 10 seconds)*
6. **Export.** Use the ☰ menu → Export image → PNG. Save it to the Desktop through
   the Save panel. *(About 10 seconds)*
7. **Open a file.** Use ☰ → Open… (⌘O) and pick `Floor plan.excalidraw` on the
   Desktop. It appears in the library. *(About 8 seconds)*
8. **Dark mode.** Use ☰ → Dark mode. *(About 3 seconds)*
9. **Delete.** Use the ⋯ menu on "Demo" → Delete → confirm. *(About 5 seconds)*
10. **Quit and relaunch.** Press ⌘Q, then reopen from Applications. Everything is
    still there. *(About 10 seconds)*

Stop the recording from the menu bar. The file lands on the Desktop as a `.mov`.

App Store Connect's attachment field does not accept `.mov`. Convert it:
`ffmpeg -i ~/Desktop/Screen\ Recording*.mov -vf scale=-2:1080 -c:v libx264 -crf 23 -an ~/Desktop/sketchshelf-review.mp4`
(or QuickTime → File → Export As → 1080p, then rename the result to `.mp4`).

## Notes

- The recording has no account, purchase or sharing steps because the app has none. The reply says so.
- Keep it under about 100 MB.
