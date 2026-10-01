#!/bin/bash
# Builds the Mac App Store package: a sandboxed, universal Sketchshelf.app,
# signed for distribution and wrapped in a signed installer .pkg.
#
#   scripts/appstore-build.sh         → dist-appstore/Sketchshelf.pkg, ready to upload
#   scripts/appstore-build.sh --dev   → dist-appstore/Sketchshelf.app, sandboxed but
#                                       signed for this Mac, so it can be run locally
#
# A distribution-signed app will not launch outside the Store, which is why the
# sandbox is tested with --dev.
set -euo pipefail

cd "$(dirname "$0")/.."
TEAM=4UBDU5MULL
OUT=dist-appstore
APP="$OUT/Sketchshelf.app"
PROFILE=src-tauri/Sketchshelf.provisionprofile

MODE=store
[ "${1:-}" = "--dev" ] && MODE=dev

npm run tauri build -- --bundles app --target universal-apple-darwin \
  --config src-tauri/tauri.appstore.conf.json

rm -rf "$OUT" && mkdir -p "$OUT"
cp -R src-tauri/target/universal-apple-darwin/release/bundle/macos/Sketchshelf.app "$APP"

if [ "$MODE" = dev ]; then
  codesign --force --sign "Apple Development" \
    --entitlements src-tauri/Sketchshelf.dev-sandbox.entitlements "$APP"
  codesign --verify --strict "$APP"
  echo "$APP"
  exit 0
fi

[ -f "$PROFILE" ] || { echo "missing $PROFILE (Mac App Store provisioning profile)" >&2; exit 1; }
cp "$PROFILE" "$APP/Contents/embedded.provisionprofile"
codesign --force --sign "Apple Distribution: SEYON VASANTHARAJAN ($TEAM)" \
  --entitlements src-tauri/Sketchshelf.appstore.entitlements "$APP"
codesign --verify --strict "$APP"

productbuild --component "$APP" /Applications \
  --sign "3rd Party Mac Developer Installer: SEYON VASANTHARAJAN ($TEAM)" \
  "$OUT/Sketchshelf.pkg"
echo "$OUT/Sketchshelf.pkg"
