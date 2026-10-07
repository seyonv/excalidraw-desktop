#!/bin/bash
# Drives the real App against a mocked library and watcher: an idle app must
# stop writing, and a drawing changed on disk must not be overwritten by the
# stale scene. Needs the Vite dev server: npm run dev
B=~/.claude/skills/gstack/browse/dist/browse
URL="http://localhost:1420/dev/library-harness.html"
HELPERS="$(dirname "$0")/app-harness.js"

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

# ---------- 4. leaving a drawing mid rich text edit ----------
# The block's elements are out of the scene while it is open. Switching used to
# swap scenes under the still-mounted editor, and its commit then landed in
# whichever drawing was open by then. Every way out commits the edit first.
edit_notes() {  # open "Notes", start editing its rich block, type $1
  js 'window.__requestOpen("Notes")' >/dev/null
  sleep 2
  js '(window.__api = window.__excalidrawApi, window.__area = document.querySelector(".canvas-area"), "ok")' >/dev/null
  $B eval "$HELPERS" >/dev/null
  js "window.__selectRich()" >/dev/null
  js "window.__dblclick()" >/dev/null
  sleep 1
  $B press "ArrowRight" >/dev/null
  $B type "$1" >/dev/null
}
overlay_open() { js 'String(!!document.querySelector(".richtext-overlay"))'; }
left_cleanly() {  # $1 = what was typed, $2 = how we left
  sleep 2
  check "$2: the editor closed" "false" "$(overlay_open)"
  check "$2: the edit was saved to its own drawing" "true" \
    "$(js "String(window.__diskText('Notes').includes('$1'))")"
  check "$2: nothing spliced into the next drawing" "false" \
    "$(js 'String(window.__excalidrawApi.getSceneElements().some(e => e.customData?.richTextId))')"
}

edit_notes " SIDEBAR"
check "the editor is open" "true" "$(overlay_open)"
$B click '.drawing-row:not(.active) .drawing-name[title="Repro"]' >/dev/null
left_cleanly " SIDEBAR" "sidebar switch"
check "the drawing left for is untouched" "false" "$(js 'String(window.__richOnDisk("Repro"))')"

edit_notes " MCP"
js 'window.__requestOpen("Repro")' >/dev/null
left_cleanly " MCP" "open request"
$B press "Escape" >/dev/null   # a stale editor would commit into Repro here
sleep 1
check "a late commit cannot reach the drawing opened" "false" \
  "$(js 'String(window.__excalidrawApi.getSceneElements().some(e => e.customData?.richTextId))')"
check "the drawing opened is untouched" "false" "$(js 'String(window.__richOnDisk("Repro"))')"

edit_notes " CREATE"
$B click '.new-button' >/dev/null
left_cleanly " CREATE" "new drawing"
check "the new drawing is untouched" "false" "$(js 'String(window.__richOnDisk("Untitled"))')"

# quitting: pagehide is the last thing the page sees
edit_notes " QUIT"
js '(window.dispatchEvent(new Event("pagehide")), "ok")' >/dev/null
sleep 2
check "pagehide saves an open edit" "true" "$(js "String(window.__diskText('Notes').includes(' QUIT'))")"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
