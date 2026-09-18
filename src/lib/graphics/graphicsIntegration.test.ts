import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { defaultGraphicsSettings, normalizeGraphicsSettings } from './graphicsSettings';
import { batchablePlant } from './vegetationEligibility';
import { subdivideDepthGeometry, canApplySurfaceDepth, shouldHideAutoNormalMap } from './depthGeometry';
import { WeatherSystem } from './WeatherSystem';
import { isolateMaterialGroup } from './plantAssets';
import type { Shape } from '../../types';

it('restricts single-material plant primitives to their own triangles', () => {
  for (const indexed of [true, false]) {
    const source = new THREE.BoxGeometry();
    const geometry = indexed ? source.clone() : source.toNonIndexed();
    expect(isolateMaterialGroup(geometry, 2)).toBe(true);
    expect(geometry.index!.count).toBe(6);
    expect(geometry.groups).toHaveLength(0);
    expect(source.index!.count).toBe(36);
    geometry.dispose(); source.dispose();
  }
});

describe('project graphics settings', () => {
  it('round trips every layer and defaults old projects independently', () => {
    const settings = defaultGraphicsSettings();
    settings.weather.enabled = true; settings.weather.cloudsMode = 'volumetric';
    Object.assign(settings.weather.layers.clouds, { altitude: 125, density: 0.91, cloudType: 'cirrus', color: '#112233' });
    settings.weather.layers.mist.density = 0.2; settings.vegetation.instancing = false;
    expect(normalizeGraphicsSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
    const old = normalizeGraphicsSettings(undefined);
    expect(old.weather.enabled).toBe(false); expect(old.weather.layers.clouds.altitude).toBe(40);
    old.weather.layers.clouds.altitude = 99;
    expect(defaultGraphicsSettings().weather.layers.clouds.altitude).toBe(40);
  });
  it('sanitizes malformed imported data', () => {
    const settings = normalizeGraphicsSettings({ weather: { width: NaN, layers: { clouds: { density: 9, count: 9e9, color: 'url(x)', altitude: -1000 } } }, vegetation: { strength: -2 } });
    expect(settings.weather.width).toBe(160); expect(settings.weather.layers.clouds.count).toBe(400);
    expect(settings.weather.layers.clouds.density).toBe(1); expect(settings.vegetation.strength).toBe(0);
  });
});

it('keeps selected, hidden, grouped and edit-tool plants outside batches', () => {
  const shape: Shape = { id: 'plant', type: 'tree', plantSpeciesId: 'norway_spruce', position: [0,0,0], args: [], color: '#ffffff' };
  const eligible = (item = shape, selected = new Set<string>(), tool = 'select') => batchablePlant(item, selected, [], true, tool);
  expect(eligible()).toBe(true); expect(eligible(shape, new Set(['plant']))).toBe(false);
  expect(eligible({ ...shape, hidden: true })).toBe(false); expect(eligible({ ...shape, groupId: 'group' })).toBe(false);
  expect(eligible(shape, new Set(), 'paint')).toBe(false); expect(eligible(shape, new Set(), 'move')).toBe(false);
  expect(batchablePlant({ ...shape, tags: ['hidden'] }, new Set(), [{ id: 'hidden', visible: false } as any], true, 'select')).toBe(false);
});

it('subdivides only the render geometry under a fixed vertex budget', () => {
  const geometry = new THREE.BoxGeometry(4, 2, 3), before = geometry.attributes.position.array.slice();
  const refined = subdivideDepthGeometry(geometry, 16);
  expect(refined.attributes.position.count).toBeGreaterThan(geometry.attributes.position.count);
  expect(refined.attributes.position.count).toBeLessThanOrEqual(98304);
  expect(geometry.attributes.position.array).toEqual(before);
  expect(refined.attributes.uv.count).toBe(refined.attributes.position.count);
  expect(refined.groups).toHaveLength(6);
  // Multi-material (per-face) boxes are supported best-effort: SurfaceDepth patches
  // every material in the array with the same height field.
  expect(canApplySurfaceDepth({ type: 'box', surfaceMaterials: { 0: '#fff' } } as any)).toBe(true);
  expect(canApplySurfaceDepth({ type: 'box', bevelAmount: 0.1 } as any)).toBe(true);
  expect(canApplySurfaceDepth({ type: 'box', surfaceDivisions: { 0: 2 } } as any)).toBe(false);
  // Surface depth is a material property, not a shape-type allowlist: any object type
  // qualifies (objects whose actual mesh can't take it are excluded at runtime instead,
  // by SurfaceDepthBinding), and surfaceDivisions is the only thing that excludes it here.
  for (const type of ['wall', 'door', 'window', 'staircase', 'roof', 'lamp', 'tree', 'bench']) {
    expect(canApplySurfaceDepth({ type } as any)).toBe(true);
  }
  expect(canApplySurfaceDepth({ type: 'wall', surfaceDivisions: { 0: 2 } } as any)).toBe(false);

  // Auto-derived normal maps hide when Surface depth is disabled...
  expect(shouldHideAutoNormalMap({ displacementMapUrl: 'x', surfaceDepthEnabled: false } as any)).toBe(true);
  // ...but stay while enabled...
  expect(shouldHideAutoNormalMap({ displacementMapUrl: 'x', surfaceDepthEnabled: true } as any)).toBe(false);
  // ...and an independently-applied normal map (no height map, or a manually uploaded
  // one with auto-normal turned off) is never hidden by this toggle.
  expect(shouldHideAutoNormalMap({ surfaceDepthEnabled: false } as any)).toBe(false);
  expect(shouldHideAutoNormalMap({ displacementMapUrl: 'x', surfaceDepthEnabled: false, surfaceDepthAutoNormal: false } as any)).toBe(false);
  geometry.dispose(); refined.dispose();
});

it('changes cloud/mist density and modes without reallocating particle buffers', () => {
  const weather = new WeatherSystem({ layers: { clouds: { count: 100 }, mist: { count: 100 } } });
  const cloud = weather.group.children[0] as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  const mist = weather.group.children[1] as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  const geometry = cloud.geometry;
  weather.configureLayer('clouds', { density: 0.25, altitude: 70, thickness: 12, cloudType: 'cirrus', color: '#eeeeff' });
  weather.configureLayer('mist', { density: 0.12 }); weather.setCloudMode('volumetric');
  expect(cloud.geometry).toBe(geometry); expect(geometry.drawRange.count).toBe(25); expect(mist.geometry.drawRange.count).toBe(12);
  expect(cloud.material.uniforms.altitude.value).toBe(70); expect(cloud.material.uniforms.volumetric.value).toBe(1);
  expect(cloud.material.uniforms.cloudType.value).toBe(1); weather.dispose();
});
