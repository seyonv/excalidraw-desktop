# Excalidraw Desktop

A lightweight desktop app for [Excalidraw](https://excalidraw.com), built with Tauri. Runs fully offline on macOS, Linux, and Windows.

## Features

- **Drawing library sidebar** — browse, switch between, create, rename, and delete drawings without leaving the app
- **Real files on disk** — every drawing is a standard `.excalidraw` file in `~/Documents/Excalidraw`, so you can back them up, share them, or drop them into excalidraw.com
- **Autosave** — changes are written to disk as you draw
- **Native file association** — double-click any `.excalidraw` file to open it
- **Offline-first** — no account, no network, no sync

## Where drawings are stored

```
~/Documents/Excalidraw/
  My Diagram.excalidraw
  Untitled 2.excalidraw
```

The filename is the drawing name — rename a file in Finder and it shows up renamed in the sidebar. Files use the standard Excalidraw export format.

Set `EXCALIDRAW_LIBRARY_DIR` to keep the library somewhere else (a synced folder, for example).

## Development

```bash
npm install
npm run tauri dev      # run the app
npm run tauri build    # produce installers
```

Requires [Node.js](https://nodejs.org) and the [Rust toolchain](https://rustup.rs).

## License

MIT
