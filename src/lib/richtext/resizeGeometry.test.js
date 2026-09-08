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

test("leaves the top and bottom bands to Excalidraw, which reads them first", () => {
  // n and s are tested before e and w, so a point level with either bound is theirs
  assert.equal(edgeAt(bounds, { x: 98, y: 50 }, 1), null);
  assert.equal(edgeAt(bounds, { x: 302, y: 150 }, 1), null);
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
