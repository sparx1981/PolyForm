import * as THREE from 'three';
import { finite, inject, patchMaterial } from './shaderHooks';

/** GPU vertex displacement for Standard/Physical materials. Use a matching normal map
 * for fine detail and a modestly subdivided mesh for silhouette/shadow depth. */
export class SurfaceDepth {
  private readonly uniforms;
  private cleanup: (() => void) | undefined;

  constructor(readonly heightMap: THREE.Texture, scale = 0.035, bias = -0.0175,
    readonly maxDisplacement = 0.1) {
    finite(maxDisplacement, 'maxDisplacement', 0);
    if (heightMap.colorSpace !== THREE.NoColorSpace) throw new Error('Height maps must use NoColorSpace.');
    this.uniforms = { pfDepthScale: { value: scale }, pfDepthBias: { value: bias } };
    this.configure(scale, bias);
  }

  configure(scale: number, bias: number) {
    finite(scale, 'depth scale'); finite(bias, 'depth bias');
    if (Math.max(Math.abs(bias), Math.abs(scale + bias)) > this.maxDisplacement)
      throw new RangeError('Depth exceeds maxDisplacement bounding budget');
    this.uniforms.pfDepthScale.value = scale; this.uniforms.pfDepthBias.value = bias;
  }

  /** Material(s) must be private to this mesh. Works with Physical (a Standard subclass).
   * A material array (per-face-group meshes, e.g. a box with a different material per
   * side) gets the same height field patched into every entry, so the whole object
   * shares one coherent relief even though face colors differ. Attach after wind if
   * combining effects. Dispose before disposing the mesh. */
  init(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[]>) {
    if (this.cleanup) throw new Error('SurfaceDepth is already attached');
    if (!mesh.geometry.hasAttribute('uv') || !mesh.geometry.hasAttribute('normal'))
      throw new Error('SurfaceDepth requires UVs and normals');
    const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (sourceMaterials.length === 0) throw new Error('SurfaceDepth requires at least one material');
    const primary = sourceMaterials[0];
    const previousDepth = mesh.customDepthMaterial;
    const previousDistance = mesh.customDistanceMaterial;
    const depth = previousDepth ?? new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    const distance = previousDistance ?? new THREE.MeshDistanceMaterial();
    if (!(depth instanceof THREE.MeshDepthMaterial) || !(distance instanceof THREE.MeshDistanceMaterial))
      throw new Error('SurfaceDepth requires standard depth/distance shadow materials');
    const materials = [...sourceMaterials, depth, distance];
    const saved = materials.map(mat => ({ displacementMap: mat.displacementMap,
      displacementScale: mat.displacementScale, displacementBias: mat.displacementBias,
      map: mat.map, alphaMap: mat.alphaMap, alphaTest: mat.alphaTest, side: mat.side }));
    const undo = materials.map(mat => {
      mat.displacementMap = this.heightMap;
      mat.displacementScale = 1; mat.displacementBias = 0;
      return patchMaterial(mat, { key: 'pf-depth-v1', apply: shader => {
        Object.assign(shader.uniforms, this.uniforms);
        shader.vertexShader = 'uniform float pfDepthScale;\nuniform float pfDepthBias;\nattribute float pfEdgeFade;\n' + shader.vertexShader;
        shader.vertexShader = inject(shader.vertexShader, '#include <displacementmap_vertex>', `
          #ifdef USE_DISPLACEMENTMAP
            float pfHeight = clamp(texture2D(displacementMap, vDisplacementMapUv).r, 0.0, 1.0);
            transformed += normalize(objectNormal) * (pfHeight * pfDepthScale + pfDepthBias) * pfEdgeFade;
          #endif
        `);
      } });
    });
    // The depth/distance shadow proxies are single materials for the whole mesh, so they
    // can only mirror one face's map/alphaTest/side; the primary (first) material stands
    // in for the group. This only affects alpha-cutout shadows on a multi-material mesh.
    for (const shadow of [depth, distance]) {
      shadow.map = primary.map; shadow.alphaMap = primary.alphaMap;
      shadow.alphaTest = primary.alphaTest; shadow.side = primary.side;
    }
    mesh.customDepthMaterial = depth; mesh.customDistanceMaterial = distance;
    // Preserve geometry ownership; update CPU culling bounds once, never vertex positions.
    const originalGeometry = mesh.geometry;
    const geometry = originalGeometry.clone();
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    geometry.boundingBox!.expandByScalar(this.maxDisplacement);
    geometry.boundingSphere!.radius += this.maxDisplacement;
    mesh.geometry = geometry;
    const instanced = mesh instanceof THREE.InstancedMesh ? mesh : null;
    const oldBox = instanced?.boundingBox?.clone() ?? null;
    const oldSphere = instanced?.boundingSphere?.clone() ?? null;
    if (instanced) {
      // Retain any existing wind padding; per-instance transforms are read only at init.
      let maxScale = 1;
      const transform = new THREE.Matrix4();
      for (let i = 0; i < instanced.count; i++) {
        instanced.getMatrixAt(i, transform); maxScale = Math.max(maxScale, transform.getMaxScaleOnAxis());
      }
      if (!instanced.boundingBox) instanced.computeBoundingBox();
      if (!instanced.boundingSphere) instanced.computeBoundingSphere();
      instanced.boundingBox?.expandByScalar(this.maxDisplacement * maxScale);
      if (instanced.boundingSphere) instanced.boundingSphere.radius += this.maxDisplacement * maxScale;
    }
    this.cleanup = () => {
      undo.forEach(fn => fn());
      materials.forEach((mat, i) => Object.assign(mat, saved[i]));
      mesh.customDepthMaterial = previousDepth; mesh.customDistanceMaterial = previousDistance;
      if (!previousDepth) depth.dispose(); if (!previousDistance) distance.dispose();
      mesh.geometry = originalGeometry; geometry.dispose();
      if (instanced) { instanced.boundingBox = oldBox; instanced.boundingSphere = oldSphere; }
    };
    return this;
  }

  dispose() { this.cleanup?.(); this.cleanup = undefined; }
}
