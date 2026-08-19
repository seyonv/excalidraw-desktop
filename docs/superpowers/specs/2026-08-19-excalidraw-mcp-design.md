# Excalidraw MCP — design

**Date:** 2026-08-19
**Status:** approved design, pre-implementation

## Goal

Let Claude Code, running in any repo, create and edit diagrams in this app's
drawing library — and have them appear on the canvas immediately. "Draw three
rectangles saying A, B, C" and "design the auth flow" should both land in under
a couple of seconds, without the user leaving their terminal.

## Why not an existing server

Every public Excalidraw MCP server ships its **own** canvas:

| Project | Model |
| --- | --- |
| `excalidraw/excalidraw-mcp` (official) | Renders MCP-App HTML canvases in chat; no local files |
| `yctimlin/mcp_excalidraw` | Express + React canvas on `:3000`, in-memory scene |
| `whallysson`, `i-tozer`, `cmd8` forks | Variations on the same pattern |
| Excalidraw+ MCP | Targets the Excalidraw Plus **cloud** workspace |

None of them drive a local desktop app. This app's premise — drawings are real
files in a folder you control — makes an existing server both unnecessary and
wrong: the library layer we need is already in `src-tauri/src/lib.rs`.

## Architecture

```
mcp/server.js            stdio MCP server — the only new process
mcp/lib/library.js       CRUD over ~/Documents/Excalidraw/*.excalidraw
mcp/lib/scene.js         element factory + layered auto-layout
mcp/lib/control.js       open/focus the app
mcp/lib/sanitize.js      mirror of the Rust name rules
src-tauri/src/lib.rs     + file watcher emitting library events
src/lib/drawings.js      + event subscription (still the only invoke caller)
src/App.jsx              + external-change handling
```

**The MCP server talks to files, never to Tauri.** No IPC, no HTTP, no port. It
works with the app closed, and the existing seam — `drawings.js` as the sole
`invoke` caller — is untouched.

Runtime dependencies: `@modelcontextprotocol/sdk`. Nothing else. Tests use
`node:test`. This is a deliberate constraint: the server starts on every Claude
Code session, so its cold start is felt.

### Rejected: mermaid-to-excalidraw

`@excalidraw/mermaid-to-excalidraw` pulls mermaid 11 — 84 MB unpacked, 22
transitive dependencies (d3, cytoscape, katex, dompurify, roughjs), all
assuming a browser DOM, so jsdom on top. Mermaid init under jsdom costs roughly
a second per boot. Layout lives in `scene.js` instead. If the user supplies
mermaid source, Claude translates it to the node/edge form — a few hundred
tokens, only when mermaid source actually exists.

## Data flow

```
Claude Code ── stdio ──▶ mcp/server.js
                              │ writes  ~/Documents/Excalidraw/Auth flow.excalidraw
                              │ writes  ~/Documents/Excalidraw/.open-request
                              └ spawns  open -a "Excalidraw Dev"
                                            │
   Tauri watcher (notify, 150ms debounce) ──┘
                              │ emit library-changed / open-request
                              ▼
                         App.jsx ── api.updateScene() ──▶ canvas
```

## The authoring API

Two tools carry all diagram creation. Terseness is the performance feature:
latency is dominated by Claude's token output, so the schema omits everything
`scene.js` can derive (ids, seeds, version nonces, roundness, bound elements,
font metrics, box sizing).

### `draw` — make or replace a whole drawing

```json
{ "name": "Stack", "nodes": ["X", "Y", "Z"] }
```

```json
{ "name": "Auth flow", "direction": "down",
  "nodes": [
    {"id": "c",   "text": "Client"},
    {"id": "api", "text": "API",      "shape": "rect"},
    {"id": "db",  "text": "Postgres", "shape": "cylinder"}
  ],
  "edges": [["c", "api", "POST /login"], ["api", "db"]] }
```

- `nodes`: a bare string is shorthand for `{text}`; `id` defaults to the text.
- `shape`: `rect` (default) | `ellipse` | `diamond` | `cylinder` | `text`.
- `edges`: `[from, to]` or `[from, to, label]`.
- `direction`: `down` (default) | `right`.
- `mode`: `replace` (default) | `append`. Append lays the new subgraph out
  independently and places it below everything already on the canvas; it never
  re-flows existing elements.
- `open`: defaults to true.

### `edit` — change elements in an existing drawing

Operates by element id, which `describe_scene` returns. Supports add, update
(text, colour, size, position), move, and delete. This is the path for "move
that box left" and "make the DB node red" without regenerating the diagram.

### Library tools

`list_drawings`, `describe_scene`, `rename_drawing`, `delete_drawing`,
`open_drawing`.

There is no separate `create_drawing`: `draw` against a name that does not exist
creates it, and `draw` with no nodes creates an empty one.

`describe_scene` returns a **compact summary** — id, type, text, position, size,
and connections — not raw Excalidraw JSON. Reading back a scene must not cost
thousands of tokens.

## Layout

`scene.js` implements layered layout, roughly 150 lines:

1. Rank nodes by BFS depth from the roots (nodes with no incoming edges).
2. Cycles: a back-edge keeps its source's rank rather than recursing.
3. Order within a rank by first-appearance, centre the rank on the axis.
4. Size each box to its text: 8px character width estimate at font size 20,
   min 120×60, wrapped at 28 characters.
5. Fixed gaps: 120px along the flow axis, 60px across it.
6. Edges become arrows with `startBinding`/`endBinding` set, so shapes stay
   connected when dragged.

No edges means a single rank — the "three rectangles" case lays out as a row.

Crossing-edge minimisation is explicitly out of scope. If dense graphs become a
real complaint, `dagre` (~200 KB, no DOM) is the upgrade path.

## Name sanitising

`sanitize()` in `lib.rs` is a security boundary: it guarantees a user-supplied
name resolves to one path component inside the library directory. The MCP
server needs the same rule to predict filenames, which means duplicating it —
so the duplication is pinned by a test:

`mcp/fixtures/sanitize-cases.json` holds `{input, expected}` pairs. Both the
Rust test suite and the Node test suite read that file and assert their
implementation matches. Drift fails a test in both languages.

The Rust side remains authoritative. The MCP server never joins a name to a
path without passing it through the mirrored rules first.

## Live sync

The app autosaves the live scene 600ms after a change. A naive watcher loops:
external write → reload → `onChange` → autosave → watcher sees its own write →
reload.

1. **Watcher.** `notify` on the library directory, 150ms debounce, emits
   `library-changed { name }` to the frontend.
2. **Echo suppression.** `App.jsx` keeps the exact string it last wrote per
   drawing. On an event it re-reads the file and drops it if the contents are
   byte-identical to that string. This kills self-triggered events exactly,
   with no reliance on mtime resolution.
3. **Reload, don't remount.** Reloads go through `api.updateScene()`. Bumping
   `sceneKey` would remount Excalidraw and discard scroll and zoom — the rule
   this repo already learned the hard way.
4. **The sidebar** refreshes its list on any event, so drawings created by
   Claude appear without a restart.

### Conflict: unsaved local edits

If the active drawing changes on disk while the canvas has unsaved edits, the
external version wins — but the `updateScene` call is captured in Excalidraw's
history, so **Cmd+Z restores what the user had**. A toast says the drawing was
updated externally.

In practice the window is nearly closed already: the app flushes on `blur`, and
the user is by definition in their terminal when Claude writes. Cmd+Z is the
safety net for the genuine race, and it costs no new files and no merge logic.

## Opening and focusing

`mcp/lib/control.js` writes `.open-request` (JSON: `{name}`) into the library
directory, then spawns the launcher. The dot prefix hides it from Finder, and
`list_drawings()` filters on the `.excalidraw` extension, so it is invisible to
the sidebar.

The app consumes the request in two places: through the watcher when already
running, and at bootstrap when it was just launched. Bootstrap consumption is
ordered **after** the existing `get_pending_file` handling, and inherits the
`bootstrappedRef` guard — the effect must still run exactly once.

Focus behaviour is set by `EXCALIDRAW_MCP_FOCUS`:

| Value | Behaviour |
| --- | --- |
| `focus` (default) | Launch if needed, bring the app forward on the drawing |
| `switch` | Switch the open drawing and update live, but stay in the background; launch only if not running |
| `off` | Write the file only; `open_drawing` remains available explicitly |

The launcher command comes from `EXCALIDRAW_APP`, defaulting to
`open -a "Excalidraw Dev"` on macOS — the existing applet, which already
handles launch-or-focus for the dev build.

## Testing

**Rust** (`src-tauri/src/lib.rs`, extending the existing serial test — the
library dir env var is process-global and must not be split across parallel
tests):
- the watcher emits an event when a file is written, renamed, or deleted
- `sanitize()` matches every case in the shared fixture

**Node** (`mcp/*.test.js`, `node --test`):
- `library.js` CRUD against a temp `EXCALIDRAW_LIBRARY_DIR`
- `sanitize.js` matches the shared fixture
- `scene.js`: the three-node no-edge case lays out as one row; a linear chain
  ranks in order; a cycle terminates; arrows carry both bindings; output parses
  as a valid Excalidraw scene
- `server.js`: each tool over an in-process stdio transport

**End to end**, run manually before calling this done: start `npm run tauri
dev`, call `draw` from a Claude Code session in a *different* repo, and confirm
the drawing appears on the canvas without a restart, with scroll and zoom
preserved, and that Cmd+Z reverts it.

## Installation

```bash
claude mcp add --scope user excalidraw -- node <repo>/mcp/server.js
```

User scope, so it is available from every repo — which is the point.

## README

Per this repo's CLAUDE.md, user-facing change means the README changes in the
same commit: a section on driving the app from Claude Code, the install command,
the two env vars, and an update to the "What this adds on top of Excalidraw"
table.

## Out of scope

Image export (PNG/SVG) — needs a rendering path the server does not have.
Multi-agent concurrent editing. Crossing-edge minimisation. Sequence, ER, and
class diagram layouts; those are flowchart-shaped or hand-placed for now.
