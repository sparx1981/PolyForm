/**
 * PolyForm — "Convert To Wall".
 *
 * Turns a drawn kernel shape that has been given a wall thickness with the
 * Offset tool (and, usually, pulled up with Push/Pull) into real `wall`
 * Shapes, so doors, windows, timber framing and the other architectural
 * tools work on it.
 *
 * What qualifies is deliberately narrow, because a wall Shape is narrow: a
 * straight, upright box of one height and one thickness, rotated only about
 * the vertical axis (see Viewport's createWallSegment). So the source must
 * be an offset RING — one outer outline and one inner outline, the same
 * distance apart all the way round — lying flat, and if it has been
 * extruded, pulled straight up to a flat, level top. One wall is produced
 * per edge of that ring, each carrying its exact mitred footprint so every
 * corner closes flush at any angle.
 *
 * Curves (circles, arcs, Béziers) are already stored as short straight
 * edges, and each one becomes its own wall: the result looks exactly like
 * what was drawn. Whether a piece is wide enough to take a door or a
 * window is reported rather than forced, because a curved wall is as often
 * a decorative sweep or a round column (where no opening is wanted) as it
 * is a room.
 *
 * Everything here is pure: it reads the graph and returns a plan. The
 * caller applies it (deleting the source faces, adding the walls).
 */

import type { EdgeId, FaceId, Graph, Vec3 } from '../lib/geometry/types';
import { loopPoints, removeFace } from '../lib/geometry/topology';
import { planeBasis, projectToBasis } from '../lib/geometry/math';
import { insertIsolatedEdge, type InsertContext } from '../lib/geometry/insert';
import { derive, type DeriveOptions } from '../lib/geometry/derive';
import type { Shape } from '../types';
import { deleteGroupFacesAndEdges } from './kernelSelection';
import { ISOLATED_SHAPE_KEY } from './kernelPushPull';
import { restore, type Snapshot } from '../lib/geometry/heal';
import type { KernelArcHost } from './kernelArcHost';

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** A face within this of flat counts as horizontal (about 1 degree). */
const HORIZONTAL_MIN_NORMAL_Y = Math.cos((1 * Math.PI) / 180);
/** A face within this of upright counts as vertical (about 1 degree). */
const VERTICAL_MAX_NORMAL_Y = Math.sin((1 * Math.PI) / 180);
/** Positional tolerance for matching points and levels, in metres. */
const POINT_TOL = 0.002;
/** Edges this close to a straight line are merged into one wall. */
const COLLINEAR_TOL = 0.0005;

export const WALL_THICKNESS_MIN_REALISTIC = 0.075;
export const WALL_THICKNESS_PARTITION_MAX = 0.125;
export const WALL_THICKNESS_MAX_REALISTIC = 0.5;
export const WALL_HEIGHT_MIN_TYPICAL = 2.0;
export const WALL_HEIGHT_MAX_STOREY = 4.0;
/** A standard 0.9 m door plus its frame and a little wall either side. */
export const PIECE_MIN_FOR_DOOR = 1.1;
/** A small 0.6 m window plus its frame. */
export const PIECE_MIN_FOR_WINDOW = 0.7;
const PIECE_MIN_USEFUL = 0.3;
const SHARP_CORNER_DEG = 30;
/** Turning less than this between neighbouring pieces reads as a curve. */
const CURVE_TURN_MAX_DEG = 20;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type WarningLevel = 'warning' | 'info';

export interface ConversionWarning {
  readonly level: WarningLevel;
  readonly message: string;
}

export interface WallPiece {
  /** Centreline start and end, world X/Z. */
  readonly start: { x: number; z: number };
  readonly end: { x: number; z: number };
  /** Unit vector from the inside face to the outside face, world X/Z. */
  readonly outward: { x: number; z: number };
  /** Outer-start, inner-start, inner-end, outer-end, world X/Z. */
  readonly corners: readonly [
    { x: number; z: number },
    { x: number; z: number },
    { x: number; z: number },
    { x: number; z: number },
  ];
  readonly length: number;
  /** True when this piece is part of a run of gently turning pieces. */
  readonly curved: boolean;
}

export interface WallConversionPlan {
  readonly ok: true;
  /** Every kernel face that makes up the wall solid (removed on convert). */
  readonly sourceFaces: readonly FaceId[];
  /** True when the ring has not been extruded; the caller supplies a height. */
  readonly flat: boolean;
  /** World Y of the bottom of the walls. */
  readonly baseY: number;
  /** Extruded height, or null when flat. */
  readonly height: number | null;
  readonly thickness: number;
  readonly pieces: readonly WallPiece[];
  /** Colour to give the walls, from the source faces when they have one. */
  readonly color: string | null;
  /** Warnings that do not depend on the height. See `warningsFor`. */
  readonly warnings: readonly ConversionWarning[];
}

export interface WallConversionRejection {
  readonly ok: false;
  readonly reason: string;
  /**
   * True when the shape looks like an attempt at walls (an offset ring was
   * found) but fails a check, so the menu can show the option greyed out
   * with the reason instead of hiding it.
   */
  readonly nearMiss: boolean;
}

export type WallConversionResult = WallConversionPlan | WallConversionRejection;

// ---------------------------------------------------------------------------
// 2D helpers (X/Z plane)
// ---------------------------------------------------------------------------

interface P2 {
  x: number;
  z: number;
}

const p2 = (v: Vec3): P2 => ({ x: v.x, z: v.z });
const sub2 = (a: P2, b: P2): P2 => ({ x: a.x - b.x, z: a.z - b.z });
const len2 = (a: P2): number => Math.hypot(a.x, a.z);
const dot2 = (a: P2, b: P2): number => a.x * b.x + a.z * b.z;
const cross2 = (a: P2, b: P2): number => a.x * b.z - a.z * b.x;
const mid2 = (a: P2, b: P2): P2 => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
const unit2 = (a: P2): P2 => {
  const l = len2(a);
  return l > 1e-12 ? { x: a.x / l, z: a.z / l } : { x: 0, z: 0 };
};

function signedArea2(poly: readonly P2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

function distToSegment2(p: P2, a: P2, b: P2): number {
  const ab = sub2(b, a);
  const l2 = dot2(ab, ab);
  const t = l2 > 1e-18 ? Math.max(0, Math.min(1, dot2(sub2(p, a), ab) / l2)) : 0;
  return len2(sub2(p, { x: a.x + ab.x * t, z: a.z + ab.z * t }));
}

function onBoundary(p: P2, poly: readonly P2[]): boolean {
  for (let i = 0; i < poly.length; i++) {
    if (distToSegment2(p, poly[i]!, poly[(i + 1) % poly.length]!) <= POINT_TOL) return true;
  }
  return false;
}

function pointInPolygon2(p: P2, poly: readonly P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Drops repeated points and points that lie on the straight line between
 * their neighbours, then winds the result counter-clockwise (positive
 * signed area in X/Z). A rectangle split by a snapped vertex mid-edge would
 * otherwise produce two walls where the user drew one.
 */
export function cleanPolygon(input: readonly P2[]): P2[] {
  let pts = input.filter((p, i) => len2(sub2(p, input[(i + 1) % input.length]!)) > POINT_TOL / 4);
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length]!;
      const next = pts[(i + 1) % pts.length]!;
      const p = pts[i]!;
      const base = sub2(next, prev);
      const bl = len2(base);
      // Perpendicular distance from p to the prev-next chord, and p must
      // sit between them (a spike folding back is not "collinear").
      const dev = bl > 1e-12 ? Math.abs(cross2(base, sub2(p, prev))) / bl : len2(sub2(p, prev));
      const along = bl > 1e-12 ? dot2(sub2(p, prev), base) / (bl * bl) : 0;
      if (dev <= COLLINEAR_TOL && along > 0 && along < 1) {
        pts = pts.slice(0, i).concat(pts.slice(i + 1));
        changed = true;
        break;
      }
    }
  }
  if (signedArea2(pts) < 0) pts = pts.slice().reverse();
  return pts;
}

// ---------------------------------------------------------------------------
// Face classification
// ---------------------------------------------------------------------------

function isHorizontal(g: Graph, id: FaceId): boolean {
  const f = g.faces.get(id);
  return !!f && Math.abs(f.plane.normal.y) >= HORIZONTAL_MIN_NORMAL_Y;
}

function isVertical(g: Graph, id: FaceId): boolean {
  const f = g.faces.get(id);
  return !!f && Math.abs(f.plane.normal.y) <= VERTICAL_MAX_NORMAL_Y;
}

function faceVertices(g: Graph, id: FaceId): Vec3[] {
  const f = g.faces.get(id);
  if (!f) return [];
  const out = loopPoints(g, f.outerLoop);
  for (const l of f.innerLoops) out.push(...loopPoints(g, l));
  return out;
}

/** Every face sharing at least one edge with `id`, through any loop. */
function edgeNeighbours(g: Graph, id: FaceId): FaceId[] {
  const f = g.faces.get(id);
  if (!f) return [];
  const out = new Set<FaceId>();
  for (const loopId of [f.outerLoop, ...f.innerLoops]) {
    const loop = g.loops.get(loopId);
    if (!loop) continue;
    for (const use of loop.uses) {
      const e = g.edges.get(use.edge);
      if (!e) continue;
      for (const u of e.uses) {
        const other = g.loops.get(u.loop)?.face;
        if (other !== undefined && other !== id) out.add(other);
      }
    }
  }
  return [...out];
}

function faceArea3(g: Graph, id: FaceId): number {
  const f = g.faces.get(id);
  if (!f) return 0;
  const areaOf = (pts: Vec3[]): number => {
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      cx += a.y * b.z - a.z * b.y;
      cy += a.z * b.x - a.x * b.z;
      cz += a.x * b.y - a.y * b.x;
    }
    return Math.hypot(cx, cy, cz) / 2;
  };
  let area = areaOf(loopPoints(g, f.outerLoop));
  for (const l of f.innerLoops) area -= areaOf(loopPoints(g, l));
  return area;
}

function polygonsMatch(a: readonly P2[], b: readonly P2[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p) => b.some((q) => len2(sub2(p, q)) <= POINT_TOL));
}

// ---------------------------------------------------------------------------
// Edge pairing
// ---------------------------------------------------------------------------

interface Pairing {
  shift: number;
  thicknesses: number[];
}

/**
 * Finds the rotation that lines inner edge (i + shift) up with outer edge i,
 * parallel and pointing the same way, for every i. Both polygons must be
 * counter-clockwise and have the same number of corners — which is exactly
 * what the Offset tool produces.
 */
function pairEdges(outer: readonly P2[], inner: readonly P2[]): Pairing | null {
  const n = outer.length;
  if (inner.length !== n) return null;
  const dirs = (poly: readonly P2[]) => poly.map((p, i) => unit2(sub2(poly[(i + 1) % poly.length]!, p)));
  const od = dirs(outer);
  const id = dirs(inner);
  for (let shift = 0; shift < n; shift++) {
    let ok = true;
    const thicknesses: number[] = [];
    for (let i = 0; i < n && ok; i++) {
      const j = (i + shift) % n;
      const a = od[i]!;
      const b = id[j]!;
      if (dot2(a, b) < 0.9995 || Math.abs(cross2(a, b)) > 0.01) {
        ok = false;
        break;
      }
      // Perpendicular distance between the two parallel lines; the inner
      // line must sit on the inside (left of a CCW outer edge).
      const d = cross2(a, sub2(inner[j]!, outer[i]!));
      if (d <= POINT_TOL) ok = false;
      thicknesses.push(d);
    }
    if (ok) return { shift, thicknesses };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function reject(reason: string, nearMiss = true): WallConversionRejection {
  return { ok: false, reason, nearMiss };
}

/**
 * An upright or tilted face with one hole only counts as a near miss when
 * the hole is an even offset of its outline: an offset ring drawn on the
 * wrong plane. A window outline drawn on a wall also has one hole, but is
 * not an attempt at walls and should not bring up the option.
 */
function isOffsetRingOnItsPlane(g: Graph, id: FaceId): boolean {
  const f = g.faces.get(id);
  if (!f || f.innerLoops.length !== 1) return false;
  const basis = planeBasis(f.plane);
  const flat = (pts: Vec3[]) => cleanPolygon(pts.map((p) => {
    const q = projectToBasis(p, basis);
    return { x: q.x, z: q.y };
  }));
  const pairing = pairEdges(flat(loopPoints(g, f.outerLoop)), flat(loopPoints(g, f.innerLoops[0]!)));
  if (!pairing) return false;
  const t = pairing.thicknesses;
  return Math.max(...t) - Math.min(...t) <= Math.max(POINT_TOL, Math.max(...t) * 0.01);
}

/**
 * Works out whether the object the clicked face belongs to can become
 * walls, and if so exactly which walls. `groupFaces` is the clicked face's
 * selection group (see groupContaining); the wall solid is found from it,
 * including any inside faces the selection grouping files separately.
 */
export function analyzeWallConversion(
  g: Graph,
  clickedFace: FaceId,
  groupFaces: readonly FaceId[],
): WallConversionResult {
  if (!g.faces.has(clickedFace)) return reject('That surface no longer exists.', false);

  // 1. Find the offset ring: a flat face with exactly one hole, in or
  //    touching the clicked group. Touching matters because a ring's own
  //    hole never joins it to its neighbours' selection group.
  const candidates = new Set<FaceId>();
  for (const id of groupFaces) {
    candidates.add(id);
    for (const n of edgeNeighbours(g, id)) candidates.add(n);
  }
  let ring: FaceId | null = null;
  let tiltedRing = false;
  for (const id of candidates) {
    const f = g.faces.get(id);
    if (!f || f.innerLoops.length !== 1) continue;
    if (!isHorizontal(g, id)) {
      if (isOffsetRingOnItsPlane(g, id)) tiltedRing = true;
      continue;
    }
    ring = id;
    break;
  }
  if (ring === null) {
    return tiltedRing
      ? reject('The shape must be drawn flat on the ground and pulled straight up to become walls.')
      : reject('Use the Offset tool first so the shape has a wall thickness.', false);
  }

  const ringFace = g.faces.get(ring)!;
  const outer = cleanPolygon(loopPoints(g, ringFace.outerLoop).map(p2));
  const inner = cleanPolygon(loopPoints(g, ringFace.innerLoops[0]!).map(p2));
  if (outer.length < 3 || inner.length < 3) return reject('The outline is too small to become walls.');
  const ringY = loopPoints(g, ringFace.outerLoop)[0]!.y;

  // 2. Collect the wall solid: every ring face with this footprint, and
  //    every upright face standing entirely on the footprint's outlines.
  const onFootprint = (p: P2) => onBoundary(p, outer) || onBoundary(p, inner);
  const solid = new Set<FaceId>();
  let minY = ringY;
  let maxY = ringY;
  for (const [id, f] of g.faces) {
    if (f.attributes.hidden) continue;
    if (isHorizontal(g, id)) {
      if (f.innerLoops.length !== 1) continue;
      const o = cleanPolygon(loopPoints(g, f.outerLoop).map(p2));
      const i = cleanPolygon(loopPoints(g, f.innerLoops[0]!).map(p2));
      if (!polygonsMatch(o, outer) || !polygonsMatch(i, inner)) continue;
    } else if (isVertical(g, id)) {
      const verts = faceVertices(g, id);
      if (verts.length === 0 || !verts.every((v) => onFootprint(p2(v)))) continue;
    } else {
      continue;
    }
    solid.add(id);
    for (const v of faceVertices(g, id)) {
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
  }
  if (!solid.has(clickedFace)) {
    return reject('Right-click the wall itself (not the floor inside it) to convert it.');
  }

  // 3. Everything in the clicked group must be part of the wall solid or a
  //    flat floor inside it; anything else means the shape is joined to
  //    other geometry or has been reshaped in ways a wall cannot follow.
  for (const id of groupFaces) {
    if (solid.has(id)) continue;
    if (isHorizontal(g, id) && isFloorFace(g, id, inner, minY)) continue;
    const f = g.faces.get(id);
    if (f && !isHorizontal(g, id) && !isVertical(g, id)) {
      return reject('Walls must stand straight up. Sloped or tapered sides cannot be converted.');
    }
    return reject('This shape is joined to other geometry, or its middle is filled in.');
  }

  const height = maxY - minY;
  const flat = height <= POINT_TOL;

  // 4. Extruded: the top must be a single flat ring matching the footprint,
  //    and the sides must cover the full height all the way round.
  if (!flat) {
    let topRing = false;
    let sideArea = 0;
    for (const id of solid) {
      if (isHorizontal(g, id)) {
        const y = faceVertices(g, id)[0]!.y;
        if (Math.abs(y - maxY) <= POINT_TOL) topRing = true;
        else if (Math.abs(y - minY) > POINT_TOL) {
          return reject('The top of the walls must be flat and level.');
        }
      } else {
        sideArea += faceArea3(g, id);
      }
    }
    if (!topRing) return reject('The top of the walls must be flat and level.');
    // A lid over the middle means the inside was pulled up too: a solid
    // block, not a ring of walls.
    for (const [id, f] of g.faces) {
      if (f.innerLoops.length !== 0 || !isHorizontal(g, id)) continue;
      const pts = loopPoints(g, f.outerLoop);
      const y = pts[0]!.y;
      if (y <= minY + POINT_TOL || y > maxY + POINT_TOL) continue;
      if (polygonsMatch(cleanPolygon(pts.map(p2)), inner)) {
        return reject('The middle of this shape is filled in. Only the outer frame should be pulled up.');
      }
    }
    const perimeter = (poly: readonly P2[]) =>
      poly.reduce((s, p, i) => s + len2(sub2(poly[(i + 1) % poly.length]!, p)), 0);
    const expected = (perimeter(outer) + perimeter(inner)) * height;
    if (Math.abs(sideArea - expected) > expected * 0.02 + 1e-4) {
      return reject('Only part of the outline has been pulled up. Pull the whole ring up to one height.');
    }
  }

  // 5. Pair every outer edge with its inner partner.
  const pairing = pairEdges(outer, inner);
  if (!pairing) {
    return reject('The inside and outside outlines do not line up. Use the Offset tool so the wall is the same thickness all the way round.');
  }
  const tMin = Math.min(...pairing.thicknesses);
  const tMax = Math.max(...pairing.thicknesses);
  if (tMax - tMin > Math.max(POINT_TOL, tMax * 0.01)) {
    return reject(
      `The wall is not the same thickness all the way round (${fmtMm(tMin)} to ${fmtMm(tMax)}). Use the Offset tool to make it even.`,
    );
  }
  const thickness = (tMin + tMax) / 2;

  // 6. Build one piece per edge.
  const n = outer.length;
  const pieces: WallPiece[] = [];
  const turnDeg: number[] = [];
  for (let i = 0; i < n; i++) {
    const o0 = outer[i]!;
    const o1 = outer[(i + 1) % n]!;
    const n0 = inner[(i + pairing.shift) % n]!;
    const n1 = inner[(i + 1 + pairing.shift) % n]!;
    const dir = unit2(sub2(o1, o0));
    // CCW outline: the inside is to the left, so outward is to the right.
    const outward = { x: dir.z, z: -dir.x };
    const start = mid2(o0, n0);
    const end = mid2(o1, n1);
    const length = len2(sub2(end, start));
    const prevDir = unit2(sub2(o0, outer[(i - 1 + n) % n]!));
    turnDeg.push((Math.acos(Math.max(-1, Math.min(1, dot2(prevDir, dir)))) * 180) / Math.PI);
    pieces.push({ start, end, outward, corners: [o0, n0, n1, o1], length, curved: false });
  }
  if (pieces.some((p) => p.length <= POINT_TOL)) {
    return reject('The offset is too large for this outline: some walls would have no length. Try a smaller offset.');
  }

  // A piece is "curved" when it turns gently from BOTH neighbours, or
  // gently from one inside a run of at least three such pieces — the
  // signature of a circle, arc or Bézier rather than a hand-placed corner.
  const gentle = turnDeg.map((t) => t > 0.05 && t < CURVE_TURN_MAX_DEG);
  const curvedFlags = pieces.map((_, i) => gentle[i]! && gentle[(i + 1) % n]!);
  const withCurve = pieces.map((p, i) => {
    const curved = curvedFlags[i]! || (gentle[i]! && curvedFlags[(i - 1 + n) % n]!) || (gentle[(i + 1) % n]! && curvedFlags[(i + 1) % n]!);
    return curved ? { ...p, curved } : p;
  });

  const warnings: ConversionWarning[] = [];
  addThicknessWarnings(warnings, thickness);

  // Sharp corners: the interior angle of the outline at each vertex.
  const sharp = turnDeg.filter((t) => 180 - t < SHARP_CORNER_DEG).length;
  if (sharp > 0) {
    warnings.push({
      level: 'warning',
      message: `${sharp} corner${sharp === 1 ? ' is' : 's are'} sharper than ${SHARP_CORNER_DEG}°. The wall ends there will be long, thin points.`,
    });
  }

  const short = withCurve.filter((p) => p.length < PIECE_MIN_USEFUL && !p.curved).length;
  if (short > 0) {
    warnings.push({
      level: 'warning',
      message: `${short} wall${short === 1 ? ' is' : 's are'} shorter than 300 mm.`,
    });
  }

  const curvedPieces = withCurve.filter((p) => p.curved);
  if (curvedPieces.length > 0) {
    const door = curvedPieces.filter((p) => p.length >= PIECE_MIN_FOR_DOOR).length;
    const windowOnly = curvedPieces.filter((p) => p.length >= PIECE_MIN_FOR_WINDOW && p.length < PIECE_MIN_FOR_DOOR).length;
    const none = curvedPieces.length - door - windowOnly;
    const shortest = Math.min(...curvedPieces.map((p) => p.length));
    const longest = Math.max(...curvedPieces.map((p) => p.length));
    const range = Math.abs(longest - shortest) < 0.01 ? `${fmtM(shortest)}` : `${fmtM(shortest)} to ${fmtM(longest)}`;
    let message = `Curved section: ${curvedPieces.length} flat wall pieces, each ${range} wide. `;
    if (none === curvedPieces.length) {
      message += 'None are wide enough for a door or window, which suits a decorative wall or a round column.';
    } else {
      const parts: string[] = [];
      if (door > 0) parts.push(`${door} can take a door`);
      if (windowOnly > 0) parts.push(`${windowOnly} can take a window only`);
      if (none > 0) parts.push(`${none} are too narrow for any opening`);
      message += `${parts.join(', ')}. Doors and windows sit on one flat piece each.`;
    }
    warnings.push({ level: 'info', message });
  }

  return {
    ok: true,
    sourceFaces: [...solid],
    flat,
    baseY: minY,
    height: flat ? null : height,
    thickness,
    pieces: withCurve,
    color: sourceColor(g, solid),
    warnings,
  };
}

function isFloorFace(g: Graph, id: FaceId, inner: readonly P2[], baseY: number): boolean {
  const f = g.faces.get(id);
  if (!f) return false;
  const pts = loopPoints(g, f.outerLoop);
  if (pts.some((p) => Math.abs(p.y - baseY) > POINT_TOL)) return false;
  return pts.every((p) => pointInPolygon2(p2(p), inner) || onBoundary(p2(p), inner));
}

function sourceColor(g: Graph, faces: Iterable<FaceId>): string | null {
  for (const id of faces) {
    const m = g.faces.get(id)?.attributes.materialFront;
    if (m) return m;
  }
  return null;
}

const fmtMm = (m: number) => `${Math.round(m * 1000)} mm`;
const fmtM = (m: number) => `${m.toFixed(2)} m`;

function addThicknessWarnings(out: ConversionWarning[], t: number): void {
  if (t < WALL_THICKNESS_MIN_REALISTIC) {
    out.push({ level: 'warning', message: `${fmtMm(t)} is thinner than any real wall (the thinnest partitions are about 75 mm).` });
  } else if (t < WALL_THICKNESS_PARTITION_MAX) {
    out.push({ level: 'info', message: `${fmtMm(t)} is partition-wall thickness: fine inside a building, too thin for most outside walls (usually 200 to 350 mm).` });
  } else if (t > WALL_THICKNESS_MAX_REALISTIC) {
    out.push({ level: 'warning', message: `${fmtMm(t)} is unusually thick for a wall (most are under 500 mm).` });
  }
}

/** Height warnings, kept separate because a flat ring's height is chosen at convert time. */
export function heightWarnings(height: number, baseY: number): ConversionWarning[] {
  const out: ConversionWarning[] = [];
  if (height < WALL_HEIGHT_MIN_TYPICAL) {
    out.push({ level: 'warning', message: `${fmtM(height)} is lower than a typical room (usually at least 2.0 m).` });
  } else if (height > WALL_HEIGHT_MAX_STOREY) {
    out.push({ level: 'warning', message: `${fmtM(height)} is taller than a typical storey (up to about 4 m). Upper floors usually get their own walls.` });
  }
  if (baseY < -POINT_TOL) {
    out.push({ level: 'info', message: 'The walls start below ground level.' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Building the walls
// ---------------------------------------------------------------------------

export interface BuildWallsOptions {
  readonly height: number;
  readonly color: string;
  readonly story: number;
  readonly pbr?: { roughness?: number; metalness?: number; opacity?: number };
  readonly makeId: () => string;
  /** Existing wall count, for naming. */
  readonly existingWallCount: number;
}

/**
 * Turns a plan into wall Shapes, in the same form Viewport's wall tool and
 * room closing produce: centred on the centreline, local X along the wall,
 * local +Z facing outward, with the exact mitred footprint in local space.
 */
export function buildWallShapes(plan: WallConversionPlan, opts: BuildWallsOptions): Shape[] {
  return plan.pieces.map((piece, i) => {
    // A yaw of -atan2(dir.z, dir.x) maps local +X to `dir` and local +Z to
    // (-dir.z, dir.x). Choosing dir = (outward.z, -outward.x) makes that
    // local +Z the outward normal, so the outside face is the wall's
    // exterior face, as orientRoomWallsToExterior guarantees for rooms.
    const dir = { x: piece.outward.z, z: -piece.outward.x };
    const angle = Math.atan2(dir.z, dir.x);
    const half = -angle / 2;
    const quaternion: [number, number, number, number] = [0, Math.sin(half), 0, Math.cos(half)];
    const centre = mid2(piece.start, piece.end);
    const toLocal = (p: P2): [number, number] => {
      const d = sub2(p, centre);
      return [dot2(d, dir), dot2(d, piece.outward)];
    };
    const c = piece.corners.map(toLocal);
    // Outer-start, inner-start, inner-end, outer-end, with "start" at -X.
    const footprint = (c[0]![0] + c[1]![0] <= c[2]![0] + c[3]![0]
      ? [c[0], c[1], c[2], c[3]]
      : [c[3], c[2], c[1], c[0]]) as [[number, number], [number, number], [number, number], [number, number]];
    const length = len2(sub2(piece.end, piece.start));
    const shape: Shape = {
      id: opts.makeId(),
      type: 'wall',
      name: `Exterior Wall ${opts.existingWallCount + i + 1}`,
      position: [centre.x, plan.baseY + opts.height / 2, centre.z],
      quaternion,
      args: [length, opts.height, plan.thickness],
      color: opts.color,
      wallMiterFootprint: footprint,
      tags: ['wall', 'wall-exterior', `story-${opts.story}`, 'converted-wall', ...(piece.curved ? ['wall-curved-piece'] : [])],
      customData: { convertedToWall: { piece: i, pieces: plan.pieces.length, curved: piece.curved } },
    };
    if (opts.pbr?.roughness !== undefined) shape.roughness = opts.pbr.roughness;
    if (opts.pbr?.metalness !== undefined) shape.metalness = opts.pbr.metalness;
    if (opts.pbr?.opacity !== undefined) shape.opacity = opts.pbr.opacity;
    return shape;
  });
}

// ---------------------------------------------------------------------------
// Undo support
// ---------------------------------------------------------------------------
//
// Walls live in Shape history; the source geometry lives in the kernel,
// which has its own separate history. Converting touches both, so undo has
// to put the kernel geometry back too. When nothing else has changed in the
// kernel since, the caller restores an exact snapshot; these cover the case
// where the user has drawn something else in between, which a whole-graph
// snapshot would wipe out.

export interface CapturedFace {
  readonly outer: Vec3[];
  readonly holes: Vec3[][];
  readonly material: string | null;
  readonly custom: Record<string, unknown>;
}

/** Records enough of each face to draw it again later. */
export function captureFaces(g: Graph, ids: Iterable<FaceId>): CapturedFace[] {
  const out: CapturedFace[] = [];
  for (const id of ids) {
    const f = g.faces.get(id);
    if (!f) continue;
    out.push({
      outer: loopPoints(g, f.outerLoop).map((p) => ({ ...p })),
      holes: f.innerLoops.map((l) => loopPoints(g, l).map((p) => ({ ...p }))),
      material: f.attributes.materialFront,
      custom: JSON.parse(JSON.stringify(f.attributes.custom ?? {})) as Record<string, unknown>,
    });
  }
  return out;
}

/**
 * Draws captured faces back into the graph as independent geometry.
 *
 * Redrawing a ring's two outlines also derives a face filling its hole (a
 * lid over the middle) that was never there; any new face that does not
 * match a captured one is removed again, leaving exactly what was captured.
 */
export function recreateFaces(ctx: InsertContext, faces: readonly CapturedFace[], deriveOpts: DeriveOptions): void {
  const g = ctx.graph;
  const before = new Set(g.faces.keys());
  const touched = new Set<EdgeId>();
  for (const face of faces) {
    for (const ring of [face.outer, ...face.holes]) {
      for (let i = 0; i < ring.length; i++) {
        for (const t of insertIsolatedEdge(ctx, ring[i]!, ring[(i + 1) % ring.length]!).touched) touched.add(t);
      }
    }
  }
  derive(g, touched, deriveOpts);
  for (const [id, f] of [...g.faces]) {
    if (before.has(id)) continue;
    const match = faces.find((c) => faceMatches(g, id, c));
    if (!match) {
      removeFace(g, id);
      continue;
    }
    f.attributes.custom = { ...match.custom, [ISOLATED_SHAPE_KEY]: true };
    if (match.material) f.attributes.materialFront = match.material;
  }
}

function faceMatches(g: Graph, id: FaceId, c: CapturedFace): boolean {
  const f = g.faces.get(id);
  if (!f || f.innerLoops.length !== c.holes.length) return false;
  const pts = loopPoints(g, f.outerLoop);
  if (pts.length !== c.outer.length) return false;
  const a = centroid(pts);
  const b = centroid(c.outer);
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= POINT_TOL;
}

const centroid = (pts: readonly Vec3[]): Vec3 => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  z: pts.reduce((s, p) => s + p.z, 0) / pts.length,
});

/** Removes the faces that match captured ones, for redo after other edits. */
export function removeMatchingFaces(g: Graph, faces: readonly CapturedFace[]): number {
  const doomed: FaceId[] = [];
  for (const id of g.faces.keys()) {
    if (faces.some((c) => faceMatches(g, id, c))) doomed.push(id);
  }
  deleteGroupFacesAndEdges(g, doomed);
  return doomed.length;
}

/** Cheap fingerprint: equal means no kernel edit happened in between. */
export function graphSignature(g: Graph): string {
  return JSON.stringify([g.nextId, g.vertices.size, g.edges.size, g.faces.size]);
}

/**
 * Ties one conversion's Shape-history step to its kernel change, so that
 * undoing past the walls brings the source geometry back and redoing
 * removes it again.
 */
export interface WallConversionUndoLink {
  /** The walls this conversion added; their presence marks the step. */
  readonly wallIds: readonly string[];
  readonly before: Snapshot;
  readonly after: Snapshot;
  readonly beforeSig: string;
  readonly afterSig: string;
  readonly removed: readonly CapturedFace[];
}

/** Puts the source geometry back. Exact when the kernel is untouched since. */
export function undoWallConversion(host: KernelArcHost, link: WallConversionUndoLink): void {
  if (graphSignature(host.graph) === link.afterSig) {
    restore(host.graph, link.before);
    host.refreshIndex();
  } else {
    recreateFaces(
      { graph: host.graph, tolerances: host.tolerances, index: host.spatialIndex },
      link.removed,
      host.deriveOptions,
    );
  }
}

/** Removes the source geometry again. */
export function redoWallConversion(host: KernelArcHost, link: WallConversionUndoLink): void {
  if (graphSignature(host.graph) === link.beforeSig) {
    restore(host.graph, link.after);
    host.refreshIndex();
  } else {
    removeMatchingFaces(host.graph, link.removed);
    host.refreshIndex();
  }
}
