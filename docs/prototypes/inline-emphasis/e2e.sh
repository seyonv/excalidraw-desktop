#!/bin/bash
# Drives the prototype through real keyboard/typing events and asserts on the model.
B=~/.claude/skills/gstack/browse/dist/browse
K=7711a73d069f53f333f66910361f44818afd28e1e1e692c4462b6022b8001717
HARNESS="$(dirname "$0")/harness.js"

pass=0; fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then pass=$((pass+1));
  else fail=$((fail+1)); printf 'FAIL  %s\n      expected: %s\n      actual:   %s\n' "$1" "$2" "$3"; fi
}
reset() { $B goto "http://localhost:61458/?key=$K" >/dev/null; $B eval "$HARNESS" >/dev/null; }
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

# ---------- 2. esc strips a mixed selection ----------
reset
js "window.__select(36,77)" >/dev/null
$B press "Meta+b" >/dev/null
$B press "Meta+h" >/dev/null
check "marks stack"        "true" "$(js 'const r=window.__runs()[1]; String(r.color==="#1971c2"&&r.highlight===true)')"
js "window.__select(0,160)" >/dev/null
$B press 'Meta+\' >/dev/null
check "cmd-\\ strips all"  "1" "$(js 'window.__runs().length')"
check "cmd-\\ keeps text"  "$ORIGINAL" "$(js 'window.__text()')"

# Escape must NOT strip formatting -- in the real app it exits the text editor
js "window.__select(36,77)" >/dev/null
$B press "Meta+b" >/dev/null
$B press "Escape" >/dev/null
check "esc leaves formatting alone" "3" "$(js 'window.__runs().length')"

# ---------- 3. typing, Enter, backspace across the line break ----------
reset
js "window.__caret(34)" >/dev/null          # right after "staging."
$B type "XY" >/dev/null
check "typing inserts"     "true" "$(js 'String(window.__text().startsWith("The migration ran clean on stagingXY."))')"
$B press "Enter" >/dev/null
check "enter adds newline" "true" "$(js 'String(window.__text().includes("stagingXY.\n") || window.__text().includes("stagingXY\n"))')"
LEN_BEFORE=$(js 'window.__text().length')
$B press "Backspace" >/dev/null
check "backspace removes exactly one char" "$((LEN_BEFORE-1))" "$(js 'window.__text().length')"

# ---------- 4. the v2 regression: styling ACROSS a line break ----------
reset
js "window.__caret(34)" >/dev/null
$B press "Enter" >/dev/null
TEXT_WITH_BREAK=$(js 'window.__text()')
js "window.__select(20,60)" >/dev/null      # a range that spans the break
$B press "Meta+b" >/dev/null
check "style across break keeps every char" "$TEXT_WITH_BREAK" "$(js 'window.__text()')"
js "window.__select(20,60)" >/dev/null
$B press "Meta+b" >/dev/null
check "un-style across break keeps chars"   "$TEXT_WITH_BREAK" "$(js 'window.__text()')"

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
check "trigger applies highlight" "true" "$(js 'String(window.__runs()[0].highlight===true && window.__runs()[0].text==="hi")')"

reset
js "window.__caret(0)" >/dev/null
$B type "**bold**" >/dev/null
check "** trigger colours"        "#1971c2" "$(js 'window.__runs()[0].color')"
check "** trigger keeps text"     "bold"    "$(js 'window.__runs()[0].text')"

# ---------- 7. sticky mode (formatting forward) ----------
reset
js "window.__caret(0)" >/dev/null
$B press "Meta+b" >/dev/null                 # no selection -> sticky on
check "sticky indicator shows" "true" "$(js 'String(document.getElementById("sticky").classList.contains("on"))')"
$B type "new" >/dev/null
check "sticky styles typed text" "#1971c2" "$(js 'window.__runs()[0].color')"
check "sticky text landed"       "new"     "$(js 'window.__runs()[0].text')"
$B press "Escape" >/dev/null
check "esc cancels sticky" "false" "$(js 'String(document.getElementById("sticky").classList.contains("on"))')"
$B type "plain" >/dev/null
check "sticky off types plain"   "true" "$(js 'String(window.__runs()[1].color===undefined)')"

# ---------- 8. breakout ----------
reset
js "window.__select(36,77)" >/dev/null
$B press "Meta+Shift+b" >/dev/null
check "breakout creates 3 blocks" '["paragraph","breakout","paragraph"]' \
  "$(js 'JSON.stringify(JSON.parse(window.__model()).map(b=>b.type))')"
check "breakout keeps all text"  "true" \
  "$(js 'String(window.__text().replace(/\n/g,"")===
        "The migration ran clean on staging. Every write goes through the new path now. The old path is gone. We should ship on Tuesday and watch the error rate closely.".replace(/\n/g,""))')"

# ---------- 9. undo ----------
reset
js "window.__select(36,77)" >/dev/null
$B press "Meta+b" >/dev/null
$B press "Meta+z" >/dev/null
check "undo reverts styling" "1" "$(js 'window.__runs().length')"
check "undo keeps text"      "$ORIGINAL" "$(js 'window.__text()')"

# ---------- 10. no console errors anywhere ----------
check "no console errors" "(no console errors)" "$($B console --errors | grep -v 'BEGIN\|END UNTRUSTED\|^$' | head -5)"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
