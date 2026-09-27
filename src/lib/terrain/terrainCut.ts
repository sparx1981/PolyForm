import * as THREE from 'three';
import * as polygonClippingModule from 'polygon-clipping';
import type { Polygon, Ring } from 'polygon-clipping';

const clip = ((polygonClippingModule as unknown as { default?: typeof polygonClippingModule }).default
  ?? polygonClippingModule) as typeof polygonClippingModule;

/**
 * Cuts a terrain mesh away under building floor slabs: triangles inside a footprint are
 * dropped and those crossing its edge are trimmed exactly to it (heights, texture coordinates,
 * normals and colours interpolated across the original triangle). The ground's height grid is
 * levelled below the slab already; this also stops its surface relief (displacement), and the
 * slope of grid squares straddling a curved edge, showing through the floor.
 *
 * `footprints` are in the geometry's own x/z (the terrain's local frame).
 */
export function cutTerrainUnderFootprints(geometry: THREE.BufferGeometry, footprints: [number, number][][]): THREE.BufferGeometry {
  const polys = footprints.filter(f => f.length >= 3);
  if (!polys.length) return geometry;
  const boxes = polys.map(f => {
    const xs = f.map(p => p[0]), zs = f.map(p => p[1]);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  });
  const rings: Polygon[] = polys.map(f => [[...f, f[0]!] as Ring]);

  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = source.getAttribute('position');
  const others = (['normal', 'uv', 'color'] as const)
    .map(name => ({ name, attr: source.getAttribute(name) as THREE.BufferAttribute | undefined }))
    .filter((a): a is { name: 'normal' | 'uv' | 'color'; attr: THREE.BufferAttribute } => !!a.attr);
  const out = { position: [] as number[], normal: [] as number[], uv: [] as number[], color: [] as number[] };
  let changed = false;

  const copyVertex = (i: number) => {
    out.position.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    for (const { name, attr } of others) {
      for (let c = 0; c < attr.itemSize; c++) out[name].push(attr.getComponent(i, c));
    }
  };

  for (let t = 0; t + 2 < pos.count; t += 3) {
    const ax = pos.getX(t), az = pos.getZ(t), bx = pos.getX(t + 1), bz = pos.getZ(t + 1), cx = pos.getX(t + 2), cz = pos.getZ(t + 2);
    const minX = Math.min(ax, bx, cx), maxX = Math.max(ax, bx, cx), minZ = Math.min(az, bz, cz), maxZ = Math.max(az, bz, cz);
    const near = rings.filter((_, k) => {
      const b = boxes[k]!;
      return maxX >= b.minX && minX <= b.maxX && maxZ >= b.minZ && minZ <= b.maxZ;
    });
    if (!near.length) { copyVertex(t); copyVertex(t + 1); copyVertex(t + 2); continue; }

    let left: ReturnType<typeof clip.difference>;
    try {
      left = clip.difference([[[ax, az], [bx, bz], [cx, cz], [ax, az]]], ...near);
    } catch {
      copyVertex(t); copyVertex(t + 1); copyVertex(t + 2);
      continue;
    }
    changed = true;
    if (!left.length) continue; // wholly under the building

    // Barycentric weights in x/z of the original triangle.
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-12) continue;
    const weights = (x: number, z: number): [number, number, number] => {
      const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
      const w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
      return [w0, w1, 1 - w0 - w1];
    };
    const emit = (x: number, z: number) => {
      const [w0, w1, w2] = weights(x, z);
      out.position.push(x, pos.getY(t) * w0 + pos.getY(t + 1) * w1 + pos.getY(t + 2) * w2, z);
      for (const { name, attr } of others) {
        for (let c = 0; c < attr.itemSize; c++) {
          out[name].push(attr.getComponent(t, c) * w0 + attr.getComponent(t + 1, c) * w1 + attr.getComponent(t + 2, c) * w2);
        }
      }
    };
    // Keep the original winding (faces up).
    const up = det;
    for (const poly of left) {
      const ringsXZ = poly.map(r => {
        const pts = r.map(p => new THREE.Vector2(p[0], p[1]));
        if (pts.length > 1 && pts[0]!.equals(pts[pts.length - 1]!)) pts.pop();
        return pts;
      }).filter(r => r.length >= 3);
      if (!ringsXZ.length) continue;
      const [contour, ...holes] = ringsXZ;
      const all = [...contour!, ...holes.flat()];
      for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour!, holes)) {
        const p = all[i]!, q = all[j]!, r = all[k]!;
        const d = (q.y - r.y) * (p.x - r.x) + (r.x - q.x) * (p.y - r.y);
        if (Math.abs(d) < 1e-10) continue; // a sliver with no area
        const [v1, v2] = (d > 0) === (up > 0) ? [q, r] : [r, q];
        emit(p.x, p.y); emit(v1.x, v1.y); emit(v2.x, v2.y);
      }
    }
  }
  if (!changed) return geometry;

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.position, 3));
  for (const { name, attr } of others) g.setAttribute(name, new THREE.Float32BufferAttribute(out[name], attr.itemSize));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
