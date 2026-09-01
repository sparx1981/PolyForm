import * as THREE from 'three';

export type SnapKind = 'endpoint' | 'midpoint' | 'edge' | 'face-center' | 'origin';

export interface SnapCandidate {
  point: THREE.Vector3;
  kind: SnapKind;
  screenDistance: number;
  sourceEntityId?: string;
}

export interface AcquiredReference {
  point: THREE.Vector3;
  kind: SnapKind;
  acquiredAt: number;
}

export interface TrackingGuide {
  sourcePoint: THREE.Vector3;
  direction: THREE.Vector3;
  color: string;
  projectedPoint: THREE.Vector3;
  guideSegment: [THREE.Vector3, THREE.Vector3];
  label: string;
}

export interface InferenceResult {
  rawPoint: THREE.Vector3;
  snappedPoint: THREE.Vector3;
  activeReference: AcquiredReference | null;
  activeGuide: TrackingGuide | null;
  isLocked: boolean;
}

export interface InferenceSettings {
  hoverDwellMs: number;
  snapTolerancePx: number;
  orthoTrackingAngleToleranceRad: number;
}

export type WallJustification = 'exterior' | 'center' | 'interior';

export interface WallSegment {
  id: string;
  startPoint: [number, number, number];
  endPoint: [number, number, number];
  thickness: number;
  height: number;
  justification?: WallJustification;
  hostWallId?: string;
  story?: number;
}

export interface WallToolSettings {
  defaultExteriorThickness: number;   // 0.20 m
  defaultInteriorThickness: number;   // 0.10 m
  defaultWallHeight: number;          // 2.40 m
  defaultSlabThickness: number;       // 0.20 m
  terrainExcavationApron: number;     // 0.50 m
  inferenceHoverDwellMs: number;      // 500 ms (range: 200–1200 ms)
  enablePulsingReticle: boolean;      // true
  autoMiterJunctions: boolean;        // true
  thickness?: number;
  height?: number;
  justification?: WallJustification;
}

export const DEFAULT_WALL_SETTINGS: WallToolSettings = {
  defaultExteriorThickness: 0.20,
  defaultInteriorThickness: 0.10,
  defaultWallHeight: 2.40,
  defaultSlabThickness: 0.20,
  terrainExcavationApron: 0.50,
  inferenceHoverDwellMs: 500,
  enablePulsingReticle: true,
  autoMiterJunctions: true,
  thickness: 0.20,
  height: 2.80,
  justification: 'exterior',
};
