import * as THREE from 'three';

export const PATH_QUALITY = {
  preview: { label: 'Preview', bounces: 4, transmissiveBounces: 6, textureSize: 512 },
  balanced: { label: 'Balanced', bounces: 8, transmissiveBounces: 12, textureSize: 1024 },
  refined: { label: 'Refined', bounces: 12, transmissiveBounces: 20, textureSize: 1024 },
} as const;
export type PathQuality = keyof typeof PATH_QUALITY;

/** Preserve the frozen projection, including portrait and split-view cameras. Bound GPU allocation. */
export function qualityRenderSize(camera: THREE.Camera, longestSide: number) {
  const side = [512, 1024, 2048].includes(longestSide) ? longestSide : 1024;
  const ratio = Math.abs(camera.projectionMatrix.elements[5] / camera.projectionMatrix.elements[0]);
  const aspect = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  return { width: Math.max(1, Math.round(side * Math.min(1, aspect))), height: Math.max(1, Math.round(side / Math.max(1, aspect))) };
}
