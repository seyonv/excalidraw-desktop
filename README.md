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
| **Where work is stored**         | Browser localStorage         | Real `.excalidraw` files in `~/Documents/Excalidraw` |
| **Survives a cache clear**       | ✗                            | ✓ — they're files                                    |
| **Rename / delete a drawing**    | Export and re-import by hand | Inline in the sidebar                                |
| **Saving**                       | Manual export                | Autosaves as you draw                                |
| **Works offline**                | Needs the page loaded        | Fully native, no network at all                      |
| **Opening a `.excalidraw` file** | Drag into the browser        | Double-click it in Finder / Explorer                 |
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

## Your drawings are just files

```
~/Documents/Excalidraw/
├── Architecture sketch.excalidraw
├── Retro board.excalidraw
└── Untitled 2.excalidraw
```

This is the point of the whole design:

- **The filename is the drawing name.** Rename a file in Finder and the sidebar shows the new name.
- **Standard Excalidraw format.** Drag any of these into [excalidraw.com](https://excalidraw.com) and it opens. Nothing is locked in.
- **Back them up like anything else.** Point the folder at Dropbox, iCloud, or a git repo and you have versioned diagrams.

Set `EXCALIDRAW_LIBRARY_DIR` to keep the library somewhere other than `~/Documents/Excalidraw`.

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
| `EXCALIDRAW_LIBRARY_DIR` | `~/Documents/Excalidraw` | Where drawings live |

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
```

### How it's put together

```
src/
├── App.jsx                  # owns the library state + autosave lifecycle
├── components/Sidebar.jsx   # the drawing list (presentational only)
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
