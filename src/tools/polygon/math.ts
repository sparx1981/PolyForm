import * as THREE from 'three';

export const MIN_POLYGON_RADIUS = 1e-5;

/**
 * Why generatePolygonVertices returned no vertices for this input, so a
 * caller can tell "the radius drag hasn't moved far enough from the
 * center yet" apart from "sides is configured below the minimum of 3" —
 * generatePolygonVertices itself returns an empty array for both, which
 * looks identical to a caller with no way to distinguish them.
 */
export function getPolygonVertexIssue(
  center: THREE.Vector3,
  radiusPoint: THREE.Vector3,
  sides: number
): 'too-few-sides' | 'radius-too-small' | null {
  if (sides < 3) return 'too-few-sides';
  if (center.distanceTo(radiusPoint) < MIN_POLYGON_RADIUS) return 'radius-too-small';
  return null;
}

/**
 * Generates the vertices for a circumscribed regular polygon.
 */
export function generatePolygonVertices(
  center: THREE.Vector3,
  radiusPoint: THREE.Vector3,
  sides: number,
  plane: THREE.Plane
): THREE.Vector3[] {
  if (sides < 3) return [];

  const radius = center.distanceTo(radiusPoint);
  if (radius < MIN_POLYGON_RADIUS) return [];

  const localX = new THREE.Vector3().subVectors(radiusPoint, center).normalize();
  const normal = plane.normal.clone().normalize();
  const localY = new THREE.Vector3().crossVectors(normal, localX).normalize();

  const vertices: THREE.Vector3[] = [];
  const angleStep = (Math.PI * 2) / sides;

  for (let i = 0; i < sides; i++) {
    const angle = i * angleStep;
    const cosA = Math.cos(angle) * radius;
    const sinA = Math.sin(angle) * radius;

    const vertex = center.clone()
      .add(localX.clone().multiplyScalar(cosA))
      .add(localY.clone().multiplyScalar(sinA));
      
    vertices.push(vertex);
  }

  vertices.push(vertices[0]!.clone()); // Close the loop — sides >= 3 guarantees at least one element above
  
  return vertices;
}
