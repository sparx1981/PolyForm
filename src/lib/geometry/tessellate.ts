/**
 * PolyForm geometry kernel — render bridge tessellation. Phase 9b.
 *
 * Turns derived faces into triangle and line buffers. Pure and
 * dependency-free: no three.js, no React, no earcut. That keeps it testable
 * headless, which matters because the thing most likely to break here —
 * a hole that fills in — is invisible in a screenshot until someone looks
 * closely at the wrong pixel.
 *
 * Ear clipping with hole bridging, rather than a library, for the same
 * reason §10.3 forbids clipping libraries in derivation: this consumes the
 * kernel's loops directly, in their existing winding, with no round trip
 * through a foreign coordinate representation.
 *
 * f64 throughout. The caller converts to Float32Array at the GPU boundary and
 * nowhere earlier. §10.3
 */

import type { EdgeId, FaceId, Graph, Vec2, Vec3 } from './types';
import { classifyEdge, edgePoints, loopPoints } from './topology';
import { add, dot, planeBasis, projectToBasis, scale, sub } from './math';
import { signedArea, withWinding } from './polygon';
import { sampleUV } from './derive';

export interface FaceMesh {
  readonly faceId: FaceId;
  /** Flat xyz triples, world space, f64. */
  readonly positions: number[];
  readonly normals: number[];
  /** Flat uv pairs from the face's world-anchored basis. §6.3 */
  readonly uvs: number[];
  readonly indices: number[];
  readonly materialFront: string | null;
  readonly materialBack: string | null;
}

export interface EdgeLine {
  readonly edgeId: EdgeId;
  readonly a: Vec3;
  readonly b: Vec3;
  /** Boundary and non-manifold edges are drawn heavier. §2.4 */
  readonly classification: 'boundary' | 'manifold' | 'non-manifold';
  /** Interior curve edges are hidden so an arc shades continuously. §5.5 */
  readonly hidden: boolean;
}

export interface KernelMeshData {
  readonly faces: FaceMesh[];
  readonly edges: EdgeLine[];
  readonly triangleCount: number;
}

// ---------------------------------------------------------------------------
// Ear clipping
// ---------------------------------------------------------------------------

const cross2 = (o: Vec2, a: Vec2, b: Vec2): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = cross2(a, b, p);
  const d2 = cross2(b, c, p);
  const d3 = cross2(c, a, p);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/**
 * Triangulates a counter-clockwise simple polygon. Returns index triples into
 * the supplied vertex array.
 */
function earClip(points: readonly Vec2[], indices: readonly number[]): number[] {
  const out: number[] = [];
  const remaining = [...indices];
  if (remaining.length < 3) return out;

  let guard = remaining.length * remaining.length + 16;

  while (remaining.length > 3 && guard-- > 0) {
    let clipped = false;

    for (let i = 0; i < remaining.length; i++) {
      const iPrev = remaining[(i - 1 + remaining.length) % remaining.length]!;
      const iCur = remaining[i]!;
      const iNext = remaining[(i + 1) % remaining.length]!;
      const a = points[iPrev]!;
      const b = points[iCur]!;
      const c = points[iNext]!;

      // Reflex vertices are not ears.
      if (cross2(a, b, c) <= 0) continue;

      // No other vertex may fall inside the candidate ear.
      let blocked = false;
      for (const j of remaining) {
        if (j === iPrev || j === iCur || j === iNext) continue;
        if (pointInTriangle(points[j]!, a, b, c)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      out.push(iPrev, iCur, iNext);
      remaining.splice(i, 1);
      clipped = true;
      break;
    }

    // Degenerate input: bail rather than spin. Better a missing triangle than
    // a hung frame.
    if (!clipped) break;
  }

  if (remaining.length === 3) out.push(remaining[0]!, remaining[1]!, remaining[2]!);
  return out;
}

/**
 * Splices holes into the outer contour, producing one simple polygon.
 *
 * For each hole, take its rightmost vertex, cast a ray in +x, and bridge to
 * the nearest visible outer vertex. Holes are processed right-to-left so an
 * earlier bridge cannot block a later one.
 */
function bridgeHoles(
  outer: readonly Vec2[],
  holes: readonly (readonly Vec2[])[],
): { points: Vec2[]; contour: number[] } {
  const points: Vec2[] = [...outer];
  let contour = outer.map((_, i) => i);

  const prepared = holes
    .map((h) => withWinding(h, false)) // holes wind clockwise inside a CCW outer
    .map((h) => {
      let mi = 0;
      for (let i = 1; i < h.length; i++) if (h[i]!.x > h[mi]!.x) mi = i;
      return { ring: h, rightmost: mi };
    })
    .sort((a, b) => b.ring[b.rightmost]!.x - a.ring[a.rightmost]!.x);

  for (const { ring, rightmost } of prepared) {
    const m = ring[rightmost]!;

    // Nearest contour vertex to the right of m that is visible from it.
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < contour.length; i++) {
      const p = points[contour[i]!]!;
      if (p.x < m.x) continue;
      const d = (p.x - m.x) * (p.x - m.x) + (p.y - m.y) * (p.y - m.y);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    // Fall back to the globally nearest vertex if nothing lies to the right.
    if (bestIdx < 0) {
      for (let i = 0; i < contour.length; i++) {
        const p = points[contour[i]!]!;
        const d = (p.x - m.x) * (p.x - m.x) + (p.y - m.y) * (p.y - m.y);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
    }
    if (bestIdx < 0) continue;

    const base = points.length;
    for (const p of ring) points.push(p);

    // Bridge: outer[..bestIdx], hole from rightmost around, back to both.
    const holeSeq: number[] = [];
    for (let k = 0; k < ring.length; k++) {
      holeSeq.push(base + ((rightmost + k) % ring.length));
    }
    holeSeq.push(base + rightmost);

    contour = [
      ...contour.slice(0, bestIdx + 1),
      ...holeSeq,
      contour[bestIdx]!,
      ...contour.slice(bestIdx + 1),
    ];
  }

  return { points, contour };
}

/** Triangulates an outer ring with holes. Indices refer to the returned points. */
export function triangulate(
  outer: readonly Vec2[],
  holes: readonly (readonly Vec2[])[] = [],
): { points: Vec2[]; indices: number[] } {
  const ccwOuter = withWinding(outer, true);
  if (holes.length === 0) {
    const idx = ccwOuter.map((_, i) => i);
    return { points: [...ccwOuter], indices: earClip(ccwOuter, idx) };
  }
  const { points, contour } = bridgeHoles(ccwOuter, holes);
  return { points, indices: earClip(points, contour) };
}

// ---------------------------------------------------------------------------
// Face meshing
// ---------------------------------------------------------------------------

export function tessellateFace(g: Graph, faceId: FaceId): FaceMesh | null {
  const face = g.faces.get(faceId);
  if (!face) return null;

  const basis = planeBasis(face.plane);
  const outerWorld = loopPoints(g, face.outerLoop);
  if (outerWorld.length < 3) return null;

  const outer2 = outerWorld.map((p) => projectToBasis(p, basis));
  const holes2 = face.innerLoops.map((l) =>
    loopPoints(g, l).map((p) => projectToBasis(p, basis)),
  );

  const { points, indices } = triangulate(outer2, holes2);

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const n = face.plane.normal;
  const uv = face.attributes.uv;

  for (const p of points) {
    const world = add(basis.origin, add(scale(basis.u, p.x), scale(basis.v, p.y)));
    positions.push(world.x, world.y, world.z);
    normals.push(n.x, n.y, n.z);
    if (uv) {
      const t = sampleUV(world, uv);
      uvs.push(t.x, t.y);
    } else {
      uvs.push(p.x, p.y);
    }
  }

  return {
    faceId,
    positions,
    normals,
    uvs,
    indices,
    materialFront: face.attributes.materialFront,
    materialBack: face.attributes.materialBack,
  };
}

/** Everything the renderer needs for one graph. */
export function tessellateGraph(g: Graph): KernelMeshData {
  const faces: FaceMesh[] = [];
  let triangleCount = 0;

  for (const id of [...g.faces.keys()].sort((a, b) => a - b)) {
    const mesh = tessellateFace(g, id);
    if (!mesh) continue;
    faces.push(mesh);
    triangleCount += mesh.indices.length / 3;
  }

  const edges: EdgeLine[] = [];
  for (const id of [...g.edges.keys()].sort((a, b) => a - b)) {
    const e = g.edges.get(id)!;
    const [a, b] = edgePoints(g, e);
    edges.push({
      edgeId: id,
      a,
      b,
      classification: classifyEdge(e),
      // A smoothed interior curve edge is not drawn; the edge still exists.
      hidden: e.hidden || (e.smooth && classifyEdge(e) === 'manifold'),
    });
  }

  return { faces, edges, triangleCount };
}

// ---------------------------------------------------------------------------
// GPU buffers — the ONLY place f32 is permitted
// ---------------------------------------------------------------------------

export interface MergedBuffers {
  readonly position: Float32Array;
  readonly normal: Float32Array;
  readonly uv: Float32Array;
  readonly index: Uint32Array;
  /** Triangle -> FaceId, so a raycast hit maps back to a kernel face. */
  readonly faceOfTriangle: FaceId[];
}

/**
 * Merges face meshes into single buffers.
 *
 * This is the f64 -> f32 boundary and the only correct place for it. Doing it
 * any earlier costs precision the kernel depends on: at 10^6 units f32
 * resolves to ~0.06, sixty times coarser than COPLANARITY_TOLERANCE. §10.3
 */
export function mergeBuffers(meshes: readonly FaceMesh[]): MergedBuffers {
  let vertexCount = 0;
  let indexCount = 0;
  for (const m of meshes) {
    vertexCount += m.positions.length / 3;
    indexCount += m.indices.length;
  }

  const position = new Float32Array(vertexCount * 3);
  const normal = new Float32Array(vertexCount * 3);
  const uv = new Float32Array(vertexCount * 2);
  const index = new Uint32Array(indexCount);
  const faceOfTriangle: FaceId[] = [];

  let vOffset = 0;
  let iOffset = 0;
  for (const m of meshes) {
    position.set(m.positions, vOffset * 3);
    normal.set(m.normals, vOffset * 3);
    uv.set(m.uvs, vOffset * 2);
    for (let k = 0; k < m.indices.length; k++) index[iOffset + k] = m.indices[k]! + vOffset;
    for (let t = 0; t < m.indices.length / 3; t++) faceOfTriangle.push(m.faceId);
    vOffset += m.positions.length / 3;
    iOffset += m.indices.length;
  }

  return { position, normal, uv, index, faceOfTriangle };
}

/** Flat line-segment buffer for edge rendering. Visible edges only. */
export function edgeBuffer(edges: readonly EdgeLine[]): {
  position: Float32Array;
  edgeOfSegment: EdgeId[];
} {
  const visible = edges.filter((e) => !e.hidden);
  const position = new Float32Array(visible.length * 6);
  const edgeOfSegment: EdgeId[] = [];
  visible.forEach((e, i) => {
    position.set([e.a.x, e.a.y, e.a.z, e.b.x, e.b.y, e.b.z], i * 6);
    edgeOfSegment.push(e.edgeId);
  });
  return { position, edgeOfSegment };
}

/** Total area of the tessellation. A cheap cross-check against face area. */
export function tessellatedArea(meshes: readonly FaceMesh[]): number {
  let total = 0;
  for (const m of meshes) {
    for (let t = 0; t < m.indices.length; t += 3) {
      const ia = m.indices[t]! * 3;
      const ib = m.indices[t + 1]! * 3;
      const ic = m.indices[t + 2]! * 3;
      const a: Vec3 = { x: m.positions[ia]!, y: m.positions[ia + 1]!, z: m.positions[ia + 2]! };
      const b: Vec3 = { x: m.positions[ib]!, y: m.positions[ib + 1]!, z: m.positions[ib + 2]! };
      const c: Vec3 = { x: m.positions[ic]!, y: m.positions[ic + 1]!, z: m.positions[ic + 2]! };
      const ab = sub(b, a);
      const ac = sub(c, a);
      const cx = ab.y * ac.z - ab.z * ac.y;
      const cy = ab.z * ac.x - ab.x * ac.z;
      const cz = ab.x * ac.y - ab.y * ac.x;
      total += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
    }
  }
  return total;
}

export { signedArea, dot };
