const HIGHLIGHT_FILL = "#ffec99";
const HIGHLIGHT_BLEED = 2;

let seq = 0;
const nextId = (prefix) => `${prefix}-${Date.now().toString(36)}-${seq++}`;

/** Fields every Excalidraw element needs. Kept in one place so the four element
 *  builders below stay readable. */
function common(overrides) {
  return {
    id: nextId("rt"),
    angle: 0,
    strokeWidth: 1,
    strokeStyle: "solid",
    fillStyle: "solid",
    roughness: 0,
    opacity: 100,
    seed: Math.floor(Math.random() * 2 ** 31),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    index: null,
    isDeleted: false,
    frameId: null,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    roundness: null,
    ...overrides,
  };
}

export function toElements(doc, laidOut, base) {
  const { x: originX, y: originY, id, fontSize, fontFamily, lineHeight, strokeColor, groupId, maxWidth } = base;
  // The base travels with the model. Reopening a block has to lay it out at the
  // same width from the same origin, and neither can be recovered from the
  // generated elements: a highlight bleeds 2px left of the origin, and a block
  // that happens not to wrap says nothing about the width it was wrapped to.
  const meta = {
    richTextId: id,
    richText: {
      id,
      blocks: doc,
      base: { x: originX, y: originY, maxWidth, fontSize, fontFamily, lineHeight, strokeColor },
    },
  };
  const behind = [];
  const front = [];

  for (const line of laidOut.lines) {
    for (const frag of line.fragments) {
      const x = originX + line.indent + frag.x;
      const y = originY + line.y;
      // Only a fragment laid out whole carries box padding in its width; one
      // that fell through to character breaking does not, so trust layout's
      // bookkeeping rather than re-deriving it from the run.
      const pad = frag.padding ?? 0;
      const textX = x + pad;
      const textWidth = frag.width - pad * 2;

      if (frag.run.highlight) {
        behind.push(common({
          type: "rectangle",
          x: textX - HIGHLIGHT_BLEED, y: y - HIGHLIGHT_BLEED,
          width: textWidth + HIGHLIGHT_BLEED * 2, height: line.height + HIGHLIGHT_BLEED * 2,
          strokeColor: "transparent", backgroundColor: HIGHLIGHT_FILL,
          groupIds: [groupId], customData: meta,
        }));
      }

      front.push(common({
        type: "text",
        x: textX, y,
        width: textWidth, height: line.height,
        strokeColor: frag.run.color ?? strokeColor,
        backgroundColor: "transparent",
        text: frag.text, originalText: frag.text,
        fontSize, fontFamily, lineHeight,
        textAlign: "left", verticalAlign: "top",
        containerId: null, autoResize: true,
        groupIds: [groupId], customData: meta,
      }));

      if (frag.run.underline) {
        const uy = y + line.height - 2;
        front.push(common({
          type: "line",
          x: textX, y: uy, width: textWidth, height: 0,
          points: [[0, 0], [textWidth, 0]],
          strokeColor: frag.run.color ?? strokeColor,
          backgroundColor: "transparent",
          groupIds: [groupId], customData: meta,
        }));
      }

      if (frag.run.box) {
        front.push(common({
          type: "rectangle",
          x, y: y - 2, width: frag.width, height: line.height + 4,
          strokeColor: frag.run.color ?? strokeColor,
          backgroundColor: "transparent",
          roundness: { type: 3 },
          groupIds: [groupId], customData: meta,
        }));
      }
    }
  }

  return [...behind, ...front];
}

export const isRichText = (element) => Boolean(element?.customData?.richTextId);

/** The model is stored identically on every generated element, so any survivor
 *  can rebuild the block. Returns the first one found, as `{ id, blocks, base }`. */
export function readModel(elements) {
  for (const el of elements) {
    if (el?.customData?.richText?.blocks) return el.customData.richText;
  }
  return null;
}
