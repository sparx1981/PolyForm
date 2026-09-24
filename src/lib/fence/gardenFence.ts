import type { GardenFenceStyle } from './fenceTypes';

/**
 * Garden fences (close board, picket, lap panel), emitted in the split-rail generator's part
 * format so both render through the same batching. Built like the real thing on slopes:
 * posts stand plumb at every corner and at most every 1.83 m; close board and picket fences
 * are raked (rails run parallel to the ground between posts), lap panels are stepped (each
 * panel stays level and the gravel board fills the gap underneath).
 */
export interface Point3 { x: number; y: number; z: number }
export interface FenceTriangle { points: [Point3, Point3, Point3]; uv: [number, number][]; endGrain?: boolean }
export interface FencePart { id: string; kind: 'wood' | 'stone' | 'metal'; role: 'post' | 'rail' | 'board'; buried?: boolean; surface: FenceTriangle[] }

const BAY = 1.83;
const POST = 0.1;

type Vec = { x: number; z: number };

class PartWriter {
  readonly surface: FenceTriangle[] = [];
  quad(a: Point3, b: Point3, c: Point3, d: Point3, endGrain = false) {
    const u = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), v = Math.hypot(d.x - a.x, d.y - a.y, d.z - a.z);
    this.surface.push({ points: [a, b, c], uv: [[0, 0], [u, 0], [u, v]], endGrain });
    this.surface.push({ points: [a, c, d], uv: [[0, 0], [u, v], [0, v]], endGrain });
  }
  tri(a: Point3, b: Point3, c: Point3) {
    this.surface.push({ points: [a, b, c], uv: [[0, 0], [1, 0], [0.5, 1]] });
  }
  /**
   * Box whose bottom edge runs from a0 to a1 (centred across the fence), `depth` thick across
   * the fence and `height` tall (vertical). Rails use a sloped a0→a1; boards and posts use a
   * short horizontal a0→a1 across their width. `grainAlongHeight` marks top/bottom as end grain.
   */
  box(a0: Point3, a1: Point3, across: Vec, depth: number, height: number, grainAlongHeight: boolean) {
    const h = depth / 2;
    // Side -1 is the +across face; with this mirroring every quad below winds outward.
    const p = (base: Point3, side: number, up: number): Point3 =>
      ({ x: base.x - across.x * h * side, y: base.y + up, z: base.z - across.z * h * side });
    const b00 = p(a0, -1, 0), b01 = p(a0, 1, 0), b10 = p(a1, -1, 0), b11 = p(a1, 1, 0);
    const t00 = p(a0, -1, height), t01 = p(a0, 1, height), t10 = p(a1, -1, height), t11 = p(a1, 1, height);
    this.quad(b00, b10, t10, t00);            // front
    this.quad(b11, b01, t01, t11);            // back
    this.quad(t00, t10, t11, t01, grainAlongHeight); // top
    this.quad(b01, b11, b10, b00, grainAlongHeight); // bottom
    this.quad(b01, b00, t00, t01, !grainAlongHeight); // start end
    this.quad(b10, b11, t11, t10, !grainAlongHeight); // finish end
  }
}

export interface GardenFenceInput {
  style: GardenFenceStyle;
  points: Vec[];
  closed: boolean;
  height: number;
  ground: (x: number, z: number) => number;
}

interface Bay { a: Vec; b: Vec; dir: Vec; across: Vec; length: number }

/** Posts at every corner and evenly between them, so no bay is longer than 1.83 m. */
function layoutBays(points: Vec[], closed: boolean): Bay[] {
  const path = closed ? [...points, points[0]] : points;
  const bays: Bay[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const s = path[i], e = path[i + 1];
    const length = Math.hypot(e.x - s.x, e.z - s.z);
    if (length < 0.05) continue;
    const dir = { x: (e.x - s.x) / length, z: (e.z - s.z) / length };
    const across = { x: -dir.z, z: dir.x };
    const count = Math.max(1, Math.ceil(length / BAY - 1e-6));
    for (let j = 0; j < count; j++) {
      const a = { x: s.x + (e.x - s.x) * j / count, z: s.z + (e.z - s.z) * j / count };
      const b = { x: s.x + (e.x - s.x) * (j + 1) / count, z: s.z + (e.z - s.z) * (j + 1) / count };
      bays.push({ a, b, dir, across, length: length / count });
    }
  }
  return bays;
}

const at = (p: Vec, dir: Vec, s: number, y: number, across?: Vec, offset = 0): Point3 =>
  ({ x: p.x + dir.x * s + (across?.x ?? 0) * offset, y, z: p.z + dir.z * s + (across?.z ?? 0) * offset });

export function buildGardenFence({ style, points, closed, height, ground }: GardenFenceInput): FencePart[] {
  const bays = layoutBays(points, closed);
  const parts: FencePart[] = [];
  let serial = 0;
  const part = (kind: FencePart['kind'], role: FencePart['role'], buried = false) => {
    const writer = new PartWriter();
    parts.push({ id: `${role}-${serial++}`, kind, role, buried, surface: writer.surface });
    return writer;
  };
  // Ground along a bay: raked fences follow the straight line between the two post feet.
  const raked = (bay: Bay, s: number, ga: number, gb: number) => ga + (gb - ga) * (s / bay.length);

  // Post tops: raked fences take their own ground; stepped panels take the higher panel.
  const postTops = new Map<string, number>();
  const key = (p: Vec) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`;
  const raise = (p: Vec, top: number) => postTops.set(key(p), Math.max(postTops.get(key(p)) ?? -Infinity, top));

  for (const bay of bays) {
    const ga = ground(bay.a.x, bay.a.z), gb = ground(bay.b.x, bay.b.z);
    const inner0 = POST / 2, inner1 = bay.length - POST / 2, span = inner1 - inner0;
    if (span <= 0.05) continue;

    if (style === 'panel') {
      // Stepped: the panel sits level above the highest ground along the bay.
      let high = -Infinity, low = Infinity;
      for (let k = 0; k <= 8; k++) {
        const s = bay.length * k / 8, g = ground(bay.a.x + bay.dir.x * s, bay.a.z + bay.dir.z * s);
        high = Math.max(high, g); low = Math.min(low, g);
      }
      const base = high + 0.02, top = base + height;
      part('stone', 'board').box(at(bay.a, bay.dir, inner0, low - 0.08), at(bay.a, bay.dir, inner1, low - 0.08), bay.across, 0.03, base + 0.15 - (low - 0.08), false);
      const frame = part('wood', 'rail');
      const panelBottom = base + 0.15;
      frame.box(at(bay.a, bay.dir, inner0, panelBottom), at(bay.a, bay.dir, inner0 + 0.045, panelBottom), bay.across, 0.045, top - panelBottom, true);
      frame.box(at(bay.a, bay.dir, inner1 - 0.045, panelBottom), at(bay.a, bay.dir, inner1, panelBottom), bay.across, 0.045, top - panelBottom, true);
      frame.box(at(bay.a, bay.dir, inner0, top - 0.045), at(bay.a, bay.dir, inner1, top - 0.045), bay.across, 0.05, 0.045, false);
      frame.box(at(bay.a, bay.dir, inner0, panelBottom), at(bay.a, bay.dir, inner1, panelBottom), bay.across, 0.05, 0.045, false);
      const slats = Math.max(3, Math.round((top - panelBottom - 0.09) / 0.14));
      const pitch = (top - panelBottom - 0.09) / slats;
      for (let k = 0; k < slats; k++) {
        const y = panelBottom + 0.045 + k * pitch;
        // Alternate slightly across the fence so the laps read as overlapping boards.
        const offset = (k % 2 ? 1 : -1) * 0.004;
        part('wood', 'board').box(at(bay.a, bay.dir, inner0 + 0.045, y, bay.across, offset),
          at(bay.a, bay.dir, inner1 - 0.045, y, bay.across, offset), bay.across, 0.012, pitch + 0.02, false);
      }
      raise(bay.a, top + 0.05); raise(bay.b, top + 0.05);
      continue;
    }

    // Raked styles: gravel board or rails parallel to the ground line.
    const railAt = (clearance: number, depth: number, tall: number, offset: number) =>
      part('wood', 'rail').box(at(bay.a, bay.dir, inner0, ga + clearance, bay.across, offset),
        at(bay.a, bay.dir, inner1, gb + clearance, bay.across, offset), bay.across, depth, tall, false);

    if (style === 'close-board') {
      part('stone', 'board').box(at(bay.a, bay.dir, inner0, ga - 0.06, bay.across, 0.02),
        at(bay.a, bay.dir, inner1, gb - 0.06, bay.across, 0.02), bay.across, 0.025, 0.21, false);
      for (const clearance of [0.3, height / 2, height - 0.3]) railAt(clearance, 0.05, 0.075, -0.035);
      const boards = Math.ceil(span / 0.1);
      for (let k = 0; k < boards; k++) {
        const s0 = inner0 + span * k / boards, s1 = Math.min(inner1, s0 + 0.125);
        const g = raked(bay, (s0 + s1) / 2, ga, gb), offset = 0.02 + (k % 2) * 0.006;
        part('wood', 'board').box(at(bay.a, bay.dir, s0, g + 0.15, bay.across, offset), at(bay.a, bay.dir, s1, g + 0.15, bay.across, offset),
          bay.across, 0.018, height - 0.15, true);
      }
      raise(bay.a, Math.max(ga, gb) + height + 0.05); raise(bay.b, Math.max(ga, gb) + height + 0.05);
    } else {
      // Picket: two rails behind spaced, pointed pickets.
      railAt(0.18, 0.045, 0.07, -0.03);
      railAt(height - 0.3, 0.045, 0.07, -0.03);
      const pickets = Math.max(1, Math.round(span / 0.13));
      for (let k = 0; k < pickets; k++) {
        const centre = inner0 + span * (k + 0.5) / pickets;
        const s0 = centre - 0.035, s1 = centre + 0.035, g = raked(bay, centre, ga, gb);
        const bottom = g + 0.05, shoulder = g + height - 0.05;
        const picket = part('wood', 'board');
        picket.box(at(bay.a, bay.dir, s0, bottom, bay.across, 0.012), at(bay.a, bay.dir, s1, bottom, bay.across, 0.012), bay.across, 0.02, shoulder - bottom, true);
        // Pointed top: a shallow pyramid on the picket's shoulders.
        const tip = at(bay.a, bay.dir, centre, g + height, bay.across, 0.012);
        const c = [[s0, -1], [s1, -1], [s1, 1], [s0, 1]].map(([s, side]) => at(bay.a, bay.dir, s, shoulder, bay.across, 0.012 + side * 0.01));
        for (let e = 0; e < 4; e++) picket.tri(c[(e + 1) % 4], c[e], tip);
      }
      raise(bay.a, Math.max(ga, gb) + height); raise(bay.b, Math.max(ga, gb) + height);
    }
  }

  // Posts: plumb, 0.6 m in the ground, with a weathering cap.
  const posts = new Map<string, Vec>();
  for (const bay of bays) { posts.set(key(bay.a), bay.a); posts.set(key(bay.b), bay.b); }
  const postSize = style === 'picket' ? 0.08 : POST;
  for (const [id, p] of posts) {
    const top = postTops.get(id);
    if (top === undefined) continue;
    const g = ground(p.x, p.z);
    const writer = part('wood', 'post', true);
    const zAxis = { x: 0, z: 1 };
    writer.box({ x: p.x - postSize / 2, y: g - 0.6, z: p.z }, { x: p.x + postSize / 2, y: g - 0.6, z: p.z }, zAxis, postSize, top - (g - 0.6), true);
    const cap = part('wood', 'rail');
    cap.box({ x: p.x - postSize / 2 - 0.01, y: top, z: p.z }, { x: p.x + postSize / 2 + 0.01, y: top, z: p.z }, zAxis, postSize + 0.02, 0.02, true);
  }
  return parts;
}

/** Total length of a fence path, metres. */
export function pathLength(points: Vec[], closed: boolean): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  if (closed && points.length > 2) length += Math.hypot(points[0].x - points.at(-1)!.x, points[0].z - points.at(-1)!.z);
  return length;
}
