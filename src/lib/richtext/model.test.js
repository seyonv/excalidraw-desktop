// The prototype at docs/prototypes/inline-emphasis/ is the reference
// implementation of this model; these are its 30 tests, ported verbatim.
// They pin the operations that broke in v2 — edits and selections spanning a
// line break, exact toggle-off, partial un-styling, and breakout round-trips.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as RT from "./model.js";

const text = (d) => RT.docText(d);
const doc = RT.fromText("hello world");
const two = RT.fromText("line one\nline two");

/* ---------- text integrity: nothing may ever vanish ---------- */

test("insert mid", () => assert.equal(text(RT.insertText(doc, 5, "!")), "hello! world"));
test("insert at 0", () => assert.equal(text(RT.insertText(doc, 0, ">")), ">hello world"));
test("insert at end", () => assert.equal(text(RT.insertText(doc, 11, "!")), "hello world!"));
test("delete mid", () => assert.equal(text(RT.deleteRange(doc, 5, 11)), "hello"));
test("delete all", () => assert.equal(text(RT.deleteRange(doc, 0, 11)), ""));
test("delete noop", () => assert.equal(text(RT.deleteRange(doc, 3, 3)), "hello world"));

test("newline preserved", () => assert.equal(text(two), "line one\nline two"));
test("insert after newline", () => assert.equal(text(RT.insertText(two, 9, "X")), "line one\nXline two"));
test("insert before newline", () => assert.equal(text(RT.insertText(two, 8, "X")), "line oneX\nline two"));
test("delete across newline", () => assert.equal(text(RT.deleteRange(two, 4, 13)), "line two"));
test("delete just the newline", () => assert.equal(text(RT.deleteRange(two, 8, 9)), "line oneline two"));
test("style across newline keeps text", () =>
  assert.equal(text(RT.applyStyle(two, 4, 13, "c-blue", true)), "line one\nline two"));

/* ---------- styling ---------- */

const blue = RT.applyStyle(doc, 0, 5, "c-blue", true);
test("colour applied to range only", () =>
  assert.deepEqual(blue[0].runs.map(r => [r.text, r.color ?? null]),
    [["hello", "#1971c2"], [" world", null]]));
test("isApplied true inside", () => assert.equal(RT.isApplied(blue, 0, 5, "c-blue"), true));
test("isApplied false partially", () => assert.equal(RT.isApplied(blue, 0, 8, "c-blue"), false));
test("toggle off restores plain", () =>
  assert.deepEqual(RT.applyStyle(blue, 0, 5, "c-blue", false)[0].runs, [{ text: "hello world" }]));
test("toggle off merges adjacent runs", () =>
  assert.equal(RT.applyStyle(blue, 0, 5, "c-blue", false)[0].runs.length, 1));
test("partial un-colour splits correctly", () =>
  assert.deepEqual(RT.applyStyle(blue, 3, 8, "c-blue", false)[0].runs.map(r => [r.text, r.color ?? null]),
    [["hel", "#1971c2"], ["lo world", null]]));

const loud = RT.applyStyle(RT.applyStyle(blue, 0, 5, "hl", true), 0, 5, "box", true);
test("marks stack on a run", () => {
  const r = loud[0].runs[0];
  assert.equal(r.color, "#1971c2"); assert.equal(r.highlight, true); assert.equal(r.box, true);
});
test("plain strips everything", () =>
  assert.deepEqual(RT.applyStyle(loud, 0, 11, "plain", true)[0].runs, [{ text: "hello world" }]));
test("styling never changes text", () => assert.equal(text(loud), "hello world"));

/* ---------- breakout ---------- */

const bo = RT.breakout(doc, 6, 11);
test("breakout keeps every character", () => assert.equal(text(bo), "hello \nworld"));
test("breakout produces a breakout block", () =>
  assert.deepEqual(bo.map(b => b.type), ["paragraph", "breakout"]));
const boMid = RT.breakout(RT.fromText("aaa bbb ccc"), 4, 7);
test("mid breakout splits into three", () =>
  assert.deepEqual(boMid.map(b => b.type), ["paragraph", "breakout", "paragraph"]));
test("mid breakout keeps text", () => assert.equal(text(boMid), "aaa \nbbb\n ccc"));
test("breakout of a breakout returns it to paragraph", () =>
  assert.equal(RT.breakout(boMid, 4, 7)[1].type, "paragraph"));

/* ---------- caret style inheritance ---------- */

test("inherits the run to the left", () => assert.equal(RT.styleAt(blue, 5).color, "#1971c2"));
test("does not inherit from the right", () => assert.equal(RT.styleAt(blue, 8).color, undefined));
test("start of doc is plain", () => assert.deepEqual(RT.styleAt(blue, 0), {}));

/* ---------- fuzz: random edits must never corrupt or crash ---------- */

test("fuzz keeps model well-formed", () => {
  let d = RT.fromText("the quick brown fox jumps over the lazy dog");
  const acts = ["c-blue", "c-red", "hl", "ul", "box", "plain"];
  let seed = 42;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let i = 0; i < 400; i++) {
    const len = RT.docText(d).length;
    const a = rnd(Math.max(1, len)), b = rnd(Math.max(1, len));
    const [s, e] = [Math.min(a, b), Math.max(a, b)];
    const op = rnd(5);
    if (op === 0) d = RT.insertText(d, s, "x");
    else if (op === 1) d = RT.deleteRange(d, s, e);
    else if (op === 2) d = RT.applyStyle(d, s, e, acts[rnd(acts.length)], rnd(2) === 0);
    else if (op === 3 && e > s) d = RT.breakout(d, s, e);
    else d = RT.applyStyle(d, s, e, "plain", true);

    assert.ok(Array.isArray(d) && d.length >= 1, `iteration ${i}: doc collapsed`);
    d.forEach((blk, bi) => {
      assert.ok(blk.runs.length >= 1, `iteration ${i}: block ${bi} has no runs`);
      blk.runs.forEach(r => assert.equal(typeof r.text, "string", `iteration ${i}: run without text`));
      // no two adjacent runs may share a style — that means tidy() failed
      for (let k = 1; k < blk.runs.length; k++) {
        assert.notEqual(RT.styleKey(blk.runs[k]), RT.styleKey(blk.runs[k - 1]),
          `iteration ${i}: block ${bi} has unmerged adjacent runs`);
      }
    });
  }
});
