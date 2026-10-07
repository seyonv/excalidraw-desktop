#!/bin/bash
# Drives the real App against a mocked library and watcher: an idle app must
# stop writing, and a drawing changed on disk must not be overwritten by the
# stale scene. Needs the Vite dev server: npm run dev
B=~/.claude/skills/gstack/browse/dist/browse
URL="http://localhost:1420/dev/library-harness.html"

pass=0; fail=0
check() {
  if [ "$2" = "$3" ]; then pass=$((pass+1));
  else fail=$((fail+1)); printf 'FAIL  %s\n      expected: %s\n      actual:   %s\n' "$1" "$2" "$3"; fi
}
js() { $B js "$1"; }

$B goto "$URL" >/dev/null
sleep 3
check "the drawing opens" "Box A" "$(js 'window.__sceneText()')"

# ---------- 1. an idle app settles ----------
# Every watcher event re-renders the app (the sidebar list refreshes), and a
# re-render fires Excalidraw's onChange. Treating that as an edit armed a save,
# whose own watcher event re-rendered again — a write every ~0.75s, forever.
BEFORE="$(js 'String(window.__writes)')"
sleep 3
check "an idle app writes nothing" "$BEFORE" "$(js 'String(window.__writes)')"

# ---------- 2. an external change survives ----------
# That loop always had a stale save armed, so a change made on disk was
# overwritten within one tick and its watcher event then read as our own echo.
# The event is held back past one save debounce so the race is not left to luck.
js 'window.__externalWrite("Box B", 1000)' >/dev/null
sleep 3
check "the external change stays on disk" "Box B" "$(js 'window.__diskText()')"
check "the external change reaches the canvas" "Box B" "$(js 'window.__sceneText()')"

# ---------- 3. a real edit still saves ----------
js '(api => { const el = api.getSceneElements()[0]; api.updateScene({ elements: [{ ...el, text: "Box C", originalText: "Box C", version: el.version + 1, versionNonce: el.versionNonce + 1 }] }); return "ok"; })(window.__excalidrawApi)' >/dev/null
sleep 2
check "an edit is saved" "Box C" "$(js 'window.__diskText()')"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
