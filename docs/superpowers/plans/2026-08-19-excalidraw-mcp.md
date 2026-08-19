# Excalidraw MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Claude Code, running in any repo, create and edit diagrams in this app's drawing library and have them appear live on the canvas.

**Architecture:** A dependency-light Node stdio MCP server writes `.excalidraw` files directly into `~/Documents/Excalidraw`. It never calls Tauri. A new file watcher in the Rust layer emits change events; `App.jsx` reloads the active drawing in place via `updateScene()` without remounting. A dot-prefixed control file plus the existing launcher applet handles opening and focusing the app.

**Tech Stack:** Node 20+ (ESM), `@modelcontextprotocol/sdk`, `node:test`, Rust `notify`, Tauri 2, React 18, `@excalidraw/excalidraw` 0.18.

**Spec:** `docs/superpowers/specs/2026-08-19-excalidraw-mcp-design.md`

## Global Constraints

- **npm, not pnpm.** This repo uses npm.
- **One runtime dependency only:** `@modelcontextprotocol/sdk`. Tests use the
  built-in `node:test` runner. Do not add jest, vitest, zod-standalone, dagre,
  mermaid, jsdom, or a logging library. The server boots on every Claude Code
  session, so cold start is a user-visible cost.
- **All MCP code is ESM** (`.js` with `import`). The repo's root `package.json`
  already declares `"type": "module"`.
- **The Rust `sanitize()` is authoritative.** The JS mirror exists only to
  predict filenames and is pinned by a shared fixture in both test suites.
- **Never bump `sceneKey`** for an external change. It remounts Excalidraw and
  discards scroll and zoom. Use `api.updateScene()`.
- **The bootstrap effect must still run exactly once.** The `bootstrappedRef`
  guard in `App.jsx` is load-bearing; new bootstrap work goes inside it.
- **Before every commit, revert vendored churn:** `git checkout -- public/`.
  A formatter hook reformats every file on edit, including the vendored
  Excalidraw bundle in `public/`.
- **Rust tests share `EXCALIDRAW_LIBRARY_DIR`, which is process-global.**
  Filesystem behaviour lives in one serial test on purpose. Add to the existing
  `library_operations` test rather than creating a second filesystem test.
- **README is updated in the same commit as user-facing behaviour** (Task 9).

## File Structure

| File | Responsibility |
| --- | --- |
| `mcp/lib/sanitize.js` | Mirror of the Rust name rules. Pure, no I/O. |
| `mcp/lib/library.js` | CRUD over the library directory. The only module doing file I/O. |
| `mcp/lib/scene.js` | Builds valid Excalidraw elements from a compact spec. Pure. |
| `mcp/lib/layout.js` | Layered graph layout: nodes+edges → positions. Pure, no Excalidraw knowledge. |
| `mcp/lib/control.js` | Writes `.open-request`, spawns the launcher. |
| `mcp/server.js` | MCP tool definitions. Wiring only — no logic of its own. |
| `mcp/fixtures/sanitize-cases.json` | Shared by the Rust and Node test suites. |
| `src-tauri/src/lib.rs` | Adds the file watcher and `.open-request` consumption. |
| `src/lib/drawings.js` | Adds event subscription. Still the only `invoke` caller. |
| `src/App.jsx` | Handles external changes: echo suppression, in-place reload. |

**Deviation from the spec, deliberate:** the spec put layout inside `scene.js`.
This plan splits `layout.js` (positions) from `scene.js` (Excalidraw elements).
They change for different reasons and each is independently testable — layout
needs no knowledge of `versionNonce`, and element construction needs no
knowledge of graph ranking.

---

### Task 1: Name sanitising, mirrored and pinned

**Files:**
- Create: `mcp/lib/sanitize.js`
- Create: `mcp/fixtures/sanitize-cases.json`
- Create: `mcp/lib/sanitize.test.js`
- Modify: `src-tauri/src/lib.rs` (add one test to the existing `mod tests`)

**Interfaces:**
- Consumes: nothing.
- Produces: `sanitize(name: string) => string` — always a non-empty single path
  component, max 120 characters.

The Rust rules, read from `src-tauri/src/lib.rs`, are: replace `/ \ : * ? " < > |`, NUL and any control character with `-`; trim whitespace, then trim leading and trailing `.`, then trim whitespace again; empty result becomes `"Untitled"`; truncate to 120 characters.

- [ ] **Step 1: Write the fixture**

Create `mcp/fixtures/sanitize-cases.json`. These cases come from the existing Rust tests plus the boundary cases those tests imply:

```json
[
  { "input": "../../etc/passwd", "expected": "-----etc-passwd" },
  { "input": "a/b", "expected": "a-b" },
  { "input": "..", "expected": "Untitled" },
  { "input": ".", "expected": "Untitled" },
  { "input": "   ", "expected": "Untitled" },
  { "input": "", "expected": "Untitled" },
  { "input": "back\\slash", "expected": "back-slash" },
  { "input": "C:\\Windows\\system32", "expected": "C--Windows-system32" },
  { "input": "My Diagram", "expected": "My Diagram" },
  { "input": "v1.2 sketch", "expected": "v1.2 sketch" },
  { "input": "  padded  ", "expected": "padded" },
  { "input": "trailing.", "expected": "trailing" },
  { "input": "Auth flow", "expected": "Auth flow" }
]
```

Note `"../../etc/passwd"` → each `/` and each `.` inside the string becomes a
character; only *leading and trailing* dots are trimmed. Verify each expectation
against the real Rust function in Step 2 rather than trusting this table.

- [ ] **Step 2: Write the failing Rust parity test**

Add to the existing `mod tests` in `src-tauri/src/lib.rs`:

```rust
/// The JS mirror in `mcp/lib/sanitize.js` must agree with this function on
/// every fixture case, or the MCP server predicts the wrong filename.
#[test]
fn sanitize_matches_shared_fixture() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("mcp/fixtures/sanitize-cases.json");
    let raw = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("could not read {}: {e}", path.display()));
    let cases: Vec<serde_json::Value> = serde_json::from_str(&raw).unwrap();
    assert!(!cases.is_empty(), "fixture is empty");
    for case in cases {
        let input = case["input"].as_str().unwrap();
        let expected = case["expected"].as_str().unwrap();
        assert_eq!(sanitize(input), expected, "mismatch for {input:?}");
    }
}
```

- [ ] **Step 3: Run it and fix the fixture, not the Rust**

Run: `cd src-tauri && cargo test sanitize_matches_shared_fixture`

If a case fails, the *fixture* is wrong — Rust is authoritative. Correct the
expected value in the JSON and re-run until green. Do not change `sanitize()`.

- [ ] **Step 4: Write the failing Node test**

Create `mcp/lib/sanitize.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sanitize } from "./sanitize.js";

const cases = JSON.parse(
  readFileSync(new URL("../fixtures/sanitize-cases.json", import.meta.url), "utf8"),
);

test("matches the Rust implementation on every fixture case", () => {
  assert.ok(cases.length > 0, "fixture is empty");
  for (const { input, expected } of cases) {
    assert.equal(sanitize(input), expected, `mismatch for ${JSON.stringify(input)}`);
  }
});

test("never produces a path separator or a leading dot", () => {
  for (const input of ["../x", "a/b", "..", "", "\u0000null"]) {
    const out = sanitize(input);
    assert.ok(out.length > 0);
    assert.ok(!out.includes("/") && !out.includes("\\"));
    assert.ok(!out.startsWith("."));
  }
});

test("caps length at 120 characters", () => {
  assert.equal(sanitize("x".repeat(500)).length, 120);
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `node --test mcp/lib/sanitize.test.js`
Expected: FAIL — `Cannot find module .../sanitize.js`

- [ ] **Step 6: Implement**

Create `mcp/lib/sanitize.js`:

```js
// Mirrors sanitize() in src-tauri/src/lib.rs. That function is the security
// boundary; this copy exists so the server can predict a filename without
// asking the app. mcp/fixtures/sanitize-cases.json pins the two together —
// if you change one, the other's test fails.

const ILLEGAL = new Set(["/", "\\", ":", "*", "?", '"', "<", ">", "|", "\0"]);

const isControl = (ch) => {
  const code = ch.codePointAt(0);
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
};

export function sanitize(name) {
  const cleaned = [...String(name ?? "")]
    .map((ch) => (ILLEGAL.has(ch) || isControl(ch) ? "-" : ch))
    .join("");
  const trimmed = cleaned.trim().replace(/^\.+|\.+$/g, "").trim();
  if (trimmed === "") return "Untitled";
  return [...trimmed].slice(0, 120).join("");
}
```

Rust's `trim_matches('.')` strips dots from both ends, and its `chars()` iteration is by Unicode scalar value — hence the spread operator rather than `slice()`, so an emoji in a name is not cut in half.

- [ ] **Step 7: Run both suites**

Run: `node --test mcp/lib/sanitize.test.js && cd src-tauri && cargo test`
Expected: PASS in both.

- [ ] **Step 8: Commit**

```bash
git checkout -- public/
git add mcp/lib/sanitize.js mcp/lib/sanitize.test.js mcp/fixtures/sanitize-cases.json src-tauri/src/lib.rs
git commit -m "Mirror the Rust name rules in JS, pinned by a shared fixture"
```

---

### Task 2: The library layer

**Files:**
- Create: `mcp/lib/library.js`
- Create: `mcp/lib/library.test.js`

**Interfaces:**
- Consumes: `sanitize(name)` from Task 1.
- Produces:
  - `libraryDir() => string`
  - `pathFor(name) => string`
  - `listDrawings() => Promise<Array<{name, modified}>>` — `modified` is epoch seconds, newest first
  - `readDrawing(name) => Promise<string>`
  - `writeDrawing(name, contents) => Promise<void>`
  - `uniqueName(base) => Promise<string>`
  - `renameDrawing(oldName, newName) => Promise<string>` — returns the name used
  - `deleteDrawing(name) => Promise<void>`
  - `exists(name) => Promise<boolean>`

Behaviour must match `src-tauri/src/lib.rs`: `EXCALIDRAW_LIBRARY_DIR` overrides
the default `~/Documents/Excalidraw`; the directory is created on first use;
collisions append `" 2"`, `" 3"`, and so on.

- [ ] **Step 1: Write the failing test**

Create `mcp/lib/library.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "excalidraw-lib-"));
process.env.EXCALIDRAW_LIBRARY_DIR = dir;

const lib = await import("./library.js");

test.after(() => rmSync(dir, { recursive: true, force: true }));

test("starts empty", async () => {
  assert.deepEqual(await lib.listDrawings(), []);
});

test("round-trips contents", async () => {
  await lib.writeDrawing("Round Trip", '{"elements":[]}');
  assert.equal(await lib.readDrawing("Round Trip"), '{"elements":[]}');
});

test("uniqueName appends a counter on collision", async () => {
  await lib.writeDrawing("Taken", "{}");
  assert.equal(await lib.uniqueName("Taken"), "Taken 2");
  await lib.writeDrawing("Taken 2", "{}");
  assert.equal(await lib.uniqueName("Taken"), "Taken 3");
  assert.equal(await lib.uniqueName("Free"), "Free");
});

test("rename moves the file and keeps contents", async () => {
  await lib.writeDrawing("Before", '{"n":1}');
  const used = await lib.renameDrawing("Before", "After");
  assert.equal(used, "After");
  assert.equal(await lib.readDrawing("After"), '{"n":1}');
  assert.equal(await lib.exists("Before"), false);
});

test("rename onto a taken name de-duplicates instead of overwriting", async () => {
  await lib.writeDrawing("Keep", '{"keep":true}');
  await lib.writeDrawing("Mover", '{"mover":true}');
  const used = await lib.renameDrawing("Mover", "Keep");
  assert.equal(used, "Keep 2");
  assert.equal(await lib.readDrawing("Keep"), '{"keep":true}');
});

test("renaming a drawing to its own name is a no-op", async () => {
  await lib.writeDrawing("Same", "{}");
  assert.equal(await lib.renameDrawing("Same", "Same"), "Same");
});

test("a malicious name cannot escape the library directory", async () => {
  await lib.writeDrawing("../../escaped", "{}");
  const names = (await lib.listDrawings()).map((d) => d.name);
  assert.ok(names.some((n) => n.includes("escaped")));
  assert.ok(!names.includes("../../escaped"));
});

test("delete removes it, and deleting again is not an error", async () => {
  await lib.writeDrawing("Doomed", "{}");
  await lib.deleteDrawing("Doomed");
  await lib.deleteDrawing("Doomed");
  assert.equal(await lib.exists("Doomed"), false);
});

test("ignores files that are not .excalidraw", async () => {
  writeFileSync(join(dir, "notes.txt"), "hello");
  const names = (await lib.listDrawings()).map((d) => d.name);
  assert.ok(!names.includes("notes"));
});

test("hides dot-prefixed control files", async () => {
  writeFileSync(join(dir, ".open-request"), "{}");
  const names = (await lib.listDrawings()).map((d) => d.name);
  assert.ok(!names.some((n) => n.startsWith(".")));
});

test("sorts newest first", async () => {
  await lib.writeDrawing("Older", "{}");
  await new Promise((r) => setTimeout(r, 1100));
  await lib.writeDrawing("Newer", "{}");
  const names = (await lib.listDrawings()).map((d) => d.name);
  assert.ok(names.indexOf("Newer") < names.indexOf("Older"));
});
```

The 1100ms wait in the last test is deliberate: `modified` is in whole seconds, matching the Rust `modified_secs`, so a shorter wait makes the test flaky.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test mcp/lib/library.test.js`
Expected: FAIL — `Cannot find module .../library.js`

- [ ] **Step 3: Implement**

Create `mcp/lib/library.js`:

```js
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { sanitize } from "./sanitize.js";

const EXT = "excalidraw";

/** `~/Documents/Excalidraw`, or wherever EXCALIDRAW_LIBRARY_DIR points. */
export function libraryDir() {
  return process.env.EXCALIDRAW_LIBRARY_DIR || join(homedir(), "Documents", "Excalidraw");
}

/** Resolves a name to a path guaranteed to sit directly inside the library. */
export function pathFor(name) {
  const dir = libraryDir();
  const path = join(dir, `${sanitize(name)}.${EXT}`);
  if (dirname(path) !== dir) throw new Error("invalid drawing name");
  return path;
}

async function ensureDir() {
  await fs.mkdir(libraryDir(), { recursive: true });
}

export async function exists(name) {
  try {
    await fs.stat(pathFor(name));
    return true;
  } catch {
    return false;
  }
}

export async function listDrawings() {
  await ensureDir();
  const entries = await fs.readdir(libraryDir());
  const drawings = [];
  for (const entry of entries) {
    if (entry.startsWith(".") || !entry.endsWith(`.${EXT}`)) continue;
    const name = entry.slice(0, -(EXT.length + 1));
    const stat = await fs.stat(join(libraryDir(), entry));
    drawings.push({ name, modified: Math.floor(stat.mtimeMs / 1000) });
  }
  drawings.sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
  return drawings;
}

export async function readDrawing(name) {
  return fs.readFile(pathFor(name), "utf8");
}

export async function writeDrawing(name, contents) {
  await ensureDir();
  await fs.writeFile(pathFor(name), contents, "utf8");
}

/** Appends " 2", " 3", ... until the name is free. */
export async function uniqueName(base) {
  const clean = sanitize(base);
  let candidate = clean;
  let n = 1;
  while (await exists(candidate)) {
    n += 1;
    candidate = `${clean} ${n}`;
  }
  return candidate;
}

/** Returns the name actually used, which may differ if newName collided. */
export async function renameDrawing(oldName, newName) {
  const from = pathFor(oldName);
  if (!(await exists(oldName))) throw new Error(`${oldName} no longer exists`);
  if (pathFor(newName) === from) return sanitize(newName);
  const used = await uniqueName(newName);
  await fs.rename(from, pathFor(used));
  return used;
}

export async function deleteDrawing(name) {
  await fs.rm(pathFor(name), { force: true });
}
```

- [ ] **Step 4: Run the test**

Run: `node --test mcp/lib/library.test.js`
Expected: PASS (about 1.2s, due to the mtime test).

- [ ] **Step 5: Commit**

```bash
git checkout -- public/
git add mcp/lib/library.js mcp/lib/library.test.js
git commit -m "Add the MCP library layer over the drawings directory"
```

---

### Task 3: Graph layout

**Files:**
- Create: `mcp/lib/layout.js`
- Create: `mcp/lib/layout.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `layout(nodes, edges, options) => Array<{id, text, shape, x, y, width, height}>`
  - `nodes`: `Array<{id, text, shape}>` — already normalised by the caller
  - `edges`: `Array<{from, to, label}>`
  - `options`: `{direction: "down" | "right"}`
  - Also exports `measure(text) => {width, height}` for reuse by tests.

- [ ] **Step 1: Write the failing test**

Create `mcp/lib/layout.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { layout } from "./layout.js";

const nodes = (...ids) => ids.map((id) => ({ id, text: id, shape: "rect" }));
const edge = (from, to) => ({ from, to, label: undefined });

test("no edges lays out as a single row", () => {
  const out = layout(nodes("A", "B", "C"), [], { direction: "down" });
  assert.equal(out.length, 3);
  assert.equal(new Set(out.map((n) => n.y)).size, 1, "all on one row");
  const xs = out.map((n) => n.x);
  assert.deepEqual(xs, [...xs].sort((a, b) => a - b), "ordered left to right");
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i].x >= out[i - 1].x + out[i - 1].width, "boxes do not overlap");
  }
});

test("a linear chain ranks in order, flowing down", () => {
  const out = layout(nodes("A", "B", "C"), [edge("A", "B"), edge("B", "C")], {
    direction: "down",
  });
  const y = Object.fromEntries(out.map((n) => [n.id, n.y]));
  assert.ok(y.A < y.B && y.B < y.C);
});

test("direction right flows along x instead", () => {
  const out = layout(nodes("A", "B"), [edge("A", "B")], { direction: "right" });
  const at = Object.fromEntries(out.map((n) => [n.id, n]));
  assert.ok(at.A.x < at.B.x);
  assert.equal(at.A.y, at.B.y);
});

test("a cycle terminates and places every node exactly once", () => {
  const out = layout(nodes("A", "B", "C"), [edge("A", "B"), edge("B", "C"), edge("C", "A")], {
    direction: "down",
  });
  assert.equal(out.length, 3);
  assert.equal(new Set(out.map((n) => n.id)).size, 3);
});

test("a self-loop terminates", () => {
  const out = layout(nodes("A"), [edge("A", "A")], { direction: "down" });
  assert.equal(out.length, 1);
});

test("a disconnected node still gets placed", () => {
  const out = layout(nodes("A", "B", "Lonely"), [edge("A", "B")], { direction: "down" });
  assert.equal(out.length, 3);
  assert.ok(out.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
});

test("boxes grow to fit long text", () => {
  const [small, big] = layout(
    [
      { id: "s", text: "Hi", shape: "rect" },
      { id: "b", text: "A considerably longer label than that one", shape: "rect" },
    ],
    [],
    { direction: "down" },
  );
  assert.ok(big.width > small.width);
});

test("multi-line text grows the box vertically", () => {
  const [one, two] = layout(
    [
      { id: "a", text: "One", shape: "rect" },
      { id: "b", text: "One\nTwo\nThree", shape: "rect" },
    ],
    [],
    { direction: "down" },
  );
  assert.ok(two.height > one.height);
});

test("ranks are centred on the flow axis", () => {
  // A fans out to B, C, D — A should sit near the middle of that row.
  const out = layout(nodes("A", "B", "C", "D"), [edge("A", "B"), edge("A", "C"), edge("A", "D")], {
    direction: "down",
  });
  const at = Object.fromEntries(out.map((n) => [n.id, n]));
  const centre = (n) => n.x + n.width / 2;
  const rowLeft = Math.min(centre(at.B), centre(at.C), centre(at.D));
  const rowRight = Math.max(centre(at.B), centre(at.C), centre(at.D));
  assert.ok(centre(at.A) > rowLeft && centre(at.A) < rowRight);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test mcp/lib/layout.test.js`
Expected: FAIL — `Cannot find module .../layout.js`

- [ ] **Step 3: Implement**

Create `mcp/lib/layout.js`:

```js
// Layered layout: rank by distance from the roots, then centre each rank.
// Deliberately simple — no crossing minimisation. If dense graphs become a
// real complaint, `dagre` (~200KB, no DOM) is the upgrade path.

const FONT_SIZE = 20;
const CHAR_WIDTH = 9; // rough advance width of Excalifont at size 20
const LINE_HEIGHT = 1.25;
const WRAP_AT = 28; // characters
const PAD_X = 24;
const PAD_Y = 20;
const MIN_WIDTH = 120;
const MIN_HEIGHT = 60;
const GAP_ALONG = 120; // between ranks
const GAP_ACROSS = 60; // between siblings in a rank

/** Wraps on whitespace at WRAP_AT columns, honouring explicit newlines. */
export function wrap(text) {
  const lines = [];
  for (const paragraph of String(text ?? "").split("\n")) {
    if (paragraph.length <= WRAP_AT) {
      lines.push(paragraph);
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (line && line.length + 1 + word.length > WRAP_AT) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Box size needed to hold `text`. */
export function measure(text) {
  const lines = wrap(text);
  const widest = lines.reduce((max, l) => Math.max(max, l.length), 0);
  return {
    width: Math.max(MIN_WIDTH, Math.round(widest * CHAR_WIDTH + PAD_X * 2)),
    height: Math.max(MIN_HEIGHT, Math.round(lines.length * FONT_SIZE * LINE_HEIGHT + PAD_Y * 2)),
  };
}

/** Assigns every node a rank: 0 for roots, else 1 + max(rank of predecessors). */
function rank(nodes, edges) {
  const ids = new Set(nodes.map((n) => n.id));
  const incoming = new Map(nodes.map((n) => [n.id, 0]));
  const out = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    out.get(e.from).push(e.to);
    incoming.set(e.to, incoming.get(e.to) + 1);
  }

  const ranks = new Map();
  // Roots first; if a cycle leaves nothing unvisited, seed with the first
  // remaining node so every node is still placed.
  let frontier = nodes.filter((n) => incoming.get(n.id) === 0).map((n) => n.id);
  if (frontier.length === 0 && nodes.length > 0) frontier = [nodes[0].id];
  for (const id of frontier) ranks.set(id, 0);

  while (frontier.length) {
    const next = [];
    for (const id of frontier) {
      for (const to of out.get(id) ?? []) {
        if (ranks.has(to)) continue; // back-edge: keep the rank it already has
        ranks.set(to, ranks.get(id) + 1);
        next.push(to);
      }
    }
    frontier = next;
  }

  // Anything unreachable (disconnected, or stranded behind a cycle) goes last.
  const maxRank = ranks.size ? Math.max(...ranks.values()) : 0;
  for (const n of nodes) if (!ranks.has(n.id)) ranks.set(n.id, maxRank + 1);
  return ranks;
}

export function layout(nodes, edges, { direction = "down" } = {}) {
  if (nodes.length === 0) return [];
  const down = direction !== "right";
  const ranks = rank(nodes, edges);

  const byRank = new Map();
  for (const n of nodes) {
    const r = ranks.get(n.id);
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r).push({ ...n, ...measure(n.text) });
  }

  const ordered = [...byRank.keys()].sort((a, b) => a - b);
  // Across-axis extent of each rank, so ranks can be centred against each other.
  const extents = new Map();
  for (const r of ordered) {
    const row = byRank.get(r);
    const across = row.reduce(
      (sum, n) => sum + (down ? n.width : n.height) + GAP_ACROSS,
      -GAP_ACROSS,
    );
    extents.set(r, across);
  }
  const widest = Math.max(...extents.values());

  const placed = [];
  let along = 0;
  for (const r of ordered) {
    const row = byRank.get(r);
    let across = (widest - extents.get(r)) / 2;
    const depth = row.reduce((max, n) => Math.max(max, down ? n.height : n.width), 0);
    for (const n of row) {
      placed.push({
        ...n,
        x: Math.round(down ? across : along),
        y: Math.round(down ? along : across),
      });
      across += (down ? n.width : n.height) + GAP_ACROSS;
    }
    along += depth + GAP_ALONG;
  }
  return placed;
}
```

- [ ] **Step 4: Run the test**

Run: `node --test mcp/lib/layout.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git checkout -- public/
git add mcp/lib/layout.js mcp/lib/layout.test.js
git commit -m "Add layered graph layout for generated diagrams"
```

---

### Task 4: Excalidraw element construction

**Files:**
- Create: `mcp/lib/scene.js`
- Create: `mcp/lib/scene.test.js`

**Interfaces:**
- Consumes: `layout(nodes, edges, options)` and `wrap(text)` from Task 3.
- Produces:
  - `buildScene({nodes, edges, direction}) => {type, version, source, elements, appState, files}`
  - `emptyScene() => sceneObject`
  - `describe(sceneJson) => Array<{id, type, text, x, y, width, height, connects}>`
  - `parseScene(contents) => {elements, appState, files}`
  - `serializeScene(scene) => string`

The element shape below was taken from real files in the user's library, written by this exact Excalidraw version — not from documentation.

**Two things this deliberately does not do:**
1. **It omits `index`.** Excalidraw's `restore()` runs on `initialData` and
   assigns valid fractional indices via `syncInvalidIndices`. Array order
   defines z-order. Hand-generating fractional index keys is a bug farm.
2. **It uses bound text** (`containerId` on the label, `boundElements` on the
   container) rather than a free text element grouped with the box, so labels
   wrap and move with their shape. Step 6 verifies this renders correctly.

- [ ] **Step 1: Write the failing test**

Create `mcp/lib/scene.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildScene, emptyScene, describe, parseScene, serializeScene } from "./scene.js";

const REQUIRED = [
  "id", "type", "x", "y", "width", "height", "angle", "strokeColor",
  "backgroundColor", "fillStyle", "strokeWidth", "strokeStyle", "roughness",
  "opacity", "groupIds", "frameId", "roundness", "seed", "version",
  "versionNonce", "isDeleted", "boundElements", "updated", "link", "locked",
];

test("an empty scene is a valid excalidraw file", () => {
  const scene = emptyScene();
  assert.equal(scene.type, "excalidraw");
  assert.equal(scene.version, 2);
  assert.deepEqual(scene.elements, []);
  assert.deepEqual(JSON.parse(serializeScene(scene)).elements, []);
});

test("every element carries every field Excalidraw requires", () => {
  const scene = buildScene({
    nodes: [{ id: "a", text: "A" }, { id: "b", text: "B" }],
    edges: [{ from: "a", to: "b", label: "goes to" }],
  });
  for (const el of scene.elements) {
    for (const field of REQUIRED) {
      assert.ok(field in el, `${el.type} is missing ${field}`);
    }
    assert.equal(typeof el.id, "string");
    assert.ok(el.id.length > 0);
  }
});

test("element ids are unique", () => {
  const scene = buildScene({
    nodes: [{ id: "a", text: "A" }, { id: "b", text: "B" }],
    edges: [{ from: "a", to: "b" }],
  });
  const ids = scene.elements.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("three bare strings become three labelled rectangles", () => {
  const scene = buildScene({ nodes: ["X", "Y", "Z"] });
  const rects = scene.elements.filter((e) => e.type === "rectangle");
  const texts = scene.elements.filter((e) => e.type === "text");
  assert.equal(rects.length, 3);
  assert.equal(texts.length, 3);
  assert.deepEqual(texts.map((t) => t.text).sort(), ["X", "Y", "Z"]);
});

test("a label is bound to its container both ways", () => {
  const scene = buildScene({ nodes: [{ id: "a", text: "Hello" }] });
  const rect = scene.elements.find((e) => e.type === "rectangle");
  const text = scene.elements.find((e) => e.type === "text");
  assert.equal(text.containerId, rect.id);
  assert.deepEqual(rect.boundElements, [{ type: "text", id: text.id }]);
  assert.equal(text.textAlign, "center");
  assert.equal(text.verticalAlign, "middle");
});

test("an arrow binds to both shapes, and both shapes know about the arrow", () => {
  const scene = buildScene({
    nodes: [{ id: "a", text: "A" }, { id: "b", text: "B" }],
    edges: [{ from: "a", to: "b" }],
  });
  const arrow = scene.elements.find((e) => e.type === "arrow");
  const rects = scene.elements.filter((e) => e.type === "rectangle");
  assert.equal(arrow.startBinding.elementId, rects[0].id);
  assert.equal(arrow.endBinding.elementId, rects[1].id);
  assert.equal(arrow.endArrowhead, "arrow");
  assert.equal(arrow.points.length, 2);
  for (const rect of rects) {
    assert.ok(rect.boundElements.some((b) => b.type === "arrow" && b.id === arrow.id));
  }
});

test("an edge label becomes a text element bound to the arrow", () => {
  const scene = buildScene({
    nodes: [{ id: "a", text: "A" }, { id: "b", text: "B" }],
    edges: [{ from: "a", to: "b", label: "POST /login" }],
  });
  const arrow = scene.elements.find((e) => e.type === "arrow");
  const label = scene.elements.find((e) => e.type === "text" && e.containerId === arrow.id);
  assert.ok(label, "arrow label exists");
  assert.equal(label.text, "POST /login");
});

test("shapes map to the right element types", () => {
  const scene = buildScene({
    nodes: [
      { id: "r", text: "R", shape: "rect" },
      { id: "e", text: "E", shape: "ellipse" },
      { id: "d", text: "D", shape: "diamond" },
      { id: "c", text: "C", shape: "cylinder" },
      { id: "t", text: "T", shape: "text" },
    ],
  });
  const types = scene.elements.map((e) => e.type);
  assert.ok(types.includes("rectangle"));
  assert.ok(types.includes("ellipse"));
  assert.ok(types.includes("diamond"));
  // cylinder has no native type; it falls back to a rounded rectangle
  assert.equal(scene.elements.filter((e) => e.type === "rectangle").length, 2);
  // a `text` node is a bare text element with no container
  const bare = scene.elements.filter((e) => e.type === "text" && e.containerId === null);
  assert.equal(bare.length, 1);
  assert.equal(bare[0].text, "T");
});

test("an edge naming an unknown node is skipped, not fatal", () => {
  const scene = buildScene({
    nodes: [{ id: "a", text: "A" }],
    edges: [{ from: "a", to: "ghost" }],
  });
  assert.equal(scene.elements.filter((e) => e.type === "arrow").length, 0);
});

test("describe summarises without dumping raw json", () => {
  const scene = buildScene({
    nodes: [{ id: "a", text: "A" }, { id: "b", text: "B" }],
    edges: [{ from: "a", to: "b" }],
  });
  const summary = describe(serializeScene(scene));
  const box = summary.find((s) => s.text === "A");
  assert.ok(box.id && Number.isFinite(box.x) && Number.isFinite(box.width));
  assert.ok(!("seed" in box), "summary must not carry Excalidraw internals");
  assert.ok(!("versionNonce" in box));
});

test("parseScene tolerates junk", () => {
  assert.deepEqual(parseScene("not json"), { elements: [], appState: {}, files: {} });
  assert.deepEqual(parseScene(""), { elements: [], appState: {}, files: {} });
  assert.deepEqual(parseScene('{"elements":"nope"}').elements, []);
});

test("parseScene drops collaborators, which must never be serialised", () => {
  const parsed = parseScene('{"elements":[],"appState":{"theme":"dark","collaborators":{}}}');
  assert.equal(parsed.appState.theme, "dark");
  assert.ok(!("collaborators" in parsed.appState));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test mcp/lib/scene.test.js`
Expected: FAIL — `Cannot find module .../scene.js`

- [ ] **Step 3: Implement**

Create `mcp/lib/scene.js`:

```js
// Builds Excalidraw elements. Field set taken from real files written by
// @excalidraw/excalidraw 0.18 — see the user's library, not the docs.
//
// `index` is deliberately omitted: Excalidraw's restore() assigns valid
// fractional indices on load, and array order gives z-order.

import { randomBytes } from "node:crypto";
import { layout, measure, wrap } from "./layout.js";

const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
const FONT_SIZE = 20;
const FONT_FAMILY = 5; // Excalifont, what 0.18 writes for hand-drawn text
const LINE_HEIGHT = 1.25;
const BOUND_PADDING = 5;
const ARROW_GAP = 8;

function newId() {
  return [...randomBytes(21)].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
}

const seed = () => Math.floor(Math.random() * 2 ** 31);

function base(type, { x, y, width, height, roundness = null }) {
  return {
    id: newId(),
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness,
    seed: seed(),
    version: 1,
    versionNonce: seed(),
    isDeleted: false,
    boundElements: [],
    updated: Date.now(),
    link: null,
    locked: false,
  };
}

function textElement(text, { x, y, width, height, containerId = null }) {
  const lines = wrap(text);
  return {
    ...base("text", { x, y, width, height }),
    text: lines.join("\n"),
    originalText: String(text),
    fontSize: FONT_SIZE,
    fontFamily: FONT_FAMILY,
    textAlign: containerId ? "center" : "left",
    verticalAlign: containerId ? "middle" : "top",
    containerId,
    autoResize: true,
    lineHeight: LINE_HEIGHT,
  };
}

/** A label centred inside `container`, bound both ways. */
function boundLabel(text, container) {
  const lines = wrap(text);
  const height = lines.length * FONT_SIZE * LINE_HEIGHT;
  const width = Math.max(0, container.width - BOUND_PADDING * 2);
  const label = textElement(text, {
    x: container.x + BOUND_PADDING,
    y: container.y + (container.height - height) / 2,
    width,
    height,
    containerId: container.id,
  });
  container.boundElements.push({ type: "text", id: label.id });
  return label;
}

const SHAPE_TYPE = {
  rect: "rectangle",
  ellipse: "ellipse",
  diamond: "diamond",
  cylinder: "rectangle", // no native cylinder; a rounded box reads the same
};

/** Accepts "A" or {id, text, shape} and fills in the gaps. */
function normaliseNode(node) {
  if (typeof node === "string") return { id: node, text: node, shape: "rect" };
  const text = String(node.text ?? node.id ?? "");
  return { id: String(node.id ?? text), text, shape: node.shape ?? "rect" };
}

/** Accepts ["a","b"], ["a","b","label"] or {from,to,label}. */
function normaliseEdge(edge) {
  if (Array.isArray(edge)) return { from: edge[0], to: edge[1], label: edge[2] };
  return { from: edge.from, to: edge.to, label: edge.label };
}

/** Centre-to-centre arrow between two boxes, stopping ARROW_GAP short. */
function arrowBetween(from, to, label) {
  const fx = from.x + from.width / 2;
  const fy = from.y + from.height / 2;
  const tx = to.x + to.width / 2;
  const ty = to.y + to.height / 2;
  const dx = tx - fx;
  const dy = ty - fy;
  const len = Math.hypot(dx, dy) || 1;
  // Pull each end back towards the box edge along the centre line.
  const shrink = (box) => Math.min(box.width, box.height) / 2 + ARROW_GAP;
  const sx = fx + (dx / len) * shrink(from);
  const sy = fy + (dy / len) * shrink(from);
  const ex = tx - (dx / len) * shrink(to);
  const ey = ty - (dy / len) * shrink(to);

  const arrow = {
    ...base("arrow", {
      x: sx,
      y: sy,
      width: Math.abs(ex - sx),
      height: Math.abs(ey - sy),
      roundness: { type: 2 },
    }),
    points: [
      [0, 0],
      [ex - sx, ey - sy],
    ],
    lastCommittedPoint: null,
    startBinding: { elementId: from.id, focus: 0, gap: ARROW_GAP },
    endBinding: { elementId: to.id, focus: 0, gap: ARROW_GAP },
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false,
  };
  from.boundElements.push({ type: "arrow", id: arrow.id });
  to.boundElements.push({ type: "arrow", id: arrow.id });

  const elements = [arrow];
  if (label) {
    const size = measure(label);
    const labelEl = textElement(label, {
      x: (sx + ex) / 2 - size.width / 2,
      y: (sy + ey) / 2 - FONT_SIZE / 2,
      width: size.width,
      height: FONT_SIZE * LINE_HEIGHT,
      containerId: arrow.id,
    });
    arrow.boundElements.push({ type: "text", id: labelEl.id });
    elements.push(labelEl);
  }
  return elements;
}

export function emptyScene() {
  return {
    type: "excalidraw",
    version: 2,
    source: "excalidraw-mcp",
    elements: [],
    appState: {},
    files: {},
  };
}

export function buildScene({ nodes = [], edges = [], direction = "down" } = {}) {
  const scene = emptyScene();
  const normalisedNodes = nodes.map(normaliseNode);
  const normalisedEdges = edges.map(normaliseEdge);
  if (normalisedNodes.length === 0) return scene;

  const placed = layout(normalisedNodes, normalisedEdges, { direction });
  const byNodeId = new Map();

  for (const node of placed) {
    if (node.shape === "text") {
      const el = textElement(node.text, {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
      });
      byNodeId.set(node.id, el);
      scene.elements.push(el);
      continue;
    }
    const shape = {
      ...base(SHAPE_TYPE[node.shape] ?? "rectangle", {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        roundness: { type: 3 },
      }),
    };
    byNodeId.set(node.id, shape);
    scene.elements.push(shape, boundLabel(node.text, shape));
  }

  for (const edge of normalisedEdges) {
    const from = byNodeId.get(edge.from);
    const to = byNodeId.get(edge.to);
    if (!from || !to || from === to) continue;
    scene.elements.push(...arrowBetween(from, to, edge.label));
  }
  return scene;
}

/** A compact summary — reading a scene back must not cost thousands of tokens. */
export function describe(contents) {
  const { elements } = parseScene(contents);
  const labels = new Map();
  for (const el of elements) {
    if (el.type === "text" && el.containerId) labels.set(el.containerId, el.text);
  }
  return elements
    .filter((el) => !el.isDeleted && !(el.type === "text" && el.containerId))
    .map((el) => {
      const summary = {
        id: el.id,
        type: el.type,
        text: labels.get(el.id) ?? el.text ?? null,
        x: Math.round(el.x),
        y: Math.round(el.y),
        width: Math.round(el.width),
        height: Math.round(el.height),
      };
      if (el.type === "arrow") {
        summary.connects = {
          from: el.startBinding?.elementId ?? null,
          to: el.endBinding?.elementId ?? null,
        };
      }
      return summary;
    });
}

/** Parses file contents, tolerating junk. Mirrors src/lib/drawings.js. */
export function parseScene(contents) {
  const empty = { elements: [], appState: {}, files: {} };
  if (!contents) return empty;
  try {
    const data = JSON.parse(contents);
    const { collaborators, ...appState } = data.appState ?? {};
    return {
      elements: Array.isArray(data.elements) ? data.elements : [],
      appState,
      files: data.files ?? {},
    };
  } catch {
    return empty;
  }
}

export function serializeScene(scene) {
  return JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "excalidraw-mcp",
    elements: scene.elements ?? [],
    appState: scene.appState ?? {},
    files: scene.files ?? {},
  });
}
```

- [ ] **Step 4: Run the test**

Run: `node --test mcp/lib/scene.test.js`
Expected: PASS.

- [ ] **Step 5: Verify the output actually renders**

Unit tests prove the JSON shape, not that Excalidraw is happy with it. Generate a real file and open it:

```bash
node -e '
import("./mcp/lib/scene.js").then(async (s) => {
  const lib = await import("./mcp/lib/library.js");
  const scene = s.buildScene({
    direction: "down",
    nodes: [
      { id: "c", text: "Client" },
      { id: "api", text: "API" },
      { id: "db", text: "Postgres", shape: "cylinder" },
      { id: "note", text: "sanity check", shape: "text" },
    ],
    edges: [["c", "api", "POST /login"], ["api", "db"]],
  });
  await lib.writeDrawing("MCP smoke test", s.serializeScene(scene));
  console.log("wrote", lib.pathFor("MCP smoke test"));
});
'
```

Then `npm run tauri dev`, click **MCP smoke test** in the sidebar, and confirm:
- every box has its label **centred inside it**, not offset or clipped
- arrows connect the boxes and stay attached when you drag a box
- the edge label sits on the arrow
- no console errors about invalid elements

- [ ] **Step 6: Fix bound-text geometry if labels render wrong**

If labels are off-centre or clipped, the fallback is a free text element grouped with its box: drop `containerId`, drop the container's `boundElements` text entry, and give the box and text a shared `groupIds: [newId()]`. Update the two bound-label assertions in `scene.test.js` to assert the shared group id instead. Take this path only if Step 5 actually looks wrong — bound text is the better representation.

- [ ] **Step 7: Commit**

```bash
git checkout -- public/
git add mcp/lib/scene.js mcp/lib/scene.test.js
git commit -m "Build valid Excalidraw elements from a compact diagram spec"
```

---

### Task 5: Opening and focusing the app

**Files:**
- Create: `mcp/lib/control.js`
- Create: `mcp/lib/control.test.js`

**Interfaces:**
- Consumes: `libraryDir()` from Task 2.
- Produces:
  - `requestOpen(name) => Promise<void>` — honours `EXCALIDRAW_MCP_FOCUS`
  - `OPEN_REQUEST_FILE` — the constant `".open-request"`

`EXCALIDRAW_MCP_FOCUS`: `focus` (default) launches or foregrounds the app;
`switch` writes the request but never launches or foregrounds; `off` does
nothing at all. `EXCALIDRAW_APP` overrides the launcher, default
`open -a "Excalidraw Dev"`.

- [ ] **Step 1: Write the failing test**

Create `mcp/lib/control.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "excalidraw-ctl-"));
process.env.EXCALIDRAW_LIBRARY_DIR = dir;
// Never launch a real app from the test suite.
process.env.EXCALIDRAW_APP = "true";

const { requestOpen, OPEN_REQUEST_FILE } = await import("./control.js");
const requestPath = join(dir, OPEN_REQUEST_FILE);

test.after(() => rmSync(dir, { recursive: true, force: true }));

test("writes a request naming the drawing", async () => {
  process.env.EXCALIDRAW_MCP_FOCUS = "focus";
  await requestOpen("Auth flow");
  assert.deepEqual(JSON.parse(readFileSync(requestPath, "utf8")).name, "Auth flow");
});

test("the request file is dot-prefixed so it stays out of the sidebar", () => {
  assert.ok(OPEN_REQUEST_FILE.startsWith("."));
});

test("switch mode still writes the request", async () => {
  rmSync(requestPath, { force: true });
  process.env.EXCALIDRAW_MCP_FOCUS = "switch";
  await requestOpen("Auth flow");
  assert.ok(existsSync(requestPath));
});

test("off mode writes nothing", async () => {
  rmSync(requestPath, { force: true });
  process.env.EXCALIDRAW_MCP_FOCUS = "off";
  await requestOpen("Auth flow");
  assert.equal(existsSync(requestPath), false);
});

test("a launcher failure never throws", async () => {
  process.env.EXCALIDRAW_MCP_FOCUS = "focus";
  process.env.EXCALIDRAW_APP = "definitely-not-a-real-command-xyz";
  await requestOpen("Auth flow"); // must resolve, not reject
  process.env.EXCALIDRAW_APP = "true";
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test mcp/lib/control.test.js`
Expected: FAIL — `Cannot find module .../control.js`

- [ ] **Step 3: Implement**

Create `mcp/lib/control.js`:

```js
// The app-facing control channel. A dot-prefixed file in the library dir that
// the Tauri watcher picks up — no port, no IPC, and it works whether the app
// is already running or is about to start.

import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { libraryDir } from "./library.js";

export const OPEN_REQUEST_FILE = ".open-request";

const focusMode = () => process.env.EXCALIDRAW_MCP_FOCUS || "focus";

/** Default targets the existing launcher applet, which handles launch-or-focus. */
function launcher() {
  const custom = process.env.EXCALIDRAW_APP;
  if (custom) return [custom, []];
  return ["open", ["-a", "Excalidraw Dev"]];
}

export async function requestOpen(name) {
  const mode = focusMode();
  if (mode === "off") return;

  await fs.mkdir(libraryDir(), { recursive: true });
  await fs.writeFile(
    join(libraryDir(), OPEN_REQUEST_FILE),
    JSON.stringify({ name, at: Date.now() }),
    "utf8",
  );
  if (mode !== "focus") return;

  // Fire and forget. The app not being installed is not a tool failure —
  // the file is written either way and the sidebar picks it up later.
  await new Promise((resolve) => {
    try {
      const [cmd, args] = launcher();
      const child = spawn(cmd, args, { stdio: "ignore", detached: true });
      child.on("error", () => resolve());
      child.on("spawn", () => {
        child.unref();
        resolve();
      });
    } catch {
      resolve();
    }
  });
}
```

- [ ] **Step 4: Run the test**

Run: `node --test mcp/lib/control.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git checkout -- public/
git add mcp/lib/control.js mcp/lib/control.test.js
git commit -m "Add the open/focus control channel for the desktop app"
```

---

### Task 6: The MCP server

**Files:**
- Create: `mcp/server.js`
- Create: `mcp/server.test.js`
- Modify: `package.json` (add the dependency and a test script)

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: `createServer() => McpServer` — exported so tests can drive it
  in-process. The file also self-starts on stdio when run directly.

Tools: `draw`, `edit`, `list_drawings`, `describe_scene`, `rename_drawing`,
`delete_drawing`, `open_drawing`.

- [ ] **Step 1: Add the dependency**

```bash
npm install @modelcontextprotocol/sdk
```

Then add to `package.json` scripts: `"test:mcp": "node --test mcp/"`.

- [ ] **Step 2: Check the SDK's tool-registration API before writing code**

The SDK's surface has changed across majors. Confirm what version 1.30 exposes:

```bash
node -e 'import("@modelcontextprotocol/sdk/server/mcp.js").then(m => console.log(Object.keys(m)))'
node -e 'import("@modelcontextprotocol/sdk/server/mcp.js").then(m => console.log(Object.getOwnPropertyNames(m.McpServer.prototype)))'
node -e 'import("@modelcontextprotocol/sdk/server/stdio.js").then(m => console.log(Object.keys(m)))'
node -e 'import("@modelcontextprotocol/sdk/client/index.js").then(m => console.log(Object.keys(m)))'
node -e 'import("@modelcontextprotocol/sdk/inMemory.js").then(m => console.log(Object.keys(m)))'
```

Expect `McpServer` with `registerTool(name, {title, description, inputSchema}, handler)`, `StdioServerTransport`, `Client`, and `InMemoryTransport.createLinkedPair()`. If `registerTool` is absent, fall back to `server.tool(name, schema, handler)`. **Write the code against what these commands actually print**, not against this plan's guess.

The SDK expects Zod schemas for `inputSchema` and ships Zod as a transitive dependency, so importing `zod` in `mcp/server.js` adds nothing to the install. If the printed API instead accepts raw JSON Schema, use that and skip the Zod import.

- [ ] **Step 3: Write the failing test**

Create `mcp/server.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "excalidraw-srv-"));
process.env.EXCALIDRAW_LIBRARY_DIR = dir;
process.env.EXCALIDRAW_MCP_FOCUS = "off"; // never launch an app from tests

const { createServer } = await import("./server.js");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

async function connect() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
  await Promise.all([createServer().connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const json = (result) => JSON.parse(result.content[0].text);

test.after(() => rmSync(dir, { recursive: true, force: true }));

test("exposes every tool", async () => {
  const client = await connect();
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "delete_drawing", "describe_scene", "draw", "edit",
    "list_drawings", "open_drawing", "rename_drawing",
  ]);
});

test("draw creates a drawing and reports the name used", async () => {
  const client = await connect();
  const out = json(await client.callTool({
    name: "draw",
    arguments: { name: "Stack", nodes: ["X", "Y", "Z"] },
  }));
  assert.equal(out.name, "Stack");
  assert.equal(out.elements, 6); // 3 boxes + 3 labels

  const list = json(await client.callTool({ name: "list_drawings", arguments: {} }));
  assert.ok(list.some((d) => d.name === "Stack"));
});

test("draw with replace overwrites rather than duplicating", async () => {
  const client = await connect();
  await client.callTool({ name: "draw", arguments: { name: "Replaced", nodes: ["A"] } });
  await client.callTool({ name: "draw", arguments: { name: "Replaced", nodes: ["A", "B"] } });
  const list = json(await client.callTool({ name: "list_drawings", arguments: {} }));
  assert.equal(list.filter((d) => d.name.startsWith("Replaced")).length, 1);
  const scene = json(await client.callTool({
    name: "describe_scene",
    arguments: { name: "Replaced" },
  }));
  assert.equal(scene.filter((e) => e.type === "rectangle").length, 2);
});

test("draw with append keeps what was already there", async () => {
  const client = await connect();
  await client.callTool({ name: "draw", arguments: { name: "Grown", nodes: ["A"] } });
  await client.callTool({
    name: "draw",
    arguments: { name: "Grown", nodes: ["B"], mode: "append" },
  });
  const scene = json(await client.callTool({
    name: "describe_scene",
    arguments: { name: "Grown" },
  }));
  assert.equal(scene.filter((e) => e.type === "rectangle").length, 2);
});

test("append places new content clear of the old", async () => {
  const client = await connect();
  await client.callTool({ name: "draw", arguments: { name: "Below", nodes: ["A"] } });
  const before = json(await client.callTool({
    name: "describe_scene", arguments: { name: "Below" },
  }));
  const bottom = Math.max(...before.map((e) => e.y + e.height));
  await client.callTool({
    name: "draw", arguments: { name: "Below", nodes: ["B"], mode: "append" },
  });
  const after = json(await client.callTool({
    name: "describe_scene", arguments: { name: "Below" },
  }));
  const added = after.find((e) => e.text === "B");
  assert.ok(added.y >= bottom, "appended content sits below existing content");
});

test("edit moves an element by id", async () => {
  const client = await connect();
  await client.callTool({ name: "draw", arguments: { name: "Movable", nodes: ["A"] } });
  const [box] = json(await client.callTool({
    name: "describe_scene", arguments: { name: "Movable" },
  }));
  await client.callTool({
    name: "edit",
    arguments: { name: "Movable", move: [{ id: box.id, x: 500, y: 600 }] },
  });
  const [moved] = json(await client.callTool({
    name: "describe_scene", arguments: { name: "Movable" },
  }));
  assert.equal(moved.x, 500);
  assert.equal(moved.y, 600);
});

test("edit recolours and retexts an element", async () => {
  const client = await connect();
  await client.callTool({ name: "draw", arguments: { name: "Paint", nodes: ["A"] } });
  const [box] = json(await client.callTool({
    name: "describe_scene", arguments: { name: "Paint" },
  }));
  await client.callTool({
    name: "edit",
    arguments: {
      name: "Paint",
      update: [{ id: box.id, backgroundColor: "#ffc9c9", text: "Renamed" }],
    },
  });
  const [painted] = json(await client.callTool({
    name: "describe_scene", arguments: { name: "Paint" },
  }));
  assert.equal(painted.text, "Renamed");
});

test("edit deletes an element and its label", async () => {
  const client = await connect();
  await client.callTool({ name: "draw", arguments: { name: "Doomed", nodes: ["A", "B"] } });
  const scene = json(await client.callTool({
    name: "describe_scene", arguments: { name: "Doomed" },
  }));
  const target = scene.find((e) => e.text === "A");
  await client.callTool({
    name: "edit", arguments: { name: "Doomed", remove: [target.id] },
  });
  const after = json(await client.callTool({
    name: "describe_scene", arguments: { name: "Doomed" },
  }));
  assert.ok(!after.some((e) => e.text === "A"));
  assert.ok(after.some((e) => e.text === "B"));
});

test("edit on an unknown id reports it instead of failing silently", async () => {
  const client = await connect();
  await client.callTool({ name: "draw", arguments: { name: "Ghosts", nodes: ["A"] } });
  const out = json(await client.callTool({
    name: "edit", arguments: { name: "Ghosts", move: [{ id: "nope", x: 1, y: 1 }] },
  }));
  assert.deepEqual(out.unknownIds, ["nope"]);
});

test("rename and delete work end to end", async () => {
  const client = await connect();
  await client.callTool({ name: "draw", arguments: { name: "Old", nodes: ["A"] } });
  const renamed = json(await client.callTool({
    name: "rename_drawing", arguments: { name: "Old", newName: "New" },
  }));
  assert.equal(renamed.name, "New");
  await client.callTool({ name: "delete_drawing", arguments: { name: "New" } });
  const list = json(await client.callTool({ name: "list_drawings", arguments: {} }));
  assert.ok(!list.some((d) => d.name === "New"));
});

test("reading a drawing that does not exist is an error, not a crash", async () => {
  const client = await connect();
  const result = await client.callTool({
    name: "describe_scene", arguments: { name: "Never Existed" },
  });
  assert.equal(result.isError, true);
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `node --test mcp/server.test.js`
Expected: FAIL — `Cannot find module .../server.js`

- [ ] **Step 5: Implement**

Create `mcp/server.js`. Adjust the registration calls to match what Step 2 printed:

```js
#!/usr/bin/env node
// Wiring only. Every behaviour lives in mcp/lib/*.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import * as library from "./lib/library.js";
import { requestOpen } from "./lib/control.js";
import { buildScene, describe, emptyScene, parseScene, serializeScene } from "./lib/scene.js";

const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
const fail = (message) => ({ content: [{ type: "text", text: message }], isError: true });

const nodeSchema = z.union([
  z.string(),
  z.object({
    id: z.string().optional(),
    text: z.string(),
    shape: z.enum(["rect", "ellipse", "diamond", "cylinder", "text"]).optional(),
  }),
]);

const edgeSchema = z.union([
  z.tuple([z.string(), z.string()]),
  z.tuple([z.string(), z.string(), z.string()]),
  z.object({ from: z.string(), to: z.string(), label: z.string().optional() }),
]);

/** Shifts a scene's elements down so appended content clears what is there. */
function offsetBelow(existing, scene) {
  const bottom = existing.reduce(
    (max, el) => (el.isDeleted ? max : Math.max(max, el.y + el.height)),
    -Infinity,
  );
  if (!Number.isFinite(bottom)) return scene;
  const top = scene.elements.reduce((min, el) => Math.min(min, el.y), Infinity);
  if (!Number.isFinite(top)) return scene;
  const shift = bottom + 120 - top;
  for (const el of scene.elements) el.y += shift;
  return scene;
}

export function createServer() {
  const server = new McpServer({ name: "excalidraw", version: "0.1.0" });

  server.registerTool(
    "draw",
    {
      title: "Draw a diagram",
      description:
        "Create or replace a drawing in the Excalidraw desktop library and open it. " +
        "Nodes are laid out automatically; a bare string is shorthand for a labelled box. " +
        "Use this for whole diagrams; use `edit` to adjust one that already exists.",
      inputSchema: {
        name: z.string().describe("Drawing name, e.g. 'Auth flow'"),
        nodes: z.array(nodeSchema).optional(),
        edges: z.array(edgeSchema).optional(),
        direction: z.enum(["down", "right"]).optional(),
        mode: z.enum(["replace", "append"]).optional(),
        open: z.boolean().optional(),
      },
    },
    async ({ name, nodes = [], edges = [], direction = "down", mode = "replace", open = true }) => {
      try {
        let scene = buildScene({ nodes, edges, direction });
        if (mode === "append" && (await library.exists(name))) {
          const existing = parseScene(await library.readDrawing(name));
          scene = offsetBelow(existing.elements, scene);
          scene.elements = [...existing.elements, ...scene.elements];
          scene.appState = existing.appState;
          scene.files = existing.files;
        }
        await library.writeDrawing(name, serializeScene(scene));
        if (open) await requestOpen(name);
        return ok({ name, elements: scene.elements.length });
      } catch (e) {
        return fail(`could not draw ${name}: ${e.message}`);
      }
    },
  );

  server.registerTool(
    "edit",
    {
      title: "Edit elements in a drawing",
      description:
        "Adjust elements in an existing drawing by id. Get ids from describe_scene. " +
        "Use this for 'move that box left' or 'make the DB node red' — it preserves " +
        "everything else on the canvas, including changes made by hand.",
      inputSchema: {
        name: z.string(),
        move: z.array(z.object({ id: z.string(), x: z.number(), y: z.number() })).optional(),
        update: z
          .array(
            z.object({
              id: z.string(),
              text: z.string().optional(),
              strokeColor: z.string().optional(),
              backgroundColor: z.string().optional(),
              width: z.number().optional(),
              height: z.number().optional(),
            }),
          )
          .optional(),
        remove: z.array(z.string()).optional(),
        open: z.boolean().optional(),
      },
    },
    async ({ name, move = [], update = [], remove = [], open = true }) => {
      try {
        const scene = parseScene(await library.readDrawing(name));
        const byId = new Map(scene.elements.map((el) => [el.id, el]));
        const labelOf = new Map();
        for (const el of scene.elements) {
          if (el.type === "text" && el.containerId) labelOf.set(el.containerId, el);
        }
        const unknownIds = [];
        const touch = (el) => {
          el.version += 1;
          el.versionNonce = Math.floor(Math.random() * 2 ** 31);
          el.updated = Date.now();
        };

        for (const m of move) {
          const el = byId.get(m.id);
          if (!el) { unknownIds.push(m.id); continue; }
          const dx = m.x - el.x;
          const dy = m.y - el.y;
          el.x = m.x;
          el.y = m.y;
          touch(el);
          const label = labelOf.get(el.id);
          if (label) { label.x += dx; label.y += dy; touch(label); }
        }

        for (const u of update) {
          const el = byId.get(u.id);
          if (!el) { unknownIds.push(u.id); continue; }
          for (const key of ["strokeColor", "backgroundColor", "width", "height"]) {
            if (u[key] !== undefined) el[key] = u[key];
          }
          if (u.text !== undefined) {
            const target = labelOf.get(el.id) ?? (el.type === "text" ? el : null);
            if (target) {
              target.text = u.text;
              target.originalText = u.text;
              touch(target);
            }
          }
          touch(el);
        }

        if (remove.length) {
          const doomed = new Set(remove);
          for (const id of remove) {
            if (!byId.has(id)) { unknownIds.push(id); continue; }
            const label = labelOf.get(id);
            if (label) doomed.add(label.id);
          }
          scene.elements = scene.elements.filter((el) => !doomed.has(el.id));
          // Drop bindings that now point at nothing.
          for (const el of scene.elements) {
            if (Array.isArray(el.boundElements)) {
              el.boundElements = el.boundElements.filter((b) => !doomed.has(b.id));
            }
            if (el.startBinding && doomed.has(el.startBinding.elementId)) el.startBinding = null;
            if (el.endBinding && doomed.has(el.endBinding.elementId)) el.endBinding = null;
          }
        }

        await library.writeDrawing(name, serializeScene(scene));
        if (open) await requestOpen(name);
        return ok({ name, unknownIds });
      } catch (e) {
        return fail(`could not edit ${name}: ${e.message}`);
      }
    },
  );

  server.registerTool(
    "list_drawings",
    { title: "List drawings", description: "Every drawing in the library, newest first.", inputSchema: {} },
    async () => ok(await library.listDrawings()),
  );

  server.registerTool(
    "describe_scene",
    {
      title: "Describe a drawing",
      description:
        "A compact summary of what is on a drawing's canvas — element ids, text, " +
        "positions, sizes, and arrow connections. Read this before editing.",
      inputSchema: { name: z.string() },
    },
    async ({ name }) => {
      try {
        return ok(describe(await library.readDrawing(name)));
      } catch (e) {
        return fail(`could not read ${name}: ${e.message}`);
      }
    },
  );

  server.registerTool(
    "rename_drawing",
    { title: "Rename a drawing", inputSchema: { name: z.string(), newName: z.string() } },
    async ({ name, newName }) => {
      try {
        return ok({ name: await library.renameDrawing(name, newName) });
      } catch (e) {
        return fail(`could not rename ${name}: ${e.message}`);
      }
    },
  );

  server.registerTool(
    "delete_drawing",
    { title: "Delete a drawing", inputSchema: { name: z.string() } },
    async ({ name }) => {
      try {
        await library.deleteDrawing(name);
        return ok({ deleted: name });
      } catch (e) {
        return fail(`could not delete ${name}: ${e.message}`);
      }
    },
  );

  server.registerTool(
    "open_drawing",
    {
      title: "Open a drawing in the app",
      description: "Bring the Excalidraw desktop app forward on this drawing.",
      inputSchema: { name: z.string() },
    },
    async ({ name }) => {
      if (!(await library.exists(name))) return fail(`${name} does not exist`);
      await requestOpen(name);
      return ok({ opened: name });
    },
  );

  return server;
}

// Self-start on stdio when run directly, not when imported by tests.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
```

- [ ] **Step 6: Run the whole suite**

Run: `node --test mcp/`
Expected: PASS.

- [ ] **Step 7: Verify it speaks MCP over real stdio**

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node mcp/server.js
```

Expected: two JSON-RPC responses, the second listing all seven tools. Anything printed to stdout that is not JSON-RPC will corrupt the protocol — if you added a `console.log` anywhere in `mcp/`, remove it or send it to `console.error`.

- [ ] **Step 8: Commit**

```bash
git checkout -- public/
git add mcp/server.js mcp/server.test.js package.json package-lock.json
git commit -m "Add the Excalidraw MCP server and its tools"
```

---

### Task 7: The file watcher

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces, to the frontend:
  - event `library-changed`, payload `{ "names": ["Auth flow", ...] }`
  - event `open-request`, payload `{ "name": "Auth flow" }`
- Produces, to Rust: `fn drawing_names(paths: &[PathBuf]) -> Vec<String>` and
  `fn open_request_name(dir: &Path) -> Option<String>` (consumes the file).
- Also adds the Tauri command `take_open_request() => Option<String>` so the
  frontend can consume a request left before the app started.

- [ ] **Step 1: Add the dependency**

```bash
cd src-tauri && cargo add notify
```

Record the version cargo picked; do not hand-write a version into `Cargo.toml`.

- [ ] **Step 2: Write the failing tests**

Add to the existing `mod tests` in `src-tauri/src/lib.rs`:

```rust
#[test]
fn drawing_names_keeps_only_library_drawings() {
    let dir = PathBuf::from("/tmp/lib");
    let paths = vec![
        dir.join("Auth flow.excalidraw"),
        dir.join("notes.txt"),
        dir.join(".open-request"),
        dir.join("Auth flow.excalidraw"), // duplicate event, common with editors
    ];
    assert_eq!(drawing_names(&paths), vec!["Auth flow".to_string()]);
}

#[test]
fn open_request_is_read_once_and_removed() {
    let dir = std::env::temp_dir().join(format!("excalidraw-req-{}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join(OPEN_REQUEST_FILE);

    assert_eq!(open_request_name(&dir), None);

    fs::write(&path, r#"{"name":"Auth flow","at":1}"#).unwrap();
    assert_eq!(open_request_name(&dir), Some("Auth flow".to_string()));
    assert!(!path.exists(), "the request must be consumed");
    assert_eq!(open_request_name(&dir), None);

    // Malformed input is ignored, and still cleaned up.
    fs::write(&path, "not json").unwrap();
    assert_eq!(open_request_name(&dir), None);
    assert!(!path.exists());

    let _ = fs::remove_dir_all(&dir);
}
```

- [ ] **Step 3: Run to verify they fail**

Run: `cd src-tauri && cargo test`
Expected: FAIL — `cannot find function drawing_names` / `open_request_name`.

- [ ] **Step 4: Implement**

In `src-tauri/src/lib.rs`, add near the top:

```rust
use std::collections::HashSet;
use std::sync::mpsc::channel;
use std::time::Duration;
use notify::{RecursiveMode, Watcher};
use tauri::Emitter;

const OPEN_REQUEST_FILE: &str = ".open-request";
const WATCH_DEBOUNCE: Duration = Duration::from_millis(150);
```

Add these functions above `pub fn run()`:

```rust
/// Maps raw watcher paths to the drawing names the frontend cares about,
/// dropping control files, non-drawings, and duplicate events.
fn drawing_names(paths: &[PathBuf]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut names = Vec::new();
    for path in paths {
        if path.extension().and_then(|e| e.to_str()) != Some(EXT) {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if stem.starts_with('.') {
            continue;
        }
        if seen.insert(stem.to_string()) {
            names.push(stem.to_string());
        }
    }
    names
}

/// Reads and removes the MCP server's open request, if there is one.
fn open_request_name(dir: &Path) -> Option<String> {
    let path = dir.join(OPEN_REQUEST_FILE);
    let contents = fs::read_to_string(&path).ok()?;
    let _ = fs::remove_file(&path);
    let value: serde_json::Value = serde_json::from_str(&contents).ok()?;
    value.get("name")?.as_str().map(|s| s.to_string())
}

/// Watches the library directory and forwards changes to the frontend.
/// Debounced, because a single save produces several filesystem events.
fn spawn_watcher(app: tauri::AppHandle) {
    let Ok(dir) = library_dir() else { return };
    std::thread::spawn(move || {
        let (tx, rx) = channel();
        let mut watcher = match notify::recommended_watcher(tx) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("could not start the library watcher: {e}");
                return;
            }
        };
        if let Err(e) = watcher.watch(&dir, RecursiveMode::NonRecursive) {
            eprintln!("could not watch {}: {e}", dir.display());
            return;
        }

        loop {
            // Block for the first event, then drain whatever arrives inside
            // the debounce window so one save is one emit.
            let Ok(first) = rx.recv() else { return };
            let mut paths: Vec<PathBuf> = first.map(|e| e.paths).unwrap_or_default();
            while let Ok(next) = rx.recv_timeout(WATCH_DEBOUNCE) {
                if let Ok(event) = next {
                    paths.extend(event.paths);
                }
            }

            if let Some(name) = open_request_name(&dir) {
                let _ = app.emit("open-request", serde_json::json!({ "name": name }));
            }
            let names = drawing_names(&paths);
            if !names.is_empty() {
                let _ = app.emit("library-changed", serde_json::json!({ "names": names }));
            }
        }
    });
}

/// Lets the frontend pick up a request written before the app was running.
#[tauri::command]
fn take_open_request() -> Result<Option<String>, String> {
    Ok(open_request_name(&library_dir()?))
}
```

In `run()`, start the watcher inside `setup` after the existing pending-file handling, and register the new command:

```rust
        .setup(|app| {
            // ... existing pending-file block stays exactly as it is ...
            spawn_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_pending_file,
            take_open_request,
            list_drawings,
            read_drawing,
            write_drawing,
            create_drawing,
            rename_drawing,
            delete_drawing
        ])
```

- [ ] **Step 5: Run the tests**

Run: `cd src-tauri && cargo test`
Expected: PASS, all tests including the pre-existing ones.

- [ ] **Step 6: Commit**

```bash
git checkout -- public/
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs
git commit -m "Watch the library directory and emit change events"
```

---

### Task 8: Live reload in the app

**Files:**
- Modify: `src/lib/drawings.js`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: the `library-changed` and `open-request` events plus the
  `take_open_request` command from Task 7.
- Produces, from `drawings.js`:
  - `onLibraryChanged(handler) => Promise<UnlistenFn>` where handler receives `string[]`
  - `onOpenRequest(handler) => Promise<UnlistenFn>` where handler receives `string`
  - `takeOpenRequest() => Promise<string | null>`

This is the task where the echo loop lives. Read the spec's **Live sync**
section before starting.

- [ ] **Step 1: Extend the Rust-facing module**

Add to `src/lib/drawings.js`:

```js
import { listen } from "@tauri-apps/api/event";
```

and, alongside the existing exports:

```js
export const takeOpenRequest = () => invoke("take_open_request");

/** Fires when drawings change on disk — including changes made by the MCP server. */
export const onLibraryChanged = (handler) =>
  listen("library-changed", (event) => handler(event.payload?.names ?? []));

/** Fires when something outside the app asks for a drawing to be opened. */
export const onOpenRequest = (handler) =>
  listen("open-request", (event) => handler(event.payload?.name));
```

- [ ] **Step 2: Write the failing test**

There is no frontend test harness in this repo and adding one is out of scope,
so the deliverable for this task is verified by the manual script in Step 5.
Before writing any code, **write that script down as a checklist** in the commit
body so the verification is recorded, not improvised.

- [ ] **Step 3: Track what we wrote, so the watcher can ignore our own writes**

In `App.jsx`, add a ref beside the existing ones:

```js
  // The exact bytes we last wrote per drawing. A watcher event whose contents
  // match one of these is our own autosave echoing back — dropping it is what
  // stops write → watch → reload → change → write from looping forever.
  const lastWrittenRef = useRef(new Map());
```

In `flush()`, record the payload as it is written:

```js
    try {
      const contents = serializeScene(
        api.getSceneElements(),
        api.getAppState(),
        api.getFiles(),
      );
      lastWrittenRef.current.set(name, contents);
      await writeDrawing(name, contents);
    } catch (e) {
```

- [ ] **Step 4: Handle external changes**

Add this effect to `App.jsx`, after the existing save-listener effect:

```js
  // Reload drawings changed underneath us — by the MCP server, or by anything
  // else that writes to the library folder.
  useEffect(() => {
    const unlisten = onLibraryChanged(async (names) => {
      await refreshList();

      const active = activeNameRef.current;
      if (!active || !names.includes(active) || !apiRef.current) return;

      const contents = await readDrawing(active).catch(() => null);
      if (contents === null) return;
      // Our own autosave coming back around.
      if (contents === lastWrittenRef.current.get(active)) return;

      const parsed = parseScene(contents);
      lastWrittenRef.current.set(active, contents);
      dirtyRef.current = false;
      clearTimeout(timerRef.current);
      // captureUpdate: IMMEDIATELY puts this in the undo stack, so Cmd+Z
      // restores whatever the user had. Never bump sceneKey here — remounting
      // Excalidraw would throw away scroll and zoom.
      apiRef.current.updateScene({
        elements: parsed.elements,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    });
    return () => {
      unlisten.then((off) => off()).catch(() => {});
    };
  }, [refreshList]);

  // Something outside the app asked for a drawing — switch to it and come forward.
  useEffect(() => {
    const unlisten = onOpenRequest(async (name) => {
      if (!name || name === activeNameRef.current) {
        await refreshList();
        return;
      }
      await flushRef.current();
      try {
        openScene(name, await readDrawing(name));
        await refreshList();
      } catch (e) {
        setError(String(e));
      }
    });
    return () => {
      unlisten.then((off) => off()).catch(() => {});
    };
  }, [openScene, refreshList]);
```

Update the imports at the top of `App.jsx`:

```js
import { Excalidraw, CaptureUpdateAction } from "@excalidraw/excalidraw";
```

and add `onLibraryChanged`, `onOpenRequest`, `takeOpenRequest` to the existing import from `./lib/drawings`.

- [ ] **Step 5: Honour a request left before the app started**

Inside the existing bootstrap effect — **within** the `bootstrappedRef` guard, immediately after the `getPendingFile()` block — add:

```js
      // An MCP open request that arrived while the app was not running.
      if (!target) {
        const requested = await takeOpenRequest();
        if (requested && list.some((d) => d.name === requested)) target = requested;
      }
```

- [ ] **Step 6: Verify by hand**

Run `npm run tauri dev`, then in a second terminal:

```bash
# 1. A new drawing appears in the sidebar without a restart
node -e 'import("./mcp/lib/library.js").then(async l => {
  const s = await import("./mcp/lib/scene.js");
  await l.writeDrawing("Watcher test", s.serializeScene(s.buildScene({nodes:["Hello"]})));
})'
```

Check each of these:
- **Sidebar** — "Watcher test" appears within a second, no restart.
- **Live update** — open it, then re-run the command with `nodes:["Hello","World"]`. The second box appears on the canvas.
- **Viewport is preserved** — scroll and zoom somewhere odd first, re-run, and confirm the view does not jump. (If it does, something is bumping `sceneKey`.)
- **Undo works** — press Cmd+Z after an external change; your previous canvas returns.
- **No echo loop** — draw a rectangle by hand and watch the terminal running `tauri dev`. The canvas must settle. If shapes flicker or the CPU spins, echo suppression is broken.
- **Open request** — quit the app, run `node -e 'import("./mcp/lib/control.js").then(m=>m.requestOpen("Watcher test"))'`, and confirm the app launches on that drawing. Then with the app running, request a *different* drawing and confirm it switches.

- [ ] **Step 7: Commit**

```bash
git checkout -- public/
git add src/lib/drawings.js src/App.jsx
git commit -m "Reload drawings changed on disk without remounting the canvas"
```

Put the Step 6 checklist and its results in the commit body.

---

### Task 9: Install, document, and prove it end to end

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Register the server**

```bash
claude mcp add --scope user excalidraw -- node /Users/seyonvasantharajan/Desktop/repos/excalidraw_improved/mcp/server.js
claude mcp list
```

Expected: `excalidraw` listed and connecting.

- [ ] **Step 2: Prove the whole thing works from another repo**

Start `npm run tauri dev`. Then open a Claude Code session in a **different** directory and ask, in plain English:

1. "Create an excalidraw drawing with 3 rectangles saying Alpha, Beta, Gamma"
2. "Now add an arrow from Alpha to Gamma labelled 'skips'"
3. "Move Beta to the right of Gamma"

Confirm: each lands on the canvas without a restart, the app comes forward, and it feels like a couple of seconds rather than ten. If step 1 takes noticeably longer than the others, the server's cold start is the suspect — check nothing heavy crept into the import graph.

- [ ] **Step 3: Update the README**

Add a section after "Your drawings are just files":

````markdown
## Draw from Claude Code

The app ships an MCP server, so Claude Code can create and edit drawings in your
library from any project on your machine — and you watch them appear on the
canvas as they are made.

```bash
claude mcp add --scope user excalidraw -- node /path/to/this/repo/mcp/server.js
```

Then just ask:

> Create an excalidraw drawing with three boxes: Client, API, Postgres — arrows
> down the chain, label the first one "POST /login"

Drawings are written straight to your library folder, so they show up in the
sidebar whether or not the app is running. If it is running, the canvas updates
in place — your scroll and zoom stay put, and `Cmd+Z` undoes anything Claude did.

| Variable | Default | What it does |
| --- | --- | --- |
| `EXCALIDRAW_MCP_FOCUS` | `focus` | `focus` brings the app forward, `switch` changes the drawing without stealing focus, `off` writes files only |
| `EXCALIDRAW_APP` | `open -a "Excalidraw Dev"` | How to launch the app |
| `EXCALIDRAW_LIBRARY_DIR` | `~/Documents/Excalidraw` | Where drawings live |
````

Also update the "What this adds on top of Excalidraw" table with a row for
driving the app from an AI agent, and add to "Development":

```bash
node --test mcp/          # MCP server tests
```

- [ ] **Step 4: Update CLAUDE.md**

Add `mcp/` to the architecture block, and add these to "Rules that came from real bugs":

```markdown
- **The MCP server must never print to stdout.** It speaks JSON-RPC there; a
  stray `console.log` corrupts the protocol. Use `console.error`.
- **Echo suppression is load-bearing.** `App.jsx` remembers the exact bytes it
  last wrote per drawing and drops watcher events that match. Without it,
  autosave and the watcher chase each other forever.
- **`sanitize()` is mirrored in `mcp/lib/sanitize.js`** and pinned by
  `mcp/fixtures/sanitize-cases.json`, which both test suites read. Change one,
  and the other's test fails — that is the point.
```

- [ ] **Step 5: Run everything**

```bash
node --test mcp/ && cd src-tauri && cargo test && cd .. && npm run build
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git checkout -- public/
git add README.md CLAUDE.md
git commit -m "Document driving the app from Claude Code"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| Architecture / file structure | 1–8 |
| Rejected: mermaid | n/a — the plan adds no such dependency, enforced by Global Constraints |
| Authoring API: `draw` | 6 |
| Authoring API: `edit` | 6 |
| Library tools | 6 |
| `describe_scene` compact summary | 4 (implementation) + 6 (tool) |
| Layout | 3 |
| Name sanitising + fixture parity | 1 |
| Live sync: watcher | 7 |
| Live sync: echo suppression | 8 |
| Live sync: reload not remount | 8 |
| Live sync: sidebar refresh | 8 |
| Conflict: Cmd+Z restores | 8 (`CaptureUpdateAction.IMMEDIATELY`) |
| Opening and focusing, both consumption paths | 5, 7, 8 |
| `EXCALIDRAW_MCP_FOCUS` / `EXCALIDRAW_APP` | 5, documented in 9 |
| Testing: Rust, Node, manual E2E | 1, 7 / 1–6 / 8, 9 |
| Installation | 9 |
| README | 9 |

No gaps.

**Known risks, flagged rather than hidden**

1. **The MCP SDK's registration API.** Task 6 Step 2 makes the executor print
   the real surface before writing code, because this is the one API in the
   plan not verified against an installed copy.
2. **Bound-text geometry.** Task 4 Step 5 verifies it visually and Step 6 gives
   the exact fallback, because Excalidraw computes container label layout
   internally and the offline calculation may not match.
3. **`fontFamily: 5`** is what this Excalidraw version writes in the user's own
   files. If text renders in the wrong face, that constant is the place to look.
