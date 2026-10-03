// Dev-only. Mounts a real Excalidraw with the real editing hook and overlay, so
// the integration — opening on double-click, committing back into the scene,
// tracking zoom — can be driven by a browser. Never part of the production
// build: `vite build` takes only index.html.
import { useRef } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, sceneCoordsToViewportCoords } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import RichTextOverlay from "../src/components/RichTextOverlay.jsx";
import { useRichTextEditing } from "../src/lib/richtext/useRichTextEditing.js";
import { useRichTextResize } from "../src/lib/richtext/useRichTextResize.js";
import { applyStyle, fromText } from "../src/lib/richtext/model.js";
import { layout } from "../src/lib/richtext/layout.js";
import { canvasMeasure } from "../src/lib/richtext/measure.js";
import { toElements } from "../src/lib/richtext/elements.js";
import { parseScene, serializeScene } from "../src/lib/drawings.js";

// Fonts from public/, as App.jsx does, not Excalidraw's esm.sh fallback.
window.EXCALIDRAW_ASSET_PATH = "/";

const BASE = {
  x: 120, y: 120, id: "rt-fixture", maxWidth: 420, fontSize: 20, fontFamily: 5,
  lineHeight: 1.25, strokeColor: "#1e1e1e", groupId: "rtg-fixture",
};

// A block that already carries emphasis, so reopening it proves the model came
// back out of customData rather than being rebuilt from plain text.
const DOC = applyStyle(
  fromText("The migration ran clean on staging. Ship on Tuesday."),
  36, 51, "c-blue", true,
);

// A plain text element too, so the "select it and press an emphasis shortcut"
// conversion path can be driven as well as the double-click path.
const PLAIN = {
  id: "plain-1", type: "text", x: 120, y: 320, width: 240, height: 25,
  angle: 0, strokeColor: "#1e1e1e", backgroundColor: "transparent",
  fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid", roughness: 0,
  opacity: 100, groupIds: [], frameId: null, index: null, roundness: null,
  seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null,
  updated: 1, link: null, locked: false,
  text: "plain text here", originalText: "plain text here",
  fontSize: 20, fontFamily: 5, textAlign: "left", verticalAlign: "top",
  containerId: null, lineHeight: 1.25, autoResize: true,
};

const INITIAL = toElements(
  DOC,
  layout(DOC, {
    measure: canvasMeasure(BASE.fontSize, BASE.fontFamily),
    maxWidth: BASE.maxWidth, fontSize: BASE.fontSize,
    lineHeight: BASE.lineHeight, boxPadding: 6,
  }),
  BASE,
).concat(PLAIN);

function Harness() {
  const apiRef = useRef(null);
  const areaRef = useRef(null);
  const { editing, editScreen, commitEditing, cancelEditing, isEditingRef } =
    useRichTextEditing({ apiRef, containerRef: areaRef });
  useRichTextResize({ apiRef, containerRef: areaRef, isEditingRef });

  return (
    <div ref={areaRef} style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <Excalidraw
        excalidrawAPI={(api) => {
          apiRef.current = api;
          window.__api = api;
          window.__area = areaRef.current;
          // The exact pair the app uses to write and read a .excalidraw file,
          // so the harness can round-trip the scene through the file format.
          window.__serializeScene = serializeScene;
          window.__parseScene = parseScene;
          window.__sceneToViewport = sceneCoordsToViewportCoords;
        }}
        initialData={{ elements: INITIAL, appState: { viewBackgroundColor: "#ffffff" } }}
      />
      {editing && editScreen && (
        <RichTextOverlay
          key={editing.base.id}
          doc={editing.doc}
          initialAct={editing.initialAct}
          style={{
            left: editScreen.left, top: editScreen.top, zoom: editScreen.zoom,
            maxWidth: editing.base.maxWidth, fontSize: editing.base.fontSize,
            fontFamily: editing.base.fontFamily, lineHeight: editing.base.lineHeight,
            strokeColor: editing.base.strokeColor,
          }}
          onCommit={commitEditing}
          onCancel={cancelEditing}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Harness />);
