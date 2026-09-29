import { describe, expect, it } from 'vitest';
import { siteBuildingGeometry } from '../../components/SiteBuildingMesh';
import { buildingProfile } from './buildingStyle';
import { styledBuildingGeometry } from './styledGeometry';
import type { SiteBuildingData } from '../../types';

const data = (over: Partial<SiteBuildingData> = {}): SiteBuildingData => ({
  sourceId: 'osm:way/1', footprint: [[-5, -3], [5, -3], [5, 3], [-5, 3]], height: 6, heightSource: 'levels', kind: 'house', ...over,
});
const build = (d: SiteBuildingData) => styledBuildingGeometry(siteBuildingGeometry(d)!, buildingProfile(d));

describe('styledBuildingGeometry', () => {
  const g = build(data());
  const attr = (name: string, i: number, size: number) => Array.from({ length: size }, (_, k) => g.getAttribute(name)!.array[i * size + k]!);

  it('has a wall group and a roof group that together cover every vertex', () => {
    expect(g.groups).toHaveLength(2);
    expect(g.groups[0]).toMatchObject({ start: 0, materialIndex: 0 });
    expect(g.groups[1]).toMatchObject({ materialIndex: 1 });
    expect(g.groups[0]!.count + g.groups[1]!.count).toBe(g.getAttribute('position')!.count);
    expect(g.groups[0]!.count).toBe(4 * 6); // four walls, two triangles each
    expect(g.groups[1]!.count).toBe(2 * 3); // a flat top
  });

  it('measures each wall\'s length and runs the wall coordinate from one end to the other', () => {
    const lengths = new Set<number>();
    let maxU = 0;
    for (let i = 0; i < g.groups[0]!.count; i++) {
      const [u, L] = attr('aWall', i, 3);
      lengths.add(Math.round(L! * 100) / 100);
      maxU = Math.max(maxU, u!);
      expect(u!).toBeGreaterThanOrEqual(-1e-6);
      expect(u!).toBeLessThanOrEqual(L! + 1e-6);
    }
    expect([...lengths].sort((a, b) => a - b)).toEqual([6, 10]);
    expect(maxU).toBeCloseTo(10, 5);
  });

  it('puts the door on the longest wall only', () => {
    const doorLengths = new Set<number>();
    for (let i = 0; i < g.groups[0]!.count; i++) {
      const [, L, door] = attr('aWall', i, 3);
      if (door === 1) doorLengths.add(Math.round(L! * 100) / 100);
    }
    expect([...doorLengths]).toEqual([10]);
  });

  it('gives walls height as their v coordinate and roofs true-size plan coordinates', () => {
    for (let i = 0; i < g.groups[0]!.count; i++) {
      expect(g.getAttribute('uv')!.array[i * 2 + 1]).toBeCloseTo(g.getAttribute('position')!.array[i * 3 + 1]!, 5);
    }
    const start = g.groups[1]!.start;
    let minU = Infinity, maxU = -Infinity;
    for (let i = start; i < start + g.groups[1]!.count; i++) { const u = g.getAttribute('uv')!.array[i * 2]!; minU = Math.min(minU, u); maxU = Math.max(maxU, u); }
    expect(maxU - minU).toBeGreaterThanOrEqual(6 - 1e-6);
    expect(g.getAttribute('aWall')!.array[start * 3 + 2]).toBe(-1); // marks roof vertices for the shader
  });

  it('carries the profile to every vertex', () => {
    const p = buildingProfile(data());
    const [storeyH, bay, , ] = attr('aS1', 0, 4);
    expect(storeyH).toBeCloseTo(p.storeyHeight, 5);
    expect(bay).toBeCloseTo(p.bayWidth, 5);
    expect(attr('aS2', 0, 4)[1]).toBeCloseTo(p.eave, 5);
  });

  it('dresses a pitched roof too: sloping faces are roof, gable ends are wall', () => {
    const pitched = data({
      height: 8,
      roof: { shape: 'gable', planes: [[0, 0.5, 5.5], [0, -0.5, 5.5]], eave: 5.5, ridge: 8, pitch: 40 },
    });
    const pg = build(pitched);
    expect(pg.groups).toHaveLength(2);
    expect(pg.groups[0]!.count).toBeGreaterThan(0);
    expect(pg.groups[1]!.count).toBeGreaterThan(0);
  });
});
