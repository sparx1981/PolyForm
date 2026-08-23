/**
 * PolyForm geometry kernel — serialisation.
 *
 * The kernel graph is held in Maps with branded ids and object references,
 * none of which survive JSON. This converts to and from a flat, storable
 * form.
 *
 * Two constraints shaped the format:
 *
 *  - **No nested arrays.** Firestore rejects an array whose elements are
 *    themselves arrays, so every list here holds primitives or objects.
 *  - **No `undefined`.** Firestore rejects it; absent values are `null`.
 *
 * Derived state is deliberately NOT stored: plane bases, planar components
 * and the spatial index are all rebuilt on load. Storing them would mean two
 * sources of truth, and the second one going stale.
 */

import type {
  Curve, CurveId, Edge, EdgeId, EdgeUse, Face, FaceId, Graph, IdCounters,
  Loop, LoopId, Vertex, VertexId, VertexProvenance,
} from './types';
import { createGraph } from './topology';
import { planeBasis } from './math';

export const KERNEL_FORMAT_VERSION = 1;

export interface SerializedVertex {
  id: number;
  x: number;
  y: number;
  z: number;
  provenance: VertexProvenance;
}

export interface SerializedEdge {
  id: number;
  v0: number;
  v1: number;
  smooth: boolean;
  hidden: boolean;
  curve: number | null;
}

export interface SerializedUse {
  edge: number;
  reversed: boolean;
}

export interface SerializedLoop {
  id: number;
  face: number;
  kind: 'outer' | 'inner';
  signedArea: number;
  uses: SerializedUse[];
}

export interface SerializedFace {
  id: number;
  outerLoop: number;
  innerLoops: number[];
  px: number; py: number; pz: number;
  nx: number; ny: number; nz: number;
  hash: string;
  materialFront: string | null;
  materialBack: string | null;
  layer: string | null;
  name: string | null;
  hidden: boolean;
  orientationLocked: boolean;
  uv: { ox: number; oy: number; oz: number; ux: number; uy: number; uz: number; vx: number; vy: number; vz: number } | null;
}

export interface SerializedCurve {
  id: number;
  edges: number[];
  cx: number; cy: number; cz: number;
  nx: number; ny: number; nz: number;
  radius: number;
  startAngle: number;
  sweep: number;
  segments: number;
  startTruncated: boolean;
  endTruncated: boolean;
}

export interface SerializedGraph {
  version: number;
  nextId: IdCounters;
  vertices: SerializedVertex[];
  edges: SerializedEdge[];
  loops: SerializedLoop[];
  faces: SerializedFace[];
  curves: SerializedCurve[];
}

/** Empty document, for a new model. */
export const emptySerializedGraph = (): SerializedGraph => ({
  version: KERNEL_FORMAT_VERSION,
  nextId: { vertex: 1, edge: 1, loop: 1, face: 1, curve: 1, component: 1 },
  vertices: [],
  edges: [],
  loops: [],
  faces: [],
  curves: [],
});

// ---------------------------------------------------------------------------

export function serializeGraph(g: Graph): SerializedGraph {
  const byId = <T,>(m: Map<number, T>) => [...m.keys()].sort((a, b) => a - b);

  return {
    version: KERNEL_FORMAT_VERSION,
    nextId: { ...g.nextId },
    vertices: byId(g.vertices as Map<number, Vertex>).map((id) => {
      const v = g.vertices.get(id as VertexId)!;
      return {
        id,
        x: v.position.x,
        y: v.position.y,
        z: v.position.z,
        provenance: v.provenance,
      };
    }),
    edges: byId(g.edges as Map<number, Edge>).map((id) => {
      const e = g.edges.get(id as EdgeId)!;
      return {
        id,
        v0: e.v0 as number,
        v1: e.v1 as number,
        smooth: e.smooth,
        hidden: e.hidden,
        curve: e.curve === null ? null : (e.curve as number),
      };
    }),
    loops: byId(g.loops as Map<number, Loop>).map((id) => {
      const l = g.loops.get(id as LoopId)!;
      return {
        id,
        face: l.face as number,
        kind: l.kind,
        signedArea: l.signedArea,
        uses: l.uses.map((u) => ({ edge: u.edge as number, reversed: u.reversed })),
      };
    }),
    faces: byId(g.faces as Map<number, Face>).map((id) => {
      const f = g.faces.get(id as FaceId)!;
      const a = f.attributes;
      return {
        id,
        outerLoop: f.outerLoop as number,
        innerLoops: f.innerLoops.map((l) => l as number),
        px: f.plane.point.x, py: f.plane.point.y, pz: f.plane.point.z,
        nx: f.plane.normal.x, ny: f.plane.normal.y, nz: f.plane.normal.z,
        hash: f.hash as string,
        materialFront: a.materialFront,
        materialBack: a.materialBack,
        layer: a.layer,
        name: a.name,
        hidden: a.hidden,
        orientationLocked: a.orientationLocked,
        uv: a.uv
          ? {
              ox: a.uv.origin.x, oy: a.uv.origin.y, oz: a.uv.origin.z,
              ux: a.uv.u.x, uy: a.uv.u.y, uz: a.uv.u.z,
              vx: a.uv.v.x, vy: a.uv.v.y, vz: a.uv.v.z,
            }
          : null,
      };
    }),
    curves: byId(g.curves as Map<number, Curve>).map((id) => {
      const c = g.curves.get(id as CurveId)!;
      return {
        id,
        edges: c.edges.map((e) => e as number),
        cx: c.centre.x, cy: c.centre.y, cz: c.centre.z,
        nx: c.normal.x, ny: c.normal.y, nz: c.normal.z,
        radius: c.radius,
        startAngle: c.startAngle,
        sweep: c.sweep,
        segments: c.segments,
        startTruncated: c.startTruncated,
        endTruncated: c.endTruncated,
      };
    }),
  };
}

/**
 * Rebuilds a graph from stored form.
 *
 * Tolerant by design: a face referencing a missing loop, or a loop
 * referencing a missing edge, is skipped rather than throwing. A partially
 * recoverable model is far better than an unopenable one, and this is the
 * path a corrupted or truncated document takes.
 */
export function deserializeGraph(data: SerializedGraph | null | undefined): Graph {
  const g = createGraph();
  if (!data || typeof data !== 'object') return g;
  if (!Array.isArray(data.vertices) || !Array.isArray(data.edges)) return g;

  for (const v of data.vertices) {
    g.vertices.set(v.id as VertexId, {
      id: v.id as VertexId,
      position: { x: v.x, y: v.y, z: v.z },
      edges: [],
      provenance: v.provenance ?? 'import',
    });
  }

  for (const e of data.edges) {
    if (!g.vertices.has(e.v0 as VertexId) || !g.vertices.has(e.v1 as VertexId)) continue;
    if (e.v0 === e.v1) continue;
    const edge: Edge = {
      id: e.id as EdgeId,
      v0: e.v0 as VertexId,
      v1: e.v1 as VertexId,
      uses: [],
      smooth: !!e.smooth,
      hidden: !!e.hidden,
      curve: e.curve === null || e.curve === undefined ? null : (e.curve as CurveId),
    };
    g.edges.set(edge.id, edge);
    g.vertices.get(edge.v0)!.edges.push(edge.id);
    g.vertices.get(edge.v1)!.edges.push(edge.id);
  }

  for (const c of data.curves ?? []) {
    const edges = (c.edges ?? []).filter((e) => g.edges.has(e as EdgeId)).map((e) => e as EdgeId);
    if (edges.length === 0) continue;
    g.curves.set(c.id as CurveId, {
      id: c.id as CurveId,
      kind: 'arc',
      edges,
      centre: { x: c.cx, y: c.cy, z: c.cz },
      normal: { x: c.nx, y: c.ny, z: c.nz },
      radius: c.radius,
      startAngle: c.startAngle,
      sweep: c.sweep,
      segments: c.segments,
      startTruncated: !!c.startTruncated,
      endTruncated: !!c.endTruncated,
    });
  }

  // Faces first, so loops can be attached to something that exists; their
  // loop ids are fixed up immediately afterwards.
  for (const f of data.faces ?? []) {
    const plane = {
      point: { x: f.px, y: f.py, z: f.pz },
      normal: { x: f.nx, y: f.ny, z: f.nz },
    };
    g.faces.set(f.id as FaceId, {
      id: f.id as FaceId,
      outerLoop: f.outerLoop as LoopId,
      innerLoops: (f.innerLoops ?? []).map((l) => l as LoopId),
      plane,
      // Derived, never stored: recomputing keeps one source of truth.
      basis: planeBasis(plane),
      hash: f.hash as Face['hash'],
      attributes: {
        materialFront: f.materialFront ?? null,
        materialBack: f.materialBack ?? null,
        layer: f.layer ?? null,
        name: f.name ?? null,
        hidden: !!f.hidden,
        orientationLocked: !!f.orientationLocked,
        uv: f.uv
          ? {
              origin: { x: f.uv.ox, y: f.uv.oy, z: f.uv.oz },
              u: { x: f.uv.ux, y: f.uv.uy, z: f.uv.uz },
              v: { x: f.uv.vx, y: f.uv.vy, z: f.uv.vz },
            }
          : null,
        custom: {},
      },
    });
  }

  for (const l of data.loops ?? []) {
    if (!g.faces.has(l.face as FaceId)) continue;
    const uses: EdgeUse[] = [];
    let broken = false;
    for (const u of l.uses ?? []) {
      if (!g.edges.has(u.edge as EdgeId)) {
        broken = true;
        break;
      }
      uses.push({ edge: u.edge as EdgeId, loop: l.id as LoopId, reversed: !!u.reversed });
    }
    if (broken || uses.length === 0) continue;

    g.loops.set(l.id as LoopId, {
      id: l.id as LoopId,
      face: l.face as FaceId,
      uses,
      kind: l.kind === 'inner' ? 'inner' : 'outer',
      signedArea: l.signedArea ?? 0,
    });
    for (const u of uses) g.edges.get(u.edge)!.uses.push(u);
  }

  // Drop faces whose loops did not survive: a face without its outer loop is
  // not renderable and would break every traversal that assumes one.
  for (const [id, f] of [...g.faces]) {
    if (!g.loops.has(f.outerLoop)) {
      g.faces.delete(id);
      continue;
    }
    f.innerLoops = f.innerLoops.filter((l) => g.loops.has(l));
  }
  for (const [id, l] of [...g.loops]) {
    if (!g.faces.has(l.face)) {
      for (const u of l.uses) {
        const e = g.edges.get(u.edge);
        if (e) e.uses = e.uses.filter((x) => x.loop !== id);
      }
      g.loops.delete(id);
    }
  }

  // Counters must clear every id in use, or a later insert reuses one.
  const maxOf = (ids: Iterable<number>, floor: number) => {
    let m = floor;
    for (const i of ids) if (i >= m) m = i + 1;
    return m;
  };
  g.nextId = {
    vertex: maxOf(g.vertices.keys(), data.nextId?.vertex ?? 1),
    edge: maxOf(g.edges.keys(), data.nextId?.edge ?? 1),
    loop: maxOf(g.loops.keys(), data.nextId?.loop ?? 1),
    face: maxOf(g.faces.keys(), data.nextId?.face ?? 1),
    curve: maxOf(g.curves.keys(), data.nextId?.curve ?? 1),
    component: data.nextId?.component ?? 1,
  };

  return g;
}

/** True when a graph holds nothing worth saving. */
export const isEmptyGraph = (g: Graph): boolean =>
  g.vertices.size === 0 && g.edges.size === 0 && g.faces.size === 0;
