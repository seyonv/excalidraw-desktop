#!/bin/bash
# Drives the rich text integration against a real Excalidraw: opening on
# double-click, what the scene looks like mid-edit, committing back, cancelling,
# and tracking zoom. Needs the Vite dev server: npm run dev
B=~/.claude/skills/gstack/browse/dist/browse
URL="http://localhost:1420/dev/app-harness.html"
HELPERS="$(dirname "$0")/app-harness.js"

pass=0; fail=0
check() {
  if [ "$2" = "$3" ]; then pass=$((pass+1));
  else fail=$((fail+1)); printf 'FAIL  %s\n      expected: %s\n      actual:   %s\n' "$1" "$2" "$3"; fi
}
reset() { $B goto "$URL" >/dev/null; sleep 2; $B eval "$HELPERS" >/dev/null; }
js() { $B js "$1"; }
open_editor() { js "window.__selectRich()" >/dev/null; js "window.__dblclick()" >/dev/null; }

TEXT="The migration ran clean on staging. Ship on Tuesday."

# ---------- 1. the fixture renders as real Excalidraw elements ----------
reset
check "block generated into the scene" "4" "$(js 'window.__sceneRichCount()')"
check "scene text matches the model"    "$TEXT" "$(js 'window.__sceneText()')"

# ---------- 2. double-click opens our editor, not Excalidraw's ----------
open_editor
check "overlay opens on double-click" "true" "$(js 'window.__overlayOpen()')"
check "overlay shows the whole text"  "$TEXT" "$(js 'window.__overlayText()')"

# the emphasis came back out of customData rather than being rebuilt as plain text
check "styled run survived the scene" "true" \
  "$(js 'String(window.__overlayRuns().some(r=>r.cls.includes("c-blue")&&r.text==="Ship on Tuesday"))')"

# ---------- 3. the block is out of the scene while it is being edited ----------
check "elements hidden during edit" "0" "$(js 'window.__sceneRichCount()')"

# ---------- 4. committing puts it back ----------
$B press "ArrowRight" >/dev/null      # collapse the select-all
$B type "!" >/dev/null
$B press "Escape" >/dev/null
sleep 1
check "overlay closes on commit" "false" "$(js 'window.__overlayOpen()')"
check "elements are back"        "true"  "$(js 'String(window.__sceneRichCount()>0)')"
check "the edit reached the scene" "true" \
  "$(js 'String(window.__sceneText().includes("!"))')"
check "the styling survived the commit" "true" \
  "$(js 'String(JSON.parse(window.__sceneModel()).some(b=>b.runs.some(r=>r.color==="#1971c2")))')"

# ---------- 5. reopening reads the committed model ----------
open_editor
check "reopen shows the edit" "true" "$(js 'String(window.__overlayText().includes("!"))')"
check "reopen keeps the colour" "true" \
  "$(js 'String(window.__overlayRuns().some(r=>r.cls.includes("c-blue")))')"

# ---------- 6. a cancelled edit restores exactly what was hidden ----------
reset
BEFORE=$(js 'window.__sceneRichCount()')
open_editor
check "hidden while editing" "0" "$(js 'window.__sceneRichCount()')"
$B press "Escape" >/dev/null
sleep 1
check "cancel restores every element" "$BEFORE" "$(js 'window.__sceneRichCount()')"
check "cancel keeps the text intact"  "$TEXT"   "$(js 'window.__sceneText()')"

# ---------- 7. the overlay tracks zoom ----------
reset
open_editor
check "overlay starts unscaled" "matrix(1, 0, 0, 1, 0, 0)" "$(js 'window.__overlayTransform()')"
js "window.__setZoom(2)" >/dev/null
sleep 1
check "overlay follows the zoom" "matrix(2, 0, 0, 2, 0, 0)" "$(js 'window.__overlayTransform()')"

# ---------- 7b. converting an ordinary text element ----------
# Both entry points, because a shortcut with an invisible precondition is not a
# discoverable way in and double-click is the gesture people actually reach for.
# Plain double-click belongs to Excalidraw: most text never needs to be rich,
# and hijacking the gesture means you cannot get in to fix a typo without the
# block becoming rich forever. The modifier is the way in.
reset
js "window.__selectPlain()" >/dev/null
js "window.__dblclick()" >/dev/null
sleep 1
check "plain double-click leaves it to Excalidraw" "false" "$(js 'String(window.__overlayOpen())')"
check "plain double-click opens Excalidraw's editor" "true" "$(js 'String(window.__nativeEditorOpen())')"

reset
js "window.__selectPlain()" >/dev/null
js "window.__dblclick({ meta: true })" >/dev/null
sleep 1
check "cmd double-click converts plain text" "true" "$(js 'String(window.__overlayOpen())')"
check "converted block holds its text" "plain text here" "$(js 'window.__overlayText()')"

# A block that is already rich has no other sensible editor: Excalidraw would
# open one generated fragment, and typing into it would desync the model.
reset
open_editor
check "a rich block still opens on a plain double-click" "true" "$(js 'window.__overlayOpen()')"

reset
js "window.__selectPlain()" >/dev/null
$B press "Meta+b" >/dev/null
sleep 1
check "shortcut converts plain text" "true" "$(js 'String(window.__overlayOpen())')"
check "shortcut applies its emphasis" "true" \
  "$(js 'String(window.__overlayRuns().some(r=>r.cls.includes("c-blue")))')"

# ---------- 7c. a copy is its own block ----------
# Duplicating carries customData over verbatim, so a copy and its original share
# a richTextId. Editing the copy used to gather both and commit one block over
# the two: the original vanished and the edit landed at the original's origin.
reset
js "window.__selectRich()" >/dev/null
js "window.__duplicateSelection()" >/dev/null
sleep 1
check "duplicate makes a second block" "2" "$(js 'JSON.parse(window.__blocks()).length')"
js "window.__dblclick()" >/dev/null   # the copy is what the duplicate left selected
sleep 1
check "only the copy is hidden while editing" "1" "$(js 'JSON.parse(window.__blocks()).length')"
$B press "ArrowRight" >/dev/null
$B type " COPY" >/dev/null
$B press "Escape" >/dev/null
sleep 1
check "both blocks survive the edit" "2" "$(js 'JSON.parse(window.__blocks()).length')"
check "the original is untouched" "1" \
  "$(js 'String(JSON.parse(window.__blocks()).filter(b=>b.text==="'"$TEXT"'").length)')"
check "the edit went to the copy only" "1" \
  "$(js 'String(JSON.parse(window.__blocks()).filter(b=>b.text.includes("COPY")).length)')"
check "the copy stays where it was dropped" "true" \
  "$(js 'String(JSON.parse(window.__blocks()).find(b=>b.text.includes("COPY")).y>120)')"
check "the copy has its own identity" "2" \
  "$(js 'String(new Set(JSON.parse(window.__blocks()).map(b=>b.rtId)).size)')"

# ---------- 7d. a moved block stays where it was moved to ----------
# base.x/y is only where the block was first laid out; committing from it
# snapped a dragged block back to its original spot.
reset
js "window.__moveRich(200, 150)" >/dev/null
open_editor
$B press "ArrowRight" >/dev/null
$B type "!" >/dev/null
$B press "Escape" >/dev/null
sleep 1
check "the edit stays at the moved position" "320,270" \
  "$(js '(b=>b.x+","+b.y)(JSON.parse(window.__blocks())[0])')"

# ---------- 7e. a scaled block keeps its scaled size ----------
# The model still carries the fontSize and maxWidth the block was authored at,
# so an edit used to lay out at the old size and snap the block back.
reset
js "window.__scaleRich(2)" >/dev/null
sleep 1
SCALED_X="$(js '(b=>b.x)(JSON.parse(window.__blocks())[0])')"
open_editor
check "the overlay opens at the scaled font size" "40" "$(js 'String(window.__overlayFontSize())')"
$B press "ArrowRight" >/dev/null
$B type "!" >/dev/null
$B press "Escape" >/dev/null
sleep 1
check "the commit keeps the scale" "40" \
  "$(js 'String(window.__api.getSceneElements().find(e=>e.type==="text"&&e.customData?.richTextId).fontSize)')"
check "the commit keeps the position" "$SCALED_X" \
  "$(js '(b=>String(b.x))(JSON.parse(window.__blocks())[0])')"

# ---------- 7f. dragging a border re-wraps instead of scaling ----------
reset
js "window.__selectRich()" >/dev/null
LINES_BEFORE="$(js 'window.__lineCount()')"
FONT_BEFORE="$(js 'window.__fontSize()')"
check "the drag is claimed" "true" "$(js 'String(window.__dragEdge("e", -160))')"
sleep 1
check "it wrapped to more lines" "true" \
  "$(js "String(window.__lineCount() > $LINES_BEFORE)")"
check "the font size is untouched" "$FONT_BEFORE" "$(js 'window.__fontSize()')"
check "the origin stays put" "120" "$(js '(b=>String(b.x))(JSON.parse(window.__blocks())[0])')"

# dragging the left border anchors the right one — the box's edge, not the
# last glyph's: wrapping leaves a ragged gap that changes with every breakpoint
reset
js "window.__selectRich()" >/dev/null
RIGHT_BEFORE="$(js '(b=>String(b.right))(JSON.parse(window.__blockBase()))')"
js 'window.__dragEdge("w", 120)' >/dev/null
sleep 1
check "a left drag anchors the right edge" "$RIGHT_BEFORE" \
  "$(js '(b=>String(b.right))(JSON.parse(window.__blockBase()))')"
check "a left drag moves the origin" "true" \
  "$(js '(b=>String(b.x>120))(JSON.parse(window.__blockBase()))')"
check "a left drag narrows the box" "true" \
  "$(js '(b=>String(b.maxWidth<420))(JSON.parse(window.__blockBase()))')"

# the width floor is fontSize * 4 — 80 for the fixture's 20px text
reset
js "window.__selectRich()" >/dev/null
js 'window.__dragEdge("e", -600)' >/dev/null
sleep 1
check "the width stops at the floor" "80" \
  "$(js '(b=>String(b.maxWidth))(JSON.parse(window.__blockBase()))')"
check "the origin did not move on an e drag" "120" \
  "$(js '(b=>String(b.x))(JSON.parse(window.__blockBase()))')"

# shift is the scale gesture and stays Excalidraw's
reset
js "window.__selectRich()" >/dev/null
check "a shift drag is not claimed" "false" \
  "$(js 'String(window.__dragEdge("e", -160, { shift: true }))')"
check "a shift drag changes nothing on its own" "$(js 'window.__lineCount()')" \
  "$(js 'window.__lineCount()')"

# a re-wrapped block still opens for editing, at the new width
reset
js "window.__selectRich()" >/dev/null
js 'window.__dragEdge("e", -160)' >/dev/null
sleep 1
open_editor
check "a re-wrapped block still opens" "true" "$(js 'window.__overlayOpen()')"
check "it opens at the re-wrapped width" "true" \
  "$(js 'String(window.__overlayText().includes("Ship on Tuesday"))')"

# ---------- 8. the quit-and-reopen path, through the real file format ----------
# serializeScene + parseScene are the exact pair the app writes and reads files
# with, so this is the round trip minus the disk hop.
reset
open_editor
$B press "ArrowRight" >/dev/null
$B type " Done." >/dev/null
$B press "Escape" >/dev/null
sleep 1
AFTER_EDIT="$(js 'window.__sceneText()')"
js "window.__roundTripThroughFileFormat()" >/dev/null
sleep 1
check "text survives the file format" "$AFTER_EDIT" "$(js 'window.__sceneText()')"
check "emphasis survives the file format" "true" \
  "$(js 'String(JSON.parse(window.__sceneModel()).some(b=>b.runs.some(r=>r.color==="#1971c2")))')"
# and it is still editable after the round trip, which is the point of it
open_editor
check "reopens after the round trip" "true" "$(js 'window.__overlayOpen()')"
check "reopened block keeps its colour" "true" \
  "$(js 'String(window.__overlayRuns().some(r=>r.cls.includes("c-blue")))')"
check "reopened block keeps the edit" "true" \
  "$(js 'String(window.__overlayText().includes("Done."))')"

# ---------- 9. no console errors (the vite HMR socket is not one) ----------
check "no console errors" "" \
  "$($B console --errors | grep -v 'BEGIN\|END UNTRUSTED\|WebSocket connection\|no console errors\|^$' | head -5)"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
