import test from "node:test";
import assert from "node:assert/strict";
import { buildScene, emptyScene, describe, parseScene, serializeScene } from "./scene.js";

const REQUIRED = [
  "id", "type", "x", "y", "width", "height", "angle", "strokeColor",
  "backgroundColor", "fillStyle", "strokeWidth", "strokeStyle", "roughness",
  "opacity", "groupIds", "frameId", "roundness", "seed", "version",
  "versionNonce", "isDeleted", "boundElements", "updated", "link", "locked",
];

test("an empty scene is a valid excalidraw file", () => {
  const scene = emptyScene();
  assert.equal(scene.type, "excalidraw");
  assert.equal(scene.version, 2);
  assert.deepEqual(scene.elements, []);
  assert.deepEqual(JSON.parse(serializeScene(scene)).elements, []);
});

test("every element carries every field Excalidraw requires", () => {
  const scene = buildScene({
    nodes: [{ id: "a", text: "A" }, { id: "b", text: "B" }],
    edges: [{ from: "a", to: "b", label: "goes to" }],
  });
  for (const el of scene.elements) {
    for (const field of REQUIRED) {
      assert.ok(field in el, `${el.type} is missing ${field}`);
    }
    assert.equal(typeof el.id, "string");
    assert.ok(el.id.length > 0);
  }
});

test("element ids are unique", () => {
  const scene = buildScene({
    nodes: [{ id: "a", text: "A" }, { id: "b", text: "B" }],
    edges: [{ from: "a", to: "b" }],
  });
  const ids = scene.elements.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("three bare strings become three labelled rectangles", () => {
  const scene = buildScene({ nodes: ["X", "Y", "Z"] });
  const rects = scene.elements.filter((e) => e.type === "rectangle");
  const texts = scene.elements.filter((e) => e.type === "text");
  assert.equal(rects.length, 3);
  assert.equal(texts.length, 3);
  assert.deepEqual(texts.map((t) => t.text).sort(), ["X", "Y", "Z"]);
});

test("a label is bound to its container both ways", () => {
  const scene = buildScene({ nodes: [{ id: "a", text: "Hello" }] });
  const rect = scene.elements.find((e) => e.type === "rectangle");
  const text = scene.elements.find((e) => e.type === "text");
  assert.equal(text.containerId, rect.id);
  assert.deepEqual(rect.boundElements, [{ type: "text", id: text.id }]);
  assert.equal(text.textAlign, "center");
  assert.equal(text.verticalAlign, "middle");
});

test("an arrow binds to both shapes, and both shapes know about the arrow", () => {
  const scene = buildScene({
    nodes: [{ id: "a", text: "A" }, { id: "b", text: "B" }],
    edges: [{ from: "a", to: "b" }],
  });
  const arrow = scene.elements.find((e) => e.type === "arrow");
  const rects = scene.elements.filter((e) => e.type === "rectangle");
  assert.equal(arrow.startBinding.elementId, rects[0].id);
  assert.equal(arrow.endBinding.elementId, rects[1].id);
  assert.equal(arrow.endArrowhead, "arrow");
  assert.equal(arrow.points.length, 2);
  for (const rect of rects) {
    assert.ok(rect.boundElements.some((b) => b.type === "arrow" && b.id === arrow.id));
  }
});

test("an edge label becomes a text element bound to the arrow", () => {
  const scene = buildScene({
    nodes: [{ id: "a", text: "A" }, { id: "b", text: "B" }],
    edges: [{ from: "a", to: "b", label: "POST /login" }],
  });
  const arrow = scene.elements.find((e) => e.type === "arrow");
  const label = scene.elements.find((e) => e.type === "text" && e.containerId === arrow.id);
  assert.ok(label, "arrow label exists");
  assert.equal(label.text, "POST /login");
});

test("shapes map to the right element types", () => {
  const scene = buildScene({
    nodes: [
      { id: "r", text: "R", shape: "rect" },
      { id: "e", text: "E", shape: "ellipse" },
      { id: "d", text: "D", shape: "diamond" },
      { id: "c", text: "C", shape: "cylinder" },
      { id: "t", text: "T", shape: "text" },
    ],
  });
  const types = scene.elements.map((e) => e.type);
  assert.ok(types.includes("rectangle"));
  assert.ok(types.includes("ellipse"));
  assert.ok(types.includes("diamond"));
  // cylinder has no native type; it falls back to a rounded rectangle
  assert.equal(scene.elements.filter((e) => e.type === "rectangle").length, 2);
  // a `text` node is a bare text element with no container
  const bare = scene.elements.filter((e) => e.type === "text" && e.containerId === null);
  assert.equal(bare.length, 1);
  assert.equal(bare[0].text, "T");
});

test("an edge naming an unknown node is skipped, not fatal", () => {
  const scene = buildScene({
    nodes: [{ id: "a", text: "A" }],
    edges: [{ from: "a", to: "ghost" }],
  });
  assert.equal(scene.elements.filter((e) => e.type === "arrow").length, 0);
});

test("describe summarises without dumping raw json", () => {
  const scene = buildScene({
    nodes: [{ id: "a", text: "A" }, { id: "b", text: "B" }],
    edges: [{ from: "a", to: "b" }],
  });
  const summary = describe(serializeScene(scene));
  const box = summary.find((s) => s.text === "A");
  assert.ok(box.id && Number.isFinite(box.x) && Number.isFinite(box.width));
  assert.ok(!("seed" in box), "summary must not carry Excalidraw internals");
  assert.ok(!("versionNonce" in box));
});

test("parseScene tolerates junk", () => {
  assert.deepEqual(parseScene("not json"), { elements: [], appState: {}, files: {} });
  assert.deepEqual(parseScene(""), { elements: [], appState: {}, files: {} });
  assert.deepEqual(parseScene('{"elements":"nope"}').elements, []);
});

test("parseScene drops collaborators, which must never be serialised", () => {
  const parsed = parseScene('{"elements":[],"appState":{"theme":"dark","collaborators":{}}}');
  assert.equal(parsed.appState.theme, "dark");
  assert.ok(!("collaborators" in parsed.appState));
});
