import { blockSpans } from "./model.js";

const BREAKOUT_INDENT = 30;
const BREAKOUT_GAP = 0.5;   // extra blank line above and below, in line heights

/** Splits a run into word-sized pieces, keeping the trailing space with its word
 *  so a line break never loses a character. */
function words(text) {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

export function layout(doc, opts) {
  const { measure, maxWidth, fontSize, lineHeight, boxPadding = 0 } = opts;
  const lineHeightPx = fontSize * lineHeight;

  const lines = [];
  let y = 0;

  for (const { block } of blockSpans(doc)) {
    const indent = block.type === "breakout" ? BREAKOUT_INDENT : 0;
    // A breakout indent wider than the element would leave nothing to lay out
    // into; one pixel still terminates, one character per line.
    const available = Math.max(1, maxWidth - indent);
    if (block.type === "breakout") y += lineHeightPx * BREAKOUT_GAP;

    let fragments = [];
    let x = 0;

    /** Appends to the fragment being built when it belongs to the same run, so a
     *  line carries one fragment per run rather than one per word. */
    const place = (run, text, width) => {
      const last = fragments[fragments.length - 1];
      if (last && last.run === run) {
        last.text += text;
        last.width += width;
      } else {
        fragments.push({ run, text, x, width, padding: 0 });
      }
      x += width;
    };

    // `hard` marks a line ended by an explicit newline in the text rather than
    // by wrapping. The newline itself is not carried into any fragment — each
    // canvas line is its own text element — so this is what tells a reader
    // where to put it back.
    const flush = (hard = false) => {
      lines.push({ y, height: lineHeightPx, type: block.type, indent, fragments, hardBreak: hard });
      y += lineHeightPx;
      fragments = [];
      x = 0;
    };

    function placeSegment(run, text) {
      // A box implies one enclosed thing, so a boxed run is placed whole unless
      // it cannot possibly fit on a line of its own.
      if (run.box) {
        const width = measure(text) + boxPadding * 2;
        if (width <= available) {
          if (x + width > available && fragments.length) flush();
          // padding travels with the fragment so element generation does not
          // have to guess whether this width includes it
          fragments.push({ run, text, x, width, padding: boxPadding });
          x += width;
          return;
        }
        // Wider than a whole line: fall through and break it like normal text.
      }

      for (const word of words(text)) {
        const core = word.trimEnd();
        // Only the ink decides the break: `white-space: pre-wrap` on the
        // overlay (RichTextOverlay.css) hangs trailing whitespace at a line
        // break rather than counting it, and charging it here made a committed
        // block wrap a word earlier than the editor showed. The advance is the
        // full measurement, spaces included — pre-wrap preserves every one of
        // them, so collapsing a run here would draw the canvas text left of
        // where the editor put it.
        const ink = measure(core);
        const width = measure(word);
        if (x + ink > available && fragments.length) flush();
        if (ink <= available) { place(run, word, width); continue; }
        // A single word wider than a whole line has no whitespace to break on,
        // so break it per character the way Excalidraw does. Without this an
        // over-wide word — or an over-wide boxed run falling through from above
        // — would sit on one line and overflow the element's own width.
        let piece = "";
        for (const ch of word) {
          if (x + measure(piece + ch) > available && (piece || fragments.length)) {
            if (piece) place(run, piece, measure(piece));
            flush();
            piece = "";
          }
          piece += ch;
        }
        if (piece) place(run, piece, measure(piece));
      }
    }

    for (const run of block.runs) {
      // Enter inserts a real newline into the run's text, and it has to break
      // the canvas line too — laid out as ordinary whitespace it would only
      // wrap when it happened to overflow, and the text elements either side
      // would sit on top of each other.
      const segments = run.text.split("\n");
      for (let i = 0; i < segments.length; i++) {
        if (i > 0) flush(true);
        placeSegment(run, segments[i]);
      }
    }

    if (fragments.length) flush();
    else { lines.push({ y, height: lineHeightPx, type: block.type, indent, fragments: [], hardBreak: false }); y += lineHeightPx; }

    if (block.type === "breakout") y += lineHeightPx * BREAKOUT_GAP;
  }

  const last = lines[lines.length - 1];
  return { lines, width: maxWidth, height: last ? last.y + last.height : 0 };
}
