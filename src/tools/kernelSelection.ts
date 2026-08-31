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

import type { EdgeId, FaceId, Graph, Vec3 } from '../lib/geometry/types';
import { loopPoints, removeFace, loopEdgeIds, loopVertexIds, getVertex } from '../lib/geometry/topology';
import { add, planeBasis, projectToBasis } from '../lib/geometry/math';
import { signedArea } from '../lib/geometry/polygon';
import { insertIsolatedEdge, type InsertContext } from '../lib/geometry/insert';
import { derive, type DeriveOptions } from '../lib/geometry/derive';

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
/**
 * The real invariant: a face using an edge as one of its HOLES must never
 * connect to anything else through that specific edge — a hole means
 * nothing structurally continues there, for whichever faces are on the
 * other side of it. Other faces sharing the SAME edge via their own OUTER
 * loops are unaffected and still union with each other normally.
 *
 * An earlier version of this excluded a specific (frame, panel) PAIR
 * instead. That was too narrow: once the panel is push/pulled, each new
 * wall of the resulting small box sits on one of those same boundary
 * edges — so that edge now has a THIRD use (the wall's own outer loop),
 * and excluding only the frame-panel pair left frame free to union with
 * the WALL directly, which — since the wall is already connected to the
 * rest of that little box — silently reconnected the frame to the whole
 * thing anyway. Blocking the hole-loop's OWN participation in any union,
 * regardless of which other face is on the other end, closes that gap.
 *
 * This is what makes a flat panel drawn to exactly fill a hole — a window
 * outline on a wall, or the inner shape an offset produces — read as its
 * OWN standalone object in the Outliner, not nested inside the surface it
 * sits in, and stay that way once the panel is push/pulled into its own
 * small solid.
 *
 * A face split by a line into two pieces is unaffected: the shared edge
 * there is used by both pieces via their own OUTER loops, with no hole
 * involved at all, so it unions exactly as before.
 */
function facesThatMayUnionViaEdge(g: Graph, edgeId: EdgeId): FaceId[] {
  const e = g.edges.get(edgeId);
  if (!e) return [];
  const out: FaceId[] = [];
  for (const use of e.uses) {
    const loop = g.loops.get(use.loop);
    if (!loop || !g.faces.has(loop.face)) continue;
    const face = g.faces.get(loop.face)!;
    // Only an OUTER-loop use may participate. A face referencing this edge
    // through one of its innerLoops (a hole) contributes nothing here — a
    // hole is precisely the absence of a structural connection.
    if (loop.id === face.outerLoop) out.push(loop.face);
  }
  return out;
}

export function faceGroups(g: Graph): FaceGroup[] {
  // Union-find over faces, joined wherever they share an edge THROUGH THEIR
  // OUTER BOUNDARIES. A face using that same edge as one of its holes never
  // participates — see facesThatMayUnionViaEdge's own doc comment for why
  // that has to be the actual invariant, not merely excluding one pair.
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

  for (const eid of g.edges.keys()) {
    const faces = facesThatMayUnionViaEdge(g, eid);
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

/**
 * Duplicates every face of a group at a fixed offset, as new, independent
 * geometry — a real copy the user can then move, edit, or delete on its
 * own, not a reference back to the original.
 *
 * Built on insertIsolatedEdge, the same construction Rectangle/Circle/
 * Triangle use (see that function's own doc comment) and for the same
 * reason: a duplicate is a brand-new, independent shape, not a deliberate
 * connection into whatever the offset happens to land on. Every resulting
 * face is marked the same way those tools mark theirs, so pushing/pulling
 * the duplicate later stays consistent with how it was created — see
 * kernelPushPull.ts's own use of this marker for why that consistency
 * matters.
 *
 * Each original face is derived on its own, one at a time, rather than
 * batching every face's edges into one shared derive() call. That is
 * slower for a large group, but it is what makes mapping each new face
 * back to the ORIGINAL face's own material reliable: a single derive()
 * call over many faces' edges at once gives no natural way to tell which
 * resulting face came from which original.
 *
 * The offset is the caller's responsibility, not computed here — this
 * keeps the function simple and testable, and lets the caller decide the
 * placement logic (e.g. clear of the group's own bounding box, so the
 * duplicate never lands overlapping the original it was copied from).
 */
export function duplicateGroup(
  ctx: InsertContext,
  faces: readonly FaceId[],
  offset: Vec3,
  deriveOpts: DeriveOptions,
): { newFaceIds: FaceId[] } {
  const g = ctx.graph;
  const newFaceIds: FaceId[] = [];

  for (const fid of faces) {
    const f = g.faces.get(fid);
    if (!f) continue;
    const material = f.attributes.materialFront;

    const order = loopPoints(g, f.outerLoop).map((p) => add(p, offset));
    const holes = f.innerLoops.map((loopId) => loopPoints(g, loopId).map((p) => add(p, offset)));

    const touched = new Set<EdgeId>();
    const faceIdsBefore = new Set(g.faces.keys());

    const n = order.length;
    for (let i = 0; i < n; i++) {
      for (const t of insertIsolatedEdge(ctx, order[i]!, order[(i + 1) % n]!).touched) touched.add(t);
    }
    for (const holePts of holes) {
      const hn = holePts.length;
      for (let i = 0; i < hn; i++) {
        for (const t of insertIsolatedEdge(ctx, holePts[i]!, holePts[(i + 1) % hn]!).touched) touched.add(t);
      }
    }
    derive(g, touched, deriveOpts);

    for (const [newFid, newFace] of g.faces) {
      if (faceIdsBefore.has(newFid)) continue;
      newFace.attributes.custom.isolatedShape = true;
      if (material) newFace.attributes.materialFront = material;
      newFaceIds.push(newFid);
    }
  }

  return { newFaceIds };
}

export interface ObjectInfoSummary {
  readonly faceCount: number;
  readonly edgeCount: number;
  readonly vertexCount: number;
  /** Bounding box extents, in the same units as the model itself. */
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  /** Every distinct material used across the group's faces, in first-seen
   *  order. Empty when no face has a material set. */
  readonly materials: string[];
  /** Total surface area across every face — NOT a solid's volume; this
   *  kernel has no volume computation, and a group is not guaranteed to
   *  be a closed, watertight solid in the first place. */
  readonly surfaceArea: number;
}

/**
 * A read-only summary of a group's own geometry, for a "View Object
 * Information" panel. Deliberately just facts read directly off the
 * graph — no per-object name, tag, or other metadata, because kernel
 * groups don't have any yet (see duplicateGroup's own doc comment on the
 * same point, and the context menu's).
 */
export function objectInfoSummary(g: Graph, faces: readonly FaceId[]): ObjectInfoSummary {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const edgeIds = new Set<EdgeId>();
  const vertexIds = new Set<number>();
  const materials: string[] = [];
  const seenMaterials = new Set<string>();
  let surfaceArea = 0;
  let faceCount = 0;

  for (const fid of faces) {
    const f = g.faces.get(fid);
    if (!f) continue;
    faceCount++;
    surfaceArea += faceArea(g, fid);
    if (f.attributes.materialFront && !seenMaterials.has(f.attributes.materialFront)) {
      seenMaterials.add(f.attributes.materialFront);
      materials.push(f.attributes.materialFront);
    }
    for (const loopId of [f.outerLoop, ...f.innerLoops]) {
      for (const eid of loopEdgeIds(g, loopId)) edgeIds.add(eid);
      for (const vid of loopVertexIds(g, loopId)) {
        vertexIds.add(vid);
        const p = getVertex(g, vid).position;
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
      }
    }
  }

  return {
    faceCount,
    edgeCount: edgeIds.size,
    vertexCount: vertexIds.size,
    width: isFinite(minX) ? maxX - minX : 0,
    height: isFinite(minY) ? maxY - minY : 0,
    depth: isFinite(minZ) ? maxZ - minZ : 0,
    materials,
    surfaceArea,
  };
}
