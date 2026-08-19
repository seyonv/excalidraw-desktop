// Layered layout: rank by distance from the roots, then centre each rank.
// Deliberately simple — no crossing minimisation. If dense graphs become a
// real complaint, `dagre` (~200KB, no DOM) is the upgrade path.

const FONT_SIZE = 20;
const CHAR_WIDTH = 9; // rough advance width of Excalifont at size 20
const LINE_HEIGHT = 1.25;
const WRAP_AT = 28; // characters
const PAD_X = 24;
const PAD_Y = 20;
const MIN_WIDTH = 120;
const MIN_HEIGHT = 60;
const GAP_ALONG = 120; // between ranks
const GAP_ACROSS = 60; // between siblings in a rank

/** Wraps on whitespace at WRAP_AT columns, honouring explicit newlines. */
export function wrap(text) {
  const lines = [];
  for (const paragraph of String(text ?? "").split("\n")) {
    if (paragraph.length <= WRAP_AT) {
      lines.push(paragraph);
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (line && line.length + 1 + word.length > WRAP_AT) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Box size needed to hold `text`. */
export function measure(text) {
  const lines = wrap(text);
  const widest = lines.reduce((max, l) => Math.max(max, l.length), 0);
  return {
    width: Math.max(MIN_WIDTH, Math.round(widest * CHAR_WIDTH + PAD_X * 2)),
    height: Math.max(MIN_HEIGHT, Math.round(lines.length * FONT_SIZE * LINE_HEIGHT + PAD_Y * 2)),
  };
}

/** Assigns every node a rank: 0 for roots, else 1 + max(rank of predecessors). */
function rank(nodes, edges) {
  const validNodes = nodes.filter((n) => n && typeof n === "object");
  const ids = new Set(validNodes.map((n) => n.id));
  const incoming = new Map(validNodes.map((n) => [n.id, 0]));
  const out = new Map(validNodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!e || typeof e !== "object" || !ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    out.get(e.from).push(e.to);
    incoming.set(e.to, incoming.get(e.to) + 1);
  }

  const ranks = new Map();
  // Roots first; if a cycle leaves nothing unvisited, seed with the first
  // remaining node so every node is still placed.
  let frontier = validNodes.filter((n) => incoming.get(n.id) === 0).map((n) => n.id);
  if (frontier.length === 0 && validNodes.length > 0) frontier = [validNodes[0].id];
  for (const id of frontier) ranks.set(id, 0);

  while (frontier.length) {
    const next = [];
    for (const id of frontier) {
      for (const to of out.get(id) ?? []) {
        if (ranks.has(to)) continue; // back-edge: keep the rank it already has
        ranks.set(to, ranks.get(id) + 1);
        next.push(to);
      }
    }
    frontier = next;
  }

  // Anything unreachable (disconnected, or stranded behind a cycle) goes last.
  const maxRank = ranks.size ? Math.max(...ranks.values()) : 0;
  for (const n of validNodes) if (!ranks.has(n.id)) ranks.set(n.id, maxRank + 1);
  return ranks;
}

export function layout(nodes, edges, { direction = "down" } = {}) {
  // Node ids are assumed unique. The caller owns deduplication.
  const validNodes = nodes.filter((n) => n && typeof n === "object");
  if (validNodes.length === 0) return [];
  const down = direction !== "right";
  const ranks = rank(validNodes, edges);

  const byRank = new Map();
  for (const n of validNodes) {
    const r = ranks.get(n.id);
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r).push({ ...n, ...measure(n.text) });
  }

  const ordered = [...byRank.keys()].sort((a, b) => a - b);
  // Across-axis extent of each rank, so ranks can be centred against each other.
  const extents = new Map();
  for (const r of ordered) {
    const row = byRank.get(r);
    const across = row.reduce(
      (sum, n) => sum + (down ? n.width : n.height) + GAP_ACROSS,
      -GAP_ACROSS,
    );
    extents.set(r, across);
  }
  const widest = Math.max(...extents.values());

  const placed = [];
  let along = 0;
  for (const r of ordered) {
    const row = byRank.get(r);
    let across = (widest - extents.get(r)) / 2;
    const depth = row.reduce((max, n) => Math.max(max, down ? n.height : n.width), 0);
    for (const n of row) {
      placed.push({
        ...n,
        x: Math.round(down ? across : along),
        y: Math.round(down ? along : across),
      });
      across += (down ? n.width : n.height) + GAP_ACROSS;
    }
    along += depth + GAP_ALONG;
  }
  return placed;
}
