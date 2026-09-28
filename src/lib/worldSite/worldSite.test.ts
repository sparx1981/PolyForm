import { describe, expect, it } from 'vitest';
import { clampSiteSize, latLngToLocal, localToLatLng, metresPerPixel, parseLatLng, siteBounds, ukPostcode, worldPixel } from './geo';
import { decodeTerrarium, gridHeightAt, siteGridCount, siteHeights, tileSampler, tilesFor, type HeightTile } from './terrain';
import {
  assembleRings, buildingHeight, buildingName, overpassQuery, parseLength, parseOverpassBuildings,
  removedBuildings, shapeFromSnapshot, siteBuildingId, siteBuildingShapes, snapshotBuildings,
} from './buildings';
import { buildSite, findSiteGround, isSiteShape, replaceSite, siteSatelliteUrl, SITE_GROUND_ID, type SiteIO } from './site';
import type { Shape } from '../../types';

const origin = { lat: 51.5, lng: -0.12 };

describe('geo', () => {
  it('round-trips between latitude/longitude and metres, with north as -z', () => {
    const p = localToLatLng(origin, 37.5, -80);
    expect(p.lat).toBeGreaterThan(origin.lat);
    expect(p.lng).toBeGreaterThan(origin.lng);
    const [x, z] = latLngToLocal(origin, p);
    expect(x).toBeCloseTo(37.5, 6);
    expect(z).toBeCloseTo(-80, 6);
  });

  it('has a degree of latitude at about 111 km', () => {
    const [, z] = latLngToLocal(origin, { lat: origin.lat + 1, lng: origin.lng });
    expect(-z).toBeCloseTo(111319.5, 0);
  });

  it('bounds a square site', () => {
    const b = siteBounds(origin, 200);
    const [x0, z0] = latLngToLocal(origin, { lat: b.south, lng: b.west });
    const [x1, z1] = latLngToLocal(origin, { lat: b.north, lng: b.east });
    expect([x0, z0, x1, z1].map(v => Math.round(v))).toEqual([-100, 100, 100, -100]);
  });

  it('caps the site at 200 m and keeps it sensible', () => {
    expect(clampSiteSize(500)).toBe(200);
    expect(clampSiteSize(5)).toBe(20);
    expect(clampSiteSize(NaN)).toBe(100);
    expect(clampSiteSize(149.6)).toBe(150);
  });

  it('reads typed coordinates and UK postcodes', () => {
    expect(parseLatLng('51.5007, -0.1246')).toEqual({ lat: 51.5007, lng: -0.1246 });
    expect(parseLatLng('(40.7 -74)')).toEqual({ lat: 40.7, lng: -74 });
    expect(parseLatLng('91, 0')).toBeNull();
    expect(parseLatLng('10 Downing Street')).toBeNull();
    expect(ukPostcode('sw1a1aa')).toBe('SW1A 1AA');
    expect(ukPostcode('M1 1AE')).toBe('M1 1AE');
    expect(ukPostcode('Main Street')).toBeNull();
  });

  it('matches Web Mercator tile maths', () => {
    // (0, 0) is the middle of the world at every zoom.
    expect(worldPixel({ lat: 0, lng: 0 }, 1)).toEqual({ x: 256, y: 256 });
    expect(metresPerPixel(0, 0)).toBeCloseTo(156543.03, 1);
  });
});

/** A tile whose height rises 1 m per pixel eastwards (plus `base`). */
function rampTile(x: number, y: number, z: number, base = 0): HeightTile {
  const heights = new Float32Array(256 * 256);
  for (let r = 0; r < 256; r++) for (let c = 0; c < 256; c++) heights[r * 256 + c] = base + (x * 256 + c);
  return { x, y, z, heights };
}

describe('terrain', () => {
  it('decodes Terrarium pixels', () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(128, 100, 128)).toBe(100.5);
    expect(decodeTerrarium(127, 255, 0)).toBe(-1);
  });

  it('lists the tiles a site needs', () => {
    const b = siteBounds(origin, 200);
    const tiles = tilesFor([{ lat: b.south, lng: b.west }, { lat: b.north, lng: b.east }]);
    expect(tiles.length).toBeGreaterThanOrEqual(1);
    expect(tiles.length).toBeLessThanOrEqual(4);
    expect(tiles.every(t => t.z === 15)).toBe(true);
  });

  it('blends between pixel centres, across tile edges', () => {
    const z = 15;
    const p = { lat: 51.5, lng: -0.12 };
    const w = worldPixel(p, z);
    const tx = Math.floor(w.x / 256), ty = Math.floor(w.y / 256);
    const sample = tileSampler([rampTile(tx, ty, z), rampTile(tx + 1, ty, z)]);
    // The ramp is 1 m per pixel, so the sampled height equals the pixel position minus half a pixel.
    expect(sample(p)).toBeCloseTo(w.x - 0.5, 3);
  });

  it('lays out a 1 m grid, north row first, relative to the centre', () => {
    // Height rises 1 m per metre northwards.
    const heightAt = (q: { lat: number; lng: number }) => 50 - latLngToLocal(origin, q)[1];
    const g = siteHeights(origin, 100, heightAt);
    expect(g.gridX).toBe(101);
    expect(g.elevation).toBeCloseTo(50, 6);
    expect(g.heights[0]).toBeCloseTo(50, 3); // north-west corner, 50 m north
    expect(g.heights[100 * 101]).toBeCloseTo(-50, 3); // south-west corner
    expect(gridHeightAt({ ...g, width: 100, depth: 100 }, 12.3, -20.5)).toBeCloseTo(20.5, 3);
    expect(siteGridCount(200)).toBe(201);
    expect(siteGridCount(1000)).toBe(201);
  });
});

/** A square way `w` metres wide centred `cx, cz` metres from the origin. */
function squareWay(id: number, cx: number, cz: number, w: number, tags: Record<string, string>) {
  const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([a, b]) => localToLatLng(origin, cx + (a * w) / 2, cz + (b * w) / 2));
  return { type: 'way', id, tags, geometry: pts.map(p => ({ lat: p.lat, lon: p.lng })) };
}

describe('buildings', () => {
  it('reads lengths in metres and feet', () => {
    expect(parseLength('12')).toBe(12);
    expect(parseLength('12.5 m')).toBe(12.5);
    expect(parseLength('40\'')).toBeCloseTo(12.192, 3);
    expect(parseLength('10 ft 6"')).toBeCloseTo(3.2004, 3);
    expect(parseLength('tall')).toBeNull();
    expect(parseLength('0')).toBeNull();
  });

  it('takes the height from the map, then floors, then the kind of building', () => {
    expect(buildingHeight({ building: 'yes', height: '14' })).toMatchObject({ height: 14, source: 'tagged' });
    expect(buildingHeight({ building: 'yes', 'building:levels': '4' })).toMatchObject({ height: 12, source: 'levels' });
    expect(buildingHeight({ building: 'house', 'building:levels': '2', 'roof:levels': '1' }).height).toBe(7.5);
    expect(buildingHeight({ building: 'garage' })).toMatchObject({ height: 3, source: 'estimated' });
    expect(buildingHeight({ building: 'apartments' })).toMatchObject({ height: 9, source: 'estimated' });
    expect(buildingHeight({ building: 'house' })).toMatchObject({ height: 6, source: 'estimated' });
    expect(buildingHeight({ building: 'roof' }).minHeight).toBeGreaterThan(2);
    expect(buildingHeight({ building: 'yes', height: '20', min_height: '5' }).minHeight).toBe(5);
  });

  it('joins a relation\'s pieces into rings', () => {
    const a = { lat: 0, lng: 0 }, b = { lat: 0, lng: 1 }, c = { lat: 1, lng: 1 }, d = { lat: 1, lng: 0 };
    const rings = assembleRings([[a, b], [c, b], [c, d, a]]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4);
    expect(assembleRings([[a, b]])).toHaveLength(0);
  });

  it('parses ways and multipolygons, skipping non-buildings', () => {
    const json = {
      elements: [
        squareWay(1, 0, 0, 10, { building: 'house', name: 'Rose Cottage' }),
        squareWay(2, 30, 0, 10, { building: 'no' }),
        squareWay(3, 30, 0, 10, { highway: 'residential' }),
        {
          type: 'relation', id: 9, tags: { building: 'yes', type: 'multipolygon' },
          members: [
            { type: 'way', role: 'outer', geometry: squareWay(0, -40, 0, 20, {}).geometry },
            { type: 'way', role: 'inner', geometry: squareWay(0, -40, 0, 6, {}).geometry },
          ],
        },
      ],
    };
    const got = parseOverpassBuildings(json as never);
    expect(got.map(b => b.sourceId)).toEqual(['osm:way/1', 'osm:relation/9']);
    expect(got[0]!.outer).toHaveLength(4);
    expect(got[1]!.holes).toHaveLength(1);
  });

  it('makes one object per building, standing on the ground, only inside the site', () => {
    const json = {
      elements: [
        squareWay(1, 10, 10, 10, { building: 'house', 'addr:housenumber': '4', 'addr:street': 'Mill Lane' }),
        squareWay(2, 95, 0, 8, { building: 'yes', height: '9' }),
        squareWay(3, 130, 0, 10, { building: 'yes' }), // outside a 200 m site
        squareWay(4, -20, 0, 1, { building: 'yes' }), // 1 m² - too small
      ],
    };
    // Ground slopes up 0.1 m per metre eastwards.
    const shapes = siteBuildingShapes(parseOverpassBuildings(json as never), origin, 200, x => x * 0.1);
    expect(shapes.map(s => s.id)).toEqual(['site-way-1', 'site-way-2']);
    const house = shapes[0]!;
    expect(house.type).toBe('site_building');
    expect(house.name).toBe('4 Mill Lane');
    expect(house.position[0]).toBeCloseTo(10, 2);
    expect(house.position[2]).toBeCloseTo(10, 2);
    // Stands on its lowest corner (x = 5 -> 0.5 m); 6 m above the ground at its middle (1.0 m).
    expect(house.position[1]).toBeCloseTo(0.5, 2);
    expect(house.siteBuildingData!.height).toBeCloseTo(6.5, 2);
    expect(house.siteBuildingData!.footprint).toHaveLength(4);
    expect(house.siteBuildingData!.heightSource).toBe('estimated');
    expect(shapes[1]!.siteBuildingData!.heightSource).toBe('tagged');
  });

  it('names buildings and gives stable ids', () => {
    expect(buildingName({ name: 'The Shard', building: 'yes' })).toBe('The Shard');
    expect(buildingName({ building: 'retail' })).toBe('Existing retail');
    expect(buildingName({ building: 'yes' })).toBe('Existing building');
    expect(siteBuildingId('osm:relation/42#1')).toBe('site-relation-42-1');
  });

  it('keeps a snapshot so deleted buildings can be ghosted and put back', () => {
    const shapes = siteBuildingShapes(parseOverpassBuildings({ elements: [squareWay(1, 0, 0, 10, { building: 'house' }), squareWay(2, 40, 0, 10, { building: 'house' })] } as never), origin, 200, () => 0);
    const snap = snapshotBuildings(shapes);
    const afterDelete = shapes.filter(s => s.id !== 'site-way-2');
    const gone = removedBuildings(snap, afterDelete);
    expect(gone.map(g => g.id)).toEqual(['site-way-2']);
    expect(shapeFromSnapshot(gone[0]!)).toEqual(shapes[1]);
  });

  it('asks Overpass for the site with a margin', () => {
    const q = overpassQuery(origin, 200);
    expect(q).toContain('way["building"]');
    expect(q).toContain('out geom');
  });
});

describe('site', () => {
  const io = (overrides: Partial<SiteIO> = {}): SiteIO => ({
    heightTiles: async tiles => tiles.map(t => rampTile(t.x, t.y, t.z, 10)),
    overpass: async () => ({ elements: [squareWay(1, 0, 0, 10, { building: 'house' })] }),
    ...overrides,
  });

  it('builds editable ground and buildings, with the centre at y = 0', async () => {
    const built = await buildSite(io(), { origin, size: 120, address: 'Somewhere', now: 1 });
    expect(built.warnings).toEqual([]);
    const g = built.ground;
    expect(g.id).toBe(SITE_GROUND_ID);
    expect(g.type).toBe('terrain');
    expect(g.terrainData!.gridX).toBe(121);
    expect(g.terrainData!.site).toMatchObject({ size: 120, address: 'Somewhere', groundStyle: 'plain', showRemoved: false });
    expect(g.terrainData!.site!.elevation).toBeGreaterThan(0);
    expect(gridHeightAt(g.terrainData!, 0, 0)).toBeCloseTo(0, 3);
    expect(built.buildings).toHaveLength(1);
    expect(g.terrainData!.siteExisting).toHaveLength(1);
  });

  it('still gives flat ground and no buildings when the services fail', async () => {
    const built = await buildSite(io({
      heightTiles: async () => { throw new Error('offline'); },
      overpass: async () => { throw new Error('busy'); },
    }), { origin, size: 50 });
    expect(built.warnings).toHaveLength(2);
    expect(built.ground.terrainData!.heights.every(h => h === 0)).toBe(true);
    expect(built.buildings).toEqual([]);
  });

  it('replaces the previous site but keeps the design', async () => {
    const design: Shape = { id: 'wall1', type: 'wall', position: [0, 1, 0], args: [4, 2.8, 0.2], color: '#fff' };
    const first = await buildSite(io(), { origin, size: 60 });
    const model = replaceSite([design], first);
    expect(model.filter(isSiteShape)).toHaveLength(2);
    const second = await buildSite(io({ overpass: async () => ({ elements: [] }) }), { origin, size: 80 });
    const next = replaceSite(model, second);
    expect(next.map(s => s.id)).toEqual([SITE_GROUND_ID, 'wall1']);
    expect(findSiteGround(next)!.terrainData!.site!.size).toBe(80);
  });

  it('frames a satellite picture to exactly the site, without a key giving nothing', () => {
    expect(siteSatelliteUrl({ lat: 51.5, lng: -0.12, size: 200 }, '')).toBeNull();
    const url = new URL(siteSatelliteUrl({ lat: 51.5, lng: -0.12, size: 200 }, 'KEY')!);
    const zoom = Number(url.searchParams.get('zoom'));
    const px = Number(url.searchParams.get('size')!.split('x')[0]);
    expect(px).toBeLessThanOrEqual(640);
    expect(px * metresPerPixel(51.5, zoom)).toBeCloseTo(200, -1);
  });
});
