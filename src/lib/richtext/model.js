/* =======================================================================
   MODEL — pure functions, no DOM. Everything above this layer is built on
   these, and the tests exercise them directly.
   doc = [ { type:"paragraph"|"breakout", runs:[ {text, color?, highlight?, underline?, box?} ] } ]
   Offsets run over the concatenation of all run text, with ONE implicit
   separator character between adjacent blocks.
   ======================================================================= */

export const COLOURS = { "c-blue":"#1971c2", "c-red":"#e03131", "c-green":"#2f9e44", "c-orange":"#f08c00" };
export const MARKS = { hl:"highlight", ul:"underline", box:"box" };

export const clone = (doc) => doc.map(b => ({ type:b.type, runs:b.runs.map(r => ({ ...r })) }));
export const styleKey = (r) => [r.color||"", r.highlight?1:0, r.underline?1:0, r.box?1:0].join("|");
export const blockText = (b) => b.runs.map(r => r.text).join("");
export const docText = (doc) => doc.map(blockText).join("\n");

export function blockSpans(doc) {
  const out = []; let pos = 0;
  doc.forEach((b, i) => {
    const len = blockText(b).length;
    out.push({ index:i, block:b, start:pos, end:pos + len });
    pos += len + 1;                       // +1 for the implicit separator
  });
  return out;
}

export function tidy(block) {
  block.runs = block.runs
    .filter(r => r.text.length)
    .reduce((acc, r) => {
      const last = acc[acc.length-1];
      if (last && styleKey(last) === styleKey(r)) last.text += r.text;
      else acc.push({ ...r });
      return acc;
    }, []);
  if (!block.runs.length) block.runs = [{ text:"" }];
  return block;
}

/** Cuts a block's runs at a local offset, returning [before, after]. */
function splitRuns(runs, at) {
  const before = [], after = []; let pos = 0;
  runs.forEach(r => {
    const s = pos, e = pos + r.text.length; pos = e;
    if (e <= at) { before.push({ ...r }); return; }
    if (s >= at) { after.push({ ...r }); return; }
    before.push({ ...r, text:r.text.slice(0, at - s) });
    after.push({ ...r, text:r.text.slice(at - s) });
  });
  return [before, after];
}

export function styleAt(doc, offset) {
  for (const span of blockSpans(doc)) {
    if (offset < span.start || offset > span.end) continue;
    let pos = span.start;
    let carry = null;
    for (const r of span.block.runs) {
      const e = pos + r.text.length;
      if (offset > pos && offset <= e) carry = r;
      pos = e;
    }
    if (carry) { const { text, ...style } = carry; return style; }
    return {};
  }
  return {};
}

export function insertText(doc, at, text, style) {
  const next = clone(doc);
  const spans = blockSpans(next);
  let target = spans.find(s => at >= s.start && at <= s.end) || spans[spans.length-1];
  const local = Math.max(0, Math.min(at - target.start, blockText(target.block).length));
  const [before, after] = splitRuns(target.block.runs, local);
  const inherited = style !== undefined ? style : styleAt(doc, at);
  target.block.runs = [...before, { text, ...inherited }, ...after];
  tidy(target.block);
  return next;
}

export function deleteRange(doc, start, end) {
  if (start === end) return clone(doc);
  const next = clone(doc);
  const spans = blockSpans(next);
  const touched = spans.filter(s => s.end >= start && s.start <= end);
  if (!touched.length) return next;

  const first = touched[0], last = touched[touched.length-1];
  const headLocal = Math.max(0, start - first.start);
  const tailLocal = Math.min(blockText(last.block).length, Math.max(0, end - last.start));
  const head = splitRuns(first.block.runs, headLocal)[0];
  const tail = splitRuns(last.block.runs, tailLocal)[1];

  first.block.runs = [...head, ...tail];
  tidy(first.block);
  // drop every block the range swallowed after the first
  const removeFrom = first.index + 1, removeTo = last.index;
  if (removeTo >= removeFrom) next.splice(removeFrom, removeTo - removeFrom + 1);
  return next;
}

function mutate(run, act, on) {
  if (act === "plain") { delete run.color; delete run.highlight; delete run.underline; delete run.box; return; }
  if (act in COLOURS) { on ? (run.color = COLOURS[act]) : delete run.color; return; }
  const key = MARKS[act];
  if (key) on ? (run[key] = true) : delete run[key];
}

export function runsInRange(doc, start, end) {
  const hits = [];
  blockSpans(doc).forEach(span => {
    let pos = span.start;
    span.block.runs.forEach(r => {
      const s = pos, e = pos + r.text.length; pos = e;
      if (e > start && s < end && r.text.length) hits.push(r);
    });
  });
  return hits;
}

export function isApplied(doc, start, end, act) {
  const hits = runsInRange(doc, start, end);
  if (!hits.length) return false;
  if (act in COLOURS) return hits.every(r => r.color === COLOURS[act]);
  if (act in MARKS) return hits.every(r => r[MARKS[act]]);
  return false;
}

export function applyStyle(doc, start, end, act, on) {
  if (start === end) return clone(doc);
  const next = clone(doc);
  blockSpans(next).forEach(span => {
    if (span.end <= start || span.start >= end) return;
    const localStart = Math.max(0, start - span.start);
    const localEnd = Math.min(blockText(span.block).length, end - span.start);
    const [head, rest] = splitRuns(span.block.runs, localStart);
    const [mid, tail] = splitRuns(rest, localEnd - localStart);
    mid.forEach(r => mutate(r, act, on));
    span.block.runs = [...head, ...mid, ...tail];
    tidy(span.block);
  });
  return next;
}

export function breakout(doc, start, end) {
  const next = [];
  blockSpans(clone(doc)).forEach(span => {
    const b = span.block;
    if (span.end <= start || span.start >= end) { next.push(b); return; }
    const localStart = Math.max(0, start - span.start);
    const localEnd = Math.min(blockText(b).length, end - span.start);
    const [head, rest] = splitRuns(b.runs, localStart);
    const [mid, tail] = splitRuns(rest, localEnd - localStart);
    const kind = b.type === "breakout" ? "paragraph" : "breakout";
    if (head.length && head.some(r => r.text)) next.push(tidy({ type:b.type, runs:head }));
    next.push(tidy({ type:kind, runs:mid }));
    if (tail.length && tail.some(r => r.text)) next.push(tidy({ type:b.type, runs:tail }));
  });
  return next.length ? next : clone(doc);
}

export const fromText = (text) => [{ type:"paragraph", runs:[{ text }] }];
