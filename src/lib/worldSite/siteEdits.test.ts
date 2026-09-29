import { describe, expect, it } from 'vitest';
import type { Shape, SiteBuildingSnapshot } from '../../types';
import { growRing, isUntouched, ringArea, siteEditSets, worldRing } from './siteEdits';

const data = (over: Record<string, unknown> = {}) => ({
  sourceId: 'osm:way/1', footprint: [[-2, -2], [2, -2], [2, 2], [-2, 2]] as [number, number][], height: 6, heightSource: 'levels' as const, ...over,
});
const shape = (over: Partial<Shape> = {}): Shape => ({
  id: 'b1', name: 'House', type: 'site_building', position: [10, 0, 5], quaternion: [0, 0, 0, 1], args: [], color: '#f1f0ec',
  siteBuildingData: data(), ...over,
} as Shape);
const snap = (over: Partial<SiteBuildingSnapshot> = {}): SiteBuildingSnapshot => ({ id: 'b1', name: 'House', position: [10, 0, 5], data: data(), ...over });

describe('isUntouched', () => {
  it('is true for a building exactly as imported', () => expect(isUntouched(shape(), snap())).toBe(true));
  it('sees a move', () => expect(isUntouched(shape({ position: [10.5, 0, 5] }), snap())).toBe(false));
  it('sees a turn', () => expect(isUntouched(shape({ quaternion: [0, 0.1, 0, 0.995] }), snap())).toBe(false));
  it('sees a new height', () => expect(isUntouched(shape({ siteBuildingData: data({ height: 9 }) }), snap())).toBe(false));
  it('sees paint', () => expect(isUntouched(shape({ color: '#ff0000' }), snap())).toBe(false));
  it('sees a reshaped outline', () => expect(isUntouched(shape({ siteBuildingData: data({ footprint: [[-2, -2], [3, -2], [3, 2], [-2, 2]] }) }), snap())).toBe(false));
  it('is false without a snapshot', () => expect(isUntouched(shape(), undefined)).toBe(false));
  it('ignores derived flags', () => expect(isUntouched(shape({ siteBuildingData: data({ heightCheck: true }) }), snap())).toBe(true));
});

describe('siteEditSets', () => {
  const existing = [snap(), snap({ id: 'b2', data: data({ sourceId: 'osm:way/2' }), position: [30, 0, 5] })];
  it('splits untouched, edited and deleted buildings', () => {
    const b1 = shape();
    const b2 = shape({ id: 'b2', position: [31, 0, 5], siteBuildingData: data({ sourceId: 'osm:way/2' }) });
    expect(siteEditSets([b1, b2], existing)).toMatchObject({ untouched: new Set(['b1']), edited: [b2] });
    const both = siteEditSets([b1, b2], existing);
    expect(both.vacated.map(v => v.id)).toEqual(['b2']); // its old spot is pressed flat too
    const deleted = siteEditSets([b1], existing);
    expect(deleted.vacated.map(v => v.id)).toEqual(['b2']);
    expect(deleted.edited).toEqual([]);
  });
  it('returns to untouched when put back', () => {
    const put = shape({ id: 'b2', position: [30, 0, 5], siteBuildingData: data({ sourceId: 'osm:way/2' }) });
    expect(siteEditSets([shape(), put], existing).vacated).toEqual([]);
  });
});

describe('rings', () => {
  const square: [number, number][] = [[-2, -2], [2, -2], [2, 2], [-2, 2]];
  it('places an outline in the world', () => {
    const r = worldRing(square, [10, 0, 5]);
    expect(r[0]).toEqual([8, 3]);
    expect(r[2]).toEqual([12, 7]);
  });
  it('turns an outline about the up axis', () => {
    const half = Math.SQRT1_2; // 90 degrees about y
    const r = worldRing([[1, 0]], [0, 0, 0], [0, half, 0, half]);
    expect(r[0]![0]).toBeCloseTo(0, 6);
    expect(Math.abs(r[0]![1])).toBeCloseTo(1, 6);
  });
  it('grows an outline outward whichever way it winds', () => {
    for (const ring of [square, [...square].reverse()]) {
      const grown = growRing(ring as [number, number][], 0.5);
      expect(Math.abs(ringArea(grown))).toBeCloseTo(25, 6); // 5 x 5
    }
  });
  it('shrinks with a negative distance', () => {
    expect(Math.abs(ringArea(growRing(square, -0.5)))).toBeCloseTo(9, 6);
  });
});
