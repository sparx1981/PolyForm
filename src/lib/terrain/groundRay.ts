import * as THREE from 'three';

/**
 * Where a ray first meets the ground described by `groundAt(x, z)`, marched against the height
 * field (so it is exact under the cursor on slopes and ignores objects standing on the ground).
 * Falls back to the y = 0 plane when the ray never reaches the ground within `maxDistance`.
 */
export function groundUnderRay(ray: THREE.Ray, groundAt: (x: number, z: number) => number, maxDistance = 5000): THREE.Vector3 | null {
  const at = new THREE.Vector3();
  const above = (t: number) => { ray.at(t, at); return at.y - groundAt(at.x, at.z); };
  if (above(0) <= 0) return at.setY(groundAt(at.x, at.z));
  let previous = 0;
  for (let t = 0.25; t < maxDistance; t += Math.max(0.25, t * 0.02)) {
    if (above(t) <= 0) {
      let lo = previous, hi = t;
      for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (above(mid) > 0) lo = mid; else hi = mid; }
      ray.at(hi, at);
      return at.setY(groundAt(at.x, at.z));
    }
    previous = t;
  }
  return ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
}
