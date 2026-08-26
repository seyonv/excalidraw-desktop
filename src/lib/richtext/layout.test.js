import { test } from "node:test";
import assert from "node:assert/strict";
import { layout } from "./layout.js";
import { fromText, applyStyle, breakout, docText } from "./model.js";

// 10px per character makes every expectation arithmetic instead of guesswork.
const measure = (text) => text.length * 10;
const opts = { measure, maxWidth: 100, fontSize: 20, lineHeight: 1.25, boxPadding: 6 };

test("wraps on whitespace at the max width", () => {
  const { lines } = layout(fromText("aaa bbb ccc ddd"), opts);
  assert.deepEqual(lines.map((l) => l.fragments.map((f) => f.text).join("")),
    ["aaa bbb ", "ccc ddd"]);
});

test("splits a line into one fragment per run", () => {
  const doc = applyStyle(fromText("aaa bbb"), 4, 7, "c-blue", true);
  const { lines } = layout(doc, { ...opts, maxWidth: 200 });
  assert.deepEqual(lines[0].fragments.map((f) => [f.text, f.run.color ?? null]),
    [["aaa ", null], ["bbb", "#1971c2"]]);
});

test("positions fragments left to right", () => {
  const doc = applyStyle(fromText("aaa bbb"), 4, 7, "c-blue", true);
  const { lines } = layout(doc, { ...opts, maxWidth: 200 });
  assert.deepEqual(lines[0].fragments.map((f) => f.x), [0, 40]);
});

test("a boxed run moves to the next line rather than breaking", () => {
  // "aaa " is 40 wide; the boxed "bbbbbb" is 60 + 12 padding = 72, so it cannot
  // share the 100-wide line and must move down whole.
  const doc = applyStyle(fromText("aaa bbbbbb"), 4, 10, "box", true);
  const { lines } = layout(doc, opts);
  assert.equal(lines.length, 2);
  assert.equal(lines[1].fragments.length, 1);
  assert.equal(lines[1].fragments[0].text, "bbbbbb");
});

test("a boxed run wider than a line falls back to breaking", () => {
  const doc = applyStyle(fromText("aaaaaaaaaaaaaaa"), 0, 15, "box", true);
  const { lines } = layout(doc, opts);
  assert.ok(lines.length > 1, "an over-wide boxed run must still wrap");
});

test("a breakout block gets its own lines and an indent", () => {
  const doc = [
    { type: "paragraph", runs: [{ text: "aaa" }] },
    { type: "breakout", runs: [{ text: "bbb" }] },
    { type: "paragraph", runs: [{ text: "ccc" }] },
  ];
  const { lines } = layout(doc, opts);
  assert.deepEqual(lines.map((l) => l.type), ["paragraph", "breakout", "paragraph"]);
  assert.ok(lines[1].indent > 0);
  assert.ok(lines[2].y > lines[1].y);
});

test("reports total height as the last line's bottom", () => {
  const { lines, height } = layout(fromText("aaa bbb ccc ddd"), opts);
  const last = lines[lines.length - 1];
  assert.equal(height, last.y + last.height);
});

/* ---------- text integrity: laying out may never lose a character ---------- */

test("fuzz: fragments reassemble into exactly the block's text", () => {
  const acts = ["c-blue", "c-red", "hl", "ul", "box"];
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const source = "the quick brown\nfox jumps over the lazy dog\n\nsupercalifragilistic  x";

  for (let i = 0; i < 200; i++) {
    let d = fromText(source.slice(0, 1 + rnd(source.length)));
    for (let k = 0; k < 4; k++) {
      const len = docText(d).length;
      const a = rnd(Math.max(1, len)), b = rnd(Math.max(1, len));
      const [s, e] = [Math.min(a, b), Math.max(a, b)];
      d = rnd(4) === 0 ? breakout(d, s, e) : applyStyle(d, s, e, acts[rnd(acts.length)], true);
    }
    // widths down to a single character exercise the char-breaking fallback
    const maxWidth = 10 + rnd(140);
    const { lines, height } = layout(d, { ...opts, maxWidth });

    // Lines carry no block index, so compare the whole document at once: every
    // fragment in order must reassemble the concatenation of every run.
    const want = d.map((block) => block.runs.map((r) => r.text).join("")).join("");
    // a hard-broken line ate an explicit newline; a soft-wrapped one ate nothing
    const got = lines
      .map((l) => l.fragments.map((f) => f.text).join("") + (l.hardBreak ? "\n" : ""))
      .join("");
    assert.equal(got, want,
      `iteration ${i} at maxWidth ${maxWidth}: layout changed the text`);
    assert.ok(height >= 0);
    // one line per character is the worst case; more means a loop that isn't
    // consuming input
    assert.ok(lines.length <= want.length + d.length + 1,
      `iteration ${i} at maxWidth ${maxWidth}: ${lines.length} lines for ${want.length} characters`);
  }
});

/* ---------- explicit newlines ---------- */

test("an explicit newline breaks the line", () => {
  const { lines } = layout(fromText("aa\nbb"), { ...opts, maxWidth: 500 });
  assert.deepEqual(lines.map((l) => l.fragments.map((f) => f.text).join("")), ["aa", "bb"]);
  assert.equal(lines[0].hardBreak, true);
  assert.equal(lines[1].hardBreak, false);
});

test("a blank line survives as an empty line", () => {
  const { lines } = layout(fromText("aa\n\nbb"), { ...opts, maxWidth: 500 });
  assert.deepEqual(lines.map((l) => l.fragments.map((f) => f.text).join("")), ["aa", "", "bb"]);
});

test("a trailing newline leaves an empty last line", () => {
  const { lines } = layout(fromText("aa\n"), { ...opts, maxWidth: 500 });
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[1].fragments, []);
});

test("no text element ever carries a newline", () => {
  const { lines } = layout(fromText("aa\nbb cc\ndd"), opts);
  for (const line of lines) {
    for (const frag of line.fragments) assert.ok(!frag.text.includes("\n"));
  }
});
