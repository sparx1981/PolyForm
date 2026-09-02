import * as THREE from 'three';

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
  if (radius < 1e-5) return [];

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

  vertices.push(vertices[0].clone()); // Close the loop
  
  return vertices;
}
