/**
 * The outer outline of a set of walls: the loop that encloses the whole building, however many partitions divide it.
 *
 * Walking the walls end to end only works while every wall is part of the one loop. A partition that stops
 * mid-span on an outer wall (a T-junction) sends such a walk off along the partition, and the outline it returns
 * crosses itself - the floor slab built from it came out as a tangle of triangles. Here the walls are treated as a
 * planar graph instead: they are split where they meet, walls that lead nowhere are pruned away, and the outer face
 * is traced, so partitions and free-standing walls inside the building cannot affect the result.
 */

export type Pt = [number, number];
/** A wall's centre line, in plan (world x / z). */
export interface WallLine { a: Pt; b: Pt }

interface Edge { u: number; v: number; seg: number }

const dist = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);

function lineIntersection(a: WallLine, b: WallLine): Pt | null {
  const d1x = a.b[0] - a.a[0], d1y = a.b[1] - a.a[1];
  const d2x = b.b[0] - b.a[0], d2y = b.b[1] - b.a[1];
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 0.05 * Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y)) return null; // (nearly) parallel
  const t = ((b.a[0] - a.a[0]) * d2y - (b.a[1] - a.a[1]) * d2x) / den;
  return [a.a[0] + d1x * t, a.a[1] + d1y * t];
}

/**
 * @param tol how far apart two wall ends may be and still count as one corner, and how far an end may stand from
 *   another wall's centre line and still count as meeting it (a partition stops at the face of a wall, half its
 *   thickness short of the centre line).
 * @returns the outline's corners (on the wall centre lines), or null when the walls enclose no area.
 */
export function outerWallLoop(walls: readonly WallLine[], tol = 0.35): Pt[] | null {
  const lines = walls.filter(w => dist(w.a, w.b) > 1e-6);
  if (lines.length < 3) return null;

  // Wall ends within `tol` of each other are one node.
  const nodes: Pt[] = [];
  const nodeAt = (p: Pt): number => {
    for (let i = 0; i < nodes.length; i++) if (dist(nodes[i], p) <= tol) return i;
    nodes.push([p[0], p[1]]);
    return nodes.length - 1;
  };
  const ends = lines.map(w => [nodeAt(w.a), nodeAt(w.b)] as const);

  // Where each wall is cut: [position along the wall 0..1, node].
  const cuts: Array<Array<[number, number]>> = lines.map((_, i) => [[0, ends[i][0]], [1, ends[i][1]]]);
  const along = (w: WallLine, p: Pt) => {
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1];
    const len2 = dx * dx + dy * dy;
    const t = ((p[0] - w.a[0]) * dx + (p[1] - w.a[1]) * dy) / len2;
    return { t, off: Math.hypot(w.a[0] + dx * t - p[0], w.a[1] + dy * t - p[1]) };
  };

  for (let i = 0; i < lines.length; i++) {
    const wi = lines[i];
    const len = dist(wi.a, wi.b);
    const margin = Math.min(0.49, tol / len); // an end this close to an end of wall i is already the same node
    for (let j = 0; j < lines.length; j++) {
      if (i === j) continue;
      const wj = lines[j];
      // T-junction: an end of wall j stands against the side of wall i.
      for (const k of [0, 1] as const) {
        const p = k === 0 ? wj.a : wj.b;
        const { t, off } = along(wi, p);
        if (off <= tol && t > margin && t < 1 - margin) cuts[i].push([t, ends[j][k]]);
      }
      // Crossing: the two walls cross each other part-way along both.
      if (j > i) {
        const hit = lineIntersection(wi, wj);
        if (hit) {
          const a = along(wi, hit), b = along(wj, hit);
          const lenJ = dist(wj.a, wj.b);
          const mj = Math.min(0.49, tol / lenJ);
          if (a.t > margin && a.t < 1 - margin && b.t > mj && b.t < 1 - mj) {
            const node = nodeAt(hit);
            cuts[i].push([a.t, node]);
            cuts[j].push([b.t, node]);
          }
        }
      }
    }
  }

  const edges: Edge[] = [];
  const seen = new Set<string>();
  cuts.forEach((list, seg) => {
    list.sort((p, q) => p[0] - q[0]);
    for (let k = 1; k < list.length; k++) {
      const u = list[k - 1][1], v = list[k][1];
      if (u === v) continue;
      const key = u < v ? `${u}:${v}` : `${v}:${u}`;
      if (seen.has(key)) continue; // two walls on top of each other
      seen.add(key);
      edges.push({ u, v, seg });
    }
  });

  // Walls that lead nowhere (a free end) take no part in an enclosure.
  let live = edges.slice();
  for (;;) {
    const degree = new Map<number, number>();
    for (const e of live) { degree.set(e.u, (degree.get(e.u) ?? 0) + 1); degree.set(e.v, (degree.get(e.v) ?? 0) + 1); }
    const next = live.filter(e => (degree.get(e.u) ?? 0) > 1 && (degree.get(e.v) ?? 0) > 1);
    if (next.length === live.length) break;
    live = next;
  }
  if (live.length < 3) return null;

  // Half-edges, with the neighbours around each node in counter-clockwise order.
  const around = new Map<number, Array<{ to: number; seg: number; angle: number }>>();
  const add = (from: number, to: number, seg: number) => {
    const list = around.get(from) ?? [];
    list.push({ to, seg, angle: Math.atan2(nodes[to][1] - nodes[from][1], nodes[to][0] - nodes[from][0]) });
    around.set(from, list);
  };
  for (const e of live) { add(e.u, e.v, e.seg); add(e.v, e.u, e.seg); }
  for (const list of around.values()) list.sort((p, q) => p.angle - q.angle);

  // Trace every face. Each is left of its half-edges: inner faces turn counter-clockwise (positive area), the
  // outside of a connected group of walls turns clockwise (negative area), and the biggest of those is the building.
  const visited = new Set<string>();
  let best: Array<{ u: number; v: number; seg: number }> | null = null;
  let bestArea = 0;
  for (const e of live) {
    for (const [start, first, seg0] of [[e.u, e.v, e.seg], [e.v, e.u, e.seg]] as const) {
      if (visited.has(`${start}>${first}`)) continue;
      const face: Array<{ u: number; v: number; seg: number }> = [];
      let u = start, v = first, seg = seg0;
      for (let guard = 0; guard <= live.length * 2 + 2; guard++) {
        visited.add(`${u}>${v}`);
        face.push({ u, v, seg });
        const list = around.get(v)!;
        const back = list.findIndex(n => n.to === u);
        const turn = list[(back - 1 + list.length) % list.length]; // the next wall clockwise from where we came in
        u = v; v = turn.to; seg = turn.seg;
        if (u === start && v === first) break;
      }
      let area = 0;
      for (const h of face) area += nodes[h.u][0] * nodes[h.v][1] - nodes[h.v][0] * nodes[h.u][1];
      if (area / 2 < bestArea) { bestArea = area / 2; best = face; }
    }
  }
  if (!best) return null;

  // A wall joining two loops is walked there and back: drop the out-and-back pairs.
  let ring = best;
  for (let changed = true; changed && ring.length >= 2;) {
    changed = false;
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length];
      if (a.u === b.v && a.v === b.u) {
        const drop = new Set([k, (k + 1) % ring.length]);
        ring = ring.filter((_, idx) => !drop.has(idx));
        changed = true;
        break;
      }
    }
  }
  if (ring.length < 3) return null;

  // One run per wall: a wall cut where partitions meet it is still one side of the outline.
  const runs: Array<{ seg: number; to: number }> = [];
  for (const h of ring) {
    if (runs.length && runs[runs.length - 1].seg === h.seg) runs[runs.length - 1].to = h.v;
    else runs.push({ seg: h.seg, to: h.v });
  }
  // The outline may have started part-way along a wall: that wall's last run continues into its first, which
  // already ends at the corner that matters.
  if (runs.length > 1 && runs[0].seg === runs[runs.length - 1].seg) runs.pop();
  return cornersOfRuns(runs, lines, nodes);
}

/** Each corner is where two walls' centre lines meet (a wall end overlaps its neighbour by about half a thickness). */
function cornersOfRuns(runs: Array<{ seg: number; to: number }>, lines: readonly WallLine[], nodes: Pt[]): Pt[] | null {
  const n = runs.length;
  if (n < 3) return null;
  const corners: Pt[] = [];
  for (let k = 0; k < n; k++) {
    const here = runs[k], next = runs[(k + 1) % n];
    const node = nodes[here.to];
    const hit = lineIntersection(lines[here.seg], lines[next.seg]);
    corners.push(hit && dist(hit, node) <= 1.0 ? hit : [node[0], node[1]]);
  }
  // Straight-through vertices (two collinear walls end to end) are not corners.
  const kept = corners.filter((p, k) => {
    const prev = corners[(k - 1 + n) % n], nxt = corners[(k + 1) % n];
    const cross = (p[0] - prev[0]) * (nxt[1] - p[1]) - (p[1] - prev[1]) * (nxt[0] - p[0]);
    const span = dist(prev, nxt) || 1;
    return Math.abs(cross) / span > 0.03 && dist(p, prev) > 1e-4;
  });
  return kept.length >= 3 ? kept : null;
}
