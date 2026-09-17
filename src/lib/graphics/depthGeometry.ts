import * as THREE from 'three';
import type { Shape } from '../../types';

export function canApplySurfaceDepth(shape: Shape): boolean {
  // Bevelled edges and per-face (surfaceMaterials) objects are supported best-effort:
  // SurfaceDepth.init() patches every material in a multi-material mesh with the same
  // height field, so a box with six different face materials still gets one coherent
  // relief. surfaceDivisions (a separate per-face UV subdivision grid, unrelated to
  // face-group materials) isn't handled by the subdivision pass below, so stays excluded.
  return ['box', 'rect', 'sphere', 'cone', 'cylinder', 'custom', 'terrain', 'poly', 'rock'].includes(shape.type)
    && !shape.surfaceDivisions;
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
  geometry.normalizeNormals(); return geometry;
}
