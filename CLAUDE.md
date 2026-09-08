# Excalidraw Desktop — working notes

A Tauri desktop wrapper around the Excalidraw editor. The value this project adds
over the stock web editor is the **drawing library**: many drawings, stored as real
files, browsable from a sidebar.

## Keep the README current

The README is the product description, not an afterthought. **Any change that alters
what a user can do must update it in the same commit.** Specifically:

- New or changed user-facing behaviour → update the relevant section, and the
  "What this adds on top of Excalidraw" table if the comparison to the web editor
  shifts.
- Shipping something on the Roadmap → tick it off and move it into the features.
- Changing where or how drawings are stored → update "Your drawings are just files".
- New dependency, build step, or command → update "Development".

If a change is purely internal (refactor, test, build tooling), the README stays as is.

## Architecture

```
src/lib/drawings.js       the ONLY module that calls invoke(); all Rust access flows here
src/components/Sidebar.jsx presentational — it raises events, it never mutates the library
src/App.jsx               owns library state, active drawing, and the autosave lifecycle
src-tauri/src/lib.rs      file operations + name sanitising + tests
mcp/server.js             MCP server wiring: registers draw, edit, list_drawings,
                          describe_scene, rename_drawing, delete_drawing, open_drawing
mcp/lib/*.js              all MCP behaviour — server.js stays wiring-only
src/lib/richtext/         inline emphasis: model → layout → elements, all pure
src/components/RichTextOverlay.jsx  the controlled contenteditable over the canvas
src/lib/richtext/useRichTextEditing.js  when the overlay opens and how the
                          result goes back into the scene — kept out of App.jsx
                          so it can be driven by a browser
dev/                      dev-only harnesses + browser suites; never shipped
```

Keep these boundaries. If the sidebar starts calling `invoke` directly, or `App.jsx`
starts formatting filenames, the seams have eroded.

## Rules that came from real bugs

- **The bootstrap effect must run exactly once.** It creates files, and React
  StrictMode double-invokes effects — an unguarded `await` before the first write
  produced a duplicate drawing on first launch. The `bootstrappedRef` guard is load-bearing.
- **Cancel the pending autosave before deleting a drawing.** A queued debounced write
  will otherwise recreate the file you just removed.
- **All path building happens in Rust.** `sanitize()` + `path_for()` guarantee a name
  resolves to a single component inside the library dir. Never join a user-supplied
  name to a path on the JS side.
- **Never bump `sceneKey` on rename.** It remounts Excalidraw and throws away the
  user's scroll and zoom. It should change only when a genuinely different scene loads.
- **The MCP server must never print to stdout.** It speaks JSON-RPC there; a
  stray `console.log` corrupts the protocol. Use `console.error`.
- **Echo suppression is load-bearing.** `App.jsx` remembers the exact bytes it
  last wrote per drawing and drops watcher events that match. Without it,
  autosave and the watcher chase each other forever.
- **`sanitize()` is mirrored in `mcp/lib/sanitize.js`** and pinned by
  `mcp/fixtures/sanitize-cases.json`, which both test suites read. Change one,
  and the other's test fails — that is the point.
- **`flush()` records into `lastWrittenRef` before awaiting the write.** That
  ordering is load-bearing for echo suppression — if the record moved after
  the `await`, a watcher event for that write could arrive before it was
  recorded, and get treated as an external change instead of our own echo.
- **Only one app window may run against a given library directory.** Two
  windows both watch and autosave the same `.excalidraw` files; whichever one
  flushes last wins, silently discarding the other's writes (including ones
  made by the MCP server directly to disk). `tauri-plugin-single-instance` in
  `src-tauri/src/lib.rs` focuses the existing window instead of spawning a
  second one — don't remove it, and don't run `npm run tauri dev` twice.
- **The sanitised name is the only name the MCP server ever returns, writes
  into `.open-request`, or hands to another module.** A tool handler resolves
  the caller-supplied name once at the top (`library.resolveName()`) and uses
  that resolved value everywhere after — never the raw input. Returning the
  raw name while the file is written under the sanitised one poisons
  `activeNameRef` in `App.jsx` and silently breaks live reload for that drawing.

- **The rich text pipeline is model → layout → elements, and each stays pure.**
  `layout.js` takes its measure function as a parameter so it never imports
  `measure.js` (the only file needing a browser). Keep it that way — it is why
  the whole thing is testable under `node --test`.
- **Layout records `padding` and `hardBreak` on what it emits; downstream must
  not re-derive them.** A boxed run too wide to fit falls through to character
  breaking and its width carries no padding, so reading `run.box` to decide
  whether to subtract padding draws the text inset and short. An explicit `\n`
  breaks the canvas line, and since no fragment carries the character, `hardBreak`
  is the only record that it was there.
- **Autosave must not run while a rich text block is being edited.** Opening the
  editor removes the block's elements from the scene; a save in that window would
  write a file without it, and quitting mid-edit would lose it. `handleChange`
  returns early while `editingRef` is set, and the commit clears it *before*
  `updateScene` so the finished edit still saves.
- **A cancelled edit must restore the exact elements that were hidden.** They are
  stashed on open for that reason — nothing else in the scene can reconstruct them.
- **A rich text block is identified by its Excalidraw group id, not by
  `richTextId`.** Duplicating or pasting copies `customData` verbatim while
  regenerating element and group ids, so a copy and its original share a
  `richTextId`. Gathering the block by that id pulled both into one edit: the
  original disappeared and the commit wrote a single block over the two. The
  copy is re-stamped with its own id when it is next edited.
- **The origin comes from `richTextOffset` on the elements, not from `base.x/y`.**
  `base.x/y` is only where the block was *first* laid out — moving or
  duplicating it leaves that stale, and laying the reopened edit out from it
  snapped the block back to where it started. Every generated element records
  its own offset from the origin, so any survivor can say where the block is now.
- **The base travels with the model in `customData`.** A reopened block has to lay
  out at the same width, and that is not recoverable from the generated elements:
  a block that happens not to wrap says nothing about the width it was wrapped to.

- **`updateScene` with no `elements` key wipes the scene.** Every call must pass
  the elements it wants to keep, even one that only means to change `appState`.

- **Never write a drawing with `fs::write`.** It truncates the destination
  before writing a byte and never fsyncs, so a crash or a `kill -9` part-way
  through a 9MB scene leaves a truncated file. `write_atomic()` (temp file →
  `sync_all` → rename) is the only way a drawing reaches disk.
- **An empty scene is not proof the user emptied it.** A large, image-heavy
  drawing reports zero elements for a while after it mounts. `sceneSettledRef`
  in `App.jsx` stays false until the mounted scene has reported the elements it
  was opened with, and `flush()` will not write an empty scene before then;
  `write_drawing` refuses one in Rust as the backstop unless `allow_empty` says
  the user really did clear it. This is not theoretical — it cost a real 9MB
  drawing, recovered only because stale exports happened to sit in `~/Downloads`.
- **`keep_previous_version` skips identical consecutive states on purpose.** The
  app rewrites the active drawing on every switch, so snapshotting every write
  would evict twenty real versions in an afternoon.

## Gotchas in this repo

- A formatter hook reformats **every** file on each edit, including the vendored
  Excalidraw assets in `public/`. Before committing, revert unrelated churn:
  `git checkout -- public/` — otherwise thousands of lines of noise land in the diff.
- `public/` holds Excalidraw's compiled bundle. It is vendored, not generated by our
  build. Don't hand-edit it, and keep its MIT notice in `LICENSE`.
- Rust tests share `EXCALIDRAW_LIBRARY_DIR`, which is process-global. Filesystem
  behaviour lives in one serial test on purpose — don't split it into parallel tests.

## Commands

```bash
npm install
npm run tauri dev             # run with hot reload
npm run build                 # frontend only
cd src-tauri && cargo test    # library layer tests
npm run test:mcp              # MCP server tests
```

This project uses **npm**, not pnpm.
