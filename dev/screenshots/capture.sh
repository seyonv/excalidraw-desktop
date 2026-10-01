#!/bin/bash
# Captures the App Store screenshots from the sandboxed build, without touching
# the mouse or keyboard. Run with the everyday build quit (they share a bundle id).
#   scripts/appstore-build.sh --dev && dev/screenshots/capture.sh <out-dir>
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=${1:?usage: capture.sh <out-dir>}
LIB="$HOME/Library/Containers/dev.seyon.sketchshelf/Data/Library/Application Support/Excalidraw"
WINID=$(mktemp -d)/winid
swiftc -O dev/screenshots/winid.swift -o "$WINID"

dev/screenshots/seed.sh "$LIB" >/dev/null
open -g dist-appstore/Sketchshelf.app
sleep 6
# 1440×900 points is 2880×1800 pixels on a Retina display.
osascript -e 'tell application "System Events" to tell process "sketchshelf"' \
  -e 'set position of window 1 to {0, 32}' -e 'set size of window 1 to {1440, 900}' -e 'end tell'

mkdir -p "$OUT"
for name in "Q4 launch plan" "Checkout architecture" "Design review" "Onboarding flow" "Landing page wireframe"; do
  printf '{"name":"%s","at":%s000}' "$name" "$(date +%s)" > "$LIB/.open-request"
  sleep 8
  # A pointer over the sidebar leaves a hover highlight in the shot.
  for _ in $(seq 1 60); do
    x=$(cliclick p | cut -d, -f1)
    [ "$x" -gt 260 ] && break
    sleep 1
  done
  sleep 1
  screencapture -x -o -l "$("$WINID")" "$OUT/$name.png"
  echo "$OUT/$name.png"
done
