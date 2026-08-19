import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

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

test("renaming Keep 2 to Keep when Keep exists returns Keep 2 (file untouched)", async () => {
  await lib.writeDrawing("Keep", '{"keep":true}');
  await lib.writeDrawing("Keep 2", '{"keep2":true}');
  const used = await lib.renameDrawing("Keep 2", "Keep");
  assert.equal(used, "Keep 2");
  assert.equal(await lib.readDrawing("Keep"), '{"keep":true}');
  assert.equal(await lib.readDrawing("Keep 2"), '{"keep2":true}');
});

test("a malicious name cannot escape the library directory", async () => {
  await lib.writeDrawing("../../escaped", "{}");
  const names = (await lib.listDrawings()).map((d) => d.name);
  assert.ok(names.some((n) => n.includes("escaped")));
  assert.ok(!names.includes("../../escaped"));
  assert.ok(lib.pathFor("../../escaped").startsWith(lib.libraryDir() + sep));
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

test("lists .hidden.excalidraw as the drawing .hidden", async () => {
  writeFileSync(join(dir, ".hidden.excalidraw"), "{}");
  const names = (await lib.listDrawings()).map((d) => d.name);
  assert.ok(names.includes(".hidden"));
});

test("hides control files without .excalidraw extension", async () => {
  writeFileSync(join(dir, ".open-request"), "{}");
  const names = (await lib.listDrawings()).map((d) => d.name);
  assert.ok(!names.some((n) => n === ".open-request"));
});

test("sorts newest first", async () => {
  await lib.writeDrawing("Older", "{}");
  await new Promise((r) => setTimeout(r, 1100));
  await lib.writeDrawing("Newer", "{}");
  const names = (await lib.listDrawings()).map((d) => d.name);
  assert.ok(names.indexOf("Newer") < names.indexOf("Older"));
});

test("sorts same-second ties by byte-wise order (case-sensitive)", async () => {
  await lib.writeDrawing("apple", "{}");
  await lib.writeDrawing("Zebra", "{}");
  const names = (await lib.listDrawings()).map((d) => d.name);
  const appleIdx = names.indexOf("apple");
  const zebraIdx = names.indexOf("Zebra");
  assert.ok(zebraIdx < appleIdx, "Zebra (90) should come before apple (97) in byte-wise order");
});
