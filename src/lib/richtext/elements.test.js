import { test } from "node:test";
import assert from "node:assert/strict";
import { toElements, readModel, isRichText } from "./elements.js";
import { layout } from "./layout.js";
import { fromText, applyStyle } from "./model.js";

const measure = (text) => text.length * 10;
const opts = { measure, maxWidth: 500, fontSize: 20, lineHeight: 1.25, boxPadding: 6 };
const base = { x: 100, y: 50, id: "rt1", fontSize: 20, fontFamily: 5,
               lineHeight: 1.25, strokeColor: "#1e1e1e", groupId: "g1" };

const build = (doc) => toElements(doc, layout(doc, opts), base);

test("emits one text element per fragment", () => {
  const els = build(applyStyle(fromText("aaa bbb"), 4, 7, "c-blue", true));
  const texts = els.filter((e) => e.type === "text");
  assert.deepEqual(texts.map((t) => t.text), ["aaa ", "bbb"]);
});

test("carries the run colour onto the text element", () => {
  const els = build(applyStyle(fromText("aaa bbb"), 4, 7, "c-blue", true));
  const blue = els.find((e) => e.type === "text" && e.text === "bbb");
  assert.equal(blue.strokeColor, "#1971c2");
});

test("positions elements relative to the base origin", () => {
  const els = build(fromText("aaa"));
  const text = els.find((e) => e.type === "text");
  assert.equal(text.x, 100);
  assert.equal(text.y, 50);
});

test("a highlighted run gets a filled rectangle behind the text", () => {
  const els = build(applyStyle(fromText("aaa"), 0, 3, "hl", true));
  const rect = els.find((e) => e.type === "rectangle");
  const textIndex = els.findIndex((e) => e.type === "text");
  assert.equal(rect.backgroundColor, "#ffec99");
  assert.equal(rect.strokeColor, "transparent");
  assert.ok(els.indexOf(rect) < textIndex, "highlight must render behind the text");
});

test("a boxed run gets a stroked rectangle with no fill", () => {
  const els = build(applyStyle(fromText("aaa"), 0, 3, "box", true));
  const rect = els.find((e) => e.type === "rectangle" && e.backgroundColor === "transparent");
  assert.equal(rect.strokeColor, "#1e1e1e");
});

test("an underlined run gets a line element", () => {
  const els = build(applyStyle(fromText("aaa"), 0, 3, "ul", true));
  assert.ok(els.some((e) => e.type === "line"));
});

test("every element shares the group and carries the model", () => {
  const doc = applyStyle(fromText("aaa bbb"), 4, 7, "c-blue", true);
  const els = build(doc);
  assert.ok(els.every((e) => e.groupIds.includes("g1")));
  assert.ok(els.every((e) => e.customData.richTextId === "rt1"));
  assert.deepEqual(readModel(els).blocks, doc);
});

test("readModel returns null for ordinary elements", () => {
  assert.equal(readModel([{ type: "text", text: "plain", customData: undefined }]), null);
  assert.equal(isRichText({ type: "text" }), false);
});

/* ---------- the round trip through the file ---------- */

test("the model survives a trip through JSON, as it does through the file", () => {
  const doc = applyStyle(applyStyle(fromText("aaa bbb ccc"), 0, 3, "hl", true), 4, 7, "c-red", true);
  const onDisk = JSON.parse(JSON.stringify(build(doc)));
  assert.deepEqual(readModel(onDisk).blocks, doc);
});

test("no character is lost between the model and the text elements", () => {
  const doc = applyStyle(fromText("the quick brown fox"), 4, 9, "box", true);
  const els = build(doc);
  const rendered = els.filter((e) => e.type === "text").map((e) => e.text).join("");
  assert.equal(rendered, doc.map((b) => b.runs.map((r) => r.text).join("")).join(""));
});

test("a boxed run that had to break gets no phantom padding", () => {
  // 15 characters at 10px each is 150, wider than this 100px line, so the box
  // branch falls through to character breaking and the width carries no padding.
  const doc = applyStyle(fromText("aaaaaaaaaaaaaaa"), 0, 15, "box", true);
  const els = toElements(doc, layout(doc, { ...opts, maxWidth: 100 }), base);
  for (const text of els.filter((e) => e.type === "text")) {
    assert.equal(text.width, text.text.length * 10);
    assert.equal(text.x, 100, "a broken boxed fragment starts at the line origin");
  }
});
