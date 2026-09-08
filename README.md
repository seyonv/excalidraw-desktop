<div align="center">

# Excalidraw Desktop

**The Excalidraw you know, with a drawing library that lives on your disk.**

A native desktop app for [Excalidraw](https://excalidraw.com) that adds what the web editor doesn't have: a real sidebar of all your drawings, saved as ordinary files you own.

[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-6965db?style=flat-square)](#installation)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri-24C8DB?style=flat-square)](https://tauri.app)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

</div>

---

## Why this exists

Excalidraw is a superb canvas, but the web editor holds **one scene at a time**. Keeping a second diagram means exporting a file, clearing the canvas, and importing it back later. There's no list, no switching, no library.

This app keeps the canvas exactly as it is and adds the missing layer around it: a sidebar of every drawing you've made, each one a real file in a folder you control.

## What this adds on top of Excalidraw

Everything below is new. The drawing experience itself is stock Excalidraw — same tools, same shortcuts, same file format.

|                                  | Excalidraw web               | Excalidraw Desktop                                   |
| -------------------------------- | ---------------------------- | ---------------------------------------------------- |
| **Drawings open at once**        | One scene                    | A full library, switch in a click                    |
| **Where work is stored**         | Browser localStorage         | Real `.excalidraw` files in `~/Library/Application Support/Excalidraw` |
| **Survives a cache clear**       | ✗                            | ✓ — they're files                                    |
| **Rename / delete a drawing**    | Export and re-import by hand | Inline in the sidebar                                |
| **Saving**                       | Manual export                | Autosaves as you draw                                |
| **Works offline**                | Needs the page loaded        | Fully native, no network at all                      |
| **Opening a `.excalidraw` file** | Drag into the browser        | Double-click it in Finder / Explorer                 |
| **Styling text**                 | One colour per text block    | Many styles inside one block — colour, highlight, underline, box, breakout |
| **Resizing a text block**        | Drag scales the type with the box | Drag a side border to re-wrap at the same size; corners still scale |
| **Driving it from an AI agent**  | Not possible                 | MCP server — Claude Code can draw and edit on the canvas |

### The sidebar

- **Browse** every drawing, most recently edited first
- **Switch** between them with a single click — the current one saves first, always
- **Create** a new drawing with `+ New drawing`
- **Rename** by double-clicking a name, or `⋯ → Rename`
- **Delete** with `⋯ → Delete`, confirmed inline instead of a modal that interrupts you
- **Collapse** it to a `☰` button when you want the whole window for the canvas
- **Follows your theme** — goes dark with Excalidraw's dark mode

### Autosave you don't have to think about

Changes are written to disk 600 ms after you stop drawing, and forced immediately whenever the window loses focus or you switch drawings. There is no save button because there is nothing to remember to press.

### Inline emphasis

On the web, a text block has exactly one colour. Here a single block can carry a
different style per phrase, so a note can emphasise the word that matters instead
of being split into separate elements to do it.

Double-click a rich text block to edit it, select a phrase, and press a key.

Ordinary text stays ordinary: a plain double-click opens Excalidraw's own text
editor, exactly as it does in the stock app. To promote a text element into a
rich block, **⌘double-click** it, or select it and press one of the shortcuts
below directly. Most text never needs to be rich, and the gesture you reach for
to fix a typo should not change what a block is.

| Emphasis                 | Shortcut |
| ------------------------ | ----- |
| Blue (primary emphasis)  | `⌘B`  |
| Red / green / orange     | `⌘1` `⌘2` `⌘3` |
| Highlight                | `⌘H`  |
| Underline                | `⌘U`  |
| Box around the phrase    | `⌘E`  |
| Break out into its own block | `⌘⇧B` |
| Strip all formatting     | `⌘\`  |

`⌘B` means *blue*, not bold — a deliberate hijack of the muscle memory, because
bold is not available (see the limits below). Everything is a toggle: `⌘B` on
blue text turns it black again. A small toolbar appears above the selection with
the same actions, and lights up the ones already applied.

You can also format **forward**, without selecting anything first:

- Press a shortcut with no selection and it turns on for what you type next — a
  chip near the caret shows what's active, and `Esc` turns it off.
- Type `**blue**`, `==highlight==`, `__underline__` or `[[box]]` and the
  delimiters disappear as you close them.

**The limits, and why.** No bold, no italic, and one text size per block. Every
font Excalidraw ships for the canvas has a single weight, and elements have a
rotation angle rather than a shear, so there is nothing to render bold or italic
*with*. Colour, highlight, underline, box and breakout are the emphasis the
canvas can actually draw.

Formatting is stored in the element's `customData` and rendered as ordinary
Excalidraw elements, so the file stays a valid `.excalidraw` — open it anywhere
else and the pixels are still right.

**Resizing a block.** Drag its left or right border and the text re-wraps to the
new width at the same font size — the block gets narrower and taller, not
smaller. Drag a corner (or the top or bottom border) and box and type scale
together, the way they always have. Shift is still Excalidraw's proportional
resize. The two gestures are the same ones a plain text element already answers
to; a block just used to ignore the first one.

## Your drawings are just files

```
~/Library/Application Support/Excalidraw/
├── Architecture sketch.excalidraw
├── Retro board.excalidraw
├── Untitled 2.excalidraw
└── .history/
    └── Architecture sketch/
        ├── 1788380259227.bak
        └── 1788380259246.bak
```

This is the point of the whole design:

- **The filename is the drawing name.** Rename a file in Finder and the sidebar shows the new name.
- **Standard Excalidraw format.** Drag any of these into [excalidraw.com](https://excalidraw.com) and it opens. Nothing is locked in.
- **Back them up like anything else.** Point the folder at Dropbox, iCloud, or a git repo and you have versioned diagrams.

### Your drawings are hard to lose

Files with no history mean one bad write loses everything, so saving is defensive:

- **Every save is atomic.** A drawing is written to a temp file, flushed to disk, then
  renamed into place. A crash or a power cut mid-save leaves the previous version
  intact rather than a truncated file — which matters most on the large,
  image-heavy drawings that take longest to write.
- **The version each save replaces is kept** under `.history/<drawing>/`, newest last,
  up to 20 distinct states per drawing. Identical saves are not stored, so ordinary
  autosave churn doesn't push out real history. To roll back, copy a `.bak` over the
  `.excalidraw` file — it's the same format.
- **A drawing that still has content is never replaced by an empty one** unless you
  actually cleared it. A large scene reads as empty for a moment while it loads, and
  an autosave landing in that window would otherwise blank the file.

`.history/` is ordinary files too — delete it whenever you like, and the app rebuilds
it on the next save.

Set `EXCALIDRAW_LIBRARY_DIR` to keep the library somewhere other than `~/Library/Application Support/Excalidraw`.

> **Upgrading from an older version?** Your existing single scene is imported automatically as a drawing called _My Drawing_ the first time you launch. Nothing is lost.

## Draw from Claude Code

The app ships an MCP server, so Claude Code can create and edit drawings in your
library from any project on your machine — and you watch them appear on the
canvas as they are made.

```bash
claude mcp add --scope user excalidraw -- node /path/to/this/repo/mcp/server.js
```

Then just ask:

> Create an excalidraw drawing with three boxes: Client, API, Postgres — arrows
> down the chain, label the first one "POST /login"

Drawings are written straight to your library folder, so they show up in the
sidebar whether or not the app is running. If it is running, the canvas updates
in place — your scroll and zoom stay put, and `Cmd+Z` undoes anything Claude did.

| Variable | Default | What it does |
| --- | --- | --- |
| `EXCALIDRAW_MCP_FOCUS` | `focus` | `focus` brings the app forward, `switch` changes the drawing without stealing focus, `off` writes files only |
| `EXCALIDRAW_APP` | (built-in: launches via `open -a "Excalidraw Dev"`) | Path to an executable to launch, invoked with no arguments — not a shell command string. Unset uses the built-in default shown here. |
| `EXCALIDRAW_LIBRARY_DIR` | `~/Library/Application Support/Excalidraw` | Where drawings live |

## Installation

Download the latest build for your platform from [Releases](../../releases).

| Platform | File                              |
| -------- | --------------------------------- |
| macOS    | `.dmg`                            |
| Windows  | `.msi` or `.exe`                  |
| Linux    | `.AppImage`, `.deb`, or `.tar.gz` |

After installing, `.excalidraw` files are associated with the app — double-click any of them to open it. Files opened this way are copied into your library so they show up in the sidebar.

## Development

Requires [Node.js](https://nodejs.org) and the [Rust toolchain](https://rustup.rs).

```bash
npm install
npm run tauri dev      # run the app with hot reload
npm run tauri build    # produce installers for the current platform
cd src-tauri && cargo test   # test the file-library layer
npm run test:mcp       # test the MCP server
npm run test:richtext  # test the inline-emphasis model, layout and elements
npm run test:overlay   # drive the text editor in a real browser (needs `npm run dev`)
npm run test:app       # drive it against a real Excalidraw canvas (needs `npm run dev`)
```

### How it's put together

```
src/
├── App.jsx                  # owns the library state + autosave lifecycle
├── components/Sidebar.jsx   # the drawing list (presentational only)
├── components/RichTextOverlay.jsx  # the text editor shown over the canvas
├── lib/richtext/            # inline emphasis: model, layout, element generation
└── lib/drawings.js          # the single place that talks to Rust
src-tauri/src/lib.rs         # file operations, name sanitising, tests
mcp/server.js                 # MCP server: draw, edit, list, describe, rename, delete, open
```

The frontend never touches the filesystem directly. Every path is re-resolved inside the library directory on the Rust side, so a drawing name can't escape the folder no matter what it contains.

## Roadmap

- [ ] Search / filter the drawing list
- [ ] Folders or tags for organising larger libraries
- [ ] Duplicate a drawing
- [ ] Drawing thumbnails in the sidebar
- [ ] Restore recently deleted drawings

## Credits

Built on [**Excalidraw**](https://github.com/excalidraw/excalidraw) by the Excalidraw team — the canvas, the tools, and the file format are all theirs, and this app bundles their editor under the MIT license. Packaged as a desktop app with [Tauri](https://tauri.app).

## License

[MIT](LICENSE). Bundled Excalidraw assets remain under Excalidraw's own MIT license, reproduced in [LICENSE](LICENSE).
