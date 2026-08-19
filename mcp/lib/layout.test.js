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

// Test Finding 1 fix: malformed edges should be skipped without throwing
test("malformed edges are skipped without error", () => {
  const out = layout(
    nodes("A", "B"),
    [null, undefined, "garbage", {}, { from: "A" }, { from: "A", to: "B" }],
    { direction: "down" },
  );
  assert.equal(out.length, 2);
  const at = Object.fromEntries(out.map((n) => [n.id, n]));
  assert.ok(at.A.y < at.B.y, "valid edge still ranked B below A");
});

// Test Finding 3a: full pairwise non-overlap checking
const boxesOverlap = (a, b) => {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
};

const assertNoOverlaps = (boxes) => {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      assert.ok(
        !boxesOverlap(boxes[i], boxes[j]),
        `boxes ${boxes[i].id} and ${boxes[j].id} overlap`,
      );
    }
  }
};

test("full pairwise non-overlap: single row of 4 nodes", () => {
  const out = layout(nodes("A", "B", "C", "D"), [], { direction: "down" });
  assertNoOverlaps(out);
});

test("full pairwise non-overlap: fan-out to 8 children", () => {
  const children = Array.from({ length: 8 }, (_, i) => String.fromCharCode(66 + i)); // B-I
  const edges = children.map((c) => edge("A", c));
  const out = layout(nodes("A", ...children), edges, { direction: "down" });
  assertNoOverlaps(out);
});

test("full pairwise non-overlap: diamond graph", () => {
  const out = layout(
    nodes("A", "B", "C", "D"),
    [edge("A", "B"), edge("A", "C"), edge("B", "D"), edge("C", "D")],
    { direction: "down" },
  );
  assertNoOverlaps(out);
});

test("full pairwise non-overlap: mixed label lengths", () => {
  const out = layout(
    [
      { id: "A", text: "Very long label here", shape: "rect" },
      { id: "B", text: "S", shape: "rect" },
      { id: "C", text: "Medium", shape: "rect" },
    ],
    [],
    { direction: "down" },
  );
  assertNoOverlaps(out);
});

test("full pairwise non-overlap: fan-out with direction right", () => {
  const children = Array.from({ length: 8 }, (_, i) => String.fromCharCode(66 + i)); // B-I
  const edges = children.map((c) => edge("A", c));
  const out = layout(nodes("A", ...children), edges, { direction: "right" });
  assertNoOverlaps(out);
});

// Test Finding 3c: malformed node entries are skipped
test("malformed node entries are skipped without error", () => {
  const out = layout([null, { id: "A", text: "A", shape: "rect" }], [], { direction: "down" });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "A");
});
