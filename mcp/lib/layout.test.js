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
