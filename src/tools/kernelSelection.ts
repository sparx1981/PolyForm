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
// Shape classification — a heuristic, not a solid-recognition engine
// ---------------------------------------------------------------------------

/** Vertex count of a face's OUTER boundary. For classification only. */
function outerVertexCount(g: Graph, faceId: FaceId): number {
  const f = g.faces.get(faceId);
  if (!f) return 0;
  return loopPoints(g, f.outerLoop).length;
}

/**
 * Guesses a human name for a CLOSED group of faces, from vertex and face
 * counts alone — not measured geometry.
 *
 * This is deliberately a heuristic, not real solid recognition: six quad
 * faces are called a "Box" whether or not they are actually rectangular or
 * their corners are perpendicular. Getting that right needs genuine solid
 * classification, which the kernel does not have. What this DOES get right
 * is the case that actually motivated it — push/pulling a rectangle, circle
 * or triangle should read as "Box", "Cylinder" or "Triangular Prism", not a
 * generic "Solid N" that gives no sense of what a hundred-surface model
 * actually contains.
 *
 * Returns null when nothing recognisable matches, so the caller falls back
 * to the generic numbered label. A face with a hole never matches — a box
 * with a shaft through it is not a simple box any more, and pretending
 * otherwise would be a confident wrong answer.
 */
function classifyClosedGroup(g: Graph, faces: readonly FaceId[]): string | null {
  if (faces.some((id) => (g.faces.get(id)?.innerLoops.length ?? 0) > 0)) return null;

  const counts = faces.map((id) => outerVertexCount(g, id));
  if (counts.some((n) => n < 3)) return null;

  if (faces.length === 6 && counts.every((n) => n === 4)) return 'Box';

  if (faces.length === 5) {
    const tris = counts.filter((n) => n === 3).length;
    const quads = counts.filter((n) => n === 4).length;
    if (tris === 2 && quads === 3) return 'Triangular Prism';
  }

  // Two matching many-sided caps plus one quad wall per side of the cap:
  // exactly what push/pulling an N-segment circle produces. But this
  // combinatorial signature is IDENTICAL for any regular N-gon extruded —
  // a pentagon prism has 2 pentagon caps and 5 quad walls, matching the
  // same shape as a "cylinder" with 5 segments. There is no way to tell
  // them apart from topology alone; the threshold below only calls it a
  // Cylinder once N is large enough that a low-poly prism reading is
  // implausible, matching the loose-face Circle threshold below.
  const caps = counts.filter((n) => n > 4);
  if (caps.length === 2 && caps[0] === caps[1] && caps[0]! >= 8) {
    const sides = caps[0]!;
    const quads = counts.filter((n) => n === 4).length;
    if (quads === sides && faces.length === sides + 2) return 'Cylinder';
  }

  return null;
}

/** Same idea, for a single loose (unextruded) face. */
function classifyLooseFace(g: Graph, faceId: FaceId): string | null {
  const f = g.faces.get(faceId);
  if (!f || f.innerLoops.length > 0) return null;
  const n = outerVertexCount(g, faceId);
  if (n === 3) return 'Triangle';
  if (n === 4) return 'Rectangle';
  // Our circle tool tessellates at 32 segments; a lower threshold risks
  // mislabelling a hand-drawn pentagon or hexagon as a circle.
  if (n >= 8) return 'Circle';
  return null;
}

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
        label:
          (closed ? classifyClosedGroup(g, faces) : faces.length === 1 ? classifyLooseFace(g, faces[0]!) : null) ??
          (closed ? `Solid ${root}` : faces.length > 1 ? `Surfaces ${root}` : `Surface ${root}`),
        faces,
        area: faces.reduce((sum, f) => sum + faceArea(g, f), 0),
        closed,
      };
    });
}

/**
 * Every face belonging to the same connected solid as `faceId`.
 *
 * This is the piece "click selects the group, double-click selects the
 * face" needs: resolving a single clicked face to the whole object it's
 * part of, via the same connectivity `faceGroups` already computes. A face
 * with no neighbours resolves to itself — a lone surface IS its own group.
 */
export function groupContaining(g: Graph, faceId: FaceId): FaceId[] {
  for (const group of faceGroups(g)) {
    if (group.faces.includes(faceId)) return group.faces;
  }
  return [faceId];
}

// ---------------------------------------------------------------------------
// Group-level hide and delete
// ---------------------------------------------------------------------------

/** Hides or shows every face in a group at once. Returns how many changed. */
export function setGroupHidden(g: Graph, faces: Iterable<FaceId>, hidden: boolean): number {
  let n = 0;
  for (const id of faces) if (setFaceHidden(g, id, hidden)) n++;
  return n;
}

/**
 * Deletes every face in a group, and every edge exclusive to it.
 *
 * Looping `deleteFaceAndEdges` over the group is safe regardless of order:
 * an edge shared between two faces BOTH in this group survives until the
 * second of the two is processed, at which point its use count reaches zero
 * and it is removed there. An edge shared with a face OUTSIDE the group
 * never reaches zero, so it survives — the same "don't destroy a neighbour"
 * guarantee `deleteFaceAndEdges` already gives one face at a time, just
 * applied to the whole group in one call.
 */
export function deleteGroupFacesAndEdges(
  g: Graph,
  faces: Iterable<FaceId>,
): { edgesRemoved: number } {
  let edgesRemoved = 0;
  for (const id of faces) edgesRemoved += deleteFaceAndEdges(g, id).edgesRemoved;
  return { edgesRemoved };
}
