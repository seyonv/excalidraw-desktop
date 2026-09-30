# Sketchshelf on the Mac App Store — design

## Goal

Ship this app to the Mac App Store as a free download anyone can install, with a
polished listing, and carry it through App Review to "Ready for Distribution".

Success = the app is live on the Store, installs, and a fresh user can create,
switch, rename, delete, and reopen drawings in the sandboxed build.

## Decisions already made

| Decision | Choice |
| --- | --- |
| Store name | **Sketchshelf** (fallback if taken: *Sketchshelf — Drawing Library*) |
| Excalidraw in the listing | Named in the description only, as a factual, non-affiliated attribution. Never in name, subtitle, keywords, or icon. |
| Bundle id | `dev.seyon.sketchshelf` (follows the team's `dev.seyon.*` convention) |
| App Store Connect access | Team API key (Admin). Everything by API except creating the app record, which Apple only allows in the website. |
| Local build vs Store build | Two builds, one codebase. `ex` stays unsandboxed with MCP; a Store config overlay adds the sandbox. |
| Price / availability | Free, all territories |
| Version | 1.0.0 (build 1) |

## 1. Rename

- `productName` → `Sketchshelf`, window title → `Sketchshelf`, identifier →
  `dev.seyon.sketchshelf`, Cargo/npm package names → `sketchshelf`.
- File type: keep the `.excalidraw` extension (it is the file format, and users
  must be able to open their files), but the UTI becomes
  `dev.seyon.sketchshelf.drawing`, name "Excalidraw Drawing".
- `mcp/lib/control.js` release-bundle path and the `ex` shell function in
  `~/.bash_profile` follow the new bundle name (`Sketchshelf.app`).
- The unsandboxed build keeps its library at
  `~/Library/Application Support/Excalidraw` — no code change, no migration for
  `ex`. The MCP server keeps working against it.
- README retitled to Sketchshelf, with the "built on Excalidraw" attribution
  kept. LICENSE keeps Excalidraw's MIT notice.
- **New original icon.** The current icon reads as a variant of Excalidraw's
  pencil mark. The new one: a hand-drawn stack of sketch cards on a shelf,
  Sketchshelf violet, macOS squircle. Drawn as SVG, rendered to 1024px, run
  through `tauri icon`.

## 2. Store build (sandbox)

A config overlay `src-tauri/tauri.appstore.conf.json`, passed with
`--config`, so the everyday build is untouched:

- `bundle.macOS.entitlements` → `src-tauri/Sketchshelf.appstore.entitlements`:
  - `com.apple.security.app-sandbox`
  - `com.apple.security.files.user-selected.read-write` (File → Open, export)
  - `com.apple.application-identifier` / `com.apple.developer.team-identifier`
  - `com.apple.security.network.client` **only if** testing shows WebKit or
    Excalidraw needs it. Fewer entitlements, easier review.
- `bundle.macOS.files` embeds the Mac App Store provisioning profile as
  `Contents/embedded.provisionprofile`.
- `bundle.category` = `Productivity`; Info.plist adds
  `ITSAppUsesNonExemptEncryption = false` (no export-compliance question on
  every upload).
- Universal binary (`--target universal-apple-darwin`), so Intel Macs can run
  it and the minimum OS can stay low.
- **Library location.** A sandboxed process's `HOME` is its container, so the
  existing `library_dir()` resolves to
  `~/Library/Containers/dev.seyon.sketchshelf/Data/Library/Application Support/Excalidraw`
  with no code change. Verified in testing rather than assumed.
- **Single instance.** `tauri-plugin-single-instance` binds a socket in
  `/tmp`, which the sandbox likely denies. If the sandboxed build fails or
  logs errors there, the plugin is registered only when the `appstore` Cargo
  feature is off. LaunchServices already keeps a Store app to one instance,
  so the invariant ("only one window per library") still holds.
- **Packaging.** `productbuild --sign "3rd Party Mac Developer Installer"`,
  producing `Sketchshelf.pkg`; app signed with `Apple Distribution`.
- One script, `scripts/appstore-build.sh`, does build → sign → pkg →
  validate, so this can be repeated for every update.

## 3. Listing

All listing text lives in `appstore/` in the repo (fastlane `deliver` layout),
so it is versioned and re-uploadable.

- **Name:** Sketchshelf
- **Subtitle (≤30):** A library for your sketches
- **Promotional text:** short hook, editable without review.
- **Description:** what it is, the feature list (library sidebar, autosave to
  real files, instant switching, rename/delete inline, inline rich text
  emphasis, side-drag re-wrapping, dark mode, offline, opens `.excalidraw`
  files), and the attribution line:
  *"Sketchshelf is built on the open-source Excalidraw editor (MIT licensed)
  and opens and saves standard .excalidraw files. It is an independent project
  and is not affiliated with or endorsed by Excalidraw."*
  The MCP/AI-agent feature is **not** listed: the Store build cannot ship it.
- **Keywords (≤100):** whiteboard, diagram, sketch, drawing, flowchart,
  wireframe, hand-drawn, notes, canvas, mind map. No competitor names.
- **Category:** Productivity; secondary Graphics & Design. Age rating 4+.
- **Privacy:** "Data Not Collected". Privacy policy and support pages as
  `docs/privacy.html` and `docs/support.html`, served by GitHub Pages from the
  public repo (`seyonv.github.io/excalidraw-desktop/…`).
- **Screenshots:** five at 2880×1800. Each shows the real app with good
  sample drawings, set in a framed composition with a one-line headline:
  1. The library — "Every drawing, one click away"
  2. Autosave to files — "Saved as you draw. Real files you own."
  3. Rich text — "Emphasis inside a single text block"
  4. Dark mode — "Easy on the eyes at night"
  5. Opening a `.excalidraw` file — "Opens your existing Excalidraw files"
  The app is captured from the running build and the frame composed as HTML
  rendered to PNG.
- **Review notes:** no login, no network, and how to exercise the library.

## 4. Testing (light)

- Existing suites: `cargo test`, `npm run test:mcp`, `npm run test:richtext`,
  `npm run build`.
- Everyday build: `ex` still launches, MCP `open_drawing` still opens it.
- Sandboxed build, signed with the Development certificate and the same
  entitlements (a Distribution-signed Store build will not launch locally):
  launch → create drawing → draw → confirm the file lands in the container →
  quit, relaunch, still there → rename → delete → File → Open an
  `.excalidraw` file from `~/Downloads` → dark mode. Console checked for
  sandbox denials.
- Before submitting: the uploaded build passes App Store Connect processing,
  and optionally a TestFlight install for you.

## 5. Submission

1. You: create an API key (Admin), save the `.p8` as
   `~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8`, send me the Key ID and
   Issuer ID.
2. Me: register bundle id `dev.seyon.sketchshelf` and create the Mac App Store
   provisioning profile, by API.
3. You: create the app record in App Store Connect (New App → macOS, name
   Sketchshelf, bundle id above, SKU `sketchshelf`), and give me a phone
   number for the review contact.
4. Me: build, upload the pkg, upload metadata and screenshots, set pricing,
   privacy and age rating, attach the build, submit for review.
5. Me: poll review status. On rejection, fix what the reviewer cites and
   resubmit. On approval, release manually or automatically after review
   (default: automatically).

Outward-facing steps I'll confirm with you first: pushing to GitHub and
enabling Pages, and the final "Submit for Review".

## Out of scope

- MCP in the Store build. It stays an add-on for the unsandboxed build.
- Migrating your own existing library into the Store app's container. Your
  daily driver stays the `ex` build; File → Open covers one-off moves.
- In-app purchases, iCloud sync, Windows/Linux stores.

## Risks

- **Name taken:** try the fallback, then ask.
- **Guideline 4.2 (minimum functionality) or 5.2 (IP):** the listing and
  review notes lead with what Sketchshelf adds (library, files, rich text),
  and the icon and name are original.
- **Sandbox surprises in WebKit** (fonts, workers, downloads): caught by the
  sandboxed E2E pass before anything is uploaded.
