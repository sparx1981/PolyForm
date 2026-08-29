/**
 * PolyForm — operations over a set of faces.
 *
 * Task 1 of the "structural fix": move, scale, rotate, offset and a bounding
 * box, all defined over an arbitrary FaceId set rather than a single mesh.
 *
 * The existing move/scale/rotate machinery (TransformControls in Viewport)
 * drives exactly one Shape's position/quaternion/scale and writes the result
 * back on release. That is single-object, single-representation by
 * construction — there is no way to hand it "these six faces" and have it
 * mean anything. Bending it to cover kernel groups would produce something
 * that only coincidentally worked for the cases tested.
 *
 * These operations work directly on the shared vertex set of the faces
 * involved: moving a group moves each vertex once, however many faces touch
 * it, so a box moves as a rigid body rather than its walls sliding apart at
 * the seams.
 */

import type { EdgeId, FaceId, Graph, Vec3, VertexId } from './types';
import { getVertex } from './topology';
import { add, distance, normalize, scale as scaleVec, sub } from './math';
import { transformDirection, transformNormal, transformPoint, invert, inverseTranspose, multiply, translation, scaling as scalingMat, rotationAxisAngle, IDENTITY } from './mat4';
import type { Mat4 } from './types';

/** Every vertex touched by any face in the set, deduplicated. */
export function verticesOf(g: Graph, faces: Iterable<FaceId>): Set<VertexId> {
  const out = new Set<VertexId>();
  for (const fid of faces) {
    const f = g.faces.get(fid);
    if (!f) continue;
    for (const lid of [f.outerLoop, ...f.innerLoops]) {
      const loop = g.loops.get(lid);
      if (!loop) continue;
      for (const use of loop.uses) {
        const e = g.edges.get(use.edge);
        if (!e) continue;
        out.add(e.v0);
        out.add(e.v1);
      }
    }
  }
  return out;
}

/** Every edge bounding any face in the set. */
export function edgesOf(g: Graph, faces: Iterable<FaceId>): Set<EdgeId> {
  const out = new Set<EdgeId>();
  for (const fid of faces) {
    const f = g.faces.get(fid);
    if (!f) continue;
    for (const lid of [f.outerLoop, ...f.innerLoops]) {
      const loop = g.loops.get(lid);
      if (!loop) continue;
      for (const use of loop.uses) out.add(use.edge);
    }
  }
  return out;
}

export interface Bounds3 {
  readonly min: Vec3;
  readonly max: Vec3;
  readonly center: Vec3;
  readonly size: Vec3;
}

/** Axis-aligned bounds of a face set, in the graph's own frame. */
export function boundsOfFaces(g: Graph, faces: Iterable<FaceId>): Bounds3 | null {
  const verts = verticesOf(g, faces);
  if (verts.size === 0) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const vid of verts) {
    const p = getVertex(g, vid).position;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.z > maxZ) maxZ = p.z;
  }
  const min = { x: minX, y: minY, z: minZ };
  const max = { x: maxX, y: maxY, z: maxZ };
  return {
    min, max,
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
    size: { x: maxX - minX, y: maxY - minY, z: maxZ - minZ },
  };
}

/**
 * Applies an arbitrary transform to a face set.
 *
 * Moves each shared vertex exactly ONCE — the reason this is a function
 * rather than "apply the same matrix while iterating faces" is that a vertex
 * used by three faces in the set must not be transformed three times.
 *
 * Face planes are recomputed from the transformed geometry rather than
 * transformed directly: a non-uniform scale changes a plane's normal by the
 * inverse transpose, and getting that wrong silently skews every face in the
 * group. Recomputing from the moved vertices sidesteps the question by
 * construction — the plane is whatever the new geometry actually describes.
 */
export function transformFaces(g: Graph, faces: Iterable<FaceId>, m: Mat4): void {
  const faceList = [...faces];
  const verts = verticesOf(g, faceList);
  for (const vid of verts) {
    const v = getVertex(g, vid);
    v.position = transformPoint(v.position, m);
  }
  const it = inverseTranspose(m);
  for (const fid of faceList) {
    const f = g.faces.get(fid);
    if (!f) continue;
    f.plane = {
      point: transformPoint(f.plane.point, m),
      normal: transformNormal(f.plane.normal, it),
    };
  }
}

export const translateFaces = (g: Graph, faces: Iterable<FaceId>, delta: Vec3): void =>
  transformFaces(g, faces, translation(delta));

/** Builds the matrix `scaleFaces` would apply, without touching the graph. */
export function scalePivotMatrix(pivot: Vec3, factor: Vec3): Mat4 {
  return multiply(translation(pivot), multiply(scalingMat(factor), translation(scaleVec(pivot, -1))));
}

/** Builds the matrix `rotateFaces` would apply, without touching the graph. */
export function rotatePivotMatrix(pivot: Vec3, axis: Vec3, radians: number): Mat4 {
  return multiply(translation(pivot), multiply(rotationAxisAngle(axis, radians), translation(scaleVec(pivot, -1))));
}

/** Scales about a pivot — the group's own center by default. */
export function scaleFaces(
  g: Graph,
  faces: Iterable<FaceId>,
  factor: Vec3,
  pivot?: Vec3,
): void {
  const faceList = [...faces];
  const center = pivot ?? boundsOfFaces(g, faceList)?.center;
  if (!center) return;
  transformFaces(g, faceList, scalePivotMatrix(center, factor));
}

/** Rotates about an axis through a pivot — the group's own center by default. */
export function rotateFaces(
  g: Graph,
  faces: Iterable<FaceId>,
  axis: Vec3,
  radians: number,
  pivot?: Vec3,
): void {
  const faceList = [...faces];
  const center = pivot ?? boundsOfFaces(g, faceList)?.center;
  if (!center) return;
  transformFaces(g, faceList, rotatePivotMatrix(center, axis, radians));
}

/**
 * Moves every vertex of a face set outward, as if each face's own plane had
 * been offset by `dist` along its normal.
 *
 * Each vertex accumulates `dist * normal` once per DISTINCT face touching
 * it — not once per edge. A face's boundary meets a shared corner via two of
 * its own edges, and counting both would double that face's contribution.
 *
 * Summing the scaled normals, rather than averaging their direction and
 * moving a single step of length `dist`, is what keeps a box corner correct:
 * three mutually perpendicular faces each moving outward by `dist` requires
 * the shared corner to move by `dist` along EACH axis — a displacement of
 * length `dist·√3`, not `dist`. For an orthonormal set of normals this sum
 * is exact. For faces meeting at other angles it is the standard
 * unweighted approximation, not a mitred, exact-distance solution — getting
 * that generally right needs a per-vertex linear solve, which is a decision
 * for whatever UI-level "Offset" tool is built on top of this.
 *
 * This is the primitive that tool needs; it does not decide sign convention
 * or self-intersection handling for a concave outline.
 */
/**
 * Computes what `offsetFaceVertices` would move each vertex to, without
 * touching the graph.
 *
 * Separated out so a live preview can call the SAME math the real
 * operation uses — rather than a second, hand-copied version that could
 * silently drift from what commit actually produces.
 */
export function computeOffsetPositions(
  g: Graph,
  faces: Iterable<FaceId>,
  dist: number,
): Map<VertexId, Vec3> {
  const faceList = [...faces];
  const verts = verticesOf(g, faceList);

  const touchingFaces = new Map<VertexId, Set<FaceId>>();
  for (const fid of faceList) {
    const f = g.faces.get(fid);
    if (!f) continue;
    for (const lid of [f.outerLoop, ...f.innerLoops]) {
      const loop = g.loops.get(lid);
      if (!loop) continue;
      for (const use of loop.uses) {
        const e = g.edges.get(use.edge);
        if (!e) continue;
        for (const vid of [e.v0, e.v1]) {
          if (!verts.has(vid)) continue;
          let set = touchingFaces.get(vid);
          if (!set) {
            set = new Set();
            touchingFaces.set(vid, set);
          }
          set.add(fid);
        }
      }
    }
  }

  const out = new Map<VertexId, Vec3>();
  for (const [vid, faceIds] of touchingFaces) {
    let delta: Vec3 = { x: 0, y: 0, z: 0 };
    for (const fid of faceIds) {
      const f = g.faces.get(fid);
      if (!f) continue;
      delta = add(delta, scaleVec(normalize(f.plane.normal), dist));
    }
    if (Math.hypot(delta.x, delta.y, delta.z) < 1e-12) continue;
    out.set(vid, add(getVertex(g, vid).position, delta));
  }
  return out;
}

export function offsetFaceVertices(g: Graph, faces: Iterable<FaceId>, dist: number): void {
  for (const [vid, pos] of computeOffsetPositions(g, faces, dist)) {
    getVertex(g, vid).position = pos;
  }
}

/** Uniform scale factor from a desired new bounding-box size along one axis. */
export function scaleFactorForSize(current: number, target: number): number {
  if (Math.abs(current) < 1e-12) return 1;
  return target / current;
}

export { transformDirection, invert, distance, sub, IDENTITY };

// ---------------------------------------------------------------------------
// Re-derivation after a transform
// ---------------------------------------------------------------------------

/**
 * Edges that must be re-derived after a geometric edit to a face set.
 *
 * Moving vertices can change which edges are coplanar, so this is not
 * optional bookkeeping — a rotated box needs its faces' planes re-derived or
 * the stored plane and the actual geometry disagree the next time anything
 * reads it.
 */
export function edgesToRederive(g: Graph, faces: Iterable<FaceId>): Set<EdgeId> {
  return edgesOf(g, faces);
}
