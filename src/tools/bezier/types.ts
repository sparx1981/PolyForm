import * as THREE from 'three';

export type HandleMode = 'mirrored' | 'broken' | 'none';

export interface BezierKnot {
  point: THREE.Vector3;
  handleIn: THREE.Vector3 | null;
  handleOut: THREE.Vector3 | null;
  mode: HandleMode;
}

export interface BezierCurveState {
  knots: BezierKnot[];
  segmentsPerSpan: number; // Default 24
  isClosed: boolean;
  activePlane: THREE.Plane | null;
}
