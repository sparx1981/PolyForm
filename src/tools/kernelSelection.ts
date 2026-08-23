/**
 * PolyForm — selecting and editing kernel faces.
 *
 * PolyForm's selection, Outliner, paint and eraser all key on `Shape.id`.
 * Kernel faces live in a separate graph with `FaceId`s, so every one of those
 * systems is blind to them: you could draw a surface but not select, colour,
 * hide or delete it.
 *
 * These are the operations those systems need, kept out of the components so
 * they can be tested. Everything here works on the graph directly; the caller
 * bumps the render revision afterwards.
 */

import type { FaceId, Graph, Vec3 } from '../lib/geometry/types';
import { loopPoints, removeFace } from '../lib/geometry/topology';
import { planeBasis, projectToBasis } from '../lib/geometry/math';
import { signedArea } from '../lib/geometry/polygon';

/** One row in the Outliner. */
export interface FaceSummary {
  readonly id: FaceId;
  /** The user's name, or a generated fallback. */
  readonly label: string;
  readonly color: string | null;
  readonly hidden: boolean;
  /** Net area, holes subtracted. Useful in a tooltip. */
  readonly area: number;
  readonly holes: number;
}

const DEFAULT_LABEL_COLOR = '#d8d4cc';

/** Net area of a face, holes subtracted. */
export function faceArea(g: Graph, id: FaceId): number {
  const f = g.faces.get(id);
  if (!f) return 0;
  const basis = planeBasis(f.plane);
  const to2 = (p: Vec3) => projectToBasis(p, basis);
  let area = Math.abs(signedArea(loopPoints(g, f.outerLoop).map(to2)));
  for (const l of f.innerLoops) area -= Math.abs(signedArea(loopPoints(g, l).map(to2)));
  return area;
}

/**
 * Outliner rows for every kernel face, deterministically ordered.
 *
 * Sorted by id rather than by area or creation time: the Outliner must not
 * reshuffle when a face is painted or hidden.
 */
export function faceSummaries(g: Graph): FaceSummary[] {
  return [...g.faces.keys()]
    .sort((a, b) => a - b)
    .map((id) => {
      const f = g.faces.get(id)!;
      return {
        id,
        label: f.attributes.name ?? `Surface ${id}`,
        color: f.attributes.materialFront,
        hidden: f.attributes.hidden,
        area: faceArea(g, id),
        holes: f.innerLoops.length,
      };
    });
}

/** Applies a colour to a face's front. Returns false when the face is gone. */
export function paintFace(g: Graph, id: FaceId, color: string): boolean {
  const f = g.faces.get(id);
  if (!f) return false;
  f.attributes.materialFront = color;
  return true;
}

export function paintFaces(g: Graph, ids: Iterable<FaceId>, color: string): number {
  let n = 0;
  for (const id of ids) if (paintFace(g, id, color)) n++;
  return n;
}

export function renameFace(g: Graph, id: FaceId, name: string): boolean {
  const f = g.faces.get(id);
  if (!f) return false;
  f.attributes.name = name.trim() === '' ? null : name;
  return true;
}

/**
 * Hides a face without deleting it.
 *
 * The face still exists and still bounds its edges, so derivation is
 * unaffected and unhiding restores it exactly. Deleting is a different
 * operation with different consequences (§7.4).
 */
export function setFaceHidden(g: Graph, id: FaceId, hidden: boolean): boolean {
  const f = g.faces.get(id);
  if (!f) return false;
  f.attributes.hidden = hidden;
  return true;
}

export function toggleFaceHidden(g: Graph, id: FaceId): boolean {
  const f = g.faces.get(id);
  if (!f) return false;
  f.attributes.hidden = !f.attributes.hidden;
  return f.attributes.hidden;
}

/**
 * Deletes a face, leaving its edges.
 *
 * This is the §7.4 case: the edges survive, so the outline of the deleted
 * surface stays visible and drawing over any one of them brings the face
 * back. That is deliberate — it is how a mistaken delete is undone by
 * redrawing rather than by hunting for undo.
 */
export function deleteFace(g: Graph, id: FaceId): boolean {
  return removeFace(g, id);
}

export function deleteFaces(g: Graph, ids: Iterable<FaceId>): number {
  let n = 0;
  for (const id of ids) if (deleteFace(g, id)) n++;
  return n;
}

/**
 * Deletes a face AND every edge used only by it.
 *
 * The harder delete: nothing is left behind, so the surface cannot be healed
 * by redrawing. Edges shared with a neighbouring face are kept, or that
 * neighbour would be destroyed too.
 */
export function deleteFaceAndEdges(g: Graph, id: FaceId): { edgesRemoved: number } {
  const f = g.faces.get(id);
  if (!f) return { edgesRemoved: 0 };

  const loops = [f.outerLoop, ...f.innerLoops];
  const candidates = new Set<number>();
  for (const lid of loops) {
    const loop = g.loops.get(lid);
    if (!loop) continue;
    for (const use of loop.uses) candidates.add(use.edge);
  }

  removeFace(g, id);

  let edgesRemoved = 0;
  for (const eid of [...candidates].sort((a, b) => a - b)) {
    const e = g.edges.get(eid as never);
    if (!e) continue;
    // Still used by another face? Removing it would destroy that one too.
    if (e.uses.length > 0) continue;
    for (const vid of [e.v0, e.v1]) {
      const v = g.vertices.get(vid);
      if (!v) continue;
      const i = v.edges.indexOf(eid as never);
      if (i >= 0) v.edges.splice(i, 1);
    }
    g.edges.delete(eid as never);
    edgesRemoved++;
  }

  for (const [vid, v] of [...g.vertices]) {
    if (v.edges.length === 0) g.vertices.delete(vid);
  }

  return { edgesRemoved };
}

/** Clears the colour, returning a face to the default material. */
export function clearFaceMaterial(g: Graph, id: FaceId): boolean {
  const f = g.faces.get(id);
  if (!f) return false;
  f.attributes.materialFront = null;
  f.attributes.materialBack = null;
  return true;
}

/**
 * Faces grouped by colour, for rendering.
 *
 * One mesh per material is what makes painting visible: a single mesh can
 * only carry one material, so without grouping every face renders in the
 * default colour however it is painted. Hidden faces are excluded entirely.
 */
export function facesByMaterial(g: Graph): Map<string, FaceId[]> {
  const groups = new Map<string, FaceId[]>();
  for (const id of [...g.faces.keys()].sort((a, b) => a - b)) {
    const f = g.faces.get(id)!;
    if (f.attributes.hidden) continue;
    const key = f.attributes.materialFront ?? DEFAULT_LABEL_COLOR;
    const list = groups.get(key);
    if (list) list.push(id);
    else groups.set(key, [id]);
  }
  return groups;
}

export { DEFAULT_LABEL_COLOR };

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export interface FaceGroup {
  readonly id: string;
  readonly label: string;
  readonly faces: FaceId[];
  /** Total net area of the group. */
  readonly area: number;
  /** True when every edge in the group is used by exactly two faces. */
  readonly closed: boolean;
}

/**
 * Groups faces into connected solids by shared edges.
 *
 * A flat list is fine for a handful of surfaces and useless at a hundred:
 * after two push/pulls the Outliner is twelve rows with nothing to say which
 * belong together. Faces joined along an edge are part of the same object, so
 * the grouping is already in the topology — it does not need storing, and it
 * cannot go stale.
 *
 * `closed` distinguishes a solid from loose surfaces: in a closed shell every
 * edge has exactly two faces. That is the difference between "Solid" and
 * "Surfaces" in the list.
 */
export function faceGroups(g: Graph): FaceGroup[] {
  // Union-find over faces, joined wherever they share an edge.
  const parent = new Map<FaceId, FaceId>();
  const find = (x: FaceId): FaceId => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (c !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const union = (a: FaceId, b: FaceId) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra > rb ? ra : rb, ra > rb ? rb : ra);
  };

  for (const id of g.faces.keys()) parent.set(id, id);

  for (const e of g.edges.values()) {
    const faces: FaceId[] = [];
    for (const use of e.uses) {
      const loop = g.loops.get(use.loop);
      if (loop && g.faces.has(loop.face)) faces.push(loop.face);
    }
    for (let i = 1; i < faces.length; i++) union(faces[0]!, faces[i]!);
  }

  const buckets = new Map<FaceId, FaceId[]>();
  for (const id of [...g.faces.keys()].sort((a, b) => a - b)) {
    const root = find(id);
    const list = buckets.get(root);
    if (list) list.push(id);
    else buckets.set(root, [id]);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([root, faces]) => {
      const faceSet = new Set(faces);
      let closed = faces.length >= 4;
      if (closed) {
        for (const e of g.edges.values()) {
          const owners = e.uses
            .map((u) => g.loops.get(u.loop)?.face)
            .filter((f): f is FaceId => f !== undefined && faceSet.has(f));
          if (owners.length === 0) continue;
          if (owners.length !== 2) {
            closed = false;
            break;
          }
        }
      }
      return {
        id: `g${root}`,
        label: closed ? `Solid ${root}` : faces.length > 1 ? `Surfaces ${root}` : `Surface ${root}`,
        faces,
        area: faces.reduce((sum, f) => sum + faceArea(g, f), 0),
        closed,
      };
    });
}
