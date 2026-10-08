#!/bin/bash
# Publishes the marketing site to Cloudflare Pages (sketchshelf.pages.dev).
# Only the public pages go up — docs/ also holds internal plans and prototypes.
set -euo pipefail

cd "$(dirname "$0")/.."
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

cp docs/*.html docs/site.css "$OUT/"
cp -R docs/assets "$OUT/assets"

npx wrangler pages deploy "$OUT" --project-name sketchshelf --branch main --commit-dirty=true
