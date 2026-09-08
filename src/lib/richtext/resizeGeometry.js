// Excalidraw's numbers, not ours. It draws no side handles on desktop — a side
// drag is a grab of the selection border, tested with SIDE_RESIZING_THRESHOLD
// (4 scene px at zoom 1) against bounds expanded by the same amount.
const THRESHOLD = 4;

/**
 * The border a scene point grabs, if it is unambiguously the left or right one.
 *
 * Deliberately conservative: anything that Excalidraw would read as a corner,
 * or as the top or bottom border, returns null and is left to Excalidraw. A
 * claimed drag that should have been a corner drag is much worse than an
 * unclaimed one, which simply scales the way it does today.
 */
export function edgeAt(bounds, point, zoom) {
  const [x1, y1, x2, y2] = bounds;
  const threshold = THRESHOLD / zoom;
  // Excalidraw tests the corner handles first, then the borders in the order
  // n, e, s, w, and every one of those tests is a strict `distance < threshold`
  // (`pointOnLineSegment`). So the n and s bands own everything up to but not
  // including the bound itself, and the corner handles sit further out still —
  // which leaves the whole span from y1 to y2 inclusive to e and w.
  if (point.y < y1 || point.y > y2) return null;
  // Strict here too, and for a sharper reason: at exactly x1 or x2 Excalidraw
  // claims nothing, so the press is a normal one inside the selection and the
  // block is being dragged to move it. Claiming that would turn a move into a
  // re-wrap.
  if (Math.abs(point.x - (x1 - threshold)) < threshold) return "w";
  if (Math.abs(point.x - (x2 + threshold)) < threshold) return "e";
  return null;
}
