import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { VegetationBatch, VegetationWind, SurfaceDepth, WeatherSystem } from './index';
import { patchMaterial, type Shader } from './shaderHooks';
import { createTreeGeometry, createBushGeometry } from '../landscapeGeometry';
import { PLANT_SPECIES_CATALOG } from '../plantLibrary';

function compile(material: THREE.Material, name: 'standard' | 'physical' | 'depth' | 'distance' = 'standard') {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib[name].vertexShader,
    fragmentShader: THREE.ShaderLib[name].fragmentShader } as Shader;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

describe('vegetation GPU lifecycle', () => {
  it('chains hooks, shares time with both shadows, and cleans up out of order', () => {
    const wind = new VegetationWind();
    const material = new THREE.MeshStandardMaterial();
    const previous = vi.fn(); material.onBeforeCompile = previous;
    const undoOther = patchMaterial(material, { key: 'other', apply: s => { s.uniforms.other = { value: 1 }; } });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
    const cleanup = wind.attachMesh(mesh);
    const surface = compile(material);
    const shadow = compile(mesh.customDepthMaterial!, 'depth');
    const pointShadow = compile(mesh.customDistanceMaterial!, 'distance');
    wind.update(0.5);
    expect(previous).toHaveBeenCalledOnce();
    for (const shader of [surface, shadow, pointShadow]) expect(shader.uniforms.pfWindTime.value).toBe(0.5);
    undoOther(); expect(compile(material).uniforms.other).toBeUndefined();
    cleanup(); expect(compile(material).uniforms.pfWindTime).toBeUndefined();
    expect(mesh.customDepthMaterial).toBeUndefined(); expect(mesh.frustumCulled).toBe(true);
    material.dispose(); mesh.geometry.dispose();
  });

  it('handles capacity, duplicate ids, conservative bounds and immutable frame data', () => {
    const geometry = new THREE.BoxGeometry(1, 4, 1); geometry.translate(0, 2, 0);
    const material = new THREE.MeshStandardMaterial();
    const wind = new VegetationWind();
    const batch = new VegetationBatch(geometry, material, wind, 2);
    const plants = [{ id: 'a', position: new THREE.Vector3(100, 0, 0), scale: new THREE.Vector3(2, 3, 2) },
      { id: 'b', position: new THREE.Vector3(-10, 0, 0) }];
    batch.setInstances(plants);
    expect(batch.idAt(1)).toBe('b');
    expect(batch.mesh.boundingBox!.max.x).toBeGreaterThan(101);
    const version = batch.mesh.instanceMatrix.version;
    wind.update(1); expect(batch.mesh.instanceMatrix.version).toBe(version);
    expect(() => batch.setInstances([...plants, plants[0]])).toThrow(/capacity/);
    expect(() => batch.setInstances([plants[0], plants[0]])).toThrow(/Duplicate/);
    expect(() => wind.configure({ strength: 10 })).toThrow(/budget/);
    batch.setInstances([]); expect(batch.mesh.visible).toBe(false);
    batch.dispose(); expect(geometry.attributes.position.count).toBeGreaterThan(0);
    geometry.dispose(); material.dispose();
  });
});

describe('surface depth', () => {
  it('composes wind and displacement on instances without losing culling padding', () => {
    const geometry = new THREE.BoxGeometry(1, 4, 1);
    const material = new THREE.MeshStandardMaterial();
    const wind = new VegetationWind();
    const batch = new VegetationBatch(geometry, material, wind, 1);
    batch.setInstances([{ id: 'a', position: new THREE.Vector3(), scale: new THREE.Vector3(3, 3, 3) }]);
    const radius = batch.mesh.boundingSphere!.radius;
    const texture = new THREE.Texture();
    const depth = new SurfaceDepth(texture).init(batch.mesh);
    expect(batch.mesh.boundingSphere!.radius).toBeCloseTo(radius + 0.3);
    for (const [mat, kind] of [[batch.mesh.material, 'standard'], [batch.mesh.customDepthMaterial!, 'depth'],
      [batch.mesh.customDistanceMaterial!, 'distance']] as const) {
      const shader = compile(mat, kind);
      expect(shader.uniforms.pfWindTime).toBeDefined(); expect(shader.uniforms.pfDepthScale).toBeDefined();
    }
    depth.dispose(); expect(batch.mesh.boundingSphere!.radius).toBe(radius);
    batch.dispose(); geometry.dispose(); material.dispose(); texture.dispose();
  });

  it('patches physical and both shadow passes with identical live controls and restores ownership', () => {
    const texture = new THREE.Texture();
    const geometry = new THREE.PlaneGeometry(4, 4, 16, 16);
    const material = new THREE.MeshPhysicalMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    const depth = new SurfaceDepth(texture).init(mesh);
    const shaders = [compile(material, 'physical'), compile(mesh.customDepthMaterial!, 'depth'), compile(mesh.customDistanceMaterial!, 'distance')];
    depth.configure(0.06, -0.03);
    for (const shader of shaders) {
      expect(shader.uniforms.pfDepthScale.value).toBe(0.06);
      expect(shader.vertexShader).toContain('texture2D(displacementMap, vDisplacementMapUv)');
    }
    expect(mesh.geometry.boundingSphere!.radius).toBeGreaterThan(2.83);
    expect(() => depth.configure(2, 0)).toThrow(/budget/);
    depth.dispose(); expect(mesh.geometry).toBe(geometry); expect(material.displacementMap).toBe(null);
    expect(mesh.customDistanceMaterial).toBeUndefined();
    geometry.dispose(); material.dispose(); texture.dispose();
  });
});

it('patches every grouped plant material with the same clock', () => {
  const materials = [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial({ alphaTest: 0.3 })];
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), materials);
  const wind = new VegetationWind(); const cleanup = wind.attachMesh(mesh);
  const shaders = materials.map(mat => compile(mat)); wind.update(2);
  expect(shaders.every(shader => shader.uniforms.pfWindTime.value === 2)).toBe(true);
  cleanup(); materials.forEach(mat => mat.dispose()); mesh.geometry.dispose();
});

describe('weather GPU simulation', () => {
  it('updates only uniforms, supports all layers and reuses allocations for controls', () => {
    const weather = new WeatherSystem({ layers: { rain: { count: 100 }, snow: { count: 50 }, clouds: {}, mist: {} } });
    const rain = weather.group.children[0] as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
    const positions = rain.geometry.getAttribute('position') as THREE.BufferAttribute;
    const seeds = rain.geometry.getAttribute('seed') as THREE.BufferAttribute;
    const original = seeds.array.slice();
    weather.update(200); weather.configureLayer('rain', { gravity: 2, size: 0.5 });
    expect(weather.group.children[0]).toBe(rain);
    expect(positions.version).toBe(0); expect(seeds.version).toBe(0); expect(seeds.array).toEqual(original);
    expect(rain.material.uniforms.time.value).toBe(200);
    expect(rain.material.uniforms.gravity.value).toBe(2);
    const dispose = vi.spyOn(rain.geometry, 'dispose');
    weather.configureLayer('rain', { count: 0 }); expect(dispose).toHaveBeenCalledOnce();
    expect(() => weather.setBounds(new THREE.Vector3(0, 1, 1))).toThrow();
    expect(() => weather.configureLayer('snow', { count: 1.2 })).toThrow();
    expect(() => weather.configureLayer('mist', { opacity: 2 })).toThrow();
    weather.dispose(); expect(weather.group.children).toHaveLength(0);
  });
});

it('adds four distinct, finite procedural models without changing the default species', () => {
  expect(PLANT_SPECIES_CATALOG[0].id).toBe('ribbon_grass');
  const counts = new Set<number>();
  for (const id of ['norway_spruce', 'flowering_cherry', 'creeping_juniper', 'rosemary_shrub']) {
    const species = PLANT_SPECIES_CATALOG.find(s => s.id === id)!;
    const geometry = species.category === 'tree' ? createTreeGeometry(id) : createBushGeometry(id);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.max.y).toBeGreaterThan(0);
    expect(Array.from(geometry.attributes.position.array).every(Number.isFinite)).toBe(true);
    counts.add(geometry.attributes.position.count); geometry.dispose();
  }
  expect(counts.size).toBe(4);
});
