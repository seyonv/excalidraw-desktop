#!/bin/bash
# Frames the raw captures in dev/screenshots/raw/ as App Store slides, written to
# appstore/screenshots/en-US/. Needs the Vite dev server: npm run dev
set -euo pipefail
cd "$(dirname "$0")/../.."
B=~/.claude/skills/gstack/browse/dist/browse
OUT=appstore/screenshots/en-US
mkdir -p "$OUT"
$B viewport 1440x900 --scale 2 >/dev/null

slide() { # <n> <raw name> <title> <underlined word> <subline>
  local url
  url=$(node -e 'const [s,t,e,u]=process.argv.slice(1); const q=new URLSearchParams({shot:"/dev/screenshots/raw/"+s+".png",title:t,em:e,sub:u}); console.log("http://localhost:1420/dev/screenshots/frame.html?"+q)' "$2" "$3" "$4" "$5")
  $B goto "$url" >/dev/null
  sleep 1.5
  $B screenshot --viewport "$PWD/$OUT/$1.png" >/dev/null
  echo "$OUT/$1.png"
}

slide 1-library "Q4 launch plan" "Every sketch, on one shelf" "one shelf" \
  "All your drawings in one sidebar. Switch between them in a click."
slide 2-files "Checkout architecture" "Saved as you draw" "Saved" \
  "Real .excalidraw files on your Mac. No account, no cloud, no lock-in."
slide 3-richtext "Design review" "Emphasis inside one text block" "Emphasis" \
  "Colour, highlight, underline or box a phrase without splitting your note."
slide 4-dark "Onboarding flow" "Easy on the eyes at night" "night" \
  "A full dark mode, sidebar included."
slide 5-open "Landing page wireframe" "Opens your .excalidraw files" ".excalidraw files" \
  "Double-click any .excalidraw file, or bring it in with File → Open."
