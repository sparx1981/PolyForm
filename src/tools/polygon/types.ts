import * as THREE from 'three';

export interface PolygonState {
  center: THREE.Vector3 | null;
  radiusPoint: THREE.Vector3 | null;
  sides: number;         // Default 6, Min 3, Max 128
  activePlane: THREE.Plane | null;
  isCommitted: boolean;
}
