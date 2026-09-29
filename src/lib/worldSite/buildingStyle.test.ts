import { describe, expect, it } from 'vitest';
import { averageRoofColour, buildingProfile, categoryOf, hash01, TOWER_HEIGHT } from './buildingStyle';

const b = (kind: string | undefined, height: number, extra: Record<string, unknown> = {}) => ({ sourceId: `osm:way/${kind}-${height}`, kind, height, ...extra });

describe('categoryOf', () => {
  it('sorts the map\'s kinds into the kinds of building we can dress', () => {
    const cases: [string | undefined, BuildingCategoryName][] = [
      ['house', 'house'], ['semidetached_house', 'house'], ['terrace', 'house'], ['apartments', 'apartments'], ['retail', 'retail'],
      ['office', 'office'], ['warehouse', 'industrial'], ['factory', 'industrial'], ['garage', 'garage'], ['church', 'religious'],
      ['school', 'civic'], ['hospital', 'civic'], ['greenhouse', 'glasshouse'], ['yes', 'other'], [undefined, 'other'],
    ];
    for (const [kind, want] of cases) expect(categoryOf(kind, 6)).toBe(want);
  });
  it('treats anything very tall as a tower, but not a church spire or a factory', () => {
    expect(categoryOf('apartments', TOWER_HEIGHT + 1)).toBe('tower');
    expect(categoryOf('yes', 60)).toBe('tower');
    expect(categoryOf('church', 60)).toBe('religious');
    expect(categoryOf('industrial', 45)).toBe('industrial');
  });
});
type BuildingCategoryName = ReturnType<typeof categoryOf>;

describe('buildingProfile', () => {
  it('dresses a house in brick or render with punched windows and a front door', () => {
    const p = buildingProfile(b('house', 7.5, { levels: 2 }));
    expect(['brick', 'render']).toContain(p.wall);
    expect(p).toMatchObject({ pattern: 'punched', door: 'front', storeys: 2 });
    expect(p.storeyHeight).toBeCloseTo(3.75, 5);
  });
  it('gives a tower a glass curtain wall', () => {
    expect(buildingProfile(b('yes', 90, { levels: 25 }))).toMatchObject({ category: 'tower', wall: 'glass', pattern: 'curtain', storeys: 25 });
  });
  it('gives a warehouse metal cladding, high windows and a roller door, in one tall storey', () => {
    expect(buildingProfile(b('warehouse', 9))).toMatchObject({ wall: 'metal', pattern: 'high', door: 'roller', storeys: 1, roof: 'metal' });
  });
  it('gives a church stone walls and tall arched windows', () => {
    expect(buildingProfile(b('church', 12))).toMatchObject({ wall: 'stone', pattern: 'lancet' });
  });
  it('gives a garage a roller door and no windows', () => {
    expect(buildingProfile(b('garage', 3))).toMatchObject({ pattern: 'none', door: 'roller' });
  });
  it('gives a shop a glazed ground floor', () => {
    expect(buildingProfile(b('retail', 8))).toMatchObject({ pattern: 'shopfront' });
  });
  it('gives a low office ribbon windows and a tall one a curtain wall', () => {
    expect(buildingProfile(b('office', 12)).pattern).toBe('ribbon');
    expect(buildingProfile(b('office', 30))).toMatchObject({ pattern: 'curtain', wall: 'glass' });
  });
  it('uses the map\'s material and colours when it has them', () => {
    const p = buildingProfile(b('house', 7, { style: { material: 'stone', colour: 'white', roofMaterial: 'slate', roofColour: '#333333' } }));
    expect(p.wall).toBe('stone');
    expect(p.wallTint).toBe('#f2f0ea');
    expect(p.roof).toBe('tiles');
    expect(p.roofTint).toBe('#333333');
  });
  it('tiles a pitched roof and leaves a flat one flat; takes the colour seen from above', () => {
    expect(buildingProfile(b('house', 7, { roof: { shape: 'gable', eave: 5 } }), '#886655')).toMatchObject({ roof: 'tiles', roofTint: '#886655', eave: 5 });
    expect(buildingProfile(b('house', 7, { roof: { shape: 'flat', eave: 7 } })).roof).toBe('flat');
  });
  it('is the same every time for the same building, and varies between buildings', () => {
    expect(buildingProfile(b('house', 7))).toEqual(buildingProfile(b('house', 7)));
    const walls = new Set(Array.from({ length: 40 }, (_, i) => buildingProfile({ sourceId: `osm:way/${i}`, kind: 'house', height: 7 }).wallTint));
    expect(walls.size).toBeGreaterThan(2);
  });
  it('keeps a floor at least 2.3 m and windows inside the storey', () => {
    const p = buildingProfile(b('house', 2.5));
    expect(p.storeyHeight).toBeGreaterThanOrEqual(2.3);
    expect(p.sill + p.windowHeight).toBeLessThan(p.storeyHeight);
  });
});

describe('hash01', () => {
  it('stays in range and differs by salt', () => {
    for (const s of ['a', 'osm:way/1', 'x'.repeat(50)]) { const h = hash01(s); expect(h).toBeGreaterThanOrEqual(0); expect(h).toBeLessThanOrEqual(1); }
    expect(hash01('a', 1)).not.toBe(hash01('a', 2));
  });
});

describe('averageRoofColour', () => {
  it('takes the typical colour of the roof', () => {
    const tiles: [number, number, number][] = Array.from({ length: 40 }, (_, i) => [150 + (i % 5), 90, 70]);
    expect(averageRoofColour(tiles)).toMatch(/^#9[0-9a-f]5a46$/);
  });
  it('ignores trees, deep shadow and glare', () => {
    const mix: [number, number, number][] = [
      ...Array.from({ length: 30 }, () => [120, 100, 90] as [number, number, number]),
      ...Array.from({ length: 30 }, () => [40, 120, 40] as [number, number, number]),   // tree
      ...Array.from({ length: 30 }, () => [10, 10, 10] as [number, number, number]),    // shadow
      ...Array.from({ length: 30 }, () => [250, 250, 250] as [number, number, number]), // glare
    ];
    expect(averageRoofColour(mix)).toBe('#78645a');
  });
  it('gives nothing when there is too little roof to go on', () => {
    expect(averageRoofColour([[100, 90, 80]])).toBeNull();
    expect(averageRoofColour(Array.from({ length: 50 }, () => [30, 130, 30] as [number, number, number]))).toBeNull();
  });
});
