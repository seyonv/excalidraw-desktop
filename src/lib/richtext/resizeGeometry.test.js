import { test } from "node:test";
import assert from "node:assert/strict";
import { edgeAt } from "./resizeGeometry.js";

// a block 200 wide and 100 tall
const bounds = [100, 50, 300, 150];

test("grabs the left and right borders", () => {
  assert.equal(edgeAt(bounds, { x: 98, y: 100 }, 1), "w");
  assert.equal(edgeAt(bounds, { x: 302, y: 100 }, 1), "e");
});

test("ignores the inside of the block", () => {
  assert.equal(edgeAt(bounds, { x: 200, y: 100 }, 1), null);
});

test("ignores the top and bottom borders", () => {
  assert.equal(edgeAt(bounds, { x: 200, y: 48 }, 1), null);
  assert.equal(edgeAt(bounds, { x: 200, y: 152 }, 1), null);
});

test("leaves the corner handles to Excalidraw", () => {
  // the nw handle occupies x[90,98] y[40,48] at zoom 1 — diagonally outside
  assert.equal(edgeAt(bounds, { x: 94, y: 44 }, 1), null);
  assert.equal(edgeAt(bounds, { x: 306, y: 156 }, 1), null);
});

test("claims the bound rows, which the n/s bands stop just short of", () => {
  // the n band's test is a strict `distance < 4`, and at y === y1 the distance
  // is exactly 4 — so Excalidraw falls through to a side grab here
  assert.equal(edgeAt(bounds, { x: 98, y: 50 }, 1), "w");
  assert.equal(edgeAt(bounds, { x: 302, y: 150 }, 1), "e");
  // a row above the top bound is the n band's, and it is tested before w
  assert.equal(edgeAt(bounds, { x: 98, y: 49 }, 1), null);
  assert.equal(edgeAt(bounds, { x: 302, y: 151 }, 1), null);
});

test("claims a border grab close to a corner, as Excalidraw does", () => {
  // 2px below the top bound is outside every corner handle and outside the n
  // band; Excalidraw's own algorithm resolves both of these to a side grab
  assert.equal(edgeAt(bounds, { x: 98, y: 52 }, 1), "w");
  assert.equal(edgeAt(bounds, { x: 302, y: 148 }, 1), "e");
  // and a short block still has a claimable border for its whole height
  assert.equal(edgeAt([100, 50, 300, 62], { x: 98, y: 56 }, 1), "w");
});

test("the bands are screen-sized, so they shrink as you zoom in", () => {
  // 6 scene px outside the border: inside the band at zoom 0.5, outside it at 2
  assert.equal(edgeAt(bounds, { x: 94, y: 100 }, 0.5), "w");
  assert.equal(edgeAt(bounds, { x: 94, y: 100 }, 2), null);
});

test("leaves the border line itself to a drag-to-move", () => {
  // at exactly x1/x2 Excalidraw claims no handle at all, so the press is an
  // ordinary one inside the selection: the block is being dragged, not resized
  assert.equal(edgeAt(bounds, { x: 100, y: 100 }, 1), null);
  assert.equal(edgeAt(bounds, { x: 300, y: 100 }, 1), null);
});
