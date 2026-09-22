import * as THREE from 'three';
import type { Shape } from '../../types';

export function canApplySurfaceDepth(shape: Shape): boolean {
  // Surface depth is a material property, not a shape-type allowlist: it can go on any
  // object's surface, the same way a color or texture can. Bevelled edges and per-face
  // (surfaceMaterials) objects are supported best-effort - SurfaceDepth.init() patches
  // every material in a multi-material mesh with the same height field, so an object with
  // several face materials still gets one coherent relief across all of them.
  // surfaceDivisions (a separate per-face UV subdivision grid, unrelated to face-group
  // materials) isn't handled by the subdivision pass below, so stays excluded. Objects
  // whose actual mesh can't take it (no UVs, vertex-colored/non-standard material,
  // instanced/batched rendering) are excluded at runtime instead, by
  // SurfaceDepthBinding's own checks - this stays a single, simple gate rather than
  // tracking every geometry's capabilities here too.
  return !shape.surfaceDivisions;
}

/** normalMapUrl is shared by two unrelated features: a general PBR material preset can
 * set it directly, or Surface depth can auto-derive it from the height map
 * (surfaceDepthAutoNormal !== false). Only the auto-derived one has any meaning tied to
 * the Surface depth toggle, so only it should disappear when Surface depth is disabled -
 * an independently-applied normal map (material preset, or a manually uploaded one with
 * surfaceDepthAutoNormal === false) must stay regardless of that toggle. */
export function shouldHideAutoNormalMap(shape: Shape): boolean {
  return Boolean(shape.displacementMapUrl) && shape.surfaceDepthAutoNormal !== false && shape.surfaceDepthEnabled === false;
}

/** One-time bounded subdivision; never modifies the modelling/collision geometry. */
export function subdivideDepthGeometry(source: THREE.BufferGeometry, detail = 16): THREE.BufferGeometry {
  if (!source.hasAttribute('uv') || !source.hasAttribute('normal')) throw new Error('Depth needs UVs and normals');
  let geometry = source.index ? source.toNonIndexed() : source.clone();
  geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new THREE.Vector3());
  const threshold = Math.max(size.x, size.y, size.z) / Math.max(4, Math.min(32, detail));
  for (let pass = 0; pass < 6; pass++) {
    const position = geometry.getAttribute('position');
    if (position.count * 4 > 98304) break;
    let needsSplit = false;
    for (let i = 0; i < position.count && !needsSplit; i += 3) {
      for (let edge = 0; edge < 3; edge++) {
        const a = i + edge, b = i + (edge + 1) % 3;
        if (Math.hypot(position.getX(a)-position.getX(b), position.getY(a)-position.getY(b), position.getZ(a)-position.getZ(b)) > threshold) needsSplit = true;
      }
    }
    if (!needsSplit) break;
    const next = new THREE.BufferGeometry();
    // Linear barycentric interpolation preserves existing UV seams and hard normals.
    const weights = [[1,0,0],[.5,.5,0],[.5,0,.5], [.5,.5,0],[0,1,0],[0,.5,.5], [.5,0,.5],[0,.5,.5],[0,0,1], [.5,.5,0],[0,.5,.5],[.5,0,.5]];
    for (const name of ['position', 'normal', 'uv', 'color']) {
      const attribute = geometry.getAttribute(name); if (!attribute) continue;
      const values = new Float32Array(position.count * 4 * attribute.itemSize);
      let offset = 0;
      for (let i = 0; i < position.count; i += 3) for (const w of weights) for (let component = 0; component < attribute.itemSize; component++) {
        values[offset++] = w[0]*attribute.getComponent(i, component) + w[1]*attribute.getComponent(i+1, component) + w[2]*attribute.getComponent(i+2, component);
      }
      next.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
    }
    geometry.groups.forEach(group => next.addGroup(group.start * 4, group.count * 4, group.materialIndex));
    geometry.dispose(); geometry = next;
  }
  geometry.normalizeNormals();
  applyDepthEdgeFade(geometry);
  return geometry;
}

/** Point-to-segment distance in 3D. */
function distanceToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = new THREE.Vector3().subVectors(b, a);
  const lenSq = ab.lengthSq();
  const t = lenSq > 1e-12 ? Math.max(0, Math.min(1, new THREE.Vector3().subVectors(p, a).dot(ab) / lenSq)) : 0;
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

/**
 * Adds a `pfEdgeFade` vertex attribute (0 at the mesh's true silhouette/boundary edges *and*
 * at its internal crease edges, ramping to 1 within `marginMeters`) that SurfaceDepth
 * multiplies its vertex displacement by, so a height-mapped surface's relief tapers off right
 * at its own edge instead of displacing that edge's vertices outward/inward - which, for two
 * surfaces that are meant to butt flush against each other, otherwise re-opens a visible gap
 * or overlap that the underlying (non-displaced) geometry closed correctly.
 *
 * Deliberately based on true geometric distance to a flagged edge, never on the surface's own
 * (often tiled/repeating) UV coordinates - a texture-space fade would instead fade at every
 * texture tile repeat, putting a visible grid of flattened lines across any large tiled surface
 * (a long wall, terrain) rather than just its true outer edge.
 *
 * Two kinds of edge are flagged, both found on a non-indexed triangle soup by grouping edges
 * that share the same (rounded) endpoint positions:
 *  - an open/boundary edge, one that only ever belongs to a single triangle - the classic case,
 *    e.g. the perimeter of an open plane.
 *  - a crease edge, one whose adjoining triangles' face normals diverge sharply (e.g. a wall's
 *    front face meeting its end/miter face at 90 degrees). A solid, watertight extrusion (the
 *    walls this was built for are exactly this: `ExtrudeGeometry` from a closed footprint, with
 *    top/bottom caps) has NO open edges anywhere on it - every edge belongs to exactly two
 *    triangles - so relying on open-edge detection alone is a no-op for any solid/closed shape.
 *    But two faces of the same watertight solid, displaced independently along their own
 *    (different) normals, still pull apart at the edge where they meet, exactly like two
 *    separate meshes would - so that edge needs the same fade treatment.
 * A fully smooth, gapless surface with no creases anywhere (a sphere, a smooth terrain patch)
 * has no flagged edges at all - the fade is then 1 everywhere, a true no-op, since there is no
 * edge whose independent displacement could ever reveal a seam.
 */
export function applyDepthEdgeFade(geometry: THREE.BufferGeometry, marginMeters = 0.04, creaseCosineThreshold = 0.9): void {
  const position = geometry.getAttribute('position');
  const vertexCount = position.count;
  const precision = 1e5; // 10 micron key resolution - well below any real seam tolerance
  const key = (x: number, y: number, z: number) =>
    `${Math.round(x * precision)},${Math.round(y * precision)},${Math.round(z * precision)}`;
  const get = (i: number) => new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i));
  const edgeKeyOf = (a: THREE.Vector3, b: THREE.Vector3) => {
    const ka = key(a.x, a.y, a.z), kb = key(b.x, b.y, b.z);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  // A degenerate (zero-area) triangle has no well-defined normal; treat its edges as flagged
  // rather than let a NaN/zero normal silently poison a real neighbour's crease comparison.
  const triangleNormal = (tri: number): THREE.Vector3 | null => {
    const a = get(tri), b = get(tri + 1), c = get(tri + 2);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    return n.lengthSq() > 1e-12 ? n.normalize() : null;
  };

  const edgeNormals = new Map<string, (THREE.Vector3 | null)[]>();
  for (let tri = 0; tri < vertexCount; tri += 3) {
    const normal = triangleNormal(tri);
    for (let e = 0; e < 3; e++) {
      const edgeKey = edgeKeyOf(get(tri + e), get(tri + ((e + 1) % 3)));
      const list = edgeNormals.get(edgeKey);
      if (list) list.push(normal); else edgeNormals.set(edgeKey, [normal]);
    }
  }
  const isFlaggedEdge = (normals: (THREE.Vector3 | null)[]) => {
    if (normals.length === 1) return true; // open/boundary edge
    for (let i = 0; i < normals.length; i++) for (let j = i + 1; j < normals.length; j++) {
      const a = normals[i], b = normals[j];
      if (!a || !b || a.dot(b) < creaseCosineThreshold) return true; // crease, or degenerate neighbour
    }
    return false;
  };

  // Flagged edges are a small fraction of a dense mesh's total edges (roughly proportional to
  // its silhouette/crease length, not its triangle count), but a naive check-every-vertex-
  // against-every-segment search is still O(vertexCount * segmentCount) - for a heavily
  // subdivided solid (tens of thousands of vertices) that is seconds of main-thread work per
  // mesh. Since only segments within `marginMeters` of a vertex matter at all (anything farther
  // saturates to fade 1 regardless of exact distance), bucket segments into a uniform grid of
  // that cell size and look a vertex up only in its own cell - registering each segment into
  // every cell its (margin-expanded) bounding box touches makes that single-cell lookup exact.
  const cellSize = Math.max(marginMeters, 1e-6);
  const cellOf = (v: number) => Math.floor(v / cellSize);
  const cellKey = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const grid = new Map<string, [THREE.Vector3, THREE.Vector3][]>();
  let segmentCount = 0;
  for (let tri = 0; tri < vertexCount; tri += 3) {
    for (let e = 0; e < 3; e++) {
      const a = get(tri + e), b = get(tri + ((e + 1) % 3));
      if (!isFlaggedEdge(edgeNormals.get(edgeKeyOf(a, b))!)) continue;
      segmentCount++;
      const minX = cellOf(Math.min(a.x, b.x) - marginMeters), maxX = cellOf(Math.max(a.x, b.x) + marginMeters);
      const minY = cellOf(Math.min(a.y, b.y) - marginMeters), maxY = cellOf(Math.max(a.y, b.y) + marginMeters);
      const minZ = cellOf(Math.min(a.z, b.z) - marginMeters), maxZ = cellOf(Math.max(a.z, b.z) + marginMeters);
      for (let cx = minX; cx <= maxX; cx++) for (let cy = minY; cy <= maxY; cy++) for (let cz = minZ; cz <= maxZ; cz++) {
        const k = cellKey(cx, cy, cz);
        const list = grid.get(k);
        if (list) list.push([a, b]); else grid.set(k, [[a, b]]);
      }
    }
  }

  const fade = new Float32Array(vertexCount).fill(1);
  if (segmentCount > 0) {
    for (let i = 0; i < vertexCount; i++) {
      const p = get(i);
      const segments = grid.get(cellKey(cellOf(p.x), cellOf(p.y), cellOf(p.z)));
      let minDist = segments ? Infinity : marginMeters;
      if (segments) for (const [a, b] of segments) minDist = Math.min(minDist, distanceToSegment(p, a, b));
      const t = Math.max(0, Math.min(1, minDist / marginMeters));
      fade[i] = t * t * (3 - 2 * t); // smoothstep
    }
  }
  geometry.setAttribute('pfEdgeFade', new THREE.Float32BufferAttribute(fade, 1));
}
