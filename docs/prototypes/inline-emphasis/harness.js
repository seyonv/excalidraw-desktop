// Installs test helpers into the prototype page.
(() => {
  const editor = document.getElementById("editor");

  function nodesWithOffsets() {
    const out = [];
    let offset = 0;
    const blocks = [...editor.querySelectorAll("[data-block]")];
    blocks.forEach((blk, i) => {
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
    [...editor.querySelectorAll("[data-block]")]
      .map((b) => b.textContent)
      .join("\n");

  window.__select = (start, end) => {
    const map = nodesWithOffsets();
    const a = map.find((m) => start >= m.start && start <= m.end);
    const b = map.find((m) => end >= m.start && end <= m.end);
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

  window.__model = () => document.getElementById("model").textContent;

  window.__runs = () => {
    try { return JSON.parse(window.__model()).flatMap((b) => b.runs.map((r) => ({ ...r, block: b.type }))); }
    catch (e) { return [{ error: String(e) }]; }
  };

  window.__bubble = () => {
    const bub = document.getElementById("bubble");
    return {
      visible: bub.classList.contains("on"),
      active: [...bub.querySelectorAll("button.active")].map((b) => b.dataset.act),
      plainDisabled: bub.querySelector('[data-act="plain"]').disabled,
    };
  };

  return "ok";
})();
