import { describe, expect, it } from 'vitest';
import { buildingLook, cutoutPlanes, ecef, estimateLift, mapColour, tilesToSiteMatrix } from './googleTiles';
import { styleTags } from './buildings';

/** Applies a column-major 4x4 to a point. */
const apply = (m: number[], p: [number, number, number]) => [
  m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
  m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
  m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
];

describe('tilesToSiteMatrix', () => {
  const lat = 51.5, lng = -0.12, h = 30;
  const m = tilesToSiteMatrix(lat, lng, h);

  it('puts the site centre at the origin', () => {
    const o = apply(m, ecef(lat, lng, h));
    o.forEach(v => expect(Math.abs(v)).toBeLessThan(1e-6));
  });

  it('puts a point straight up on +y', () => {
    const p = apply(m, ecef(lat, lng, h + 25));
    expect(p[0]).toBeCloseTo(0, 5);
    expect(p[1]).toBeCloseTo(25, 5);
    expect(p[2]).toBeCloseTo(0, 5);
  });

  it('puts east on +x and north on -z', () => {
    const east = apply(m, ecef(lat, lng + 0.001, h));
    expect(east[0]).toBeGreaterThan(50); // ~69 m
    expect(Math.abs(east[2])).toBeLessThan(0.5);
    const north = apply(m, ecef(lat + 0.001, lng, h));
    expect(north[2]).toBeLessThan(-100); // ~111 m north
    expect(Math.abs(north[0])).toBeLessThan(0.5);
  });

  it('lifts by the given amount', () => {
    const lifted = tilesToSiteMatrix(lat, lng, h, 7);
    expect(apply(lifted, ecef(lat, lng, h))[1]).toBeCloseTo(7, 6);
  });
});

describe('cutoutPlanes', () => {
  it('describes the square, less an inset', () => {
    const planes = cutoutPlanes(100, 5);
    expect(planes).toHaveLength(4);
    // A point inside is on the negative side of every plane; outside is positive for at least one.
    const side = (p: [number, number, number]) => planes.map(pl => pl.normal[0] * p[0] + pl.normal[1] * p[1] + pl.normal[2] * p[2] + pl.constant);
    expect(side([0, 12, 0]).every(d => d < 0)).toBe(true);
    expect(side([44, 0, 0]).every(d => d < 0)).toBe(true);
    expect(side([46, 0, 0]).some(d => d > 0)).toBe(true);
    expect(side([0, 0, -46]).some(d => d > 0)).toBe(true);
  });
});

describe('estimateLift', () => {
  it('matches the low points, ignoring roofs and trees', () => {
    const samples = [
      { tiles: 52, ground: 5 }, { tiles: 51.5, ground: 4.5 }, { tiles: 52.2, ground: 5.1 }, // ground: tiles ~47 above
      { tiles: 70, ground: 5 }, { tiles: 64, ground: 4 }, { tiles: 58, ground: 5 }, { tiles: 75, ground: 5 }, { tiles: 66, ground: 5 },
    ];
    expect(estimateLift(samples)).toBeCloseTo(-47, 0);
  });
  it('is zero with nothing to go on', () => {
    expect(estimateLift([])).toBe(0);
    expect(estimateLift([{ tiles: NaN, ground: 1 }])).toBe(0);
  });
});

describe('building looks', () => {
  it('reads map colours', () => {
    expect(mapColour('#A5573E')).toBe('#a5573e');
    expect(mapColour('#abc')).toBe('#aabbcc');
    expect(mapColour('Red')).toBe('#a94a3a');
    expect(mapColour('chartreuse-ish')).toBeNull();
  });
  it('prefers the map colour, then material, then kind', () => {
    expect(buildingLook({ kind: 'house', style: { colour: 'white' } }).wall).toBe('#f2f0ea');
    expect(buildingLook({ kind: 'house', style: { material: 'stone' } }).wall).toBe('#b7ae9d');
    expect(buildingLook({ kind: 'house' }).wall).toBe('#a5573e');
    expect(buildingLook({ kind: 'apartments' }).wall).toBe('#e2dccf');
    expect(buildingLook({}).wall).toBe('#dcd8cf');
  });
  it('colours the roof from its tags', () => {
    expect(buildingLook({ style: { roofMaterial: 'slate' } }).roof).toBe('#5b6168');
    expect(buildingLook({ style: { roofColour: '#ff0000' } }).roof).toBe('#ff0000');
    expect(buildingLook({}).roof).toBe('#8a7a70');
  });
  it('keeps only the appearance tags a building has', () => {
    expect(styleTags({ building: 'house' })).toBeUndefined();
    expect(styleTags({ building: 'house', 'building:colour': ' White ', 'roof:material': 'slate' })).toEqual({ colour: 'white', roofMaterial: 'slate' });
  });
});
