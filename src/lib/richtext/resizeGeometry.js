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
  // n, e, s, w. Every corner handle sits diagonally outside the bounds
  // (x1-10..x1-2 at zoom 1), and the n/s bands reach from 2*threshold outside
  // to the bound itself — so all of them live outside the vertical span. A
  // point strictly inside that span can only ever be an `e` or `w` grab.
  if (point.y <= y1 || point.y >= y2) return null;
  if (Math.abs(point.x - (x1 - threshold)) <= threshold) return "w";
  if (Math.abs(point.x - (x2 + threshold)) <= threshold) return "e";
  return null;
}
