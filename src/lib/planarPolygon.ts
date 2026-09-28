import * as THREE from 'three';

// Flat-polygon checks shared by the Polygon and Bézier tools and sdk.drawing.

/** True when a closed polygon's edges cross each other (neighbouring edges excepted). */
export const checkSelfIntersection = (points: THREE.Vector2[]): boolean => {
  const n = points.length;
  if (n < 4) return false;
  
  const intersect = (p1: THREE.Vector2, p2: THREE.Vector2, p3: THREE.Vector2, p4: THREE.Vector2) => {
    const denominator = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
    if (denominator === 0) return false;
    let ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denominator;
    let ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denominator;
    return (ua >= 0 && ua <= 1) && (ub >= 0 && ub <= 1);
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (intersect(points[i]!, points[(i + 1) % n]!, points[j]!, points[(j + 1) % n]!)) return true;
    }
  }
  return false;
};

/** Points in 3D, flattened into 2D coordinates on the plane through `origin` with `normal`. */
export const projectToPlane = (vertices: THREE.Vector3[], origin: THREE.Vector3, normal: THREE.Vector3): THREE.Vector2[] => {
  const up = new THREE.Vector3(0, 1, 0);
  if (Math.abs(normal.dot(up)) > 0.99) up.set(0, 0, 1);
  const tangent = new THREE.Vector3().crossVectors(normal, up).normalize();
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
  
  return vertices.map(v => {
    const diff = v.clone().sub(origin);
    return new THREE.Vector2(diff.dot(tangent), diff.dot(bitangent));
  });
};
