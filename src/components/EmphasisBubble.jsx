import { useLayoutEffect, useRef, useState } from "react";
import "./EmphasisBubble.css";

const COLOURS = [
  { act: "c-blue", hex: "#1971c2", key: "⌘B", label: "Blue" },
  { act: "c-red", hex: "#e03131", key: "⌘1", label: "Red" },
  { act: "c-green", hex: "#2f9e44", key: "⌘2", label: "Green" },
  { act: "c-orange", hex: "#f08c00", key: "⌘3", label: "Orange" },
];

const MARKS = [
  { act: "hl", glyph: "▮", key: "⌘H", label: "Highlight" },
  { act: "ul", glyph: "U̲", key: "⌘U", label: "Underline" },
  { act: "box", glyph: "▭", key: "⌘E", label: "Box" },
  { act: "breakout", glyph: "⏎", key: "⌘⇧B", label: "Break out" },
];

const GAP = 9;

export default function EmphasisBubble({ rect, active = [], dirty, onAction }) {
  const ref = useRef(null);
  const [placement, setPlacement] = useState({ left: rect?.left ?? 0, top: rect?.top ?? 0, below: false });

  // A selection near the top of the canvas leaves no room above it, and one
  // near an edge would push a centred bubble out of view. Measure once per
  // position change and flip or clamp rather than letting it leave the canvas.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !rect) return;
    const parent = el.offsetParent;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const maxRight = parent ? parent.clientWidth : Infinity;

    const below = rect.top - height - GAP < 0;
    const centre = rect.left + rect.width / 2;
    const half = width / 2;
    const left = Math.min(Math.max(centre, half + 4), Math.max(half + 4, maxRight - half - 4));

    setPlacement({ left, top: below ? rect.top + (rect.height ?? 0) : rect.top, below });
  }, [rect?.left, rect?.top, rect?.width, rect?.height]);

  if (!rect) return null;

  // mousedown + preventDefault, never onClick: clicking must not collapse the
  // selection the action is about to operate on.
  const press = (act) => (event) => {
    event.preventDefault();
    onAction(act);
  };

  const button = (act, label, key, children) => (
    <button
      key={act}
      type="button"
      title={`${label} (${key})`}
      aria-pressed={active.includes(act)}
      className={active.includes(act) ? "active" : ""}
      onMouseDown={press(act)}
    >
      {children}
      <span className="key">{key}</span>
    </button>
  );

  return (
    <div
      ref={ref}
      className={`emphasis-bubble${placement.below ? " below" : ""}`}
      style={{ left: placement.left, top: placement.top }}
      role="toolbar"
      aria-label="Text emphasis"
    >
      <button type="button" title="Back to plain (⌘\)" disabled={!dirty} onMouseDown={press("plain")}>
        <i className="dot plain" />
        <span className="key">⌘\</span>
      </button>
      <span className="sep" />
      {COLOURS.map((c) => button(c.act, c.label, c.key, <i className="dot" style={{ background: c.hex }} />))}
      <span className="sep" />
      {MARKS.map((m) => button(m.act, m.label, m.key, <span>{m.glyph}</span>))}
    </div>
  );
}
