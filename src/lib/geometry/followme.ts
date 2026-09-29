/**
 * PolyForm geometry kernel — Follow Me (sweep a face along a path).
 *
 * The profile face travels along a path of straight segments (an arc is a run of short ones).
 * At every bend its outline is carried onto the MITRE plane - the plane halfway between the
 * incoming and outgoing directions - exactly as a picture-frame corner is cut. Each point of
 * the outline moves parallel to the path segment it's on, so every side panel between two
 * mitres is a flat four-sided face, which is what lets the ordinary derivation pass build it.
 *
 * Like push/pull, the whole operation is expressed as EDGES and handed to derivation; nothing
 * here constructs a face directly (§6.1), so the result behaves like anything else drawn.
 *
 * Two shapes of path:
 *  - OPEN: the sweep starts at the path end nearer the profile. The profile face stays and
 *    becomes the start cap; the outline carried to the far end becomes the end cap.
 *  - CLOSED (a loop, e.g. round a slab or a circle): there are no caps. Every station is a
 *    mitre, and the tube closes on itself. The caller removes the original profile face, which
 *    no longer bounds anything (see tools/kernelFollowMe.ts).
 *
 * The mitre rings at the bends are closed flat cycles, and a closed flat cycle is always
 * derived into a face (§6). Those would be membranes across the inside of the tube, so they
 * are removed after derivation - the same "phantom lid" clean-up push/pull does for holes.
 */

import type { EdgeId, FaceId, Tolerances, Vec3 } from './types';
import { loopEdgeIds, loopPoints, removeEdge, removeFace, removeOrphanVertices } from './topology';
import { interiorPointWithHoles, pointInPolygonWithHoles } from './polygon';
import {
  add, centroid, distance, distanceToPlane, dot, length, planeBasis, planeFromPoints, projectToBasis, scale, sub,
  tryNormalize, unprojectFromBasis,
} from './math';
import { insertEdge, type InsertContext, type InsertResult } from './insert';
import { derive, flipFaceOrientation, reconcileOrientation } from './derive';

/** Bends gentler than this are part of a curve: their ring edges are drawn smooth. */
const SMOOTH_BEND_RADIANS = (30 * Math.PI) / 180;

export interface SweepPlan {
  /** The outline at each station along the path: loops, outer first (as the profile's). */
  readonly stations: Vec3[][][];
  /** True when the path is a loop: the last station joins back to the first. */
  readonly closed: boolean;
  /** Per station: whether the path bends gently there (part of a curve). */
  readonly smoothStation: boolean[];
  /** The path's first direction (open paths start here). */
  readonly startDirection: Vec3;
}

export type SweepPlanResult = { ok: true; plan: SweepPlan; reason?: never } | { ok: false; plan?: never; reason: string };

/** Drops repeated points (and, for a loop, a closing point equal to the first). */
function cleanPath(path: readonly Vec3[], closed: boolean, tol: number): Vec3[] {
  const out: Vec3[] = [];
  for (const p of path) {
    const last = out[out.length - 1];
    if (!last || distance(last, p) > tol) out.push(p);
  }
  if (closed && out.length > 2 && distance(out[0]!, out[out.length - 1]!) <= tol) out.pop();
  return out;
}

/**
 * Where the outline goes at each station - the pure geometry, shared by the sweep and its
 * preview. `loops` is the profile's outline, outer loop first.
 */
export function planSweep(
  loops: readonly (readonly Vec3[])[],
  profileNormal: Vec3,
  rawPath: readonly Vec3[],
  closed: boolean,
  tolerances: Tolerances,
): SweepPlanResult {
  const tol = tolerances.MIN_EDGE_LENGTH;
  const outer = loops[0];
  if (!outer || outer.length < 3) return { ok: false, reason: 'The shape has no outline to sweep.' };
  let path = cleanPath(rawPath, closed, tol);
  if (path.length < 2 || (closed && path.length < 3)) return { ok: false, reason: 'The path is too short.' };

  // Start where the profile is: the nearer end of an open path, the nearest corner of a loop.
  const c = centroid(outer);
  if (closed) {
    let best = 0;
    path.forEach((p, i) => { if (distance(p, c) < distance(path[best]!, c)) best = i; });
    path = [...path.slice(best), ...path.slice(0, best)];
  } else if (distance(path[path.length - 1]!, c) < distance(path[0]!, c)) {
    path = [...path].reverse();
  }

  const n = path.length;
  const segCount = closed ? n : n - 1;
  const dirs: Vec3[] = [];
  for (let i = 0; i < segCount; i++) {
    const d = tryNormalize(sub(path[(i + 1) % n]!, path[i]!));
    if (!d) return { ok: false, reason: 'The path has a zero-length piece.' };
    dirs.push(d);
  }

  const d0 = dirs[0]!;
  if (Math.abs(dot(tryNormalize(profileNormal) ?? profileNormal, d0)) < 0.05) {
    return { ok: false, reason: 'The shape lies along the path. Draw it across the start of the path, facing along it.' };
  }

  /** The mitre plane's normal at path point i (between the segment into it and the one out). */
  const mitreNormal = (into: Vec3, out: Vec3): Vec3 | null => tryNormalize(add(into, out));

  /** Carries a ring along `d` onto the plane through `at` with normal `nrm`. */
  const carry = (ring: readonly Vec3[], d: Vec3, at: Vec3, nrm: Vec3): Vec3[] | null => {
    const denom = dot(d, nrm);
    if (Math.abs(denom) < 1e-6) return null;
    return ring.map((p) => add(p, scale(d, dot(sub(at, p), nrm) / denom)));
  };

  const stations: Vec3[][][] = [];
  const smoothStation: boolean[] = [];
  const bend = (into: Vec3, out: Vec3) => Math.acos(Math.max(-1, Math.min(1, dot(into, out))));

  // Station 0.
  if (closed) {
    const nrm = mitreNormal(dirs[segCount - 1]!, d0);
    if (!nrm) return { ok: false, reason: 'The path doubles back on itself.' };
    const rings = loops.map((l) => carry(l, d0, path[0]!, nrm));
    if (rings.some((r) => !r)) return { ok: false, reason: 'The shape lies along the path.' };
    stations.push(rings as Vec3[][]);
    smoothStation.push(bend(dirs[segCount - 1]!, d0) < SMOOTH_BEND_RADIANS);
  } else {
    stations.push(loops.map((l) => [...l]));
    smoothStation.push(false);
  }

  // Every later station: a mitre at each bend, square to the path at an open path's end.
  for (let i = 1; i < n; i++) {
    const into = dirs[i - 1]!;
    const isEnd = !closed && i === n - 1;
    const out = isEnd ? into : dirs[i % segCount]!;
    const nrm = isEnd ? into : mitreNormal(into, out);
    if (!nrm) return { ok: false, reason: 'The path doubles back on itself.' };
    const prev = stations[i - 1]!;
    const rings = prev.map((r) => carry(r, into, path[i]!, nrm));
    if (rings.some((r) => !r)) return { ok: false, reason: 'The path turns too sharply here.' };
    // Every point must move forwards along the segment: if one would go backwards, the
    // bend is too tight for the shape's size (the corner would fold inside out).
    for (let k = 0; k < prev.length; k++) {
      const from = prev[k]!, to = rings[k]!;
      for (let j = 0; j < from.length; j++) {
        if (dot(sub(to[j]!, from[j]!), into) < tol) {
          return { ok: false, reason: 'The path bends too tightly for the size of the shape.' };
        }
      }
    }
    stations.push(rings as Vec3[][]);
    smoothStation.push(!isEnd && bend(into, out) < SMOOTH_BEND_RADIANS);
  }

  if (closed) {
    // The loop must close: carrying the last station round to the first must land on it.
    const into = dirs[segCount - 1]!;
    const nrm = mitreNormal(into, d0)!;
    const back = stations[stations.length - 1]!.map((r) => carry(r, into, path[0]!, nrm));
    const first = stations[0]!;
    for (let k = 0; k < first.length; k++) {
      const a = back[k], b = first[k]!;
      if (!a) return { ok: false, reason: 'The path turns too sharply here.' };
      for (let j = 0; j < b.length; j++) {
        if (dot(sub(b[j]!, a[j]!), into) < -tol || distance(a[j]!, b[j]!) > Math.max(tol * 10, 1e-4)) {
          return { ok: false, reason: 'This loop twists as it goes round, so the ends would not meet. Try an open path.' };
        }
      }
    }
  }

  return { ok: true, plan: { stations, closed, smoothStation, startDirection: d0 } };
}

/** The sweep's edges as point pairs: each ring at a station, and the runs between stations. */
export function sweepSegments(plan: SweepPlan): [Vec3, Vec3][] {
  const out: [Vec3, Vec3][] = [];
  const count = plan.stations.length;
  plan.stations.forEach((station, s) => {
    for (const ring of station) {
      for (let j = 0; j < ring.length; j++) out.push([ring[j]!, ring[(j + 1) % ring.length]!]);
    }
    const nextIndex = s + 1 < count ? s + 1 : plan.closed ? 0 : -1;
    if (nextIndex < 0) return;
    const next = plan.stations[nextIndex]!;
    station.forEach((ring, k) => ring.forEach((p, j) => out.push([p, next[k]![j]!])));
  });
  return out;
}

export interface FollowMeOptions {
  readonly tolerances: Tolerances;
  /** As push/pull's: `insertIsolatedEdge` for a shape drawn as an independent object. */
  readonly insertFn?: (ctx: InsertContext, p0: Vec3, p1: Vec3) => InsertResult;
}

export interface FollowMeResult {
  readonly ok: boolean;
  readonly reason?: string;
  /** Every edge created or touched. Feed to derivation. */
  readonly touched: Set<EdgeId>;
  readonly closed: boolean;
}

/**
 * Sweeps face `id` along `path` (points in order; `closed` for a loop). One call is one
 * operation; the caller wraps it in a transaction.
 */
export function followMe(
  ctx: InsertContext,
  id: FaceId,
  path: readonly Vec3[],
  closed: boolean,
  opts: FollowMeOptions,
): FollowMeResult {
  const g = ctx.graph;
  const fail = (reason: string): FollowMeResult => ({ ok: false, reason, touched: new Set(), closed });
  const face = g.faces.get(id);
  if (!face) return fail('The shape is gone.');

  const loops = [face.outerLoop, ...face.innerLoops].map((lid) => loopPoints(g, lid));
  const planned = planSweep(loops, face.plane.normal, path, closed, opts.tolerances);
  if (!planned.ok) return fail(planned.reason);
  const plan = planned.plan;

  const insert = opts.insertFn ?? insertEdge;
  const touched = new Set<EdgeId>();
  const smooth = new Set<EdgeId>();
  /** Every edge the sweep is made of (including existing ones it runs along). */
  const sweepEdges = new Set<EdgeId>();
  const put = (a: Vec3, b: Vec3, isSmooth: boolean) => {
    if (distance(a, b) < opts.tolerances.MIN_EDGE_LENGTH) return;
    const r = insert(ctx, a, b);
    for (const t of r.touched) touched.add(t);
    // The edges that now make up this span (not every edge the insert happened to split).
    for (const e of r.edges) {
      sweepEdges.add(e);
      if (isSmooth) smooth.add(e);
    }
  };

  // Which profile corners sit on a curve (a circle's or an arc's): the runs from them are
  // drawn smooth, so a pipe looks round rather than faceted.
  const outlineEdges = [face.outerLoop, ...face.innerLoops].map((lid) => loopEdgeIds(g, lid));
  const cornerOnCurve = outlineEdges.map((edges) => edges.map((_, j) => {
    const before = g.edges.get(edges[(j + edges.length - 1) % edges.length]!);
    const after = g.edges.get(edges[j]!);
    return !!before?.curve && !!after?.curve;
  }));

  // Round a loop the profile is replaced by the sweep's own first station: take it away first
  // (with any of its edges nothing else uses), so its outline doesn't cut into the panels.
  if (plan.closed) {
    removeFace(g, id);
    for (const e of outlineEdges.flat()) {
      if ((g.edges.get(e)?.uses.length ?? 1) === 0) {
        removeEdge(g, e);
        ctx.index.remove(e);
      }
    }
    removeOrphanVertices(g);
  }
  const facesBefore = new Set(g.faces.keys());

  // Rings at each station (the profile itself is station 0 of an open path, and already there).
  plan.stations.forEach((station, s) => {
    for (const ring of station) {
      for (let j = 0; j < ring.length; j++) put(ring[j]!, ring[(j + 1) % ring.length]!, plan.smoothStation[s]!);
    }
  });
  // Runs between stations, and the side panels they bound.
  const panels: Vec3[][] = [];
  const count = plan.stations.length;
  for (let s = 0; s < count; s++) {
    const nextIndex = s + 1 < count ? s + 1 : plan.closed ? 0 : -1;
    if (nextIndex < 0) break;
    const station = plan.stations[s]!, next = plan.stations[nextIndex]!;
    station.forEach((ring, k) => ring.forEach((p, j) => {
      // loopPoints and loopEdgeIds walk the loop the same way: corner j sits between edges j-1 and j.
      put(p, next[k]![j]!, cornerOnCurve[k]?.[j] ?? false);
      const j1 = (j + 1) % ring.length;
      panels.push([p, ring[j1]!, next[k]![j1]!, next[k]![j]!]);
    }));
  }

  derive(g, touched, { tolerances: opts.tolerances });

  // Keep only the sweep's real faces. Any closed flat outline becomes a face (§6), so the
  // sweep's edges also bound faces nobody asked for: a wall across the inside at each mitre,
  // a lid over a hole at the far end, the middle of a frame swept round a loop. A new face
  // made only of sweep edges stays when it lies within a side panel or the end cap.
  const endCap = plan.closed ? null : plan.stations[count - 1]!;
  const inside = (p: Vec3, outer: readonly Vec3[], holes: readonly (readonly Vec3[])[] = []): boolean => {
    const plane = planeFromPoints(outer);
    if (!plane || distanceToPlane(p, plane) > 1e-5) return false;
    const basis = planeBasis(plane);
    const flat = (pts: readonly Vec3[]) => pts.map((q) => projectToBasis(q, basis));
    return pointInPolygonWithHoles(projectToBasis(p, basis), flat(outer), holes.map(flat));
  };
  for (const [fid, f] of [...g.faces]) {
    if (facesBefore.has(fid)) continue;
    const edges = [f.outerLoop, ...f.innerLoops].flatMap((lid) => loopEdgeIds(g, lid));
    if (!edges.every((e) => sweepEdges.has(e))) continue;
    const basis = planeBasis(f.plane);
    const flatLoop = (lid: typeof f.outerLoop) => loopPoints(g, lid).map((q) => projectToBasis(q, basis));
    const ip = interiorPointWithHoles(flatLoop(f.outerLoop), f.innerLoops.map(flatLoop));
    if (!ip) continue;
    const p = unprojectFromBasis(ip, basis);
    if (panels.some((q) => inside(p, q))) continue;
    if (endCap && inside(p, endCap[0]!, endCap.slice(1))) continue;
    removeFace(g, fid);
    // As push/pull: don't hand these back as touched, or the caller's derive rebuilds them.
    for (const e of edges) touched.delete(e);
  }

  // Smooth edges along curves.
  for (const e of smooth) {
    const edge = g.edges.get(e);
    if (edge) edge.smooth = true;
  }

  // Orientation: every face of the sweep facing outwards.
  const opFaces = new Set<FaceId>();
  for (const loop of g.loops.values()) {
    for (const use of loop.uses) if (sweepEdges.has(use.edge)) opFaces.add(loop.face);
  }
  if (!plan.closed) {
    const base = g.faces.get(id);
    if (base) {
      // The start cap faces back, away from the sweep.
      if (dot(base.plane.normal, plan.startDirection) > 0) flipFaceOrientation(g, id);
      reconcileOrientation(g, id, opFaces);
    }
  } else {
    // A loop has no cap to start from: take a side panel and make it face away from the middle
    // of the outline beside it.
    const first = plan.stations[0]![0]!;
    const middle = centroid(first);
    let seed: FaceId | null = null;
    for (const fid of opFaces) {
      const f = g.faces.get(fid);
      if (!f) continue;
      const pts = loopPoints(g, f.outerLoop);
      if (pts.some((p) => first.some((q) => distance(p, q) < 1e-6))) { seed = fid; break; }
    }
    if (seed !== null) {
      const f = g.faces.get(seed)!;
      const outward = sub(centroid(loopPoints(g, f.outerLoop)), middle);
      if (length(outward) > 0 && dot(f.plane.normal, outward) < 0) flipFaceOrientation(g, seed);
      reconcileOrientation(g, seed, opFaces);
    }
  }
  return { ok: true, touched, closed: plan.closed };
}
