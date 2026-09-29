import { describe, expect, it } from 'vitest';
import { writeArrayBuffer } from 'geotiff';
import * as THREE from 'three';
import { alignmentShift, fitRoof, interiorPoints, lidarBuildings, lidarGround, localGrid, minimumRectangle, type RoofSample } from './lidarSite';
import { pitchedBuildingGeometry, roofHeightAt } from './roofGeometry';
import { readGeoTiff, sampleRaster } from './raster';
import { loadLidar, wcsAxes, wcsCoverageIds, ENGLAND_LIDAR, type Fetcher } from './lidar';
import { withBuildingHeight } from './buildings';
import { buildSite, type SiteIO } from './site';
import { localToLatLng, latLngToLocal } from './geo';
import type { Shape, SiteBuildingData } from '../../types';

type P = [number, number];
const rect = (w: number, d: number, cx = 0, cz = 0): P[] => [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2]];

/** Roof samples every 0.5 m inside an outline from a height function, with a little noise. */
function samplesOf(ring: P[], h: (x: number, z: number) => number, noise = 0.05): RoofSample[] {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  return interiorPoints(ring, 0.5, 0.5).map(([x, z]) => ({ x, z, h: h(x, z) + rand() * noise }));
}

describe('roof fitting', () => {
  const house = rect(10, 8);

  it('finds a gable, its eaves, ridge and pitch', () => {
    // Ridge along x (the long side), 35°.
    const slope = Math.tan(35 * Math.PI / 180);
    const roof = fitRoof(samplesOf(house, (_x, z) => 5 + slope * (4 - Math.abs(z))), house)!;
    expect(roof.shape).toBe('gable');
    expect(roof.eave).toBeCloseTo(5, 0);
    expect(roof.ridge).toBeCloseTo(5 + slope * 4, 0);
    expect(roof.pitch).toBeGreaterThan(32);
    expect(roof.pitch).toBeLessThan(38);
    expect(roofHeightAt(roof.planes, 0, 0)).toBeCloseTo(roof.ridge, 0);
    expect(roofHeightAt(roof.planes, 0, 4)).toBeCloseTo(5, 0);
  });

  it('finds a gable turned the other way', () => {
    const roof = fitRoof(samplesOf(house, (x) => 4 + 0.8 * (5 - Math.abs(x))), house)!;
    expect(roof.shape).toBe('gable');
    expect(roofHeightAt(roof.planes, 0, 3)).toBeGreaterThan(roofHeightAt(roof.planes, 4, 3) + 2);
  });

  it('finds hipped and pyramid roofs', () => {
    const hip = fitRoof(samplesOf(house, (x, z) => 5 + 0.7 * Math.min(4 - Math.abs(z), 5 - Math.abs(x))), house)!;
    expect(hip.shape).toBe('hip');
    const square = rect(8, 8);
    const pyramid = fitRoof(samplesOf(square, (x, z) => 3 + 0.9 * Math.min(4 - Math.abs(z), 4 - Math.abs(x))), square)!;
    expect(pyramid.shape).toBe('pyramid');
  });

  it('calls flat roofs flat, even with a chimney and some clutter', () => {
    const roof = fitRoof(samplesOf(rect(20, 14), (x, z) => (Math.hypot(x - 3, z - 2) < 0.8 ? 9.5 : 7.2), 0.1), rect(20, 14))!;
    expect(roof.shape).toBe('flat');
    expect(roof.ridge).toBeCloseTo(7.2, 0);
  });

  it('finds a lean-to', () => {
    const roof = fitRoof(samplesOf(rect(6, 4), (x) => 3 + 0.3 * x), rect(6, 4))!;
    expect(roof.shape).toBe('skillion');
    expect(roof.pitch).toBeCloseTo(16.7, 0);
  });

  it('works on a turned building', () => {
    const turn = 0.6;
    const c = Math.cos(turn), s = Math.sin(turn);
    const ring = rect(12, 7).map(([x, z]) => [x * c - z * s, x * s + z * c] as P);
    const r = minimumRectangle(ring);
    expect(r.halfLength).toBeCloseTo(6, 3);
    expect(r.halfWidth).toBeCloseTo(3.5, 3);
    // Gable with its ridge along the long side, in the turned frame.
    const roof = fitRoof(samplesOf(ring, (x, z) => 5 + 0.7 * (3.5 - Math.abs(-x * s + z * c))), ring)!;
    expect(roof.shape).toBe('gable');
    expect(roof.ridge).toBeCloseTo(5 + 0.7 * 3.5, 0);
  });
});

describe('LiDAR over a site', () => {
  it('lines the LiDAR up with the outlines', () => {
    const outlines = [rect(10, 8, -20, 0), rect(12, 9, 15, 10), rect(8, 8, 0, -25), rect(14, 6, 25, -20)];
    // The survey has every building 3 m east and 2 m north (-z) of the map.
    const tall = (x: number, z: number) => outlines.some(o => {
      const xs = o.map(p => p[0]), zs = o.map(p => p[1]);
      return x - 3 >= Math.min(...xs) && x - 3 <= Math.max(...xs) && z + 2 >= Math.min(...zs) && z + 2 <= Math.max(...zs);
    });
    expect(alignmentShift(outlines, tall)).toEqual([3, -2]);
    // Already lined up: no shift.
    expect(alignmentShift(outlines, (x, z) => tall(x + 3, z - 2))).toEqual([0, 0]);
  });

  const building = (id: string, cx: number, cz: number, height = 6): Shape => ({
    id, type: 'site_building', position: [cx, 0, cz], args: [], color: '#f1f0ec',
    siteBuildingData: { sourceId: id, footprint: rect(10, 8), height, heightSource: 'estimated' },
  });

  it('measures heights and roofs, and flags buildings the survey doesn\'t show', () => {
    const surface = (x: number, z: number) => {
      // A gabled house at (0, 0): eaves 5 m, ridge 7.8 m.
      if (Math.abs(x) <= 5 && Math.abs(z) <= 4) return 5 + 0.7 * (4 - Math.abs(z));
      return 0;
    };
    const out = lidarBuildings([building('a', 0, 0), building('b', 40, 0)], surface, () => 0, [0, 0]);
    const a = out[0]!.siteBuildingData!;
    expect(a.heightSource).toBe('lidar');
    expect(a.roof?.shape).toBe('gable');
    expect(a.height).toBeCloseTo(7.8, 0);
    expect(a.heightCheck).toBeUndefined();
    const b = out[1]!.siteBuildingData!;
    expect(b.heightCheck).toBe(true);
    expect(b.height).toBe(6);
    expect(b.heightSource).toBe('estimated');
  });

  it('leaves buildings alone where there is no survey', () => {
    const out = lidarBuildings([building('a', 0, 0)], () => NaN, () => 0, [0, 0]);
    expect(out[0]!.siteBuildingData).toEqual(building('a', 0, 0).siteBuildingData);
  });

  it('builds the ground from the DTM and fills its gaps', () => {
    const dtm = (x: number, z: number) => (x > 30 ? NaN : 100 + x * 0.1);
    const g = lidarGround(100, 101, dtm, () => -1)!;
    expect(g.elevation).toBeCloseTo(100, 6);
    expect(g.heights[50 * 101 + 60]).toBeCloseTo(1, 3); // x = 10
    expect(g.heights[50 * 101 + 100]).toBe(-1); // x = 50: filled
    expect(lidarGround(100, 101, () => NaN, () => 0)).toBeNull();
  });

  it('resamples onto a local grid, skipping gaps', () => {
    const origin = { lat: 52, lng: 0 };
    const sampler = localGrid(origin, 20, 0.5, p => { const [x] = latLngToLocal(origin, p); return x < 5 ? x : NaN; });
    expect(sampler(2.25, 1)).toBeCloseTo(2.25, 3);
    expect(sampler(8, 0)).toBeNaN();
    expect(sampler(50, 0)).toBeNaN();
  });
});

describe('pitched roof geometry', () => {
  const data = (roof: ReturnType<typeof fitRoof>): SiteBuildingData => ({ sourceId: 'x', footprint: rect(10, 8), height: roof!.ridge, heightSource: 'lidar', roof: roof! });
  const gable = fitRoof(samplesOf(rect(10, 8), (_x, z) => 5 + 0.7 * (4 - Math.abs(z)), 0), rect(10, 8));

  it('builds walls up to the eaves with gable ends, and the roof to the ridge', () => {
    const geo = pitchedBuildingGeometry(data(gable))!;
    geo.computeBoundingBox();
    expect(geo.boundingBox!.max.y).toBeCloseTo(7.8, 1);
    expect(geo.boundingBox!.min.y).toBe(0);
    // The gable-end wall reaches the ridge at the middle of the short side.
    const pos = geo.attributes.position!;
    let gablePeak = false;
    for (let i = 0; i < pos.count; i++) if (Math.abs(Math.abs(pos.getX(i)) - 5) < 1e-6 && Math.abs(pos.getZ(i)) < 1e-6 && pos.getY(i) > 7.7) gablePeak = true;
    expect(gablePeak).toBe(true);
    // Closed: roof area over the footprint is at least the plan area.
    let roofArea = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
      const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
      if (Math.abs(n.y) / n.length() > 0.3 && Math.min(a.y, b.y, c.y) > 1) roofArea += n.length() / 2;
    }
    expect(roofArea).toBeGreaterThan(80);
  });

  it('is only for pitched roofs', () => {
    expect(pitchedBuildingGeometry({ sourceId: 'x', footprint: rect(4, 4), height: 3, heightSource: 'levels' })).toBeNull();
  });

  it('moves a fitted roof with a typed height, keeping its pitch', () => {
    const d = withBuildingHeight(data(gable), 10);
    expect(d.roof!.ridge).toBe(10);
    expect(d.roof!.eave).toBeCloseTo(7.2, 1);
    expect(d.heightSource).toBe('tagged');
    expect(roofHeightAt(d.roof!.planes, 0, 0)).toBeCloseTo(10, 1);
  });
});

describe('LiDAR services', () => {
  it('reads coverage ids and axis names from WCS answers', () => {
    expect(wcsCoverageIds('<wcs:Contents><wcs:CoverageSummary><wcs:CoverageId>abc__Lidar_Composite_Elevation_DTM_1m</wcs:CoverageId></wcs:CoverageSummary><wcs:CoverageSummary><CoverageId> dsm_05m </CoverageId></wcs:CoverageSummary></wcs:Contents>'))
      .toEqual(['abc__Lidar_Composite_Elevation_DTM_1m', 'dsm_05m']);
    expect(wcsAxes('<gml:Envelope axisLabels="N E" srsName="...">')).toEqual(['E', 'N']);
    expect(wcsAxes('<gml:Envelope axisLabels="x y">')).toEqual(['x', 'y']);
    expect(wcsAxes('<nothing/>')).toEqual(['E', 'N']);
  });

  it('reads a GeoTIFF and samples it by map position', async () => {
    const buffer = writeArrayBuffer(new Float32Array([1, 2, 3, 4, 5, 6]), {
      width: 3, height: 2, ModelPixelScale: [1, 1, 0], ModelTiepoint: [0, 0, 0, 1000, 2000, 0], GeographicTypeGeoKey: 4326, GeogCitationGeoKey: 'WGS 84',
    } as never);
    const r = await readGeoTiff(buffer as ArrayBuffer);
    expect([r.x0, r.y0, r.width, r.height, r.dx, r.dy]).toEqual([1000, 2000, 3, 2, 1, 1]);
    expect(sampleRaster(r, 1000.5, 1999.5)).toBeCloseTo(1);
    expect(sampleRaster(r, 1001, 1999.5)).toBeCloseTo(1.5);
    expect(sampleRaster(r, 1002.5, 1998.5)).toBeCloseTo(6);
    expect(sampleRaster(r, 900, 1999)).toBeNaN();
  });

  it('asks the Environment Agency for its layers over the site, in British grid metres', async () => {
    const asked: string[] = [];
    const get: Fetcher = async url => {
      asked.push(url);
      if (url.includes('GetCapabilities')) return new Response(`<CoverageId>${url.includes('terrain') ? 'x__DTM_1m' : 'y__DSM_1m'}</CoverageId>`);
      if (url.includes('DescribeCoverage')) return new Response('<gml:Envelope axisLabels="E N">');
      return new Response('<ServiceException>out of area</ServiceException>', { headers: { 'content-type': 'text/xml' } });
    };
    // Out of area: nothing, and the site falls back quietly.
    expect(await ENGLAND_LIDAR.load({ lat: 51.5, lng: -0.12 }, 100, get)).toBeNull();
    const coverage = asked.find(u => u.includes('GetCoverage') && u.includes('DTM'))!;
    const [, e0, e1] = /subset=E\((\d+),(\d+)\)/.exec(coverage)!.map(Number);
    expect(e1! - e0!).toBeGreaterThanOrEqual(124);
    expect(e0).toBeGreaterThan(529000);
    expect(e1).toBeLessThan(531000);
  });

  it('gives up quietly outside every source', async () => {
    expect(await loadLidar({ lat: -33.9, lng: 151.2 }, 100, async () => { throw new Error('should not be asked'); })).toBeNull();
  });
});

describe('site import with LiDAR', () => {
  const origin = { lat: 52.37, lng: 4.89 };
  const way = (id: number, cx: number, cz: number) => {
    const pts = rect(10, 8, cx, cz).concat([rect(10, 8, cx, cz)[0]!]).map(([x, z]) => localToLatLng(origin, x, z));
    return { type: 'way', id, tags: { building: 'house' }, geometry: pts.map(p => ({ lat: p.lat, lon: p.lng })) };
  };
  const io: SiteIO = {
    heightTiles: async tiles => tiles.map(t => ({ ...t, heights: new Float32Array(256 * 256).fill(3) })),
    overpass: async () => ({ elements: [way(1, 0, 0), way(2, 40, 20)] }),
    lidar: async () => ({
      source: 'Test LiDAR',
      licence: 'test',
      // Ground rising 5 cm per metre east from 1 m above the datum; a gabled house at the centre.
      dtm: p => { const [x] = latLngToLocal(origin, p); return 1 + 0.05 * x; },
      dsm: p => {
        const [x, z] = latLngToLocal(origin, p);
        const ground = 1 + 0.05 * x;
        return Math.abs(x) <= 5 && Math.abs(z) <= 4 ? ground + 5 + 0.7 * (4 - Math.abs(z)) : ground;
      },
    }),
  };

  it('uses LiDAR ground, heights and roofs, and flags what the survey doesn\'t show', async () => {
    const built = await buildSite(io, { origin, size: 100 });
    const site = built.ground.terrainData!.site!;
    expect(site.lidarSource).toBe('Test LiDAR');
    expect(site.terrainSource).toBe('Test LiDAR');
    expect(site.elevation).toBeCloseTo(1, 1);
    const heights = built.ground.terrainData!.heights;
    expect(heights[50 * 101 + 100]).toBeCloseTo(2.5, 1); // 50 m east: 2.5 m up
    const [house, empty] = built.buildings;
    expect(house!.siteBuildingData!.roof?.shape).toBe('gable');
    expect(house!.siteBuildingData!.heightSource).toBe('lidar');
    expect(empty!.siteBuildingData!.heightCheck).toBe(true);
  });

  it('skips LiDAR when asked', async () => {
    const built = await buildSite(io, { origin, size: 100, skipLidar: true });
    expect(built.ground.terrainData!.site!.lidarSource).toBeUndefined();
    expect(built.buildings[0]!.siteBuildingData!.roof).toBeUndefined();
  });
});

describe('pitched roof winding', () => {
  it('faces every triangle outwards', () => {
    for (const ring of [rect(10, 8), rect(10, 8).reverse()]) {
      const roof = fitRoof(samplesOf(ring, (x, z) => 5 + 0.7 * Math.min(4 - Math.abs(z), 5 - Math.abs(x)), 0), ring)!;
      const geo = pitchedBuildingGeometry({ sourceId: 'x', footprint: ring, height: roof.ridge, heightSource: 'lidar', roof })!;
      const pos = geo.attributes.position!;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      const centre = new THREE.Vector3(0, roof.eave / 2, 0);
      for (let i = 0; i < pos.count; i += 3) {
        a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
        const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
        const mid = a.clone().add(b).add(c).divideScalar(3);
        expect(n.dot(mid.sub(centre))).toBeGreaterThan(0);
      }
    }
  });
});
