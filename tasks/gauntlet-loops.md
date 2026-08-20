# Gauntlet Loops — Excalidraw Desktop

Five high-leverage ideas, each written as a gauntlet-loop prompt (per
https://github.com/robonuggets/gauntlet-loop): paste one into a fresh session.
Each names a real, fetchable quality bar; the loop runs builder/critic pairs and
blind-compares against the bar until our output wins — never a fixed round count.

Repo: `/Users/seyonvasantharajan/Desktop/repos/excalidraw_improved`
Constraints that apply to every loop: respect CLAUDE.md architecture boundaries
(`src/lib/drawings.js` is the only invoke() caller; Sidebar stays presentational;
all path building in Rust), keep drawings as plain `.excalidraw` files on disk,
update the README in the same commit, and run `cargo test` + a real
`npm run tauri dev` E2E pass before claiming done.

---

## 1. Visual Library — thumbnails, gallery, instant full-canvas search

Ships three roadmap items at once (search, thumbnails, organisation) and is the
single biggest daily-use upgrade: today the sidebar is a bare text list.

**Gauntlet prompt:**

> Build a visual library for the Excalidraw desktop app in this repo: live-rendered
> thumbnails in the sidebar, a full-window gallery view, and instant fuzzy search
> that matches drawing names AND text inside the canvas elements. Thumbnails must
> render from the `.excalidraw` files themselves (export API or offscreen canvas),
> cache to disk, and update on autosave. Quality bar: the Obsidian Excalidraw
> plugin (github.com/zsviczian/obsidian-excalidraw-plugin) — install it in a vault,
> screenshot its thumbnail grid and search, and read how it renders previews.
> Split into thumbnail pipeline, gallery UI, and search index; run a builder and a
> critic per piece. Critics blind-compare our screenshots against the plugin's for
> visual quality, latency (search must feel instant at 200 drawings), and fidelity.
> Loop until ours wins the blind comparison.

---

## 2. Time Machine — per-drawing version history with a scrubbable timeline

Local-first apps lose work silently; nothing in the sketching space has
Figma-grade history for plain files on disk. Technically deep: efficient
snapshotting of scene JSON, delta storage, and a replay UI.

**Gauntlet prompt:**

> Add per-drawing version history to the Excalidraw desktop app in this repo:
> every autosave becomes a recoverable snapshot (content-addressed deltas in a
> `.history/` dir beside the library — never bloat the `.excalidraw` files), with a
> scrubbable timeline UI that live-previews the canvas at any point and one-click
> restore. Must survive rename and delete (restore a deleted drawing), stay under
> 5MB of history per typical drawing, and never fight the autosave debounce.
> Quality bar: Figma's version history (figma.com — open a file, screenshot the
> history panel and restore flow; read help.figma.com/hc/en-us/articles/360038006754).
> Split into storage engine (Rust), timeline UI, and restore semantics; builder +
> critic per piece. Critics blind-compare our restore flow recordings against
> Figma's for clarity and trust. Loop until ours wins.

---

## 3. Linked Canvases — cross-drawing links, backlinks, and a knowledge graph

Turns a pile of drawings into a thinking tool: link any shape to another drawing,
navigate by click, see backlinks, and view the whole library as a graph. Nobody
has Obsidian-style linking for a pure-canvas library.

**Gauntlet prompt:**

> Give the Excalidraw desktop app in this repo cross-drawing links: any element
> can link to another drawing (stored in the element's `link` field so files stay
> valid `.excalidraw`), Cmd-click navigates with back/forward history, a backlinks
> panel shows what points at the current drawing, and a graph view renders the
> whole library as an interactive node graph. Links must survive rename (update
> referrers atomically in Rust). Quality bar: Heptabase (heptabase.com — use the
> trial, screenshot its card links, backlinks, and whiteboard graph) plus
> Obsidian's graph view. Split into link model + rename integrity, navigation UX,
> and graph view; builder + critic per piece. Critics blind-compare navigation
> recordings and graph screenshots against Heptabase. Loop until ours wins the
> blind comparison.

---

## 4. Presentation Mode — animated hand-drawn replay with camera choreography

One keystroke turns any drawing into a talk: frames become slides, the camera
glides between them, and strokes draw themselves in hand-drawn style. Huge
wow-factor; the hard parts are SVG stroke animation and smooth camera pathing.

**Gauntlet prompt:**

> Build a presentation mode for the Excalidraw desktop app in this repo: press
> play and the drawing's frames become an ordered slide sequence, the camera
> animates smoothly between them (zoom-to-fit with eased pathing), and within each
> frame the elements animate in hand-drawn stroke-by-stroke style. Include
> presenter controls (arrow keys, laser pointer, escape to edit) and export to a
> self-contained animated SVG/HTML. Quality bar: excalidraw-animate
> (github.com/dai-shi/excalidraw-animate — run it, record its output on the same
> test drawing) and tldraw's presentation cameras. Split into stroke animation
> engine, camera choreography, and presenter UX; builder + critic per piece.
> Critics blind-compare screen recordings of the same source drawing rendered by
> both. Loop until ours beats excalidraw-animate in the blind comparison.

---

## 5. Instant Share — serverless live collaboration from the desktop

The desktop app's biggest gap vs excalidraw.com is collaboration. Do it with no
server and no account: host a session directly from the app (WebRTC + local
signaling or iroh-style P2P from the Tauri/Rust side), guests join from any
browser via a link/QR code. Technically the hardest of the five.

**Gauntlet prompt:**

> Add serverless live collaboration to the Excalidraw desktop app in this repo:
> the desktop app hosts a session for a drawing (Rust side: P2P transport, e.g.
> WebRTC data channels or iroh; the app is the source of truth and keeps saving to
> disk), guests join instantly from a plain browser via link or QR code — no
> accounts, no cloud persistence. Live cursors, sub-200ms edit propagation on LAN,
> conflict-free merging of scene elements, graceful host disconnect. Quality bar:
> excalidraw.com's live collaboration (open two browsers, start a session, record
> cursor latency and the join flow). Split into transport + sync protocol, host
> lifecycle + persistence, and guest join UX; builder + critic per piece. Critics
> blind-compare side-by-side session recordings against excalidraw.com for
> latency, join friction, and merge correctness. Loop until ours wins.

---

## Suggested order

1 → 2 → 3 ship compounding value on the library (the product's stated moat);
4 is the demo-magnet; 5 is the moonshot — run it last, in its own worktree lane.
