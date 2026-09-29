import { describe, expect, it } from 'vitest';
import type { Shape } from '../../types';
import { buildingKindWord, siteBuildingGroups, siteGroundOf, siteShapeIds } from './siteGroups';

const b = (id: string, kind?: string): Shape => ({
  id, type: 'site_building', position: [0, 0, 0], args: [], color: '#fff',
  siteBuildingData: { sourceId: id, footprint: [], height: 5, heightSource: 'levels', ...(kind ? { kind } : {}) },
} as Shape);
const ground = { id: 'g', type: 'terrain', position: [0, 0, 0], args: [], color: '#ccc', terrainData: { site: {} } } as unknown as Shape;
const other = { id: 'x', type: 'box', position: [0, 0, 0], args: [1, 1, 1], color: '#f00' } as Shape;

describe('siteBuildingGroups', () => {
  it('groups by what the map says, named "Existing ..."', () => {
    const groups = siteBuildingGroups([b('1', 'house'), b('2', 'garage'), b('3', 'house'), other]);
    expect(groups.map(g => [g.label, g.shapes.length])).toEqual([['Existing house', 2], ['Existing garage', 1]]);
  });
  it('puts unknown or "yes" buildings under Existing building', () => {
    const groups = siteBuildingGroups([b('1'), b('2', 'yes')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe('Existing building');
  });
  it('reads kinds with underscores', () => {
    expect(buildingKindWord('semidetached_house')).toBe('semidetached house');
    expect(siteBuildingGroups([b('1', 'semidetached_house')])[0]!.key).toBe('semidetached-house');
  });
});

describe('site shapes', () => {
  it('finds the imported ground and every site shape, and only those', () => {
    const shapes = [ground, b('1', 'house'), other];
    expect(siteGroundOf(shapes)?.id).toBe('g');
    expect([...siteShapeIds(shapes)].sort()).toEqual(['1', 'g']);
  });
});
