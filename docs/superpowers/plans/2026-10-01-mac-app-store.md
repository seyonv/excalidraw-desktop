# Sketchshelf on the Mac App Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the app to the Mac App Store as Sketchshelf, free, and carry it through review.

**Architecture:** One codebase, two builds. The everyday build (`ex`) stays unsandboxed. `src-tauri/tauri.appstore.conf.json` is merged in with `--config` to add the sandbox, the entitlements, the embedded profile and the Store-only Cargo feature. Listing metadata lives in `appstore/` in fastlane `deliver` layout.

**Tech Stack:** Tauri 2.11, Rust, Vite/React, `productbuild`, `xcrun altool`, fastlane `deliver` (App Store Connect API key auth).

**Spec:** `docs/superpowers/specs/2026-09-30-mac-app-store-design.md`

## Global Constraints

- Name `Sketchshelf`; bundle id `dev.seyon.sketchshelf`; team `4UBDU5MULL`; version `1.0.0`.
- "Excalidraw" appears in the description only, never in the name, subtitle, keywords or icon.
- The unsandboxed library stays at `~/Library/Application Support/Excalidraw`.
- Store build: sandboxed, universal binary, `ITSAppUsesNonExemptEncryption=false`, category Productivity.
- Free, all territories, released automatically on approval.
- Privacy and support pages served by GitHub Pages from `/docs` of `seyonv/excalidraw-desktop`.
- Confirm with the user before pushing to GitHub or enabling Pages. Submission was asked for up front, so the final submit needs no extra confirmation.

## Review Focus

- A first launch inside the sandbox, with an empty container, must create the library and a first drawing. Pinned by the sandboxed E2E in Task 2.
- File → Open on a file outside the container must import it. A sandbox denial here is silent, so Task 2's E2E checks it explicitly.
- The second launch of the Store build must not crash if the single-instance socket is denied. Checked in Task 2.
- The Excalidraw fonts and workers in `public/` must load inside the sandbox; a denial shows as fallback fonts. Checked in Task 2 by inspecting the console and the screenshot.
- The `ex` build and MCP `open_drawing` must still work after the rename. Checked in Task 1.

---

### Task 1: Rename to Sketchshelf, with an original icon

**Files:** `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `package.json`, `mcp/lib/control.js:18`, `src/lib/drawings.js:65`, `src-tauri/src/lib.rs:353`, `README.md`, `src-tauri/icons/*`, `design/icon.svg` (new), `~/.bash_profile` `ex()`

- [ ] Set `productName: "Sketchshelf"`, `identifier: "dev.seyon.sketchshelf"`, window title `Sketchshelf`, version `1.0.0`. Set the UTI to `dev.seyon.sketchshelf.drawing` in both `contentTypes` and `exportedType.identifier`. Keep `ext: ["excalidraw"]`.
- [ ] Cargo `name = "sketchshelf"`, lib `sketchshelf_lib`. Update `main.rs` to `sketchshelf_lib::run()`. npm `name: "sketchshelf"`.
- [ ] `control.js` bundle path → `Sketchshelf.app`; README `EXCALIDRAW_APP` row likewise. `"source"` in new files → `"sketchshelf"`.
- [ ] Draw `design/icon.svg`: an original mark (a hand-drawn stack of three sketch cards on a shelf line, on a violet squircle). Render it to 1024 px and run `npx tauri icon design/icon-1024.png`.
- [ ] README: retitle to Sketchshelf and keep the Excalidraw attribution. In the "Installation" section, add a Mac App Store mention.
- [ ] `ex()`: app path `Sketchshelf.app`; quit `Sketchshelf`; pgrep `Sketchshelf.app/Contents/MacOS/sketchshelf`.
- [ ] Verify: `cd src-tauri && cargo test`, `npm run test:mcp`, `npm run test:richtext`, `npm run build`; then `ex` launches, the existing library shows, and MCP `open_drawing` focuses the app.
- [ ] Commit ("Rename the app to Sketchshelf with an original icon").

### Task 2: Sandboxed Store build

**Files:** create `src-tauri/tauri.appstore.conf.json`, `src-tauri/Sketchshelf.appstore.entitlements`, `src-tauri/Sketchshelf.dev-sandbox.entitlements`, `src-tauri/Info.plist`, `scripts/appstore-build.sh`; modify `src-tauri/Cargo.toml` (feature `appstore`), `src-tauri/src/lib.rs` (gate single-instance)

- [ ] Overlay config:
```json
{
  "bundle": {
    "category": "Productivity",
    "macOS": {
      "entitlements": "Sketchshelf.appstore.entitlements",
      "files": { "embedded.provisionprofile": "Sketchshelf.provisionprofile" },
      "minimumSystemVersion": "11.0"
    }
  },
  "build": { "features": ["appstore"] }
}
```
- [ ] Entitlements: `app-sandbox`, `files.user-selected.read-write`, `application-identifier = 4UBDU5MULL.dev.seyon.sketchshelf`, `team-identifier = 4UBDU5MULL`. The dev variant has only the first two.
- [ ] `Info.plist` with `ITSAppUsesNonExemptEncryption=false`. Tauri merges it.
- [ ] Cargo `[features] appstore = []`; wrap the single-instance plugin registration in `#[cfg(not(feature = "appstore"))]`, but only if the sandbox E2E shows it fails. Otherwise leave it.
- [ ] `scripts/appstore-build.sh`: `npm run tauri build -- --bundles app --target universal-apple-darwin --config src-tauri/tauri.appstore.conf.json`, then `codesign` with Apple Distribution and the entitlements, then `productbuild --component … /Applications --sign "3rd Party Mac Developer Installer: …" Sketchshelf.pkg`, then `xcrun altool --validate-app`. A `--dev` flag signs with Apple Development and the dev entitlements for local runs.
- [ ] Sandboxed E2E (dev-signed): launch; confirm a drawing appears under `~/Library/Containers/dev.seyon.sketchshelf/Data/Library/Application Support/Excalidraw`; draw; quit and relaunch, and the drawing persists; rename and delete; File → Open a `.excalidraw` from `~/Downloads`; second `open` of the app does not crash; dark mode; `log show --predicate 'process == "sketchshelf"' --last 5m | grep -i deny` is clean.
- [ ] README "Development": document `scripts/appstore-build.sh`. Commit.

### Task 3: Listing — copy, pages, screenshots

**Files:** create `appstore/metadata/en-US/{name,subtitle,promotional_text,description,keywords,release_notes,support_url,marketing_url,privacy_url}.txt`, `appstore/metadata/{copyright,primary_category,secondary_category}.txt`, `appstore/review_information/*`, `appstore/screenshots/en-US/*.png`, `docs/privacy.html`, `docs/support.html`, `docs/index.html`, `dev/screenshots/` (frame compositor)

- [ ] Write the copy (limits: subtitle ≤30, promo ≤170, keywords ≤100, description ≤4000) with the attribution line from the spec. Run the `avoid-ai-writing` pass on it.
- [ ] Privacy page: no data collected, no network, files stay on the Mac. Support page: contact email and FAQ. Ask before pushing; then enable Pages from `/docs`.
- [ ] Screenshots: seed five showcase drawings, capture the real app window at 2880×1800 logical, and compose each into a framed headline slide (HTML → PNG at 2880×1800).
- [ ] Commit.

### Task 4: App Store Connect and submission

Needs the API key (Key ID, Issuer ID, `.p8`).

- [ ] Register bundle id `dev.seyon.sketchshelf` (platform MAC_OS) via the API, then create a `MAC_APP_STORE` profile with the Apple Distribution certificate and save it as `src-tauri/Sketchshelf.provisionprofile` (gitignored).
- [ ] User creates the app record (name Sketchshelf, SKU `sketchshelf`) and provides a review contact phone.
- [ ] `scripts/appstore-build.sh` → `xcrun altool --upload-app -f Sketchshelf.pkg -t macos --apiKey … --apiIssuer …`; wait for processing.
- [ ] `fastlane deliver` with metadata and screenshots; set price free, age rating 4+, privacy "Data Not Collected", automatic release; submit.
- [ ] Poll review status; fix and resubmit on rejection; report when live.
