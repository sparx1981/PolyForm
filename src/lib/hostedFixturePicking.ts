import * as THREE from 'three';
import type { Shape } from '../types';

/** Let a fixture win a context click when its host wall is the first raycast hit. */
export function pickHostedFixture(
  wallId: string,
  shapes: readonly Shape[],
  camera: THREE.Camera,
  pointer: THREE.Vector2,
  getObject: (id: string) => THREE.Object3D | null,
): string | null {
  const targets = shapes
    .filter(shape => !shape.hidden && shape.hostWallId === wallId && (shape.type === 'door' || shape.type === 'window'))
    .map(shape => getObject(shape.id))
    .filter((object): object is THREE.Object3D => object !== null);
  if (targets.length === 0) return null;

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(targets, true)[0];
  let object: THREE.Object3D | null = hit?.object ?? null;
  while (object && !object.userData.id) object = object.parent;
  return typeof object?.userData.id === 'string' ? object.userData.id : null;
}
