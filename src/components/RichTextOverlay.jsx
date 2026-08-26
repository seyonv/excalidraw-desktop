import { useCallback, useEffect, useRef, useState } from "react";
import * as RT from "../lib/richtext/model.js";
import { fontString } from "../lib/richtext/measure.js";
import EmphasisBubble from "./EmphasisBubble.jsx";
import "./RichTextOverlay.css";

const CLS_FOR_COLOUR = Object.fromEntries(
  Object.entries(RT.COLOURS).map(([act, hex]) => [hex, act]),
);

const LABEL = { "c-blue": "blue", "c-red": "red", "c-green": "green", "c-orange": "orange",
                hl: "highlight", ul: "underline", box: "box" };

/** The emphasis shortcuts, keyed by the character pressed with ⌘/Ctrl. Exported
 *  because the app uses the same map to convert a plain text element. */
export const ACT_FOR_KEY = { b: "c-blue", 1: "c-red", 2: "c-green", 3: "c-orange",
                             h: "hl", u: "ul", e: "box" };

const TRIGGERS = [
  { re: /\*\*([^*]+)\*\*$/, act: "c-blue" },
  { re: /==([^=]+)==$/, act: "hl" },
  { re: /__([^_]+)__$/, act: "ul" },
  { re: /\[\[([^\]]+)\]\]$/, act: "box" },
];

const MARK_ACTS = ["hl", "ul", "box"];

/**
 * A fully controlled `contenteditable` over the canvas. Every `beforeinput` is
 * prevented and applied to the model instead, so the browser never invents DOM
 * structure of its own — that is what destroyed characters around a line break
 * in the prototype's second version.
 *
 * React owns *when* to render; the editable DOM itself is built imperatively,
 * exactly as the prototype builds it. Letting React reconcile the children of a
 * contenteditable reintroduces the same class of hazard from the other side.
 */
export default function RichTextOverlay({ doc: initialDoc, style, initialAct, onCommit, onCancel }) {
  const editorRef = useRef(null);
  const docRef = useRef(initialDoc);
  const selRef = useRef({ start: 0, end: 0 });
  const stickyRef = useRef(new Set());
  const undoRef = useRef([]);
  const redoRef = useRef([]);
  const initialRef = useRef(initialDoc);

  const [bubble, setBubble] = useState(null);
  const [chip, setChip] = useState(null);

  /* ---------- render ---------- */

  const rebuild = useCallback(() => {
    const editorEl = editorRef.current;
    if (!editorEl) return;
    const frag = document.createDocumentFragment();
    docRef.current.forEach((block, bi) => {
      const el = document.createElement("div");
      el.className = "blk" + (block.type === "breakout" ? " breakout" : "");
      el.dataset.block = bi;
      block.runs.forEach((run, ri) => {
        const cls = [];
        if (run.color) cls.push(CLS_FOR_COLOUR[run.color]);
        if (run.highlight) cls.push("hl");
        if (run.underline) cls.push("ul");
        if (run.box) cls.push("box");
        const span = document.createElement("span");
        span.className = cls.join(" ");
        span.dataset.run = ri;
        span.textContent = run.text;
        el.appendChild(span);
      });
      frag.appendChild(el);
    });
    editorEl.replaceChildren(frag);
    // A boxed run keeps itself on one line; only one wider than the line may wrap.
    // Inline elements report scrollWidth 0, so measure the rendered rect.
    const lineWidth = editorEl.getBoundingClientRect().width;
    editorEl.querySelectorAll(".box").forEach((el) => {
      el.classList.remove("too-wide");
      if (el.getBoundingClientRect().width > lineWidth) el.classList.add("too-wide");
    });
  }, []);

  /* ---------- offsets <-> DOM ---------- */

  const offsetToDom = useCallback((offset) => {
    const editorEl = editorRef.current;
    for (const span of RT.blockSpans(docRef.current)) {
      if (offset < span.start || offset > span.end) continue;
      const blockEl = editorEl.querySelector(`[data-block="${span.index}"]`);
      if (!blockEl) return null;
      let pos = span.start;
      for (let ri = 0; ri < span.block.runs.length; ri++) {
        const run = span.block.runs[ri];
        const e = pos + run.text.length;
        if (offset <= e) {
          const spanEl = blockEl.querySelector(`[data-run="${ri}"]`);
          const node = spanEl.firstChild || spanEl.appendChild(document.createTextNode(""));
          return { node, offset: offset - pos };
        }
        pos = e;
      }
      const lastEl = blockEl.lastElementChild;
      const node = lastEl.firstChild || lastEl.appendChild(document.createTextNode(""));
      return { node, offset: node.textContent.length };
    }
    return null;
  }, []);

  const domToOffset = useCallback((node, nodeOffset) => {
    const spanEl = node.nodeType === 3 ? node.parentElement : node;
    const blockEl = spanEl?.closest ? spanEl.closest("[data-block]") : null;
    if (!blockEl) return 0;
    const bi = Number(blockEl.dataset.block);
    const span = RT.blockSpans(docRef.current).find((s) => s.index === bi);
    if (!span) return 0;
    let pos = span.start;
    const ri = Number(spanEl.dataset ? spanEl.dataset.run : NaN);
    for (let i = 0; i < span.block.runs.length; i++) {
      if (i === ri) return pos + Math.min(nodeOffset, span.block.runs[i].text.length);
      pos += span.block.runs[i].text.length;
    }
    return pos;
  }, []);

  const readSelection = useCallback(() => {
    const editorEl = editorRef.current;
    const s = window.getSelection();
    if (!s.rangeCount || !editorEl?.contains(s.anchorNode)) return;
    const r = s.getRangeAt(0);
    const a = domToOffset(r.startContainer, r.startOffset);
    const b = domToOffset(r.endContainer, r.endOffset);
    selRef.current = { start: Math.min(a, b), end: Math.max(a, b) };
  }, [domToOffset]);

  const writeSelection = useCallback(() => {
    const a = offsetToDom(selRef.current.start);
    const b = offsetToDom(selRef.current.end);
    if (!a || !b) return;
    const r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }, [offsetToDom]);

  /* ---------- the bubble and the sticky chip ---------- */

  const refresh = useCallback(() => {
    const editorEl = editorRef.current;
    const { start, end } = selRef.current;
    const s = window.getSelection();
    const inside = s.rangeCount && editorEl?.contains(s.anchorNode);
    const parent = editorEl?.offsetParent;
    const box = parent ? parent.getBoundingClientRect() : { left: 0, top: 0 };

    if (start === end || !inside) {
      setBubble(null);
    } else {
      const rect = s.getRangeAt(0).getBoundingClientRect();
      const active = [...Object.keys(RT.COLOURS), ...MARK_ACTS]
        .filter((act) => RT.isApplied(docRef.current, start, end, act));
      const dirty = RT.runsInRange(docRef.current, start, end)
        .some((r) => r.color || r.highlight || r.underline || r.box);
      setBubble({
        rect: { left: rect.left - box.left, top: rect.top - box.top,
                width: rect.width, height: rect.height },
        active, dirty,
      });
    }

    if (!stickyRef.current.size || !inside) {
      setChip(null);
      return;
    }
    const caret = s.rangeCount ? s.getRangeAt(0).getClientRects()[0] : null;
    setChip({
      text: [...stickyRef.current].map((a) => LABEL[a]).join(" + ") + " — esc to stop",
      left: caret ? caret.left - box.left : 0,
      top: caret ? caret.bottom - box.top + 6 : 0,
    });
  }, []);

  /* ---------- commit a new doc ---------- */

  const commit = useCallback((nextDoc, nextSel, { undoable = true } = {}) => {
    if (undoable) {
      undoRef.current.push({ doc: RT.clone(docRef.current), sel: { ...selRef.current } });
      redoRef.current.length = 0;
    }
    docRef.current = nextDoc;
    selRef.current = nextSel;
    rebuild();
    writeSelection();
    refresh();
  }, [rebuild, writeSelection, refresh]);

  /* ---------- markdown triggers ---------- */

  const runTriggers = useCallback(() => {
    const doc = docRef.current;
    const before = RT.docText(doc).slice(0, selRef.current.end);
    for (const trigger of TRIGGERS) {
      const m = before.match(trigger.re);
      if (!m) continue;
      const start = selRef.current.end - m[0].length;
      const marker = (m[0].length - m[1].length) / 2;
      let next = RT.deleteRange(doc, start + m[1].length + marker, start + m[0].length); // closing
      next = RT.deleteRange(next, start, start + marker);                                // opening
      next = RT.applyStyle(next, start, start + m[1].length, trigger.act, true);
      const caret = start + m[1].length;
      commit(next, { start: caret, end: caret });
      return;
    }
  }, [commit]);

  /* ---------- styling ---------- */

  const stickyStyle = useCallback(() => {
    const style = {};
    stickyRef.current.forEach((act) => {
      if (act in RT.COLOURS) style.color = RT.COLOURS[act];
      else if (act === "hl") style.highlight = true;
      else if (act === "ul") style.underline = true;
      else if (act === "box") style.box = true;
    });
    return style;
  }, []);

  const toggleSticky = useCallback((act) => {
    const sticky = stickyRef.current;
    if (act === "plain") { sticky.clear(); refresh(); return; }
    if (act === "breakout") return;
    // one colour at a time; marks stack
    if (act in RT.COLOURS) [...sticky].forEach((s) => { if (s in RT.COLOURS) sticky.delete(s); });
    if (sticky.has(act)) sticky.delete(act); else sticky.add(act);
    refresh();
  }, [refresh]);

  const apply = useCallback((act) => {
    readSelection();
    const { start, end } = selRef.current;
    if (start === end) { toggleSticky(act); return; }
    if (act === "breakout") {
      commit(RT.breakout(docRef.current, start, end), { start, end });
      return;
    }
    const on = act === "plain" ? true : !RT.isApplied(docRef.current, start, end, act);
    commit(RT.applyStyle(docRef.current, start, end, act, on), { start, end });
  }, [readSelection, toggleSticky, commit]);

  /* ---------- word boundaries ---------- */

  const wordBoundary = useCallback((from, dir) => {
    const text = RT.docText(docRef.current);
    let i = from;
    if (dir < 0) {
      while (i > 0 && /\s/.test(text[i - 1])) i--;
      while (i > 0 && !/\s/.test(text[i - 1])) i--;
    } else {
      const n = text.length;
      while (i < n && /\s/.test(text[i])) i++;
      while (i < n && !/\s/.test(text[i])) i++;
    }
    return i;
  }, []);

  /* ---------- ending the edit ---------- */

  // Exactly one of these fires when the overlay closes. An edit that changed
  // nothing reports a cancel, so the caller can leave the scene — and the undo
  // history — alone. Every commit builds a new doc, so identity is the test.
  const endEdit = useCallback(() => {
    if (docRef.current === initialRef.current) onCancel?.();
    else onCommit(docRef.current);
  }, [onCommit, onCancel]);

  /* ---------- input, fully controlled ---------- */

  useEffect(() => {
    const editorEl = editorRef.current;
    if (!editorEl) return undefined;

    const onBeforeInput = (e) => {
      readSelection();
      const { start, end } = selRef.current;

      const insert = (text, style) => {
        let next = docRef.current;
        const at = start;
        if (start !== end) next = RT.deleteRange(next, start, end);
        next = RT.insertText(next, at, text, style);
        commit(next, { start: at + text.length, end: at + text.length });
      };

      switch (e.inputType) {
        case "insertText": {
          e.preventDefault();
          if (e.data == null) return;
          insert(e.data, stickyRef.current.size ? stickyStyle() : undefined);
          runTriggers();
          return;
        }
        case "insertParagraph":
        case "insertLineBreak": {
          e.preventDefault();
          insert("\n", {});
          return;
        }
        case "insertFromPaste": {
          e.preventDefault();
          const text = (e.dataTransfer && e.dataTransfer.getData("text/plain")) || "";
          if (text) insert(text, undefined);
          return;
        }
        case "deleteContentBackward":
        case "deleteContentForward":
        case "deleteByCut":
        case "deleteWordBackward":
        case "deleteWordForward": {
          e.preventDefault();
          let s = start;
          let t = end;
          if (s === t) {
            const word = e.inputType.includes("Word");
            if (e.inputType.includes("Backward")) {
              if (s === 0) return;
              s = word ? wordBoundary(start, -1) : start - 1;
            } else {
              if (t >= RT.docText(docRef.current).length) return;
              t = word ? wordBoundary(end, 1) : end + 1;
            }
          }
          commit(RT.deleteRange(docRef.current, s, t), { start: s, end: s });
          return;
        }
        default:
          e.preventDefault();      // refuse anything we don't model
      }
    };

    const onKeyDown = (e) => {
      // Escape cancels sticky mode only. Excalidraw uses it to leave the text
      // editor, so it must never be claimed for anything else.
      if (e.key === "Escape") {
        if (!stickyRef.current.size) { endEdit(); return; }
        e.preventDefault();
        stickyRef.current.clear();
        refresh();
        return;
      }
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();

      if (k === "\\") { e.preventDefault(); apply("plain"); return; }

      if (k === "z") {
        e.preventDefault();
        const from = e.shiftKey ? redoRef.current : undoRef.current;
        const to = e.shiftKey ? undoRef.current : redoRef.current;
        if (!from.length) return;
        to.push({ doc: RT.clone(docRef.current), sel: { ...selRef.current } });
        const prev = from.pop();
        commit(prev.doc, prev.sel, { undoable: false });
        return;
      }
      if (k === "b" && e.shiftKey) { e.preventDefault(); apply("breakout"); return; }
      const act = ACT_FOR_KEY[k];
      if (!act) return;
      e.preventDefault();
      apply(act);
    };

    const onSelectionChange = () => {
      if (!editorEl.contains(window.getSelection().anchorNode)) return;
      readSelection();
      refresh();
    };

    // Clicking anywhere else ends the edit. The bubble is outside the editor in
    // the DOM, so it has to be excluded or pressing a button would commit first.
    const onPointerDown = (e) => {
      if (editorEl.contains(e.target) || e.target.closest?.(".emphasis-bubble")) return;
      endEdit();
    };

    editorEl.addEventListener("beforeinput", onBeforeInput);
    editorEl.addEventListener("keydown", onKeyDown);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      editorEl.removeEventListener("beforeinput", onBeforeInput);
      editorEl.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [readSelection, commit, stickyStyle, runTriggers, wordBoundary, apply, refresh, endEdit]);

  /* ---------- mount ---------- */

  useEffect(() => {
    rebuild();
    editorRef.current?.focus();
    // Whole block selected on entry, so the first action applies to all of it —
    // and so a conversion started by a shortcut has something to act on.
    selRef.current = { start: 0, end: RT.docText(docRef.current).length };
    writeSelection();
    if (initialAct) apply(initialAct);
    else refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zoom = style.zoom ?? 1;

  return (
    <>
      <div
        ref={editorRef}
        className="richtext-overlay"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        role="textbox"
        aria-multiline="true"
        aria-label="Rich text"
        style={{
          left: style.left,
          top: style.top,
          width: style.maxWidth,
          font: fontString(style.fontSize, style.fontFamily),
          lineHeight: style.lineHeight,
          color: style.strokeColor ?? "#1e1e1e",
          transform: `scale(${zoom})`,
        }}
      />
      {bubble && (
        <EmphasisBubble
          rect={bubble.rect}
          active={bubble.active}
          dirty={bubble.dirty}
          onAction={apply}
        />
      )}
      {chip && (
        <div className="richtext-sticky" style={{ left: chip.left, top: chip.top }}>
          {chip.text}
        </div>
      )}
    </>
  );
}
