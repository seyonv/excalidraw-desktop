#!/bin/bash
# Watches the App Store review of the current Sketchshelf version. launchd runs
# it every six hours (see scripts/review-watch.plist). While the version is
# waiting or in review it only logs the state; anything else hands over to a
# headless Claude Code run that fixes and resubmits, or announces the release.
#
# Account details live outside the repo, in ~/.appstoreconnect/sketchshelf.env:
#   ASC_KEY_ID, ASC_ISSUER_ID, SKETCHSHELF_REVIEW_PHONE
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$HOME/.nvm/versions/node/v22.23.2/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
# shellcheck source=/dev/null
source "$HOME/.appstoreconnect/sketchshelf.env"
export ASC_KEY_ID ASC_ISSUER_ID SKETCHSHELF_REVIEW_PHONE

APP_ID=6818256677
STATE_FILE="$HOME/.appstoreconnect/sketchshelf.last-state"
LOG="$HOME/Library/Logs/sketchshelf-review-watch.last-run.txt"
stamp() { date "+%Y-%m-%d %H:%M:%S"; }

state=$(node scripts/asc.mjs GET "/v1/apps/$APP_ID/appStoreVersions?filter[platform]=MAC_OS&limit=1" |
  node -e 'const d=JSON.parse(require("fs").readFileSync(0)).data[0];console.log(d.attributes.versionString+" "+d.attributes.appStoreState)')
last=$(cat "$STATE_FILE" 2>/dev/null || true)
echo "$(stamp) $state"

case "$state" in
  *" WAITING_FOR_REVIEW" | *" IN_REVIEW" | *" PROCESSING_FOR_APP_STORE" | *" READY_FOR_REVIEW")
    echo "$state" > "$STATE_FILE"
    exit 0 ;;
esac
# Nothing new since the last run that already acted on this state.
[ "$state" = "$last" ] && exit 0

osascript -e "display notification \"App Store state: ${state#* }\" with title \"Sketchshelf review\"" || true

# The prompt goes in on stdin: --allowedTools takes any number of values and
# would swallow a trailing prompt argument.
claude -p --permission-mode acceptEdits \
  --allowedTools "Bash Read Edit Write Glob Grep mcp__claude_ai_Gmail__search_threads mcp__claude_ai_Gmail__get_thread mcp__claude-in-chrome__*" \
  > "$LOG" 2>&1 <<PROMPT && echo "$state" > "$STATE_FILE" # only a finished run counts as handled
The Mac App Store version of Sketchshelf (ASC app id $APP_ID) just moved to: $state.
Read the sketchshelf-app-store-release memory and docs/superpowers/plans/2026-10-01-mac-app-store.md first.
- If it was rejected (REJECTED, METADATA_REJECTED or INVALID_BINARY): find the reviewer's message. Check Gmail (from:no_reply@email.apple.com newer_than:7d) and the App Review page in App Store Connect in the user's Chrome. Fix the cause in code or metadata. If the binary changes, bump bundle.macOS.bundleVersion in src-tauri/tauri.conf.json, run scripts/appstore-build.sh, and upload with xcrun altool --upload-app -f dist-appstore/Sketchshelf.pkg -t macos --apiKey \$ASC_KEY_ID --apiIssuer \$ASC_ISSUER_ID. Attach the new build with scripts/asc.mjs, reply in the Resolution Center if a reply is warranted, and resubmit with a new reviewSubmission. Commit and push the fixes, with no AI attribution in commit messages.
- If it is approved or live (PENDING_DEVELOPER_RELEASE, READY_FOR_SALE, READY_FOR_DISTRIBUTION): add https://apps.apple.com/app/id$APP_ID to the README Installation section, commit and push, then unload the watcher: launchctl bootout gui/\$(id -u)/dev.seyon.sketchshelf.review-watch.
- Anything else: investigate and do what is needed to get the app released.
End with a short plain-text summary of what happened and what you did.
PROMPT
summary=$(tail -c 180 "$LOG" | tr '\n"' "  ")
osascript -e "display notification \"$summary\" with title \"Sketchshelf review: ${state#* }\"" || true
