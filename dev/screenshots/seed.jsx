// Dev-only. Builds the showcase drawings used for the App Store screenshots.
// Runs in a browser next to a real Excalidraw so rich text is measured with the
// real fonts; the result is read off `window.__seed` by dev/screenshots/seed.sh.
import { createRoot } from "react-dom/client";
import { Excalidraw, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { applyStyle, fromText } from "../../src/lib/richtext/model.js";
import { layout } from "../../src/lib/richtext/layout.js";
import { canvasMeasure, fontsReady } from "../../src/lib/richtext/measure.js";
import { toElements } from "../../src/lib/richtext/elements.js";

const EXCALIFONT = 5;
const BOX_PADDING = 6;

const fill = (backgroundColor, strokeColor = "#1e1e1e") => ({
  backgroundColor, strokeColor, fillStyle: "solid", strokeWidth: 2, roughness: 1,
});
const box = (id, x, y, width, height, text, style, type = "rectangle") => ({
  type, id, x, y, width, height, ...style,
  roundness: type === "rectangle" ? { type: 3 } : null,
  label: { text, fontSize: 22 },
});
const arrow = (from, to, label, extra = {}) => ({
  type: "arrow", x: 0, y: 0, strokeWidth: 2, strokeColor: "#1e1e1e",
  start: { id: from }, end: { id: to }, ...(label ? { label: { text: label, fontSize: 18 } } : {}), ...extra,
});
const text = (x, y, value, fontSize = 22, strokeColor = "#1e1e1e") => ({
  type: "text", x, y, text: value, fontSize, strokeColor,
});

/** A rich text block: `marks` is [phrase, action] pairs applied in order. */
function rich(id, x, y, maxWidth, value, marks, fontSize = 22) {
  let doc = fromText(value);
  for (const [phrase, act] of marks) {
    const start = value.indexOf(phrase);
    if (start < 0) throw new Error(`"${phrase}" is not in "${value}"`);
    doc = applyStyle(doc, start, start + phrase.length, act, true);
  }
  const base = {
    x, y, id, maxWidth, fontSize, fontFamily: EXCALIFONT, lineHeight: 1.25,
    strokeColor: "#1e1e1e", groupId: `${id}-g`,
  };
  const laidOut = layout(doc, {
    measure: canvasMeasure(fontSize, EXCALIFONT), maxWidth, fontSize,
    lineHeight: 1.25, boxPadding: BOX_PADDING,
  });
  return toElements(doc, laidOut, base);
}

/** How far along a ray from a shape's centre its outline is, per unit of ray. */
function edgeT(el, dx, dy) {
  const a = el.width / 2, b = el.height / 2;
  if (el.type === "ellipse") return 1 / Math.hypot(dx / a, dy / b);
  if (el.type === "diamond") return 1 / (Math.abs(dx) / a + Math.abs(dy) / b);
  return Math.min(a / Math.abs(dx || 1e-9), b / Math.abs(dy || 1e-9));
}

/** convertToExcalidrawElements binds arrows but leaves them at the origin, so
 *  route each one from its start shape's outline to its end shape's. */
function routeArrows(elements) {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const GAP = 8;
  for (const arrow of elements.filter((e) => e.type === "arrow" && e.startBinding && e.endBinding)) {
    const from = byId.get(arrow.startBinding.elementId), to = byId.get(arrow.endBinding.elementId);
    const c1 = [from.x + from.width / 2, from.y + from.height / 2];
    const c2 = [to.x + to.width / 2, to.y + to.height / 2];
    const len = Math.hypot(c2[0] - c1[0], c2[1] - c1[1]);
    const dx = (c2[0] - c1[0]) / len, dy = (c2[1] - c1[1]) / len;
    const t1 = edgeT(from, dx, dy) + GAP, t2 = edgeT(to, -dx, -dy) + GAP;
    const start = [c1[0] + dx * t1, c1[1] + dy * t1];
    const end = [c2[0] - dx * t2, c2[1] - dy * t2];
    Object.assign(arrow, {
      x: start[0], y: start[1],
      width: Math.abs(end[0] - start[0]), height: Math.abs(end[1] - start[1]),
      points: [[0, 0], [end[0] - start[0], end[1] - start[1]]],
    });
    const label = elements.find((e) => e.containerId === arrow.id);
    if (label) {
      label.x = (start[0] + end[0]) / 2 - label.width / 2;
      label.y = (start[1] + end[1]) / 2 - label.height / 2;
    }
  }
  return elements;
}

const scene = (elements, appState = {}) => JSON.stringify({
  type: "excalidraw", version: 2, source: "sketchshelf", elements: routeArrows(elements),
  appState: { viewBackgroundColor: "#ffffff", scrollX: 0, scrollY: 50, zoom: { value: 1 }, ...appState },
  files: {},
});

function launchPlan() {
  const shapes = convertToExcalidrawElements([
    text(80, 120, "Q4 launch plan", 40),
    box("research", 80, 230, 190, 90, "Research", fill("#a5d8ff")),
    box("design", 350, 230, 190, 90, "Design", fill("#d0bfff")),
    box("beta", 610, 210, 190, 130, "Beta OK?", fill("#ffec99"), "diamond"),
    box("launch", 880, 225, 190, 100, "Launch 🚀", fill("#b2f2bb"), "ellipse"),
    box("fix", 610, 430, 190, 84, "Fix & retest", fill("#ffc9c9")),
    arrow("research", "design"),
    arrow("design", "beta"),
    arrow("beta", "launch", "yes"),
    arrow("beta", "fix", "no"),
    arrow("fix", "design", "iterate", { strokeStyle: "dashed" }),
    { type: "rectangle", id: "note", x: 70, y: 560, width: 480, height: 160, ...fill("#fff3bf", "#f08c00"), roundness: { type: 3 } },
  ], { regenerateIds: false });
  const note = rich("rt-launch", 95, 585, 430,
    "Ship on November 12. The marketing site goes live the same morning and the press embargo lifts at 9am. Owner: Maya.",
    [["November 12", "c-blue"], ["press embargo lifts at 9am", "hl"], ["Maya", "ul"], ["marketing site", "c-green"]]);
  return scene([...shapes, ...note]);
}

function architecture() {
  return scene(convertToExcalidrawElements([
    text(80, 120, "Checkout architecture", 40),
    box("web", 80, 250, 180, 90, "Web app", fill("#a5d8ff"), "ellipse"),
    box("gw", 380, 250, 200, 90, "API gateway", fill("#d0bfff")),
    box("auth", 680, 140, 200, 84, "Auth service", fill("#b2f2bb")),
    box("orders", 680, 300, 200, 84, "Orders service", fill("#b2f2bb")),
    box("queue", 680, 470, 200, 84, "Event queue", fill("#ffd8a8")),
    box("db", 950, 295, 190, 100, "Postgres", fill("#99e9f2"), "ellipse"),
    box("mail", 960, 470, 150, 84, "Emails", fill("#ffc9c9")),
    arrow("web", "gw", "HTTPS"),
    arrow("gw", "auth", "verify"),
    arrow("gw", "orders"),
    arrow("orders", "db"),
    arrow("orders", "queue", "order.placed"),
    arrow("queue", "mail"),
    text(80, 600, "p95 under 300 ms at 2k orders/min", 22, "#868e96"),
  ], { regenerateIds: false }));
}

function designReview() {
  const shapes = convertToExcalidrawElements([
    text(80, 120, "Design review: settings", 40),
    { type: "rectangle", x: 760, y: 200, width: 300, height: 520, ...fill("#f8f9fa"), roundness: { type: 3 } },
    { type: "rectangle", x: 780, y: 220, width: 260, height: 50, ...fill("#d0bfff") },
    text(800, 232, "Settings", 22),
    { type: "ellipse", x: 980, y: 300, width: 44, height: 26, ...fill("#b2f2bb") },
    { type: "ellipse", x: 980, y: 360, width: 44, height: 26, ...fill("#e9ecef") },
    text(800, 300, "Autosave", 20), text(800, 360, "Dark mode", 20),
    { type: "rectangle", x: 800, y: 640, width: 220, height: 50, ...fill("#a5d8ff"), roundness: { type: 3 }, label: { text: "Save", fontSize: 20 } },
  ]);
  const decisions = rich("rt-decisions", 80, 220, 600,
    "Decisions: keep the toggles on one screen, and move the danger zone below the fold. Ship it in v2.3.",
    [["keep the toggles on one screen", "c-blue"], ["danger zone", "c-red"], ["v2.3", "box"]]);
  const open = rich("rt-open", 80, 340, 600,
    "Open questions: should dark mode follow the system? Needs a decision by Friday.",
    [["follow the system", "hl"], ["by Friday", "c-orange"], ["Needs a decision", "ul"]]);
  const done = rich("rt-done", 80, 460, 600,
    "Done: contrast pass and new icons. Everything else carries over.",
    [["contrast pass", "c-green"], ["new icons", "c-green"]]);
  return scene([...shapes, ...decisions, ...open, ...done]);
}

function onboarding() {
  return scene(convertToExcalidrawElements([
    text(80, 120, "Onboarding flow", 40),
    box("signup", 80, 260, 190, 90, "Sign up", fill("#a5d8ff")),
    box("verify", 350, 260, 190, 90, "Verify email", fill("#d0bfff")),
    box("tmpl", 620, 260, 190, 90, "Pick a template", fill("#b2f2bb")),
    box("first", 890, 250, 190, 110, "First drawing", fill("#ffec99"), "ellipse"),
    box("skip", 620, 450, 190, 84, "Start blank", fill("#e9ecef")),
    arrow("signup", "verify", null),
    arrow("verify", "tmpl", null),
    arrow("tmpl", "first", null),
    arrow("verify", "skip", "skip"),
    arrow("skip", "first", null, { strokeStyle: "dashed" }),
  ], { regenerateIds: false }), { theme: "dark", viewBackgroundColor: "#ffffff" });
}

function wireframe() {
  return scene(convertToExcalidrawElements([
    text(80, 120, "Landing page wireframe", 40),
    { type: "rectangle", x: 80, y: 200, width: 640, height: 520, ...fill("#ffffff"), roundness: { type: 3 } },
    { type: "rectangle", x: 80, y: 200, width: 640, height: 54, ...fill("#e9ecef") },
    text(104, 214, "logo", 20), text(500, 214, "Pricing   Docs   Log in", 18),
    text(140, 300, "Draw it. Keep it.", 44),
    { type: "line", x: 140, y: 380, points: [[0, 0], [360, 0]], strokeColor: "#868e96" },
    { type: "line", x: 140, y: 410, points: [[0, 0], [300, 0]], strokeColor: "#868e96" },
    { type: "rectangle", x: 140, y: 450, width: 170, height: 54, ...fill("#ffd8a8"), roundness: { type: 3 }, label: { text: "Download", fontSize: 20 } },
    { type: "rectangle", x: 400, y: 560, width: 280, height: 130, ...fill("#f1f3f5"), label: { text: "screenshot", fontSize: 20 } },
    text(820, 300, "hero copy needs\nto fit one line", 22, "#e03131"),
    { type: "arrow", x: 812, y: 330, points: [[0, 0], [-150, 0]], strokeColor: "#e03131", strokeWidth: 2 },
    text(820, 470, "make this the\nonly orange thing", 22, "#e03131"),
    { type: "arrow", x: 812, y: 495, points: [[0, 0], [-490, -10]], strokeColor: "#e03131", strokeWidth: 2 },
  ]));
}

const placeholder = (title) => scene(convertToExcalidrawElements([text(80, 120, title, 40)]));

async function build() {
  await fontsReady();
  await document.fonts.load("22px Excalifont");
  window.__seed = {
    "Q4 launch plan": launchPlan(),
    "Checkout architecture": architecture(),
    "Design review": designReview(),
    "Onboarding flow": onboarding(),
    "Landing page wireframe": wireframe(),
    "Kitchen remodel": placeholder("Kitchen remodel"),
    "Reading notes": placeholder("Reading notes"),
    "Sprint retro": placeholder("Sprint retro"),
    "Team offsite agenda": placeholder("Team offsite agenda"),
    "Pricing brainstorm": placeholder("Pricing brainstorm"),
  };
}

// Mounting a real Excalidraw is what loads its fonts.
createRoot(document.getElementById("root")).render(
  <div style={{ height: "100vh" }}>
    <Excalidraw initialData={{ elements: convertToExcalidrawElements([text(0, 0, "fonts")]) }} />
  </div>,
);
setTimeout(() => build().catch((e) => { window.__seedError = String(e?.stack ?? e); }), 1500);
