// Dev-only. Mounts the real RichTextOverlay on its own so the interaction can be
// driven by a browser and asserted on. Never part of the production build:
// `vite build` only takes index.html as an entry.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import RichTextOverlay from "../src/components/RichTextOverlay.jsx";
import { fromText } from "../src/lib/richtext/model.js";

const TEXT =
  "The migration ran clean on staging. Every write goes through the new path now. " +
  "The old path is gone. We should ship on Tuesday and watch the error rate closely.";

function Harness() {
  const [committed, setCommitted] = useState(null);
  return (
    <>
      <div className="canvas">
        <RichTextOverlay
          doc={fromText(TEXT)}
          style={{
            left: 20, top: 20, maxWidth: 520, fontSize: 20, fontFamily: 5,
            lineHeight: 1.25, strokeColor: "#1e1e1e", zoom: 1,
          }}
          onCommit={(doc) => setCommitted({ kind: "commit", blocks: doc })}
          onCancel={() => setCommitted({ kind: "cancel" })}
        />
      </div>
      <pre id="committed">{committed ? JSON.stringify(committed) : ""}</pre>
    </>
  );
}

createRoot(document.getElementById("root")).render(<Harness />);
