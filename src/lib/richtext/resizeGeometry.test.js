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

test("leaves the corners to Excalidraw", () => {
  // within reach of the nw handle, which Excalidraw tests before any side
  assert.equal(edgeAt(bounds, { x: 98, y: 52 }, 1), null);
  assert.equal(edgeAt(bounds, { x: 302, y: 148 }, 1), null);
});

test("the bands are screen-sized, so they shrink as you zoom in", () => {
  // 6 scene px outside the border: inside the band at zoom 0.5, outside it at 2
  assert.equal(edgeAt(bounds, { x: 94, y: 100 }, 0.5), "w");
  assert.equal(edgeAt(bounds, { x: 94, y: 100 }, 2), null);
});

test("a block too short to have a middle claims nothing", () => {
  assert.equal(edgeAt([100, 50, 300, 62], { x: 98, y: 56 }, 1), null);
});
