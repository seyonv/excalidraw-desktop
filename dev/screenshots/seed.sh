#!/bin/bash
# Writes the App Store showcase drawings into a library directory.
#   dev/screenshots/seed.sh <library-dir>
# Needs the Vite dev server: npm run dev
set -euo pipefail
DEST=${1:?usage: seed.sh <library-dir>}
B=~/.claude/skills/gstack/browse/dist/browse
$B goto "http://localhost:1420/dev/screenshots/seed.html" >/dev/null
for _ in $(seq 1 20); do
  ready=$($B js "String(Boolean(window.__seed || window.__seedError))")
  [ "$ready" = true ] && break
  sleep 1
done
err=$($B js "window.__seedError || ''")
[ -z "$err" ] || { echo "$err" >&2; exit 1; }
mkdir -p "$DEST"
$B js "JSON.stringify(window.__seed)" | node -e '
  const fs = require("fs"), path = require("path");
  const seed = JSON.parse(fs.readFileSync(0, "utf8"));
  for (const [name, contents] of Object.entries(seed)) {
    fs.writeFileSync(path.join(process.argv[1], name + ".excalidraw"), contents);
    console.log(name);
  }' "$DEST"
