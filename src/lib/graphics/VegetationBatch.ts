import * as THREE from 'three';
import { VegetationWind, isFoliageMaterial } from './VegetationWind';
import { finite } from './shaderHooks';

export interface PlantInstance {
  id: string;
  position: THREE.Vector3;
  rotation?: THREE.Quaternion;
  scale?: THREE.Vector3;
  color?: THREE.Color;
}

/** One geometry/material pair per spatial cell. Caller owns source assets and clock. */
export class VegetationBatch {
  readonly mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private ids: string[] = [];
  private cleanup: () => void;
  private maxScale = 1;
  private readonly matrix = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly white = new THREE.Color('white');

  constructor(geometry: THREE.BufferGeometry, material: THREE.MeshStandardMaterial,
    readonly wind: VegetationWind, readonly capacity = 2048, readonly maxWindStrength = wind.maxStrength) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('capacity must be a positive integer');
    finite(maxWindStrength, 'maxWindStrength', 0);
    if (maxWindStrength < wind.maxStrength) throw new RangeError('Batch bounds must cover wind.maxStrength');
    // Only materials need private shader hooks. Geometry is immutable and shared across cells.
    this.mesh = new THREE.InstancedMesh(geometry, material.clone(), capacity);
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    if (!this.mesh.geometry.boundingBox) this.mesh.geometry.computeBoundingBox();
    const box = this.mesh.geometry.boundingBox!;
    this.cleanup = wind.attachMesh(this.mesh, box.min.y, Math.max(0.001, box.max.y - box.min.y), false);
    this.mesh.frustumCulled = true;
  }

  init(parent: THREE.Object3D) { parent.add(this.mesh); return this; }

  /** O(n) only when placements change; instanceId from raycasting maps to idAt(). */
  setInstances(instances: readonly PlantInstance[]) {
    if (instances.length > this.capacity) throw new RangeError('Vegetation batch capacity exceeded');
    const seen = new Set<string>();
    for (const plant of instances) {
      if (seen.has(plant.id)) throw new Error(`Duplicate plant id: ${plant.id}`);
      seen.add(plant.id);
      for (const v of plant.position.toArray()) finite(v, 'position');
      for (const v of (plant.scale ?? this.scale).toArray()) finite(v, 'scale', 0.0001);
      if (plant.rotation) {
        for (const v of plant.rotation.toArray()) finite(v, 'rotation');
        if (plant.rotation.lengthSq() < 1e-10) throw new RangeError('rotation must be nonzero');
      }
    }
    this.maxScale = 1;
    this.ids = instances.map((plant, i) => {
      const scale = plant.scale ?? this.scale;
      this.maxScale = Math.max(this.maxScale, scale.x, scale.y, scale.z);
      if (plant.rotation) this.rotation.copy(plant.rotation).normalize(); else this.rotation.identity();
      this.matrix.compose(plant.position, this.rotation, scale);
      this.mesh.setMatrixAt(i, this.matrix);
      this.mesh.setColorAt(i, plant.color ?? this.white);
      return plant.id;
    });
    this.mesh.count = instances.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.computeBoundingBox(); this.mesh.computeBoundingSphere();
    const padding = VegetationWind.padding(this.maxWindStrength, isFoliageMaterial(this.mesh.material)) * this.maxScale;
    this.mesh.boundingBox?.expandByScalar(padding);
    if (this.mesh.boundingSphere) this.mesh.boundingSphere.radius += padding;
    this.mesh.visible = instances.length > 0;
  }

  idAt(instanceId: number) { return this.ids[instanceId]; }
  /** Update the shared wind once per frame, not once per batch. */
  dispose() {
    this.mesh.removeFromParent(); this.cleanup(); this.mesh.dispose();
    this.mesh.material.dispose();
  }
}
