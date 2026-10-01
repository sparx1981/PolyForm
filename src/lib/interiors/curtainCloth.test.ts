import { describe, expect, it } from 'vitest';
import { createCurtainPanels, CurtainCloth, relaxCurtainPositions, type ClothWind } from './curtainCloth';
import { createInteriorFurnitureShape } from './parametricFurniture';
import { bakeSemanticSimulation } from './bakeSimulation';
import { curtainTerrain, curtainWind } from './curtainWind';
import { normalizeGraphicsSettings } from '../graphics/graphicsSettings';
import { DEFAULT_GRASS_SETTINGS, DEFAULT_WILDFLOWER_SETTINGS, type Shape, type TerrainData } from '../../types';

const dimensions = { width: 2, height: 2.2, openAmount: 0.4, fullness: 1.8, foldDepth: 0.065 };
const fresh = () => new CurtainCloth(createCurtainPanels(dimensions)[0]);
const run = (cloth: CurtainCloth, wind: ClothWind, seconds = 2, fps = 60) => {
  for (let i = 0; i < seconds * fps; i++) cloth.update(1 / fps, wind);
};
const meanZ = (cloth: CurtainCloth) => cloth.positions.filter((_, i) => i % 3 === 2).reduce((a, b) => a + b, 0) / (cloth.positions.length / 3);
const terrain: TerrainData = { gridX: 2, gridY: 2, width: 20, depth: 20, heights: [0, 0, 0, 0], grass: { ...DEFAULT_GRASS_SETTINGS, enabled: true }, flowers: { ...DEFAULT_WILDFLOWER_SETTINGS, enabled: true } };

describe('curtain fabric', () => {
  it('retains saved cloth relaxation without moving the rod or heading', () => {
    const shape = createInteriorFurnitureShape('curtain', { params: dimensions });
    const baked = bakeSemanticSimulation(shape, 0.7);
    const expected = [...shape.geometryData!.positions!];
    relaxCurtainPositions(expected, dimensions.width, dimensions.height, 0.7);
    expect(baked.geometryData!.positions).toEqual(expected);
    for (let i = 0; i < expected.length; i += 3) if (expected[i+1] >= dimensions.height) {
      expect(expected.slice(i, i+3)).toEqual(shape.geometryData!.positions!.slice(i, i+3));
    }
    expect(expected).not.toEqual(shape.geometryData!.positions);
  });
  it('uses broad smooth folds rather than dense repeating pleats', () => {
    const cloth = fresh();
    let turns = 0;
    for (let x = 1; x < 24; x++) {
      const a = cloth.rest[x*3+2] - cloth.rest[(x-1)*3+2];
      const b = cloth.rest[(x+1)*3+2] - cloth.rest[x*3+2];
      if (a * b < 0) turns++;
    }
    expect(turns).toBeLessThan(8);
    expect(cloth.geometry.index).not.toBeNull();
    cloth.geometry.dispose();
  });
  it('billows visibly and independently while keeping every heading attachment pinned', () => {
    const calm = fresh(), windy = fresh();
    run(calm, { x: 0, z: 0, speed: 2 });
    run(windy, { x: 0, z: 3, speed: 2 });
    expect(meanZ(windy) - meanZ(calm)).toBeGreaterThan(0.08);
    expect(Array.from(windy.positions.slice(0, 25 * 3))).toEqual(Array.from(windy.rest.slice(0, 25 * 3)));
    const middle = (14 * 25 + 12) * 3, hem = (28 * 25 + 12) * 3;
    expect(windy.positions[hem+2] - windy.rest[hem+2]).toBeGreaterThan(windy.positions[middle+2] - windy.rest[middle+2]);
    calm.geometry.dispose(); windy.geometry.dispose();
  });
  it('handles low frame rates, strong gusts, floor and glass constraints', () => {
    const desktop = fresh(), mobile = fresh();
    run(desktop, { x: 2, z: 5, speed: 3 });
    run(mobile, { x: 2, z: 5, speed: 3 }, 2, 20);
    expect(meanZ(mobile)).toBeCloseTo(meanZ(desktop), 5);
    run(mobile, { x: -5, z: -5, speed: 3 });
    expect(Array.from(mobile.positions).every(Number.isFinite)).toBe(true);
    for (let n = 25; n < mobile.positions.length / 3; n++) {
      expect(mobile.positions[n*3+1]).toBeGreaterThanOrEqual(0.0029);
      expect(mobile.positions[n*3+2]).toBeGreaterThanOrEqual(-0.09001);
    }
    desktop.geometry.dispose(); mobile.geometry.dispose();
  });
  it('reacts to a walk-by and settles when the airflow stops', () => {
    const cloth = fresh(), calm = fresh();
    run(cloth, { x: 0, z: 0, speed: 1 });
    for (let i = 0; i < 60; i++) cloth.update(1/60, { x: 0, z: 0, speed: 1 }, { x: -0.65, y: 1.5, z: 0.2, speed: 2 });
    expect(meanZ(cloth)).toBeGreaterThan(0.04);
    run(cloth, { x: 0, z: 0, speed: 1 }, 12);
    run(calm, { x: 0, z: 0, speed: 1 }, 15);
    expect(Math.abs(meanZ(cloth) - meanZ(calm))).toBeLessThan(0.04);
    cloth.geometry.dispose(); calm.geometry.dispose();
  });
});

describe('shared curtain wind', () => {
  it('responds separately to grass, flower, plant and weather controls', () => {
    const settings = normalizeGraphicsSettings({ vegetation: { windEnabled: false } });
    const base = curtainWind(settings, terrain);
    const grass = curtainWind(settings, { ...terrain, grass: { ...terrain.grass!, animationStrength: 0.5, windSpeed: 4 } });
    const flowers = curtainWind(settings, { ...terrain, flowers: { ...terrain.flowers!, animationStrength: 0.5 } });
    expect(Math.hypot(grass.x, grass.z)).toBeGreaterThan(Math.hypot(base.x, base.z));
    expect(Math.hypot(flowers.x, flowers.z)).toBeGreaterThan(Math.hypot(base.x, base.z));
    expect(grass.speed).toBeGreaterThan(base.speed);
    expect(curtainWind(settings, { ...terrain, grass: { ...terrain.grass!, animate: false }, flowers: { ...terrain.flowers!, animate: false } }).x).toBe(0);
    settings.vegetation.windEnabled = true; settings.vegetation.direction = 90;
    expect(curtainWind(settings).z).toBeGreaterThan(0);
    expect(curtainWind(settings).x).toBeCloseTo(0);
    settings.weather.enabled = true; settings.weather.windZ = -5;
    expect(curtainWind(settings).z).toBeLessThan(0);
  });
  it('uses terrain under the window, including rotated/scaled terrain, and ignores distant terrain', () => {
    const shape = { id: 'terrain', type: 'terrain', position: [5, 0, 5], rotation: [0, Math.PI / 2, 0], scale: [2, 1, 1], terrainData: terrain } as Shape;
    expect(curtainTerrain([shape], [5, 2, 20])).toBe(terrain);
    expect(curtainTerrain([shape], [100, 2, 100])).toBeUndefined();
  });
});
