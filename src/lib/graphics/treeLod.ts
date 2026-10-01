import * as THREE from 'three';
import { PLANT_SPECIES_CATALOG } from '../plantLibrary';
import catalog from './polyhavenModelCatalog.json';

export type TreeDetail = 0 | 1 | 2 | 3;

const lodUrls = new Map<string, [string, string]>(
  (catalog.assets as { sourceId: string; lodUrls?: [string, string] }[])
    .filter(asset => asset.lodUrls?.length === 2)
    .map(asset => [`ph_${asset.sourceId}`, asset.lodUrls!]),
);

export function hasTreeLod(speciesId: string) { return lodUrls.has(speciesId); }
export function treeLodUrl(speciesId: string, detail: TreeDetail): string | undefined {
  return detail && detail < 3 ? lodUrls.get(speciesId)?.[detail - 1] : undefined;
}

/** Approximate projected height in screen pixels, including orthographic cameras. */
export function treeScreenHeight(camera: THREE.Camera, viewportHeight: number, position: THREE.Vector3, height: number): number {
  if (camera instanceof THREE.OrthographicCamera) {
    return height * viewportHeight * camera.zoom / (camera.top - camera.bottom);
  }
  if (camera instanceof THREE.PerspectiveCamera) {
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const depth = Math.max(0.01, position.clone().sub(camera.position).dot(forward));
    return height * viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * depth);
  }
  return Infinity;
}

/** Hysteresis prevents a tree from swapping assets at every small camera movement. */
export function chooseTreeDetail(pixels: number, previous: TreeDetail = 0, allowImpostor = false): TreeDetail {
  if (allowImpostor && pixels < 32) return 3;
  if (previous === 3) previous = 2;
  if (previous === 0) return pixels < 50 ? 2 : pixels < 150 ? 1 : 0;
  if (previous === 1) return pixels < 50 ? 2 : pixels > 190 ? 0 : 1;
  return pixels > 190 ? 0 : pixels > 68 ? 1 : 2;
}

export function treeHeight(speciesId: string, scaleY = 1): number {
  return (PLANT_SPECIES_CATALOG.find(species => species.id === speciesId)?.defaultHeight ?? 4) * scaleY;
}

/** Horizontal atlas captures are unsuitable for plan views or steep camera elevations. */
export function treeImpostorView(camera: THREE.Camera,position: THREE.Vector3): boolean {
  if (!(camera instanceof THREE.PerspectiveCamera)) return false;
  const dx=camera.position.x-position.x,dz=camera.position.z-position.z;
  return Math.abs(camera.position.y-position.y) < Math.hypot(dx,dz)*0.3;
}
