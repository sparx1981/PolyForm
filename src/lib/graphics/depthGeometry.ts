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
 * Adds a `pfEdgeFade` vertex attribute (0 at the mesh's true silhouette/boundary edges,
 * ramping to 1 within `marginMeters`) that SurfaceDepth multiplies its vertex displacement by,
 * so a height-mapped surface's relief tapers off right at its own edge instead of displacing
 * that edge's vertices outward/inward - which, for two separate meshes that are meant to butt
 * flush against each other (e.g. two walls meeting at a corner), otherwise re-opens a visible
 * gap or overlap that the underlying (non-displaced) geometry closed correctly.
 *
 * Deliberately based on true geometric distance to a boundary edge, never on the surface's own
 * (often tiled/repeating) UV coordinates - a texture-space fade would instead fade at every
 * texture tile repeat, putting a visible grid of flattened lines across any large tiled surface
 * (a long wall, terrain) rather than just its true outer edge.
 *
 * A "boundary edge" is found the standard way: on a non-indexed triangle soup, an edge shared
 * by only one triangle (as opposed to two, for an interior edge) sits on the mesh's silhouette.
 * Closed, gapless shapes (a full sphere, a solid box) have no boundary edges at all - the fade
 * is then 1 everywhere, a no-op, since there is no edge that another mesh could ever need to
 * align flush against.
 */
export function applyDepthEdgeFade(geometry: THREE.BufferGeometry, marginMeters = 0.04): void {
  const position = geometry.getAttribute('position');
  const vertexCount = position.count;
  const precision = 1e5; // 10 micron key resolution - well below any real seam tolerance
  const key = (x: number, y: number, z: number) =>
    `${Math.round(x * precision)},${Math.round(y * precision)},${Math.round(z * precision)}`;

  const edgeCounts = new Map<string, number>();
  const get = (i: number) => new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i));
  for (let tri = 0; tri < vertexCount; tri += 3) {
    for (let e = 0; e < 3; e++) {
      const a = get(tri + e), b = get(tri + ((e + 1) % 3));
      const ka = key(a.x, a.y, a.z), kb = key(b.x, b.y, b.z);
      const edgeKey = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      edgeCounts.set(edgeKey, (edgeCounts.get(edgeKey) ?? 0) + 1);
    }
  }

  const boundarySegments: [THREE.Vector3, THREE.Vector3][] = [];
  for (let tri = 0; tri < vertexCount; tri += 3) {
    for (let e = 0; e < 3; e++) {
      const a = get(tri + e), b = get(tri + ((e + 1) % 3));
      const ka = key(a.x, a.y, a.z), kb = key(b.x, b.y, b.z);
      const edgeKey = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (edgeCounts.get(edgeKey) === 1) boundarySegments.push([a, b]);
    }
  }

  const fade = new Float32Array(vertexCount).fill(1);
  if (boundarySegments.length > 0) {
    for (let i = 0; i < vertexCount; i++) {
      const p = get(i);
      let minDist = Infinity;
      for (const [a, b] of boundarySegments) minDist = Math.min(minDist, distanceToSegment(p, a, b));
      const t = Math.max(0, Math.min(1, minDist / marginMeters));
      fade[i] = t * t * (3 - 2 * t); // smoothstep
    }
  }
  geometry.setAttribute('pfEdgeFade', new THREE.Float32BufferAttribute(fade, 1));
}
