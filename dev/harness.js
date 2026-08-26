// Installs test helpers against the mounted RichTextOverlay. The model is read
// back out of the rendered DOM on purpose: render is a pure function of the
// model, so this checks what the user actually sees, not an internal field.
(() => {
  const editor = document.querySelector(".richtext-overlay");

  const COLOUR_FOR_CLS = { "c-blue": "#1971c2", "c-red": "#e03131",
                           "c-green": "#2f9e44", "c-orange": "#f08c00" };

  function nodesWithOffsets() {
    const out = [];
    let offset = 0;
    [...editor.querySelectorAll("[data-block]")].forEach((blk, i) => {
      if (i > 0) offset += 1;                       // implicit block separator
      [...blk.querySelectorAll("[data-run]")].forEach((span) => {
        const node = span.firstChild;
        const len = node ? node.textContent.length : 0;
        out.push({ node: node || span, start: offset, end: offset + len });
        offset += len;
      });
    });
    return out;
  }

  window.__text = () =>
    [...editor.querySelectorAll("[data-block]")].map((b) => b.textContent).join("\n");

  window.__runs = () =>
    [...editor.querySelectorAll("[data-run]")].map((span) => {
      const cls = [...span.classList];
      const run = { text: span.textContent };
      const colour = cls.find((c) => c in COLOUR_FOR_CLS);
      if (colour) run.color = COLOUR_FOR_CLS[colour];
      if (cls.includes("hl")) run.highlight = true;
      if (cls.includes("ul")) run.underline = true;
      if (cls.includes("box")) run.box = true;
      return run;
    });

  window.__model = () =>
    JSON.stringify([...editor.querySelectorAll("[data-block]")].map((b) => ({
      type: b.classList.contains("breakout") ? "breakout" : "paragraph",
    })));

  window.__select = (start, end) => {
    const map = nodesWithOffsets();
    const a = map.find((m) => start >= m.start && start <= m.end);
    const b = [...map].reverse().find((m) => end >= m.start && end <= m.end);
    if (!a || !b) return "NO_MAP";
    const r = document.createRange();
    r.setStart(a.node, start - a.start);
    r.setEnd(b.node, end - b.start);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    editor.focus();
    document.dispatchEvent(new Event("selectionchange"));
    return window.getSelection().toString();
  };

  window.__caret = (at) => window.__select(at, at);

  window.__sticky = () => Boolean(document.querySelector(".richtext-sticky"));
  window.__bubble = () => Boolean(document.querySelector(".emphasis-bubble"));

  return "ok";
})();
