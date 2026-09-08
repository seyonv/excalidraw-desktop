// Excalidraw's numbers, not ours. It draws no side handles on desktop — a side
// drag is a grab of the selection border, tested with SIDE_RESIZING_THRESHOLD
// (4 scene px at zoom 1) against bounds expanded by the same amount. Corner
// handles are tested first and reach from 2 to 10 scene px past each corner.
const THRESHOLD = 4;
const CORNER_REACH = 10;

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
  const corner = CORNER_REACH / zoom;
  if (point.y < y1 + corner || point.y > y2 - corner) return null;
  if (Math.abs(point.x - (x1 - threshold)) <= threshold) return "w";
  if (Math.abs(point.x - (x2 + threshold)) <= threshold) return "e";
  return null;
}
