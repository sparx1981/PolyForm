import * as THREE from 'three';
import { ringOrigin, GRASS_FADE_START, GRASS_FADE_END, type GrassField, type GrassRing } from './bladeGrass';

export const GRASS_PATCH_SIDE = 16;
export const GRASS_PATCH_BLADES = GRASS_PATCH_SIDE ** 2;
export const grassPatchCapacity = (ring: GrassRing) => (Math.ceil(ring.cells / GRASS_PATCH_SIDE) + 2) ** 2;

/** Conservative mask query: include linear-filter neighbours so edges never disappear. */
export function grassPatchOccupied(field: GrassField, minX: number, minZ: number, maxX: number, maxZ: number): boolean {
  const { bounds: b, maskWidth: w, maskHeight: h, occupancy } = field;
  if (maxX < b.x || maxZ < b.y || minX > b.x + b.z || minZ > b.y + b.w) return false;
  const x0 = Math.max(0, Math.min(w, Math.floor((minX - b.x) / b.z * w) - 1));
  const z0 = Math.max(0, Math.min(h, Math.floor((minZ - b.y) / b.w * h) - 1));
  const x1 = Math.max(0, Math.min(w, Math.ceil((maxX - b.x) / b.z * w) + 1));
  const z1 = Math.max(0, Math.min(h, Math.ceil((maxZ - b.y) / b.w * h) + 1));
  const stride = w + 1;
  return occupancy[z1*stride+x1] - occupancy[z0*stride+x1] - occupancy[z1*stride+x0] + occupancy[z0*stride+x0] > 0;
}

export interface GrassPatchView {
  camera: THREE.Camera; field: GrassField; ring: GrassRing; finer?: GrassRing;
  centreX: number; centreZ: number; lodOrigin: THREE.Vector3; lodVertical: number; lodBias: number;
  margin: number;
}

/** Reused scratch objects and attribute storage: no per-root CPU work. */
export class GrassPatchBatch {
  readonly origins: THREE.InstancedBufferAttribute;
  private matrix = new THREE.Matrix4();
  private frustum = new THREE.Frustum();
  private box = new THREE.Box3();
  private origin = new THREE.Vector2();
  private count = 0;
  private occupied: Uint8Array;
  private maskWindow: { field: GrassField; ring: GrassRing; startX: number; startZ: number; endX: number; endZ: number } | null = null;
  private lastMatrix = new THREE.Matrix4();
  private previous: GrassPatchView | null = null;
  private lastLod = new THREE.Vector3();
  candidatePatches = 0;
  constructor(capacity: number) {
    this.occupied = new Uint8Array(capacity);
    this.origins = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2, false, GRASS_PATCH_BLADES);
    this.origins.setUsage(THREE.DynamicDrawUsage);
  }
  prepare(view: GrassPatchView): number {
    const { camera, field, ring, finer, lodOrigin: p, lodVertical, lodBias, margin } = view;
    this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const old = this.previous;
    if (old && old.field === field && old.ring === ring && old.finer === finer && this.lastMatrix.equals(this.matrix)
      && old.centreX === view.centreX && old.centreZ === view.centreZ && this.lastLod.equals(p)
      && old.lodVertical === lodVertical && old.lodBias === lodBias && old.margin === margin) return this.count * GRASS_PATCH_BLADES;
    this.lastMatrix.copy(this.matrix); this.lastLod.copy(p);
    this.previous = { ...view };
    this.frustum.setFromProjectionMatrix(this.matrix);
    ringOrigin(ring, view.centreX, view.centreZ, this.origin);
    const startX = Math.floor(Math.round(this.origin.x / ring.spacing) / GRASS_PATCH_SIDE);
    const startZ = Math.floor(Math.round(this.origin.y / ring.spacing) / GRASS_PATCH_SIDE);
    const endX = Math.ceil((Math.round(this.origin.x / ring.spacing) + ring.cells) / GRASS_PATCH_SIDE);
    const endZ = Math.ceil((Math.round(this.origin.y / ring.spacing) + ring.cells) / GRASS_PATCH_SIDE);
    const size = GRASS_PATCH_SIDE * ring.spacing;
    const dyMin = lodVertical ? Math.max(field.minY - p.y, 0, p.y - field.maxY) : 0;
    const dyMax = lodVertical ? Math.max(Math.abs(field.minY - p.y), Math.abs(field.maxY - p.y)) : 0;
    const window = this.maskWindow;
    if (!window || window.field !== field || window.ring !== ring || window.startX !== startX || window.startZ !== startZ || window.endX !== endX || window.endZ !== endZ) {
      this.maskWindow = { field, ring, startX, startZ, endX, endZ };
      let i = 0;
      for (let z = startZ; z < endZ; z++) for (let x = startX; x < endX; x++)
        this.occupied[i++] = grassPatchOccupied(field,x*size,z*size,(x+1)*size,(z+1)*size) ? 1 : 0;
    }
    const outer = ring.radius * GRASS_FADE_END - lodBias, inner = (ring.fadeInRadius ?? finer?.radius) !== undefined ? (ring.fadeInRadius ?? finer!.radius) * GRASS_FADE_START - lodBias : -1;
    let count = 0, changed = false, maskIndex = 0;
    this.candidatePatches = (endX - startX) * (endZ - startZ);
    for (let z = startZ; z < endZ; z++) for (let x = startX; x < endX; x++) {
      const minX = x * size, minZ = z * size, maxX = minX + size, maxZ = minZ + size;
      if (!this.occupied[maskIndex++]) continue;
      const dxMin = Math.max(minX - p.x, 0, p.x - maxX), dzMin = Math.max(minZ - p.z, 0, p.z - maxZ);
      if (outer <= 0 || dxMin*dxMin + dyMin*dyMin + dzMin*dzMin >= outer*outer) continue;
      const dxMax = Math.max(Math.abs(minX - p.x), Math.abs(maxX - p.x));
      const dzMax = Math.max(Math.abs(minZ - p.z), Math.abs(maxZ - p.z));
      if (inner >= 0 && dxMax*dxMax + dyMax*dyMax + dzMax*dzMax <= inner*inner) continue;
      this.box.min.set(minX-margin,field.minY-margin,minZ-margin);
      this.box.max.set(maxX+margin,field.maxY+margin,maxZ+margin);
      if (!this.frustum.intersectsBox(this.box)) continue;
      if (count >= this.origins.count) throw new Error('Grass patch capacity exceeded');
      const cellX = x * GRASS_PATCH_SIDE, cellZ = z * GRASS_PATCH_SIDE;
      if (this.origins.getX(count) !== cellX || this.origins.getY(count) !== cellZ) {
        this.origins.setXY(count,cellX,cellZ); changed = true;
      }
      count++;
    }
    if (changed) this.origins.needsUpdate = true;
    this.count = count;
    return count * GRASS_PATCH_BLADES;
  }
  get visiblePatches() { return this.count; }
}
