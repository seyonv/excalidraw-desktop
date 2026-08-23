// Extracts the RT model out of the prototype and hammers it in node.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

// The prototype IS the reference implementation of the model. These tests read
// the RT module straight out of it, so the two can never drift.
const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "prototype.html"), "utf8");
const start = html.indexOf("const RT = (() => {");
const end = html.indexOf("/* ====", start);
const src = html.slice(start, end);
const RT = eval(src + "\nRT;");

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; }
  catch (e) { fail++; console.log(`FAIL  ${name}\n      ${e.message.split("\n")[0]}`); }
};

const text = (d) => RT.docText(d);
const doc = RT.fromText("hello world");
const two = RT.fromText("line one\nline two");

/* ---------- text integrity: nothing may ever vanish ---------- */

t("insert mid", () => assert.equal(text(RT.insertText(doc, 5, "!")), "hello! world"));
t("insert at 0", () => assert.equal(text(RT.insertText(doc, 0, ">")), ">hello world"));
t("insert at end", () => assert.equal(text(RT.insertText(doc, 11, "!")), "hello world!"));
t("delete mid", () => assert.equal(text(RT.deleteRange(doc, 5, 11)), "hello"));
t("delete all", () => assert.equal(text(RT.deleteRange(doc, 0, 11)), ""));
t("delete noop", () => assert.equal(text(RT.deleteRange(doc, 3, 3)), "hello world"));

t("newline preserved", () => assert.equal(text(two), "line one\nline two"));
t("insert after newline", () => assert.equal(text(RT.insertText(two, 9, "X")), "line one\nXline two"));
t("insert before newline", () => assert.equal(text(RT.insertText(two, 8, "X")), "line oneX\nline two"));
t("delete across newline", () => assert.equal(text(RT.deleteRange(two, 4, 13)), "line two"));
t("delete just the newline", () => assert.equal(text(RT.deleteRange(two, 8, 9)), "line oneline two"));
t("style across newline keeps text", () =>
  assert.equal(text(RT.applyStyle(two, 4, 13, "c-blue", true)), "line one\nline two"));

/* ---------- styling ---------- */

const blue = RT.applyStyle(doc, 0, 5, "c-blue", true);
t("colour applied to range only", () =>
  assert.deepEqual(blue[0].runs.map(r => [r.text, r.color ?? null]),
    [["hello", "#1971c2"], [" world", null]]));
t("isApplied true inside", () => assert.equal(RT.isApplied(blue, 0, 5, "c-blue"), true));
t("isApplied false partially", () => assert.equal(RT.isApplied(blue, 0, 8, "c-blue"), false));
t("toggle off restores plain", () =>
  assert.deepEqual(RT.applyStyle(blue, 0, 5, "c-blue", false)[0].runs, [{ text: "hello world" }]));
t("toggle off merges adjacent runs", () =>
  assert.equal(RT.applyStyle(blue, 0, 5, "c-blue", false)[0].runs.length, 1));
t("partial un-colour splits correctly", () =>
  assert.deepEqual(RT.applyStyle(blue, 3, 8, "c-blue", false)[0].runs.map(r => [r.text, r.color ?? null]),
    [["hel", "#1971c2"], ["lo world", null]]));

const loud = RT.applyStyle(RT.applyStyle(blue, 0, 5, "hl", true), 0, 5, "box", true);
t("marks stack on a run", () => {
  const r = loud[0].runs[0];
  assert.equal(r.color, "#1971c2"); assert.equal(r.highlight, true); assert.equal(r.box, true);
});
t("plain strips everything", () =>
  assert.deepEqual(RT.applyStyle(loud, 0, 11, "plain", true)[0].runs, [{ text: "hello world" }]));
t("styling never changes text", () => assert.equal(text(loud), "hello world"));

/* ---------- breakout ---------- */

const bo = RT.breakout(doc, 6, 11);
t("breakout keeps every character", () => assert.equal(text(bo), "hello \nworld"));
t("breakout produces a breakout block", () =>
  assert.deepEqual(bo.map(b => b.type), ["paragraph", "breakout"]));
const boMid = RT.breakout(RT.fromText("aaa bbb ccc"), 4, 7);
t("mid breakout splits into three", () =>
  assert.deepEqual(boMid.map(b => b.type), ["paragraph", "breakout", "paragraph"]));
t("mid breakout keeps text", () => assert.equal(text(boMid), "aaa \nbbb\n ccc"));
t("breakout of a breakout returns it to paragraph", () =>
  assert.equal(RT.breakout(boMid, 4, 7)[1].type, "paragraph"));

/* ---------- caret style inheritance ---------- */

t("inherits the run to the left", () => assert.equal(RT.styleAt(blue, 5).color, "#1971c2"));
t("does not inherit from the right", () => assert.equal(RT.styleAt(blue, 8).color, undefined));
t("start of doc is plain", () => assert.deepEqual(RT.styleAt(blue, 0), {}));

/* ---------- fuzz: random edits must never corrupt or crash ---------- */

t("fuzz keeps model well-formed", () => {
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
