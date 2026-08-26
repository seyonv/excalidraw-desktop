import { FONT_FAMILY } from "@excalidraw/excalidraw";

// FONT_FAMILY maps name -> numeric id. Elements store the id, canvas needs the
// name, so invert it rather than hardcoding ids that the bundle minifies away.
const NAME_BY_ID = Object.fromEntries(
  Object.entries(FONT_FAMILY).map(([name, id]) => [id, name]),
);

// Excalidraw's own fallback chain: Excalifont falls back through Xiaolai (CJK)
// before the emoji face, everything else goes straight to it. Measuring with a
// shorter chain than the renderer uses puts our line breaks out of step with
// its own on any text the primary face doesn't cover.
const EMOJI = "Segoe UI Emoji";
const CJK = "Xiaolai";

function fallbackFor(fontFamily) {
  return fontFamily === FONT_FAMILY.Excalifont ? `${CJK}, ${EMOJI}` : EMOJI;
}

export function fontString(fontSize, fontFamily) {
  return `${fontSize}px ${NAME_BY_ID[fontFamily] ?? "Excalifont"}, ${fallbackFor(fontFamily)}`;
}

let ctx = null;

/** Returns a width function bound to one font. Excalidraw measures the same way,
 *  so our line breaks agree with the ones it would have chosen. */
export function canvasMeasure(fontSize, fontFamily) {
  ctx ||= document.createElement("canvas").getContext("2d");
  const font = fontString(fontSize, fontFamily);
  return (text) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
}

/** Measuring before the web font loads yields fallback metrics and every line
 *  break is wrong. Always await this before the first layout. */
export function fontsReady() {
  return document.fonts ? document.fonts.ready : Promise.resolve();
}
