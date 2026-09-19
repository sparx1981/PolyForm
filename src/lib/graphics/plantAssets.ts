import * as THREE from 'three';
import { PLANT_SPECIES_CATALOG } from '../plantLibrary';
import { createTreeGeometry, createBushGeometry } from '../landscapeGeometry';
import { loadPlantGLTF, loadPlantFBX, loadPlantUSD, getCachedPlantTexture } from '../plantModelLoader';

export interface PlantPrimitive { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }
export function plantTint(speciesId: string, color: string): THREE.Color {
  const species = PLANT_SPECIES_CATALOG.find(item => item.id === speciesId);
  return new THREE.Color(color !== species?.foliageColor && /^(?:#[\da-f]{3}|#[\da-f]{6})$/i.test(color) ? color : '#ffffff');
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
// clone materials and batches clone both; shared textures are never disposed by consumers.
const templates = new Map<string, Promise<PlantPrimitive[]>>();
const fallbacks = new Map<string, PlantPrimitive[]>();
export function proceduralPlantPrimitives(speciesId: string): PlantPrimitive[] {
  if (!fallbacks.has(speciesId)) {
    const species = PLANT_SPECIES_CATALOG.find(item => item.id === speciesId);
    fallbacks.set(speciesId, [{ geometry: species?.category === 'tree' ? createTreeGeometry(speciesId) : createBushGeometry(speciesId),
      material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide }) }]);
  }
  return fallbacks.get(speciesId)!;
}
export function loadPlantPrimitives(speciesId: string, variation?: string): Promise<PlantPrimitive[]> {
  const species = PLANT_SPECIES_CATALOG.find(item => item.id === speciesId);
  const chosen = variation || species?.variations?.[0] || '';
  const key = `${speciesId}/${chosen}`;
  if (templates.has(key)) return templates.get(key)!;
  const procedural = () => proceduralPlantPrimitives(speciesId);
  const promise = !species || species.modelType === 'procedural' ? Promise.resolve(procedural()) : new Promise<THREE.Group>((resolve, reject) => {
    if (species.modelType === 'gltf') loadPlantGLTF(`${species.modelPath}${chosen.toLowerCase()}.glb`, resolve, reject);
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
        const geometry = object.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(normalize, object.matrixWorld));
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
