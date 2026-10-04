#!/bin/bash
# Copies the latest release build to /Applications/Sketchshelf.app, so the
# installed app is always the newest one. Runs on its own after every
# `npm run tauri …` (the "posttauri" npm script) and does nothing unless the
# release bundle is newer than the installed copy.
set -euo pipefail

cd "$(dirname "$0")/.."
SRC=src-tauri/target/release/bundle/macos/Sketchshelf.app
DEST=/Applications/Sketchshelf.app
BIN=Contents/MacOS/sketchshelf

[ -f "$SRC/$BIN" ] || exit 0
[ -f "$DEST/$BIN" ] && [ ! "$SRC/$BIN" -nt "$DEST/$BIN" ] && exit 0

rm -rf "$DEST"
ditto "$SRC" "$DEST"
echo "Installed $DEST"
