// Builds Excalidraw elements. Field set taken from real files written by
// @excalidraw/excalidraw 0.18 — see the user's library, not the docs.
//
// `index` is deliberately omitted: Excalidraw's restore() assigns valid
// fractional indices on load, and array order gives z-order.

import { randomBytes } from "node:crypto";
import { layout, measure, wrap } from "./layout.js";

const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
const FONT_SIZE = 20;
const FONT_FAMILY = 5; // Excalifont, what 0.18 writes for hand-drawn text
const LINE_HEIGHT = 1.25;
const BOUND_PADDING = 5;
const ARROW_GAP = 8;

function newId() {
  return [...randomBytes(21)].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
}

const seed = () => Math.floor(Math.random() * 2 ** 31);

function base(type, { x, y, width, height, roundness = null }) {
  return {
    id: newId(),
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness,
    seed: seed(),
    version: 1,
    versionNonce: seed(),
    isDeleted: false,
    boundElements: [],
    updated: Date.now(),
    link: null,
    locked: false,
  };
}

function textElement(text, { x, y, width, height, containerId = null }) {
  const lines = wrap(text);
  return {
    ...base("text", { x, y, width, height }),
    text: lines.join("\n"),
    originalText: String(text),
    fontSize: FONT_SIZE,
    fontFamily: FONT_FAMILY,
    textAlign: containerId ? "center" : "left",
    verticalAlign: containerId ? "middle" : "top",
    containerId,
    autoResize: true,
    lineHeight: LINE_HEIGHT,
  };
}

/** A label centred inside `container`, bound both ways. */
function boundLabel(text, container) {
  const lines = wrap(text);
  const height = lines.length * FONT_SIZE * LINE_HEIGHT;
  const width = Math.max(0, container.width - BOUND_PADDING * 2);
  const label = textElement(text, {
    x: container.x + BOUND_PADDING,
    y: container.y + (container.height - height) / 2,
    width,
    height,
    containerId: container.id,
  });
  container.boundElements.push({ type: "text", id: label.id });
  return label;
}

const SHAPE_TYPE = {
  rect: "rectangle",
  ellipse: "ellipse",
  diamond: "diamond",
  cylinder: "rectangle", // no native cylinder; a rounded box reads the same
};

/** Accepts "A" or {id, text, shape} and fills in the gaps. */
function normaliseNode(node) {
  if (typeof node === "string") return { id: node, text: node, shape: "rect" };
  const text = String(node.text ?? node.id ?? "");
  return { id: String(node.id ?? text), text, shape: node.shape ?? "rect" };
}

/** Accepts ["a","b"], ["a","b","label"] or {from,to,label}. */
function normaliseEdge(edge) {
  if (Array.isArray(edge)) return { from: edge[0], to: edge[1], label: edge[2] };
  return { from: edge.from, to: edge.to, label: edge.label };
}

/** Centre-to-centre arrow between two boxes, stopping ARROW_GAP short. */
function arrowBetween(from, to, label) {
  const fx = from.x + from.width / 2;
  const fy = from.y + from.height / 2;
  const tx = to.x + to.width / 2;
  const ty = to.y + to.height / 2;
  const dx = tx - fx;
  const dy = ty - fy;
  const len = Math.hypot(dx, dy) || 1;
  // Pull each end back towards the box edge along the centre line.
  const shrink = (box) => Math.min(box.width, box.height) / 2 + ARROW_GAP;
  const sx = fx + (dx / len) * shrink(from);
  const sy = fy + (dy / len) * shrink(from);
  const ex = tx - (dx / len) * shrink(to);
  const ey = ty - (dy / len) * shrink(to);

  const arrow = {
    ...base("arrow", {
      x: sx,
      y: sy,
      width: Math.abs(ex - sx),
      height: Math.abs(ey - sy),
      roundness: { type: 2 },
    }),
    points: [
      [0, 0],
      [ex - sx, ey - sy],
    ],
    lastCommittedPoint: null,
    startBinding: { elementId: from.id, focus: 0, gap: ARROW_GAP },
    endBinding: { elementId: to.id, focus: 0, gap: ARROW_GAP },
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false,
  };
  from.boundElements.push({ type: "arrow", id: arrow.id });
  to.boundElements.push({ type: "arrow", id: arrow.id });

  const elements = [arrow];
  if (label) {
    const size = measure(label);
    const labelEl = textElement(label, {
      x: (sx + ex) / 2 - size.width / 2,
      y: (sy + ey) / 2 - FONT_SIZE / 2,
      width: size.width,
      height: FONT_SIZE * LINE_HEIGHT,
      containerId: arrow.id,
    });
    arrow.boundElements.push({ type: "text", id: labelEl.id });
    elements.push(labelEl);
  }
  return elements;
}

export function emptyScene() {
  return {
    type: "excalidraw",
    version: 2,
    source: "excalidraw-mcp",
    elements: [],
    appState: {},
    files: {},
  };
}

export function buildScene({ nodes = [], edges = [], direction = "down" } = {}) {
  const scene = emptyScene();
  const normalisedNodes = nodes.map(normaliseNode);
  const normalisedEdges = edges.map(normaliseEdge);
  if (normalisedNodes.length === 0) return scene;

  const placed = layout(normalisedNodes, normalisedEdges, { direction });
  const byNodeId = new Map();

  for (const node of placed) {
    if (node.shape === "text") {
      const el = textElement(node.text, {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
      });
      byNodeId.set(node.id, el);
      scene.elements.push(el);
      continue;
    }
    const shape = {
      ...base(SHAPE_TYPE[node.shape] ?? "rectangle", {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        roundness: { type: 3 },
      }),
    };
    byNodeId.set(node.id, shape);
    scene.elements.push(shape, boundLabel(node.text, shape));
  }

  for (const edge of normalisedEdges) {
    const from = byNodeId.get(edge.from);
    const to = byNodeId.get(edge.to);
    if (!from || !to || from === to) continue;
    scene.elements.push(...arrowBetween(from, to, edge.label));
  }
  return scene;
}

/** A compact summary — reading a scene back must not cost thousands of tokens. */
export function describe(contents) {
  const { elements } = parseScene(contents);
  const labels = new Map();
  for (const el of elements) {
    if (el.type === "text" && el.containerId) labels.set(el.containerId, el.text);
  }
  return elements
    .filter((el) => !el.isDeleted && !(el.type === "text" && el.containerId))
    .map((el) => {
      const summary = {
        id: el.id,
        type: el.type,
        text: labels.get(el.id) ?? el.text ?? null,
        x: Math.round(el.x),
        y: Math.round(el.y),
        width: Math.round(el.width),
        height: Math.round(el.height),
      };
      if (el.type === "arrow") {
        summary.connects = {
          from: el.startBinding?.elementId ?? null,
          to: el.endBinding?.elementId ?? null,
        };
      }
      return summary;
    });
}

/** Parses file contents, tolerating junk. Mirrors src/lib/drawings.js. */
export function parseScene(contents) {
  const empty = { elements: [], appState: {}, files: {} };
  if (!contents) return empty;
  try {
    const data = JSON.parse(contents);
    const { collaborators, ...appState } = data.appState ?? {};
    return {
      elements: Array.isArray(data.elements) ? data.elements : [],
      appState,
      files: data.files ?? {},
    };
  } catch {
    return empty;
  }
}

export function serializeScene(scene) {
  return JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "excalidraw-mcp",
    elements: scene.elements ?? [],
    appState: scene.appState ?? {},
    files: scene.files ?? {},
  });
}
