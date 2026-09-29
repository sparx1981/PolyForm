import { describe, expect, it } from 'vitest';
import type { Shape, SiteRoute } from '../../types';
import { planStreetLights, withStreetLights, withoutStreetLights } from './streetLights';

const road = (id: string, pts: [number, number][], width = 6): SiteRoute => ({ id, kind: 'road', points: pts, source: 'map', width });
const house = (id: string, x: number, z: number) => ({ id, position: [x, z] as [number, number], footprint: [[-4, -4], [4, -4], [4, 4], [-4, 4]] as [number, number][], kind: 'house', height: 6 });

describe('auto street lights', () => {
  it('spaces lights along a road, at its kerb, alternating sides on a main road', () => {
    const lights = planStreetLights({ routes: [road('main', [[-90, 0], [90, 0]], 10)], buildings: [] });
    expect(lights.length).toBeGreaterThanOrEqual(5);
    expect(lights.every(l => l.style === 'modern-led')).toBe(true);
    // At the kerb: 5 m of road half-width plus a bit.
    for (const l of lights) expect(Math.abs(l.z)).toBeGreaterThan(5);
    expect(new Set(lights.map(l => Math.sign(l.z))).size).toBe(2);
    const xs = lights.map(l => l.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThan(20);
  });
  it('lights a street with cobra heads on one side and a wide road with double arms', () => {
    const street = planStreetLights({ routes: [road('s', [[-60, 0], [60, 0]], 6)], buildings: [] });
    expect(street.every(l => l.style === 'cobra')).toBe(true);
    expect(new Set(street.map(l => Math.sign(l.z))).size).toBe(1);
    const dual = planStreetLights({ routes: [road('d', [[-60, 0], [60, 0]], 14)], buildings: [] });
    expect(dual.every(l => l.style === 'cobra-double')).toBe(true);
  });
  it('keeps clear of junctions and buildings', () => {
    const lights = planStreetLights({ routes: [road('a', [[-90, 0], [90, 0]], 6), road('b', [[0, -90], [0, 90]], 6)], buildings: [] });
    for (const l of lights) {
      // Along the east-west road, none within the junction; along the north-south road, likewise.
      if (Math.abs(l.z) < 10) expect(Math.abs(l.x)).toBeGreaterThan(6);
      else expect(Math.abs(l.z)).toBeGreaterThan(6);
    }
    expect(lights.length).toBeGreaterThan(0);
    const blocked = planStreetLights({ routes: [road('a', [[-30, 0], [30, 0]], 6)], buildings: [{ ...house('h', 0, -4.2), footprint: [[-40, -3], [40, -3], [40, 3], [-40, 3]] }] });
    for (const l of blocked) expect(l.z > -7.2 && l.z < -1.2).toBe(false);
  });
  it('gives some houses a gate light and path lights', () => {
    const buildings = Array.from({ length: 8 }, (_, i) => house(`h${i}`, -70 + i * 20, -22));
    const lights = planStreetLights({ routes: [road('a', [[-90, 0], [90, 0]], 6)], buildings });
    const garden = lights.filter(l => ['post-top', 'victorian', 'bollard', 'solar-path'].includes(l.style));
    expect(garden.length).toBeGreaterThan(0);
    expect(garden.length).toBeLessThan(buildings.length * 3);
    expect(garden.some(l => l.style === 'post-top' || l.style === 'victorian')).toBe(true);
    expect(garden.some(l => l.style === 'bollard' || l.style === 'solar-path')).toBe(true);
  });
  it('replaces its own lights and leaves everything else alone', () => {
    const mine = { id: 'wall', type: 'wall', position: [0, 0, 0] } as unknown as Shape;
    const lights = planStreetLights({ routes: [road('a', [[-60, 0], [60, 0]], 6)], buildings: [] });
    const once = withStreetLights([mine], lights, undefined);
    const twice = withStreetLights(once, lights, undefined);
    expect(twice).toHaveLength(once.length);
    expect(twice[0]).toBe(mine);
    expect(twice.filter(s => s.type === 'lamp')).toHaveLength(lights.length);
    expect(withoutStreetLights(twice)).toEqual([mine]);
  });
});
