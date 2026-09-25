import * as THREE from 'three';
import { PLANT_SPECIES_CATALOG } from '../plantLibrary';
import { createTreeGeometry, createBushGeometry, createRockGeometry } from '../landscapeGeometry';
import { loadPlantGLTF, loadPlantFBX, loadPlantUSD, getCachedPlantTexture } from '../plantModelLoader';
import { treeLodUrl, type TreeDetail } from './treeLod';

export interface PlantPrimitive { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }
export function plantTint(speciesId: string, color: string): THREE.Color {
  const species = PLANT_SPECIES_CATALOG.find(item => item.id === speciesId);
  return new THREE.Color(color !== species?.foliageColor && /^(?:#[\da-f]{3}|#[\da-f]{6})$/i.test(color) ? color : '#ffffff');
}
/**
 * KHR_mesh_quantization-compressed geometry (used by the decimated material library catalog's
 * EXT_meshopt_compression) stores POSITION/NORMAL as normalized integers - BufferAttribute.setXYZ
 * on a `normalized` attribute re-quantizes the value it's given back into that integer's range.
 * applyMatrix4 below bakes each node's own real-world scale/translation (its dequantization
 * transform) directly into the geometry, producing values far outside [-1,1] - writing those back
 * through the normalized setter clamps them straight back onto the unit cube, collapsing the mesh
 * onto its own bounding-box faces (confirmed: every material library tree rendered as a flat black
 * "spiky building" - literally the clamped geometry - until this ran first). Converting to plain
 * float attributes first makes applyMatrix4 write real coordinates instead of re-quantizing them.
 */
export function dequantizeAttributes(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(geometry.attributes)) {
    const attribute = geometry.attributes[name] as THREE.BufferAttribute;
    if (!attribute.normalized) continue;
    const itemSize = attribute.itemSize;
    const array = new Float32Array(attribute.count * itemSize);
    for (let i = 0; i < attribute.count; i++) {
      for (let component = 0; component < itemSize; component++) array[i * itemSize + component] = attribute.getComponent(i, component);
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize, false));
  }
  return geometry;
}
/** A single-material Mesh ignores geometry groups, so restrict the actual index. */
export function isolateMaterialGroup(geometry: THREE.BufferGeometry, materialIndex: number): boolean {
  const groups = geometry.groups.filter(group => group.materialIndex === materialIndex);
  if (!groups.length) return false;
  const indices: number[] = [], source = geometry.index;
  const count = source?.count ?? geometry.getAttribute('position').count;
  for (const group of groups) for (let i = group.start; i < Math.min(count, group.start + group.count); i++)
    indices.push(source ? source.getX(i) : i);
  geometry.setIndex(indices); geometry.clearGroups();
  return indices.length > 0;
}
// Cached templates own their geometry/materials for the application lifetime. Instances
// clone materials; shared textures and geometry are never disposed by consumers.
const templates = new Map<string, Promise<PlantPrimitive[]>>();
const fallbacks = new Map<string, PlantPrimitive[]>();
export function proceduralPlantPrimitives(speciesId: string): PlantPrimitive[] {
  if (!fallbacks.has(speciesId)) {
    const species = PLANT_SPECIES_CATALOG.find(item => item.id === speciesId);
    const geometry = species?.category === 'rock' ? createRockGeometry(species.defaultSpread)
      : species?.category === 'tree' ? createTreeGeometry(speciesId) : createBushGeometry(speciesId);
    const material = species?.category === 'rock'
      ? new THREE.MeshStandardMaterial({ color: species.foliageColor, roughness: 0.9, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
    fallbacks.set(speciesId, [{ geometry, material }]);
  }
  return fallbacks.get(speciesId)!;
}
export function loadPlantPrimitives(speciesId: string, variation?: string, detail: TreeDetail = 0): Promise<PlantPrimitive[]> {
  const species = PLANT_SPECIES_CATALOG.find(item => item.id === speciesId);
  const chosen = variation || species?.variations?.[0] || '';
  const lodUrl = treeLodUrl(speciesId, detail);
  const key = `${speciesId}/${chosen}/${lodUrl ?? 'original'}`;
  if (templates.has(key)) return templates.get(key)!;
  const procedural = () => proceduralPlantPrimitives(speciesId);
  const promise = !species || species.modelType === 'procedural' ? Promise.resolve(procedural()) : new Promise<THREE.Group>((resolve, reject) => {
    if (species.modelType === 'gltf' && species.modelUrl) {
      // GLTFLoader resolves the .gltf's own internal relative URIs (its .bin, its textures) by
      // appending them to the .gltf's own URL - which doesn't reliably match a remote host's
      // actual file layout (confirmed against the material library). `modelIncludes` gives the real URL
      // for each relative path directly from the source API, so remap by the URL GLTFLoader
      // will actually request (that relative path resolved against modelUrl) to the real one.
      const urlRemap = species.modelIncludes && Object.fromEntries(
        Object.entries(species.modelIncludes).map(([relativePath, realUrl]) => [new URL(relativePath, species.modelUrl).href, realUrl])
      );
      loadPlantGLTF(lodUrl ?? species.modelUrl, resolve, reject, lodUrl ? undefined : urlRemap);
    }
    else if (species.modelType === 'gltf') loadPlantGLTF(`${species.modelPath}${chosen.toLowerCase()}.glb`, resolve, reject);
    else if (species.modelType === 'fbx') loadPlantFBX(`${species.modelPath}${chosen}_LOD0.fbx`, resolve, reject);
    else loadPlantUSD(`${species.modelPath}${chosen}.usd`, resolve, reject);
  }).then(root => {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const factor = species.defaultHeight / Math.max(0.001, box.max.y - box.min.y);
    const normalize = new THREE.Matrix4().makeTranslation(0, -box.min.y * factor, 0)
      .multiply(new THREE.Matrix4().makeScale(factor, factor, factor));
    const result: PlantPrimitive[] = [];
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh) || (object as THREE.SkinnedMesh).isSkinnedMesh) return;
      const originals = Array.isArray(object.material) ? object.material : [object.material];
      originals.forEach((original, index) => {
        const geometry = dequantizeAttributes(object.geometry.clone()).applyMatrix4(new THREE.Matrix4().multiplyMatrices(normalize, object.matrixWorld));
        if (originals.length > 1) {
          if (!isolateMaterialGroup(geometry, index)) { geometry.dispose(); return; }
        }
        const material = original instanceof THREE.MeshStandardMaterial ? original.clone()
          : new THREE.MeshStandardMaterial({ color: species.foliageColor, roughness: 0.75, side: THREE.DoubleSide });
        if (species.modelType === 'fbx' && species.texturePath) {
          const base = species.texturePath;
          material.map = getCachedPlantTexture(`${base}BaseColor.jpg`);
          material.alphaMap = getCachedPlantTexture(`${base}Opacity.jpg`, false);
          material.normalMap = getCachedPlantTexture(`${base}Normal.jpg`, false);
          material.roughnessMap = getCachedPlantTexture(`${base}Roughness.jpg`, false);
          material.aoMap = getCachedPlantTexture(`${base}AO.jpg`, false);
          geometry.deleteAttribute('color'); material.vertexColors = false; material.alphaTest = 0.25;
        }
        if (material.alphaMap || material.alphaTest > 0) { material.transparent = false; material.alphaTest = Math.max(0.25, material.alphaTest); }
        material.side = THREE.DoubleSide;
        result.push({ geometry, material });
      });
    });
    if (!result.length) return procedural();
    return result;
  }).catch(error => { console.warn('[Vegetation] Using procedural fallback', speciesId, error); return procedural(); });
  templates.set(key, promise); return promise;
}
