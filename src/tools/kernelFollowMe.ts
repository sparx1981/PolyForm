/**
 * PolyForm — Follow Me binding.
 *
 * Click the shape to sweep, then click the path: an edge (the whole run of lines and arcs
 * connected to it end to end) or a face (its outline, all the way round). The sweep itself
 * lives in lib/geometry/followme.ts; this file is what a click means, the preview, and the
 * one-transaction, one-undo commit.
 */

import type { EdgeId, FaceId, Graph, Vec3, VertexId } from '../lib/geometry/types';
import { followMe, planSweep, sweepSegments } from '../lib/geometry/followme';
import { insertIsolatedEdge } from '../lib/geometry/insert';
import { derive } from '../lib/geometry/derive';
import { snapshot, restore } from '../lib/geometry/heal';
import { getVertex, loopEdgeIds, loopPoints } from '../lib/geometry/topology';
import type { KernelArcHost } from './kernelArcHost';
import { ISOLATED_SHAPE_KEY } from './kernelPushPull';

export interface FollowMePath {
  points: Vec3[];
  closed: boolean;
  /** The edges it's made of, for highlighting. */
  edges: EdgeId[];
}

/**
 * The run of edges through `start`, carried on through every corner where exactly two
 * edges meet, until it branches, ends, or comes back round. The shape's own outline is
 * left out, so a path starting at a corner of the shape still ends there.
 */
export function pathFromEdge(g: Graph, start: EdgeId, exclude: ReadonlySet<EdgeId> = new Set()): FollowMePath | null {
  const first = g.edges.get(start);
  if (!first || exclude.has(start)) return null;
  const others = (v: VertexId, not: EdgeId): EdgeId[] =>
    getVertex(g, v).edges.filter((e) => e !== not && !exclude.has(e) && g.edges.has(e));

  const walk = (from: VertexId, via: EdgeId): { vertices: VertexId[]; edges: EdgeId[]; loop: boolean } => {
    const vertices: VertexId[] = [];
    const edges: EdgeId[] = [];
    let v = from, e = via;
    for (let guard = 0; guard < g.edges.size + 1; guard++) {
      const next = others(v, e);
      if (next.length !== 1) break;
      const ne = next[0]!;
      if (ne === start) return { vertices, edges, loop: true };
      const edge = g.edges.get(ne)!;
      const nv = edge.v0 === v ? edge.v1 : edge.v0;
      edges.push(ne);
      vertices.push(nv);
      v = nv;
      e = ne;
    }
    return { vertices, edges, loop: false };
  };

  const forward = walk(first.v1, start);
  if (forward.loop) {
    // The walk ends back at the first corner; don't list it twice.
    const vertices = [first.v0, first.v1, ...forward.vertices.slice(0, -1)];
    return { points: vertices.map((v) => getVertex(g, v).position), closed: true, edges: [start, ...forward.edges] };
  }
  const backward = walk(first.v0, start);
  const vertices = [...backward.vertices.reverse(), first.v0, first.v1, ...forward.vertices];
  return {
    points: vertices.map((v) => getVertex(g, v).position),
    closed: false,
    edges: [...backward.edges.reverse(), start, ...forward.edges],
  };
}

/** A face's outline as a closed path. */
export function pathFromFace(g: Graph, id: FaceId): FollowMePath | null {
  const f = g.faces.get(id);
  if (!f) return null;
  return { points: loopPoints(g, f.outerLoop), closed: true, edges: loopEdgeIds(g, f.outerLoop) };
}

/** The shape's outline edges: never part of its own path. */
export function outlineEdges(g: Graph, id: FaceId): Set<EdgeId> {
  const f = g.faces.get(id);
  if (!f) return new Set();
  return new Set([f.outerLoop, ...f.innerLoops].flatMap((lid) => loopEdgeIds(g, lid)));
}

/** What the sweep would look like, as line segments - or why it can't be done. */
export function previewFollowMe(host: KernelArcHost, profile: FaceId, path: FollowMePath): { segments: [Vec3, Vec3][] } | { reason: string } {
  const g = host.graph;
  const f = g.faces.get(profile);
  if (!f) return { reason: 'The shape is gone.' };
  const loops = [f.outerLoop, ...f.innerLoops].map((lid) => loopPoints(g, lid));
  const r = planSweep(loops, f.plane.normal, path.points, path.closed, host.tolerances);
  return r.ok ? { segments: sweepSegments(r.plan) } : { reason: r.reason };
}

/**
 * Sweeps the shape along the path as one transaction and one undo entry. Shared by the tool
 * and scripts. The caller refreshes the view (bumpKernel).
 */
export function commitKernelFollowMe(host: KernelArcHost, profile: FaceId, path: FollowMePath): { ok: true; reason?: never } | { ok: false; reason: string } {
  const before = snapshot(host.graph);
  try {
    // A shape drawn as its own object (Rectangle, Circle ...) sweeps as one too - as push/pull.
    const isIsolated = host.graph.faces.get(profile)?.attributes.custom?.[ISOLATED_SHAPE_KEY] === true;
    const r = followMe(
      { graph: host.graph, tolerances: host.tolerances, index: host.spatialIndex },
      profile,
      path.points,
      path.closed,
      { tolerances: host.tolerances, ...(isIsolated ? { insertFn: insertIsolatedEdge } : {}) },
    );
    if (!r.ok) {
      restore(host.graph, before);
      host.refreshIndex();
      return { ok: false, reason: r.reason ?? 'Could not sweep the shape along that path.' };
    }
    derive(host.graph, r.touched, host.deriveOptions);
    host.recordUndo(before);
    return { ok: true };
  } catch (err) {
    restore(host.graph, before);
    host.refreshIndex();
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
