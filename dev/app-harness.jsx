// Dev-only. Mounts a real Excalidraw with the real editing hook and overlay, so
// the integration — opening on double-click, committing back into the scene,
// tracking zoom — can be driven by a browser. Never part of the production
// build: `vite build` takes only index.html.
import { useRef } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import RichTextOverlay from "../src/components/RichTextOverlay.jsx";
import { useRichTextEditing } from "../src/lib/richtext/useRichTextEditing.js";
import { applyStyle, fromText } from "../src/lib/richtext/model.js";
import { layout } from "../src/lib/richtext/layout.js";
import { canvasMeasure } from "../src/lib/richtext/measure.js";
import { toElements } from "../src/lib/richtext/elements.js";

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

const INITIAL = toElements(
  DOC,
  layout(DOC, {
    measure: canvasMeasure(BASE.fontSize, BASE.fontFamily),
    maxWidth: BASE.maxWidth, fontSize: BASE.fontSize,
    lineHeight: BASE.lineHeight, boxPadding: 6,
  }),
  BASE,
);

function Harness() {
  const apiRef = useRef(null);
  const areaRef = useRef(null);
  const { editing, editScreen, commitEditing, cancelEditing } =
    useRichTextEditing({ apiRef, containerRef: areaRef });

  return (
    <div ref={areaRef} style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <Excalidraw
        excalidrawAPI={(api) => {
          apiRef.current = api;
          window.__api = api;
          window.__area = areaRef.current;
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
