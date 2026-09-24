import * as THREE from 'three';
import type { PatioData, PatioStep } from './patioTypes';

/**
 * Geometry for patios and decks, built in the shape's local frame: x/z relative to the shape's
 * position, y = 0 at the walking surface. `groundAt(x, z)` gives the ground's height in the
 * same frame (negative where the ground is below the surface).
 *
 * Everything here is plain geometry maths so it can be tested without a renderer.
 */
export type Vec2 = [number, number];
export type GroundAt = (x: number, z: number) => number;

/** One mesh's worth of triangles for one material. */
export type PatioPart =
  | 'surface' | 'joints' | 'edge' | 'kerb' | 'wall' | 'steps'
  | 'frame' | 'fascia' | 'skirting' | 'railTimber' | 'railMetal' | 'glass' | 'lights';

export interface PatioBuild {
  parts: Partial<Record<PatioPart, THREE.BufferGeometry>>;
  /** Light positions (local), for real lights and glowing fittings. */
  lights: THREE.Vector3[];
  stats: PatioStats;
}

export interface PatioStats {
  area: number;
  perimeter: number;
  /** Slabs, bricks or flagstones (patio) / board pieces (deck). */
  pieces: number;
  /** Total length of deck boards, metres. */
  boardLength: number;
  steps: number;
}

// ---------------------------------------------------------------------------------------------
// Polygon helpers
// ---------------------------------------------------------------------------------------------

export function polygonArea(poly: Vec2[]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
    area += ax * bz - bx * az;
  }
  return area / 2;
}

export function pointInPolygon(x: number, z: number, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

export function distanceToPolygon(x: number, z: number, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1e-12;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

/**
 * Offsets a polygon by `distance` (positive = outward), mitring corners (clipped so sharp
 * corners don't shoot out). Keeps one output point per input point.
 */
export function offsetPolygon(poly: Vec2[], distance: number): Vec2[] {
  if (Math.abs(distance) < 1e-9 || poly.length < 3) return poly.map(p => [p[0], p[1]]);
  const outward = polygonArea(poly) > 0 ? 1 : -1;
  const n = poly.length;
  return poly.map((p, i) => {
    const prev = poly[(i + n - 1) % n], next = poly[(i + 1) % n];
    const normal = (a: Vec2, b: Vec2): Vec2 => {
      const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz) || 1;
      return [outward * dz / length, -outward * dx / length];
    };
    const n1 = normal(prev, p), n2 = normal(p, next);
    let nx = n1[0] + n2[0], nz = n1[1] + n2[1];
    const length = Math.hypot(nx, nz);
    if (length < 1e-6) { nx = n1[0]; nz = n1[1]; } else { nx /= length; nz /= length; }
    const scale = Math.min(3, 1 / Math.max(0.25, nx * n1[0] + nz * n1[1]));
    return [p[0] + nx * distance * scale, p[1] + nz * distance * scale];
  });
}

/** Sutherland-Hodgman: `subject` (any simple polygon) clipped to the convex CCW polygon `clip`. */
export function clipToConvex(subject: Vec2[], clip: Vec2[]): Vec2[] {
  let output = subject;
  for (let i = 0; i < clip.length && output.length; i++) {
    const [ax, az] = clip[i], [bx, bz] = clip[(i + 1) % clip.length];
    // Inside = left of a->b for a CCW (positive area) clip polygon.
    const side = (p: Vec2) => (bx - ax) * (p[1] - az) - (bz - az) * (p[0] - ax);
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      const sp = side(p), sq = side(q);
      if (sp >= 0) output.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        output.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return output;
}

/**
 * The parts of a simple polygon on the left of the directed line a->b. Unlike a single
 * Sutherland-Hodgman pass, a concave polygon cut into several pieces comes back as separate
 * polygons (no zero-width bridges along the cut).
 */
export function splitByLine(poly: Vec2[], a: Vec2, b: Vec2): Vec2[][] {
  const n = poly.length;
  if (n < 3) return [];
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const side = poly.map(p => {
    const d = dx * (p[1] - a[1]) - dz * (p[0] - a[0]);
    return Math.abs(d) < 1e-12 ? 1e-12 : d;
  });
  if (side.every(d => d > 0)) return [poly];
  if (side.every(d => d < 0)) return [];
  const along = (p: Vec2) => (p[0] - a[0]) * dx + (p[1] - a[1]) * dz;

  // Walk the outline, recording inside runs; each run starts at an entry crossing and ends at an exit.
  interface Crossing { point: Vec2; s: number; chain: number; enter: boolean }
  const crossings: Crossing[] = [];
  const chains: Vec2[][] = [];
  // Start just after a vertex that is outside, so every chain is complete.
  const start = side.findIndex(d => d < 0);
  let current: Vec2[] | null = null;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n, j = (i + 1) % n;
    const p = poly[i], q = poly[j], sp = side[i], sq = side[j];
    if (sp > 0 && current) current.push(p);
    if ((sp > 0) !== (sq > 0)) {
      const t = sp / (sp - sq);
      const x: Vec2 = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      if (sq > 0) {
        current = [x];
        crossings.push({ point: x, s: along(x), chain: chains.length, enter: true });
      } else if (current) {
        current.push(x);
        crossings.push({ point: x, s: along(x), chain: chains.length, enter: false });
        chains.push(current);
        current = null;
      }
    }
  }
  // Pair crossings along the line: interior stretches of the line run between consecutive ones.
  const sorted = crossings.slice().sort((c1, c2) => c1.s - c2.s);
  const partner = new Map<Crossing, Crossing>();
  for (let k = 0; k + 1 < sorted.length; k += 2) { partner.set(sorted[k], sorted[k + 1]); partner.set(sorted[k + 1], sorted[k]); }
  const exitOf = new Map<number, Crossing>(), enterOf = new Map<number, Crossing>();
  for (const c of crossings) (c.enter ? enterOf : exitOf).set(c.chain, c);
  const used = new Set<number>();
  const pieces: Vec2[][] = [];
  for (let c0 = 0; c0 < chains.length; c0++) {
    if (used.has(c0)) continue;
    const piece: Vec2[] = [];
    let c = c0;
    for (let guard = 0; guard <= chains.length && !used.has(c); guard++) {
      used.add(c);
      piece.push(...chains[c]);
      const next = partner.get(exitOf.get(c)!);
      if (!next) break;
      c = next.chain;
    }
    if (piece.length >= 3) pieces.push(piece);
  }
  return pieces;
}

/** `subject` (any simple polygon) intersected with the convex CCW polygon `clip`, as separate pieces. */
export function clipToConvexPieces(subject: Vec2[], clip: Vec2[]): Vec2[][] {
  let pieces = [subject];
  for (let i = 0; i < clip.length && pieces.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    pieces = pieces.flatMap(piece => splitByLine(piece, a, b));
  }
  return pieces;
}

function ensureCCW(poly: Vec2[]): Vec2[] {
  return polygonArea(poly) < 0 ? poly.slice().reverse() : poly;
}

/** Point on the arc from a to b whose middle sits `bulge` to the left of a->b, at fraction t. */
export function arcPoint(a: Vec2, b: Vec2, bulge: number, t: number): Vec2 {
  const dx = b[0] - a[0], dz = b[1] - a[1], chord = Math.hypot(dx, dz);
  if (Math.abs(bulge) < 1e-4 || chord < 1e-6) return [a[0] + dx * t, a[1] + dz * t];
  // Left normal in x/z (rotate the direction a quarter turn from +x toward -z... i.e. (-dz, dx)).
  const nx = -dz / chord, nz = dx / chord;
  const s = bulge;
  const radius = (chord * chord / 4 + s * s) / (2 * Math.abs(s));
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
  // Centre sits on the normal through the middle, on the far side from the bulge by R - |s|.
  const offset = s - Math.sign(s) * radius;
  const cx = mx + nx * offset, cz = mz + nz * offset;
  const angleA = Math.atan2(a[1] - cz, a[0] - cx);
  const angleB = Math.atan2(b[1] - cz, b[0] - cx);
  const angleP = Math.atan2(mz + nz * s - cz, mx + nx * s - cx);
  let sweep = angleB - angleA;
  const norm = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));
  sweep = norm(sweep);
  // Pick the direction that passes through the bulge point.
  const toP = norm(angleP - angleA);
  const passes = sweep > 0 ? toP > 0 && toP < sweep : toP < 0 && toP > sweep;
  if (!passes) sweep = sweep > 0 ? sweep - Math.PI * 2 : sweep + Math.PI * 2;
  const angle = angleA + sweep * t;
  return [cx + Math.cos(angle) * radius, cz + Math.sin(angle) * radius];
}

/** Bulge (sagitta) of the arc from a to b passing through `through`, or 0 if nearly straight. */
export function bulgeThrough(a: Vec2, b: Vec2, through: Vec2): number {
  const dx = b[0] - a[0], dz = b[1] - a[1], chord = Math.hypot(dx, dz);
  if (chord < 1e-6) return 0;
  const nx = -dz / chord, nz = dx / chord;
  // Signed distance of the through point from the chord and its position along it.
  const h = (through[0] - a[0]) * nx + (through[1] - a[1]) * nz;
  const u = ((through[0] - a[0]) * dx + (through[1] - a[1]) * dz) / chord;
  if (Math.abs(h) < 0.02) return 0;
  // Circle through a, b and the point: its centre is on the chord's perpendicular bisector,
  // at height k above the chord (in the normal direction).
  const half = chord / 2;
  const k = ((u - half) * (u - half) + h * h - half * half) / (2 * h);
  const radius = Math.hypot(half, k);
  // The arc's middle is the circle's point on the bisector on the through point's side.
  return k + Math.sign(h) * radius;
}

export interface DenseOutline {
  /** CCW outline with curved edges broken into short segments. */
  points: Vec2[];
  /** For each dense point, the drawn edge it starts a segment of. */
  edgeOf: number[];
  /** For each dense point, how far along its drawn edge it is (0..1). */
  tOf: number[];
  /** True when the drawn points were reversed to make the outline CCW. */
  reversed: boolean;
}

/**
 * The drawn outline with curves expanded. Drawn edge i runs from points[i] to points[i+1]; if
 * the drawing was clockwise the dense outline is reversed, and edgeOf/tOf still refer to the
 * drawn edges.
 */
export function denseOutline(points: Vec2[], bulges: number[], segment = 0.15): DenseOutline {
  const out: Vec2[] = [], edgeOf: number[] = [], tOf: number[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n], bulge = bulges[i] ?? 0;
    const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.abs(bulge) < 1e-4 ? 1 : Math.max(4, Math.ceil((chord + Math.abs(bulge) * 2) / segment));
    for (let s = 0; s < steps; s++) {
      out.push(arcPoint(a, b, bulge, s / steps));
      edgeOf.push(i);
      tOf.push(s / steps);
    }
  }
  if (polygonArea(out) >= 0) return { points: out, edgeOf, tOf, reversed: false };
  // Reverse so the outline is CCW. Segment k (point k to k+1) of the reversed outline is the
  // original segment ending at the original point k, so its drawn edge is that segment's.
  const m = out.length;
  const points2: Vec2[] = [], edge2: number[] = [], t2: number[] = [];
  for (let k = 0; k < m; k++) {
    const original = (m - k) % m;
    const segmentStart = (original - 1 + m) % m;
    points2.push(out[original]);
    edge2.push(edgeOf[segmentStart]);
    t2.push(original === 0 ? 1 : tOf[original] || 1);
  }
  return { points: points2, edgeOf: edge2, tOf: t2, reversed: true };
}

// ---------------------------------------------------------------------------------------------
// Mesh building
// ---------------------------------------------------------------------------------------------

class PartBuilder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  uvs: number[] = [];
  /** Board-space coordinates for wood shading: along the board (m), across it (0..1). */
  board: number[] = [];
  private color = new THREE.Color(1, 1, 1);
  private boardAlong = 0;
  private boardAcross = 0;

  setColor(c: THREE.Color) { this.color.copy(c); return this; }
  setBoard(along: number, across: number) { this.boardAlong = along; this.boardAcross = across; }

  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, uv?: [Vec2, Vec2, Vec2], board?: [Vec2, Vec2, Vec2]) {
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (normal.lengthSq() < 1e-16) return;
    normal.normalize();
    [a, b, c].forEach((p, i) => {
      this.positions.push(p.x, p.y, p.z);
      this.normals.push(normal.x, normal.y, normal.z);
      this.colors.push(this.color.r, this.color.g, this.color.b);
      const u = uv ? uv[i] : [p.x, p.z];
      this.uvs.push(u[0], u[1]);
      const w = board ? board[i] : [this.boardAlong, this.boardAcross];
      this.board.push(w[0], w[1]);
    });
  }

  /** Quad a-b-c-d (counter-clockwise seen from the side the face should point to). */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) {
    const uvFor = (p: THREE.Vector3): Vec2 => [p.x + p.z, p.y];
    this.tri(a, b, c, [uvFor(a), uvFor(b), uvFor(c)]);
    this.tri(a, c, d, [uvFor(a), uvFor(c), uvFor(d)]);
  }

  build(): THREE.BufferGeometry | undefined {
    if (!this.positions.length) return undefined;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute('aBoard', new THREE.Float32BufferAttribute(this.board, 2));
    g.computeBoundingSphere();
    return g;
  }
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Flat top face of a polygon (CCW in x/z) at height y, facing up. */
function topFace(builder: PartBuilder, poly: Vec2[], y: number, uvOf?: (p: Vec2) => Vec2, boardOf?: (p: Vec2) => Vec2) {
  if (poly.length < 3) return;
  const contour = poly.map(p => new THREE.Vector2(p[0], p[1]));
  const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const [i, j, k] of triangles) {
    // Wind so the normal points up (+y): a triangle that is CCW in x/z faces up as (a, c, b).
    let a = poly[i], b = poly[j], c = poly[k];
    if ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]) < 0) [b, c] = [c, b];
    const pts = [a, c, b];
    builder.tri(v3(a[0], y, a[1]), v3(c[0], y, c[1]), v3(b[0], y, b[1]),
      uvOf ? pts.map(uvOf) as [Vec2, Vec2, Vec2] : undefined,
      boardOf ? pts.map(boardOf) as [Vec2, Vec2, Vec2] : undefined);
  }
}

/**
 * Vertical face from a to b between heights. Materials are double-sided and normals follow the
 * winding, so faces light correctly from either side.
 */
function sideQuad(builder: PartBuilder, a: Vec2, b: Vec2, yTopA: number, yTopB: number, yBotA: number, yBotB: number) {
  builder.quad(v3(a[0], yBotA, a[1]), v3(b[0], yBotB, b[1]), v3(b[0], yTopB, b[1]), v3(a[0], yTopA, a[1]));
}

/**
 * A paving piece or board: flat top with a small bevel down to its sides. `poly` must be CCW.
 */
function addPiece(builder: PartBuilder, poly: Vec2[], top: number, thickness: number, bevel: number,
  uvOf?: (p: Vec2) => Vec2, boardOf?: (p: Vec2) => Vec2) {
  if (poly.length < 3) return;
  let inner = bevel > 0 ? offsetPolygon(poly, -bevel) : poly;
  // Tiny or sliver pieces: skip the bevel rather than let the inset turn inside out.
  if (bevel > 0 && (polygonArea(inner) < polygonArea(poly) * 0.35 || polygonArea(inner) <= 0)) inner = poly;
  const bevelled = inner !== poly;
  topFace(builder, inner, top, uvOf, boardOf);
  const edgeTop = bevelled ? top - bevel * 0.6 : top;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const a = poly[i], b = poly[j];
    if (bevelled) {
      const ia = inner[i], ib = inner[j];
      builder.quad(v3(a[0], edgeTop, a[1]), v3(b[0], edgeTop, b[1]), v3(ib[0], top, ib[1]), v3(ia[0], top, ia[1]));
    }
    sideQuad(builder, a, b, edgeTop, edgeTop, top - thickness, top - thickness);
  }
}

/** An axis-free box from a to b (x/z), `width` across, between heights y0 and y1. */
function addBeam(builder: PartBuilder, a: Vec2, b: Vec2, y0: number, y1: number, width: number) {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
  if (len < 1e-5) return;
  const nx = -dz / len * width / 2, nz = dx / len * width / 2;
  const poly: Vec2[] = [[a[0] - nx, a[1] - nz], [b[0] - nx, b[1] - nz], [b[0] + nx, b[1] + nz], [a[0] + nx, a[1] + nz]];
  addPiece(builder, ensureCCW(poly), y1, y1 - y0, 0);
  topFace(builder, ensureCCW(poly).slice().reverse(), y0);
}

/** A vertical post, square, centred on p. */
function addPost(builder: PartBuilder, p: Vec2, y0: number, y1: number, size: number, cap = false) {
  const h = size / 2;
  addPiece(builder, [[p[0] - h, p[1] - h], [p[0] + h, p[1] - h], [p[0] + h, p[1] + h], [p[0] - h, p[1] + h]], y1, y1 - y0, cap ? size * 0.12 : 0);
}

// ---------------------------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------------------------

function hash2(x: number, z: number): number {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function shade(base: THREE.Color, seed: number, amount: number, hueAmount = 0): THREE.Color {
  const c = base.clone();
  c.offsetHSL((hash2(seed, 7.3) - 0.5) * hueAmount, (hash2(seed, 1.9) - 0.5) * amount * 0.5, (hash2(seed, 4.1) - 0.5) * amount);
  return c;
}

// ---------------------------------------------------------------------------------------------
// Paving patterns: convex cells in pattern space (u, v), before joints and clipping.
// ---------------------------------------------------------------------------------------------

type Cell = Vec2[];

function rect(u0: number, v0: number, u1: number, v1: number): Cell {
  return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
}

function slabCells(bounds: [number, number, number, number], size: [number, number], offsetRows: boolean): Cell[] {
  const [minU, minV, maxU, maxV] = bounds;
  const [w, d] = size;
  const cells: Cell[] = [];
  for (let row = Math.floor(minV / d) - 1; row * d < maxV + d; row++) {
    const shift = offsetRows && row % 2 ? w / 2 : 0;
    for (let col = Math.floor((minU - shift) / w) - 1; col * w + shift < maxU + w; col++) {
      cells.push(rect(col * w + shift, row * d, (col + 1) * w + shift, (row + 1) * d));
    }
  }
  return cells;
}

/** Random-course paving: rows of 290 or 600 mm, each filled with 290/600/900 mm slabs. */
function mixedCells(bounds: [number, number, number, number]): Cell[] {
  const [minU, minV, maxU, maxV] = bounds;
  const heights = [0.6, 0.29], lengths = [0.9, 0.6, 0.29];
  const cells: Cell[] = [];
  let v = Math.floor(minV / 0.3) * 0.3 - 0.6, row = 0;
  while (v < maxV + 0.6) {
    const h = heights[hash2(row, 3.3) < 0.62 ? 0 : 1];
    let u = minU - 1 - hash2(row, 8.1) * 0.9, k = 0;
    while (u < maxU + 1) {
      const l = lengths[Math.floor(hash2(row * 31 + k, 5.5) * 3)];
      cells.push(rect(u, v, u + l, v + h));
      u += l; k++;
    }
    v += h; row++;
  }
  return cells;
}

function brickCells(bounds: [number, number, number, number], pattern: PatioData['blockPattern'], length: number, width: number): Cell[] {
  const [minU, minV, maxU, maxV] = bounds;
  const cells: Cell[] = [];
  if (pattern === 'stretcher') return slabCells(bounds, [length, width], true);
  if (pattern === 'basketweave') {
    // 2x2 squares of paired bricks, alternating horizontal and vertical.
    const s = length;
    for (let i = Math.floor(minU / s) - 1; i * s < maxU + s; i++) {
      for (let j = Math.floor(minV / s) - 1; j * s < maxV + s; j++) {
        const u = i * s, v = j * s;
        if ((i + j) % 2 === 0) { cells.push(rect(u, v, u + s, v + width), rect(u, v + width, u + s, v + s)); }
        else { cells.push(rect(u, v, u + width, v + s), rect(u + width, v, u + s, v + s)); }
      }
    }
    return cells;
  }
  // 90-degree herringbone with bricks twice as long as wide: staircases of one horizontal and
  // one vertical brick per step (along (w, w)), repeated every (2w, -2w).
  const w = width;
  const span = Math.ceil((maxU - minU + maxV - minV) / w) + 4;
  const k0 = Math.floor((minU + minV) / (2 * w)) - span;
  for (let m = -span; m <= span; m++) {
    for (let k = k0; k <= k0 + span * 2; k++) {
      const u = (k + 2 * m) * w, v = (k - 2 * m) * w;
      if (u > maxU + 3 * w || v > maxV + 3 * w || u < minU - 3 * w || v < minV - 3 * w) continue;
      cells.push(rect(u, v, u + 2 * w, v + w));
      cells.push(rect(u, v + w, u + w, v + 3 * w));
    }
  }
  return cells;
}

/** Crazy paving: Voronoi cells of jittered seed points. */
function flagstoneCells(bounds: [number, number, number, number], size: number): Cell[] {
  const [minU, minV, maxU, maxV] = bounds;
  const seeds: Vec2[] = [];
  for (let i = Math.floor(minU / size) - 1; i * size < maxU + size; i++) {
    for (let j = Math.floor(minV / size) - 1; j * size < maxV + size; j++) {
      seeds.push([(i + 0.15 + 0.7 * hash2(i, j)) * size, (j + 0.15 + 0.7 * hash2(j + 17, i - 3)) * size]);
    }
  }
  const cells: Cell[] = [];
  for (const s of seeds) {
    let cell: Cell = rect(s[0] - size * 2, s[1] - size * 2, s[0] + size * 2, s[1] + size * 2);
    for (const o of seeds) {
      if (o === s) continue;
      const dx = o[0] - s[0], dz = o[1] - s[1];
      if (dx * dx + dz * dz > size * size * 6) continue;
      // Keep the half-plane closer to s: a big CCW rectangle on s's side of the bisector.
      const mx = (s[0] + o[0]) / 2, mz = (s[1] + o[1]) / 2, len = Math.hypot(dx, dz);
      const tx = -dz / len, tz = dx / len, bx = -dx / len, bz = -dz / len, far = size * 8;
      const half: Cell = [
        [mx - tx * far, mz - tz * far], [mx + tx * far, mz + tz * far],
        [mx + tx * far + bx * far, mz + tz * far + bz * far], [mx - tx * far + bx * far, mz - tz * far + bz * far],
      ];
      cell = clipToConvex(cell, ensureCCW(half));
      if (cell.length < 3) break;
    }
    if (cell.length >= 3) cells.push(ensureCCW(cell));
  }
  return cells;
}

// ---------------------------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------------------------

const deg = THREE.MathUtils.degToRad;

/** Direction (radians, in x/z) of the longest drawn edge: boards and patterns line up with it. */
export function mainDirection(points: Vec2[]): number {
  let best = 0, angle = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > best) { best = len; angle = Math.atan2(b[1] - a[1], b[0] - a[0]); }
  }
  return angle;
}

/** Rotations between local x/z and a pattern frame turned by `angle`. */
function frame(angle: number) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return {
    toPattern: (p: Vec2): Vec2 => [p[0] * c + p[1] * s, -p[0] * s + p[1] * c],
    toLocal: (p: Vec2): Vec2 => [p[0] * c - p[1] * s, p[0] * s + p[1] * c],
  };
}

/** Where a step flight meets the outline: the point, outward normal and along-edge direction. */
export function stepAnchor(data: Pick<PatioData, 'points' | 'bulges'>, step: PatioStep) {
  const n = data.points.length;
  const a = data.points[step.edge % n], b = data.points[(step.edge + 1) % n], bulge = data.bulges[step.edge % n] ?? 0;
  const p = arcPoint(a, b, bulge, step.t);
  const q = arcPoint(a, b, bulge, Math.min(1, step.t + 0.01)), r = arcPoint(a, b, bulge, Math.max(0, step.t - 0.01));
  let tx = q[0] - r[0], tz = q[1] - r[1];
  const len = Math.hypot(tx, tz) || 1;
  tx /= len; tz /= len;
  // Outward: test which side of the edge is outside the (dense) outline.
  const dense = denseOutline(data.points, data.bulges).points;
  let nx = tz, nz = -tx;
  if (pointInPolygon(p[0] + nx * 0.05, p[1] + nz * 0.05, dense)) { nx = -nx; nz = -nz; }
  return { point: p, normal: [nx, nz] as Vec2, tangent: [tx, tz] as Vec2 };
}

export const STEP_RISE = 0.17;

export function buildPatio(data: PatioData, groundAt: GroundAt): PatioBuild {
  const outline = denseOutline(data.points, data.bulges);
  const poly = outline.points;
  const parts: Partial<Record<PatioPart, PartBuilder>> = {};
  const part = (name: PatioPart) => (parts[name] ??= new PartBuilder());
  const lights: THREE.Vector3[] = [];
  const stats: PatioStats = { area: Math.abs(polygonArea(poly)), perimeter: 0, pieces: 0, boardLength: 0, steps: 0 };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    stats.perimeter += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  if (poly.length < 3 || stats.area < 0.05) return { parts: {}, lights, stats };

  const white = new THREE.Color(1, 1, 1);
  const baseColor = new THREE.Color(data.color);

  // Openings in the edge for steps: dense segments whose middle falls inside a step's width.
  const stepAnchors = data.steps.map(step => ({ step, ...stepAnchor(data, step) }));
  const inStepOpening = (a: Vec2, b: Vec2) => stepAnchors.some(s => {
    const mx = (a[0] + b[0]) / 2 - s.point[0], mz = (a[1] + b[1]) / 2 - s.point[1];
    return Math.abs(mx * s.tangent[0] + mz * s.tangent[1]) < s.step.width / 2 && Math.abs(mx * s.normal[0] + mz * s.normal[1]) < 0.3;
  });
  const onWall = (k: number) => data.wallEdges[outline.edgeOf[k]] === true;

  if (data.kind === 'patio') {
    const kerbWidth = data.kerb ? 0.1 : 0;
    const field = kerbWidth ? offsetPolygon(poly, -kerbWidth) : poly;
    const angle = mainDirection(data.points) + deg(data.rotation);
    const { toPattern, toLocal } = frame(angle);
    const fieldPattern = field.map(toPattern);
    const us = fieldPattern.map(p => p[0]), vs = fieldPattern.map(p => p[1]);
    const bounds: [number, number, number, number] = [Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)];
    const joint = data.paving === 'gravel' ? 0 : Math.max(0.001, data.jointWidth);
    const thickness = data.paving === 'block' ? 0.06 : 0.04;
    const bevel = data.paving === 'porcelain' ? 0.0015 : data.paving === 'natural' ? 0.006 : data.paving === 'block' ? 0.005 : 0.004;
    const tone = data.paving === 'natural' ? 0.22 : data.paving === 'block' ? 0.2 : data.paving === 'porcelain' ? 0.04 : 0.1;
    const hueTone = data.paving === 'natural' ? 0.05 : data.paving === 'block' ? 0.03 : 0.01;

    if (data.paving === 'gravel') {
      // A fine, slightly lumpy surface with speckled stones, over the whole field.
      const builder = part('surface');
      const step = 0.08;
      const fieldCCW = ensureCCW(field.map(toPattern));
      for (let u = bounds[0]; u < bounds[2]; u += step) {
        for (let v = bounds[1]; v < bounds[3]; v += step) {
          for (const cell of clipToConvexPieces(fieldCCW, rect(u, v, u + step, v + step))) {
            const local = ensureCCW(cell.map(toLocal));
            const cx = local.reduce((s, p) => s + p[0], 0) / local.length, cz = local.reduce((s, p) => s + p[1], 0) / local.length;
            builder.setColor(shade(baseColor, cx * 13.1 + cz * 7.7, 0.35, 0.03));
            const bump = (hash2(cx * 3, cz * 3) - 0.5) * 0.006;
            topFace(builder, local, 0.005 + bump);
          }
        }
      }
      stats.pieces = 0;
    } else {
      const cells = data.paving === 'block'
        ? brickCells(bounds, data.blockPattern, data.slabSize[0] || 0.2, data.slabSize[1] || 0.1)
        : data.paving === 'natural'
          ? flagstoneCells(bounds, Math.max(0.25, data.slabSize[0] || 0.55))
          : (data.slabSize[0] <= 0 ? mixedCells(bounds) : slabCells(bounds, data.slabSize, data.slabSize[0] !== data.slabSize[1]));
      const fieldCCW = ensureCCW(fieldPattern);
      const builder = part('surface');
      for (const cell of cells) {
        const cu = cell.reduce((s, p) => s + p[0], 0) / cell.length, cv = cell.reduce((s, p) => s + p[1], 0) / cell.length;
        if (cu < bounds[0] - 1 || cu > bounds[2] + 1 || cv < bounds[1] - 1 || cv > bounds[3] + 1) continue;
        const shrunk = offsetPolygon(ensureCCW(cell), -joint / 2);
        for (const piece of clipToConvexPieces(fieldCCW, ensureCCW(shrunk))) {
          if (Math.abs(polygonArea(piece)) < 0.0004) continue;
          builder.setColor(shade(baseColor, cu * 12.9898 + cv * 78.233, tone, hueTone));
          // Laid slabs are never perfectly level: a millimetre or so of lippage.
          const lift = (hash2(cu * 5.1, cv * 3.7) - 0.5) * (data.paving === 'natural' ? 0.004 : 0.0015);
          addPiece(builder, ensureCCW(piece.map(toLocal)), lift, thickness, bevel);
          stats.pieces++;
        }
      }
      // Grout / bedding between the pieces.
      part('joints').setColor(white);
      topFace(part('joints'), ensureCCW(field), -0.006);
    }

    if (data.kerb) {
      const builder = part('kerb');
      const kerbColor = new THREE.Color(data.kerbColor);
      for (let i = 0; i < poly.length; i++) {
        const j = (i + 1) % poly.length;
        const a = poly[i], b = poly[j], ia = field[i], ib = field[j];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const count = Math.max(1, Math.round(len / 0.2));
        for (let k = 0; k < count; k++) {
          const t0 = k / count, t1 = (k + 1) / count;
          const lerp = (p: Vec2, q: Vec2, t: number): Vec2 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
          const cell = ensureCCW([lerp(a, b, t0), lerp(a, b, t1), lerp(ia, ib, t1), lerp(ia, ib, t0)]);
          const shrunk = offsetPolygon(cell, -0.002);
          builder.setColor(shade(kerbColor, i * 31 + k, 0.08));
          addPiece(builder, shrunk, 0.006, 0.12, 0.004);
        }
      }
    }

    // The patio's own edge, down to the ground where it stands proud of it.
    const edge = part('edge');
    edge.setColor(baseColor.clone().multiplyScalar(0.85));
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ga = Math.min(groundAt(a[0], a[1]), -0.04) - 0.05, gb = Math.min(groundAt(b[0], b[1]), -0.04) - 0.05;
      sideQuad(edge, a, b, 0, 0, ga, gb);
    }

    if (data.retainingWall) {
      // Where the ground outside is higher than the patio, hold it back with a low wall with a coping.
      const outer = offsetPolygon(poly, 0.16);
      const probe = offsetPolygon(poly, 0.9);
      const heights = probe.map(p => THREE.MathUtils.clamp(groundAt(p[0], p[1]) + 0.06, 0, 1.2));
      const wall = part('wall');
      wall.setColor(new THREE.Color(data.kerbColor).multiplyScalar(0.95));
      for (let i = 0; i < poly.length; i++) {
        const j = (i + 1) % poly.length;
        let ha = heights[i], hb = heights[j];
        if (ha < 0.12 && hb < 0.12) continue;
        if (onWall(i) || inStepOpening(poly[i], poly[j])) continue;
        ha = Math.max(ha, 0.12); hb = Math.max(hb, 0.12);
        const a = poly[i], b = poly[j], oa = outer[i], ob = outer[j];
        // Inner face, top, outer face (mostly buried), with a slight coping overhang.
        wall.quad(v3(b[0], -0.05, b[1]), v3(a[0], -0.05, a[1]), v3(a[0], ha, a[1]), v3(b[0], hb, b[1]));
        wall.quad(v3(a[0], ha, a[1]), v3(oa[0], ha, oa[1]), v3(ob[0], hb, ob[1]), v3(b[0], hb, b[1]));
        wall.quad(v3(oa[0], ha, oa[1]), v3(oa[0], -0.3, oa[1]), v3(ob[0], -0.3, ob[1]), v3(ob[0], hb, ob[1]));
        const ga = heights[(i + poly.length - 1) % poly.length] < 0.12, gb = heights[(j + 1) % poly.length] < 0.12;
        if (ga) wall.quad(v3(a[0], -0.05, a[1]), v3(oa[0], -0.05, oa[1]), v3(oa[0], ha, oa[1]), v3(a[0], ha, a[1]));
        if (gb) wall.quad(v3(ob[0], -0.05, ob[1]), v3(b[0], -0.05, b[1]), v3(b[0], hb, b[1]), v3(ob[0], hb, ob[1]));
      }
    }
  } else {
    buildDeck(data, poly, outline, groundAt, part, stats, lights, inStepOpening, onWall);
  }

  // Steps down from the edge, one flight per step entry.
  for (const anchor of stepAnchors) {
    const builder = part('steps');
    const foot: Vec2 = [anchor.point[0] + anchor.normal[0] * 0.6, anchor.point[1] + anchor.normal[1] * 0.6];
    const drop = -groundAt(foot[0], foot[1]);
    if (drop < 0.08) continue;
    const count = Math.max(1, Math.round(drop / STEP_RISE));
    const rise = drop / count, going = data.kind === 'deck' ? 0.28 : 0.32;
    const half = anchor.step.width / 2;
    const [nx, nz] = anchor.normal, [tx, tz] = anchor.tangent;
    const color = data.kind === 'deck' ? deckColor(data) : new THREE.Color(data.kerb ? data.kerbColor : data.color);
    for (let k = 1; k <= count; k++) {
      const d0 = (k - 1) * going, d1 = k * going + 0.02;
      const at = (d: number, s: number): Vec2 => [anchor.point[0] + nx * d + tx * s, anchor.point[1] + nz * d + tz * s];
      const tread = ensureCCW([at(d0, -half), at(d1, -half), at(d1, half), at(d0, half)]);
      const top = -k * rise;
      builder.setColor(shade(color, k * 7 + anchor.step.edge, 0.06));
      if (data.kind === 'deck') {
        builder.setBoard(k * 1.7, 0.5);
        addPiece(builder, tread, top, 0.035, 0.003);
        // Riser board and a pair of stringers down to the ground.
        const riser = ensureCCW([at(d0, -half), at(d0 + 0.02, -half), at(d0 + 0.02, half), at(d0, half)]);
        addPiece(builder, riser, top + rise - 0.035, rise - 0.035, 0);
        // A light in each riser, facing out.
        if (data.lights.enabled) { const lp = at(d0 + 0.022, 0); lights.push(new THREE.Vector3(lp[0], top + rise * 0.45, lp[1])); }
      } else {
        const ground = Math.min(groundAt(...at((d0 + d1) / 2, 0)), top) - 0.1;
        addPiece(builder, tread, top, top - ground, 0.006);
      }
    }
    if (data.kind === 'deck') {
      const frameBuilder = part('frame');
      frameBuilder.setColor(new THREE.Color('#7e6a4c'));
      // Sloped stringers under each side of the flight, from the deck edge down to the ground.
      const length = count * going;
      for (const side of [-half + 0.03, half - 0.03]) {
        const at = (d: number, y: number, across: number) =>
          v3(anchor.point[0] + nx * d + tx * (side + across), y, anchor.point[1] + nz * d + tz * (side + across));
        const topStart = -0.04, topEnd = -drop + rise * 0.3, depth = 0.22;
        for (const across of [-0.02, 0.02]) {
          frameBuilder.quad(at(0, topStart, across), at(length, topEnd, across), at(length, -drop - 0.05, across), at(0, topStart - depth, across));
        }
        frameBuilder.quad(at(0, topStart, -0.02), at(length, topEnd, -0.02), at(length, topEnd, 0.02), at(0, topStart, 0.02));
        frameBuilder.quad(at(0, topStart - depth, -0.02), at(length, -drop - 0.05, -0.02), at(length, -drop - 0.05, 0.02), at(0, topStart - depth, 0.02));
      }
    }
    stats.steps += count;
  }

  // Light fittings: small glowing squares set into the deck and the step risers.
  if (lights.length) {
    const fittings = part('lights');
    fittings.setColor(new THREE.Color(1, 1, 1));
    for (const light of lights) addPost(fittings, [light.x, light.z], light.y - 0.015, light.y + 0.002, 0.035);
  }

  const built: Partial<Record<PatioPart, THREE.BufferGeometry>> = {};
  for (const [name, builder] of Object.entries(parts) as [PatioPart, PartBuilder][]) {
    const g = builder.build();
    if (g) built[name] = g;
  }
  return { parts: built, lights, stats };
}

export function deckColor(data: Pick<PatioData, 'board' | 'color'>): THREE.Color {
  return new THREE.Color(data.color);
}

function buildDeck(
  data: PatioData, poly: Vec2[], outline: DenseOutline, groundAt: GroundAt,
  part: (name: PatioPart) => PartBuilder, stats: PatioStats, lights: THREE.Vector3[],
  inStepOpening: (a: Vec2, b: Vec2) => boolean, onWall: (k: number) => boolean,
) {
  const boardThickness = 0.028;
  const color = deckColor(data);
  const tone = data.board === 'composite' ? 0.05 : data.board === 'painted' ? 0.03 : 0.14;
  const width = THREE.MathUtils.clamp(data.boardWidth, 0.08, 0.3);
  const gap = THREE.MathUtils.clamp(data.boardGap, 0.002, 0.02);

  const turn = data.direction === 'across' ? Math.PI / 2 : data.direction === 'diagonal' ? Math.PI / 4 : 0;
  const angle = mainDirection(data.points) + turn;
  const { toPattern, toLocal } = frame(angle);

  const frameWidth = data.pictureFrame ? width + gap : 0;
  const field = frameWidth ? offsetPolygon(poly, -frameWidth) : poly;
  const fieldPattern = ensureCCW(field.map(toPattern));
  const us = fieldPattern.map(p => p[0]), vs = fieldPattern.map(p => p[1]);
  const [minU, minV, maxU, maxV] = [Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)];

  // Field boards in rows, cut to real board lengths with staggered butt joints.
  const surface = part('surface');
  const boardLength = 3.6;
  let row = 0;
  for (let v = minV; v < maxV; v += width + gap, row++) {
    const stagger = hash2(row, 2.2) * boardLength;
    for (let u = minU - stagger; u < maxU; u += boardLength) {
      const cell = rect(u + 0.0015, v, u + boardLength - 0.0015, v + width);
      for (const piece of clipToConvexPieces(fieldPattern, cell)) {
        if (Math.abs(polygonArea(piece)) < 0.002) continue;
        const pieceUs = piece.map(p => p[0]);
        stats.boardLength += Math.max(...pieceUs) - Math.min(...pieceUs);
        stats.pieces++;
        surface.setColor(shade(color, row * 17 + Math.round(u * 3), tone, tone * 0.15));
        const seed = hash2(row, u) * 50;
        addPiece(surface, ensureCCW(piece.map(toLocal)), 0, boardThickness, 0.002, undefined,
          p => { const q = toPattern(p); return [q[0] + seed, (q[1] - v) / width]; });
      }
    }
  }

  // Picture-frame boards around the edge, mitred at the corners.
  if (data.pictureFrame) {
    const inner = offsetPolygon(poly, -width);
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      const piece = ensureCCW([poly[i], poly[j], inner[j], inner[i]]);
      if (Math.abs(polygonArea(piece)) < 1e-5) continue;
      const ex = poly[j][0] - poly[i][0], ez = poly[j][1] - poly[i][1], len = Math.hypot(ex, ez) || 1;
      surface.setColor(shade(color, 900 + outline.edgeOf[i] * 13, tone, tone * 0.15));
      const seed = outline.edgeOf[i] * 7.3;
      addPiece(surface, offsetPolygon(piece, -0.0015), 0, boardThickness, 0.002, undefined,
        p => {
          const along = ((p[0] - poly[i][0]) * ex + (p[1] - poly[i][1]) * ez) / len;
          const across = Math.abs((p[0] - poly[i][0]) * -ez + (p[1] - poly[i][1]) * ex) / len / width;
          return [along + seed, Math.min(1, across)];
        });
      stats.boardLength += len;
    }
    stats.pieces += data.points.length;
  }

  // Frame: joists across the boards every 400 mm, beams under them, posts down to the ground.
  const frameColor = new THREE.Color(data.board === 'composite' ? '#5b5a57' : '#7e6a4c');
  const joistDepth = 0.15, beamDepth = 0.2;
  const jointTop = -boardThickness;
  const frameBuilder = part('frame');
  frameBuilder.setColor(frameColor);
  const outlinePattern = ensureCCW(offsetPolygon(poly, -0.02).map(toPattern));
  const opu = outlinePattern.map(p => p[0]), opv = outlinePattern.map(p => p[1]);
  const [fu0, fv0, fu1, fv1] = [Math.min(...opu), Math.min(...opv), Math.max(...opu), Math.max(...opv)];
  const underBottom = jointTop - joistDepth - beamDepth;
  const lowestGround = Math.min(...poly.map(p => groundAt(p[0], p[1])));
  if (data.underside === 'frame' || lowestGround < underBottom) {
    for (let u = fu0 + 0.02; u < fu1; u += 0.4) {
      for (const piece of clipToConvexPieces(outlinePattern, rect(u - 0.0235, fv0 - 1, u + 0.0235, fv1 + 1))) {
        addPiece(frameBuilder, ensureCCW(piece.map(toLocal)), jointTop, joistDepth, 0);
      }
    }
    // Rim joists round the outside.
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      const inset = offsetPolygon(poly, -0.047);
      const piece = ensureCCW([poly[i], poly[j], inset[j], inset[i]]);
      if (Math.abs(polygonArea(piece)) > 1e-5) addPiece(frameBuilder, piece, jointTop, joistDepth, 0);
    }
    const beamArea = ensureCCW(offsetPolygon(poly, -0.3).map(toPattern));
    const bu = beamArea.map(p => p[0]), bv = beamArea.map(p => p[1]);
    const [bu0, bv0, bu1, bv1] = [Math.min(...bu), Math.min(...bv), Math.max(...bu), Math.max(...bv)];
    const beamSpacing = 1.8;
    const beamCount = Math.max(1, Math.ceil((bv1 - bv0) / beamSpacing));
    for (let b = 0; b <= beamCount; b++) {
      const v = bv0 + (bv1 - bv0) * (b / beamCount);
      for (const piece of clipToConvexPieces(beamArea, rect(bu0 - 1, v - 0.05, bu1 + 1, v + 0.05))) {
        addPiece(frameBuilder, ensureCCW(piece.map(toLocal)), jointTop - joistDepth, beamDepth, 0);
      }
      // Posts along the beam.
      const postCount = Math.max(1, Math.ceil((bu1 - bu0) / beamSpacing));
      for (let k = 0; k <= postCount; k++) {
        const u = bu0 + (bu1 - bu0) * (k / postCount);
        const local = toLocal([u, v]);
        if (!pointInPolygon(local[0], local[1], poly) || distanceToPolygon(local[0], local[1], poly) < 0.2) continue;
        const ground = groundAt(local[0], local[1]);
        const bottom = jointTop - joistDepth - beamDepth;
        if (ground > bottom - 0.05) continue;
        addPost(frameBuilder, local, ground - 0.15, bottom, 0.1);
      }
    }
  }

  // Fascia board round the edge, covering the joist ends.
  if (data.fascia || data.underside === 'skirting') {
    const fascia = part('fascia');
    const outer = offsetPolygon(poly, 0.022);
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length;
      if (onWall(i)) continue;
      fascia.setColor(shade(color, 400 + i, tone * 0.6));
      fascia.setBoard(i * 3.1, 0.5);
      const oa = outer[i], ob = outer[j];
      const bottom = data.underside === 'skirting' ? 0 : -0.2;
      if (data.underside === 'skirting') {
        // Vertical slats down to the ground.
        const len = Math.hypot(ob[0] - oa[0], ob[1] - oa[1]);
        const slats = Math.max(1, Math.round(len / 0.13));
        for (let s = 0; s < slats; s++) {
          const t0 = s / slats + 0.004 / Math.max(len, 0.01), t1 = (s + 1) / slats - 0.004 / Math.max(len, 0.01);
          const pa: Vec2 = [oa[0] + (ob[0] - oa[0]) * t0, oa[1] + (ob[1] - oa[1]) * t0];
          const pb: Vec2 = [oa[0] + (ob[0] - oa[0]) * t1, oa[1] + (ob[1] - oa[1]) * t1];
          const ga = groundAt(pa[0], pa[1]) - 0.03, gb = groundAt(pb[0], pb[1]) - 0.03;
          fascia.setColor(shade(color, 400 + i * 50 + s, tone));
          sideQuad(fascia, pa, pb, -0.005, -0.005, Math.min(ga, -0.05), Math.min(gb, -0.05));
        }
      } else {
        sideQuad(fascia, oa, ob, -0.004, -0.004, bottom, bottom);
        // Its underside and top edge.
        fascia.quad(v3(oa[0], bottom, oa[1]), v3(poly[i][0], bottom, poly[i][1]), v3(poly[j][0], bottom, poly[j][1]), v3(ob[0], bottom, ob[1]));
      }
    }
  }

  // Railings along open edges (not against the house, not across a step opening).
  if (data.railing !== 'none') buildRailing(data, poly, part, inStepOpening, onWall, color);

  // Recessed deck lights round the edge.
  if (data.lights.enabled) {
    const ring = offsetPolygon(poly, -(data.pictureFrame ? width / 2 : 0.08));
    let carry = data.lights.spacing / 2;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      while (carry <= len) {
        const t = carry / len;
        const p: Vec2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        lights.push(new THREE.Vector3(p[0], 0.002, p[1]));
        carry += Math.max(0.3, data.lights.spacing);
      }
      carry -= len;
    }
  }
}

function buildRailing(
  data: PatioData, poly: Vec2[], part: (name: PatioPart) => PartBuilder,
  inStepOpening: (a: Vec2, b: Vec2) => boolean, onWall: (k: number) => boolean, deck: THREE.Color,
) {
  const height = 1.0;
  const metal = data.railing === 'cable';
  const posts = metal ? part('railMetal') : part('railTimber');
  const rails = data.railing === 'timber' ? part('railTimber') : part('railMetal');
  posts.setColor(metal ? new THREE.Color('#2b2d30') : deck);
  rails.setColor(data.railing === 'timber' ? deck : new THREE.Color('#2b2d30'));
  const postSize = metal ? 0.05 : 0.09;
  const inset = offsetPolygon(poly, -postSize / 2 - 0.01);

  // Runs of consecutive dense segments that get a railing.
  const n = poly.length;
  const open = poly.map((_, i) => !onWall(i) && !inStepOpening(poly[i], poly[(i + 1) % n]));
  const runs: Vec2[][] = [];
  if (open.every(Boolean)) {
    runs.push([...inset, inset[0]]);
  } else {
    const start = open.findIndex(o => !o);
    let current: Vec2[] | null = null;
    for (let k = 1; k <= n; k++) {
      const i = (start + k) % n;
      if (open[i]) {
        current ??= [inset[i]];
        current.push(inset[(i + 1) % n]);
      } else if (current) {
        runs.push(current);
        current = null;
      }
    }
    if (current) runs.push(current);
  }

  for (const run of runs) {
    // Resample the run at post positions: every corner sharper than ~20 degrees and at most 1.5 m apart.
    const postsAt: Vec2[] = [run[0]];
    let since = 0;
    for (let k = 1; k < run.length; k++) {
      const a = run[k - 1], b = run[k];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const pieces = Math.ceil((since + len) / 1.5);
      if (pieces > 1) {
        for (let s = 1; s < pieces; s++) {
          const t = (s * 1.5 - since) / len;
          if (t > 0 && t < 1) postsAt.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
        since = (since + len) % 1.5;
      } else since += len;
      const c = run[k + 1];
      const corner = c ? Math.abs(Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])) : Math.PI;
      if (!c || Math.min(corner, Math.PI * 2 - corner) > 0.35) { postsAt.push(b); since = 0; }
    }
    for (const p of postsAt) addPost(posts, p, -0.18, height + 0.03, postSize, !metal);
    // Rails follow the run itself (so curved edges get curved rails).
    for (let k = 1; k < run.length; k++) {
      const a = run[k - 1], b = run[k];
      if (data.railing === 'timber') {
        addBeam(rails, a, b, height - 0.045, height, 0.09);
        addBeam(rails, a, b, 0.07, 0.115, 0.07);
      } else {
        addBeam(rails, a, b, height - 0.04, height, data.railing === 'glass' ? 0.05 : 0.06);
      }
    }
    // Infill between consecutive posts.
    for (let k = 1; k < postsAt.length; k++) {
      const a = postsAt[k - 1], b = postsAt[k];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < postSize * 1.5) continue;
      const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
      const from: Vec2 = [a[0] + ux * (postSize / 2 + 0.02), a[1] + uz * (postSize / 2 + 0.02)];
      const to: Vec2 = [b[0] - ux * (postSize / 2 + 0.02), b[1] - uz * (postSize / 2 + 0.02)];
      if (data.railing === 'timber') {
        const count = Math.max(1, Math.floor(len / 0.12));
        for (let s = 1; s < count; s++) {
          const t = s / count;
          addPost(rails, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], 0.115, height - 0.045, 0.035);
        }
      } else if (data.railing === 'glass') {
        const glass = part('glass');
        glass.setColor(new THREE.Color(1, 1, 1));
        addBeam(glass, from, to, 0.06, height - 0.05, 0.012);
      } else {
        for (let y = 0.1; y < height - 0.05; y += 0.08) addBeam(rails, from, to, y, y + 0.005, 0.005);
      }
    }
  }
}

/**
 * The terrain as it should be under patios: flattened just below the paving inside the
 * outline, and never above the paving for a short margin round it (so terrain triangles that
 * straddle the edge can't poke up through the slabs). Only ever lowers the ground.
 */
export function patioGroundLimit(data: PatioData, surfaceY: number, margin: number): (x: number, z: number, localX: number, localZ: number) => number | undefined {
  const poly = denseOutline(data.points, data.bulges, 0.25).points;
  const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs) - margin, Math.max(...xs) + margin, Math.min(...zs) - margin, Math.max(...zs) + margin];
  const depth = data.paving === 'block' ? 0.07 : 0.05;
  return (_x, _z, lx, lz) => {
    if (lx < x0 || lx > x1 || lz < z0 || lz > z1) return undefined;
    if (pointInPolygon(lx, lz, poly)) return surfaceY - depth;
    if (distanceToPolygon(lx, lz, poly) <= margin) return surfaceY - 0.015;
    return undefined;
  };
}

/** The minimal shape fields ground grading needs (keeps this file free of app types). */
interface PatioShapeLike {
  type: string;
  hidden?: boolean;
  position: [number, number, number];
  patioData?: PatioData;
}

interface TerrainLike {
  position: [number, number, number];
  terrainData?: { gridX: number; gridY: number; width: number; depth: number; heights: number[] };
}

/**
 * Terrain heights with every patio set into the ground: flattened just below the paving inside
 * the outline, and kept below the paving for one grid cell round it (so terrain triangles that
 * straddle the edge can't poke up through the slabs). Only ever lowers the ground; decks leave
 * the ground alone. Returns the input heights unchanged (same array) when nothing applies.
 */
export function gradePatioGround(terrain: TerrainLike, shapes: PatioShapeLike[]): number[] | undefined {
  const data = terrain.terrainData;
  if (!data?.heights) return data?.heights;
  const patios = shapes.filter(s => s.type === 'patio' && !s.hidden && s.patioData?.kind === 'patio' && s.patioData.points.length >= 3);
  if (!patios.length) return data.heights;
  const { gridX, gridY, width, depth } = data;
  const [px, py, pz] = terrain.position;
  const cell = Math.max(width / Math.max(1, gridX - 1), depth / Math.max(1, gridY - 1));
  const margin = cell * 1.5 + 0.1;
  const limits = patios.map(s => ({ s, limit: patioGroundLimit(s.patioData!, s.position[1], margin) }));
  let heights: number[] | null = null;
  for (let iy = 0; iy < gridY; iy++) for (let ix = 0; ix < gridX; ix++) {
    const x = px - width / 2 + (ix / Math.max(1, gridX - 1)) * width;
    const z = pz - depth / 2 + (iy / Math.max(1, gridY - 1)) * depth;
    const index = iy * gridX + ix;
    let y = py + data.heights[index];
    for (const { s, limit } of limits) {
      const cap = limit(x, z, x - s.position[0], z - s.position[2]);
      if (cap !== undefined && y > cap) y = cap;
    }
    const local = y - py;
    if (local !== data.heights[index]) {
      heights ??= data.heights.slice();
      heights[index] = local;
    }
  }
  return heights ?? data.heights;
}
