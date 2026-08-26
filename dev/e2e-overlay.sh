#!/bin/bash
# Drives the real RichTextOverlay through keyboard and typing events and asserts
# on what is rendered. Ported from docs/prototypes/inline-emphasis/e2e.sh — the
# assertions encode real bugs, so they are kept, not rewritten.
#
# Needs the Vite dev server: npm run dev
B=~/.claude/skills/gstack/browse/dist/browse
URL="http://localhost:1420/dev/richtext-harness.html"
HARNESS="$(dirname "$0")/harness.js"

pass=0; fail=0
check() {
  if [ "$2" = "$3" ]; then pass=$((pass+1));
  else fail=$((fail+1)); printf 'FAIL  %s\n      expected: %s\n      actual:   %s\n' "$1" "$2" "$3"; fi
}
reset() { $B goto "$URL" >/dev/null; $B eval "$HARNESS" >/dev/null; }
js() { $B js "$1"; }

ORIGINAL="The migration ran clean on staging. Every write goes through the new path now. The old path is gone. We should ship on Tuesday and watch the error rate closely."

# ---------- 1. colour toggle round-trip ----------
reset
js "window.__select(36,77)" >/dev/null
$B press "Meta+b" >/dev/null
check "colour: run count after apply" "3" "$(js 'window.__runs().length')"
check "colour: text unchanged"        "$ORIGINAL" "$(js 'window.__text()')"
$B press "Meta+b" >/dev/null
check "colour: toggles back off"      "1" "$(js 'window.__runs().length')"
check "colour: text still unchanged"  "$ORIGINAL" "$(js 'window.__text()')"

# ---------- 2. cmd-\ strips a mixed selection ----------
reset
js "window.__select(36,77)" >/dev/null
$B press "Meta+b" >/dev/null
$B press "Meta+h" >/dev/null
check "marks stack" "true" "$(js 'const r=window.__runs()[1]; String(r.color==="#1971c2"&&r.highlight===true)')"
js "window.__select(0,160)" >/dev/null
$B press 'Meta+\' >/dev/null
check "cmd-\\ strips all" "1" "$(js 'window.__runs().length')"
check "cmd-\\ keeps text" "$ORIGINAL" "$(js 'window.__text()')"

# ---------- 3. typing, Enter, backspace across the line break ----------
reset
js "window.__caret(34)" >/dev/null
$B type "XY" >/dev/null
check "typing inserts" "true" "$(js 'String(window.__text().startsWith("The migration ran clean on stagingXY."))')"
$B press "Enter" >/dev/null
check "enter adds newline" "true" "$(js 'String(window.__text().includes("stagingXY.\n")||window.__text().includes("stagingXY\n"))')"
LEN_BEFORE=$(js 'window.__text().length')
$B press "Backspace" >/dev/null
check "backspace removes exactly one char" "$((LEN_BEFORE-1))" "$(js 'window.__text().length')"

# ---------- 4. the v2 regression: styling ACROSS a line break ----------
reset
js "window.__caret(34)" >/dev/null
$B press "Enter" >/dev/null
TEXT_WITH_BREAK=$(js 'window.__text()')
js "window.__select(20,60)" >/dev/null
$B press "Meta+b" >/dev/null
check "style across break keeps every char" "$TEXT_WITH_BREAK" "$(js 'window.__text()')"
js "window.__select(20,60)" >/dev/null
$B press "Meta+b" >/dev/null
check "un-style across break keeps chars" "$TEXT_WITH_BREAK" "$(js 'window.__text()')"

# ---------- 5. selection spanning a break, then delete ----------
reset
js "window.__caret(34)" >/dev/null
$B press "Enter" >/dev/null
BEFORE=$(js 'window.__text().length')
js "window.__select(30,40)" >/dev/null
$B press "Backspace" >/dev/null
check "delete across break removes exactly the selection" "$((BEFORE-10))" "$(js 'window.__text().length')"

# ---------- 6. markdown triggers ----------
reset
js "window.__caret(0)" >/dev/null
$B type "==hi==" >/dev/null
check "trigger strips delimiters" "true" "$(js 'String(window.__text().startsWith("hiThe migration"))')"
check "trigger applies highlight" "true" "$(js 'String(window.__runs()[0].highlight===true&&window.__runs()[0].text==="hi")')"

reset
js "window.__caret(0)" >/dev/null
$B type "**bold**" >/dev/null
check "** trigger colours"    "#1971c2" "$(js 'window.__runs()[0].color')"
check "** trigger keeps text" "bold"    "$(js 'window.__runs()[0].text')"

# ---------- 7. sticky mode (formatting forward) ----------
reset
js "window.__caret(0)" >/dev/null
$B press "Meta+b" >/dev/null
check "sticky indicator shows" "true" "$(js 'String(window.__sticky())')"
$B type "new" >/dev/null
check "sticky styles typed text" "#1971c2" "$(js 'window.__runs()[0].color')"
check "sticky text landed"       "new"     "$(js 'window.__runs()[0].text')"
$B press "Escape" >/dev/null
check "esc cancels sticky" "false" "$(js 'String(window.__sticky())')"
$B type "plain" >/dev/null
check "sticky off types plain" "true" "$(js 'String(window.__runs()[1].color===undefined)')"

# ---------- 8. breakout ----------
reset
js "window.__select(36,77)" >/dev/null
$B press "Meta+Shift+b" >/dev/null
check "breakout creates 3 blocks" '["paragraph","breakout","paragraph"]' \
  "$(js 'JSON.stringify(JSON.parse(window.__model()).map(b=>b.type))')"
check "breakout keeps all text" "true" \
  "$(js "String(window.__text().replace(/\n/g,'')==='$ORIGINAL')")"

# ---------- 9. undo ----------
reset
js "window.__select(36,77)" >/dev/null
$B press "Meta+b" >/dev/null
$B press "Meta+z" >/dev/null
check "undo reverts styling" "1" "$(js 'window.__runs().length')"
check "undo keeps text"      "$ORIGINAL" "$(js 'window.__text()')"

# ---------- 10. the bubble appears for a selection, not for a caret ----------
reset
js "window.__select(36,77)" >/dev/null
check "bubble shows for a selection" "true"  "$(js 'String(window.__bubble())')"
js "window.__caret(36)" >/dev/null
check "bubble hides for a caret"     "false" "$(js 'String(window.__bubble())')"

# ---------- 11. the non-negotiable, driven through real keystrokes ----------
# Interleaved typing, newlines and deletions must account for every character.
reset
js "window.__caret(0)" >/dev/null
START=$(js 'window.__text().length')
$B type "hello" >/dev/null
$B press "Enter" >/dev/null
$B type "world" >/dev/null
$B press "Backspace" >/dev/null
$B press "Backspace" >/dev/null
$B type "XY" >/dev/null
# +5 typed, +1 newline, +5 typed, -2 deleted, +2 typed = +11
check "every keystroke accounted for" "$((START+11))" "$(js 'window.__text().length')"
check "characters landed in order" "true" \
  "$(js 'String(window.__text().startsWith("hello\nworXY"))')"

# a styled range must survive further typing outside it
js "window.__select(0,5)" >/dev/null
$B press "Meta+h" >/dev/null
LEN=$(js 'window.__text().length')
js "window.__caret(20)" >/dev/null
$B type "zzz" >/dev/null
check "typing outside a styled range keeps it" "true" \
  "$(js 'String(window.__runs()[0].highlight===true&&window.__runs()[0].text==="hello")')"
check "typing outside a styled range adds exactly 3" "$((LEN+3))" "$(js 'window.__text().length')"

# ---------- 12. the commit / cancel contract ----------
# Escape with nothing changed reports a cancel, so the caller can leave the
# scene and the undo history alone.
reset
$B press "Escape" >/dev/null
check "unchanged edit cancels" "cancel" \
  "$(js 'const c=document.getElementById("committed").textContent; c?JSON.parse(c).kind:"none"')"

reset
js "window.__caret(0)" >/dev/null
$B type "Q" >/dev/null
$B press "Escape" >/dev/null
check "changed edit commits" "commit" \
  "$(js 'const c=document.getElementById("committed").textContent; c?JSON.parse(c).kind:"none"')"
check "committed doc carries the edit" "true" \
  "$(js 'const c=JSON.parse(document.getElementById("committed").textContent); String(c.blocks[0].runs[0].text.startsWith("QThe migration"))')"

# ---------- 13. no console errors anywhere ----------
# the vite HMR socket is dev-server noise, not the app
check "no console errors" "" \
  "$($B console --errors | grep -v 'BEGIN\|END UNTRUSTED\|WebSocket connection\|no console errors\|^$' | head -5)"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
