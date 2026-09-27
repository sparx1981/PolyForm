import * as THREE from 'three';

/**
 * The geometry with each triangle kept once: a double-sided mesh stores every triangle a
 * second time facing the other way, and edge detection pairs each triangle with its own back
 * copy (a 180 degree fold), drawing a line along every triangle edge. For edge lines only.
 */
export function singleSidedGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = source.getAttribute('position');
  if (!pos) return geometry;
  const key = (i: number) => `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
  const seen = new Set<string>();
  const out: number[] = [];
  for (let i = 0; i + 2 < pos.count; i += 3) {
    const k = [key(i), key(i + 1), key(i + 2)].sort().join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    for (let j = i; j < i + 3; j++) out.push(pos.getX(j), pos.getY(j), pos.getZ(j));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return g;
}
