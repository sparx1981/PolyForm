/**
 * PolyForm — World View: national LiDAR, for 1 m ground and real building heights and roofs.
 *
 * Each source gives a bare-ground model (DTM) and, where published, a surface model (DSM: the
 * tops of roofs and trees). Heights of buildings come from the difference.
 *
 *  - England: Environment Agency LiDAR Composite, 1 m (DTM and first-return DSM), Open
 *    Government Licence. British National Grid.
 *  - Netherlands: AHN (Actueel Hoogtebestand Nederland), 0.5 m DTM and DSM via PDOK, CC0.
 *    RD New grid.
 *  - USA: USGS 3DEP, 1 m where flown (DTM only: there's no national surface model), public domain.
 *
 * The WCS services are asked what they hold first (GetCapabilities / DescribeCoverage), so a
 * renamed layer is still found. A source with no data at the site (e.g. Scotland for the
 * Environment Agency) gives null, and the site keeps the global heights and map building heights.
 */

import { type LatLng, localToLatLng } from './geo';
import { toBritishGrid, toDutchGrid } from './projections';
import { type Raster, readGeoTiff, sampleRaster } from './raster';

/** Fetches a URL (the browser version falls back to the app's relay when a service blocks browsers). */
export type Fetcher = (url: string) => Promise<Response>;

export interface LidarData {
  /** Name for the user, e.g. "Environment Agency LiDAR (1 m)". */
  source: string;
  /** Bare-ground height (metres above the national datum) at a point, NaN where unknown. */
  dtm: ((p: LatLng) => number) | null;
  /** Surface height (roofs, trees) at a point, NaN where unknown. */
  dsm: ((p: LatLng) => number) | null;
  licence: string;
}

export interface LidarSource {
  id: string;
  /** Rough test: could this source hold data here? (It may still have none.) */
  covers: (p: LatLng) => boolean;
  load: (origin: LatLng, size: number, get: Fetcher) => Promise<LidarData | null>;
}

/** Map units per site metre are close to 1 for the national grids; this margin covers alignment. */
const MARGIN = 12;

/** The site's corners (with a margin) in a projected grid, rounded outwards to whole metres. */
function gridBox(origin: LatLng, size: number, project: (p: LatLng) => { e: number; n: number }) {
  const half = size / 2 + MARGIN;
  const pts = [[-half, -half], [half, -half], [half, half], [-half, half]].map(([x, z]) => project(localToLatLng(origin, x, z)));
  return {
    minE: Math.floor(Math.min(...pts.map(p => p.e))),
    maxE: Math.ceil(Math.max(...pts.map(p => p.e))),
    minN: Math.floor(Math.min(...pts.map(p => p.n))),
    maxN: Math.ceil(Math.max(...pts.map(p => p.n))),
  };
}

/** The coverage ids a WCS GetCapabilities answer lists. */
export function wcsCoverageIds(xml: string): string[] {
  return [...xml.matchAll(/<(?:[\w-]+:)?CoverageId>\s*([^<\s]+)\s*<\//g)].map(m => m[1]!);
}

/** The two horizontal axis names a WCS DescribeCoverage answer gives, easting first. */
export function wcsAxes(xml: string): [string, string] {
  const labels = /axisLabels="([^"]+)"/.exec(xml)?.[1]?.trim().split(/\s+/) ?? [];
  if (labels.length >= 2) {
    const east = labels.find(l => /^(e|x|east|easting|long?)/i.test(l)) ?? labels[0]!;
    const north = labels.find(l => l !== east) ?? labels[1]!;
    return [east, north];
  }
  return ['E', 'N'];
}

const capsCache = new Map<string, Promise<string[]>>();

/** Fetches one coverage from a WCS 2.0 service as a raster, over a box in its native grid. */
export async function wcsRaster(
  get: Fetcher,
  service: string,
  pick: RegExp,
  box: { minE: number; maxE: number; minN: number; maxN: number },
): Promise<Raster | null> {
  const base = `${service}?service=WCS&version=2.0.1`;
  let ids = capsCache.get(service);
  if (!ids) {
    ids = get(`${base}&request=GetCapabilities`).then(r => r.text()).then(wcsCoverageIds);
    capsCache.set(service, ids);
    ids.catch(() => capsCache.delete(service));
  }
  const list = await ids;
  const id = list.find(i => pick.test(i));
  if (!id) return null;
  const axes = wcsAxes(await (await get(`${base}&request=DescribeCoverage&CoverageId=${encodeURIComponent(id)}`)).text());
  const url = `${base}&request=GetCoverage&CoverageId=${encodeURIComponent(id)}&format=image/tiff`
    + `&subset=${axes[0]}(${box.minE},${box.maxE})&subset=${axes[1]}(${box.minN},${box.maxN})`;
  const res = await get(url);
  const type = res.headers.get('content-type') ?? '';
  if (/xml|html|text/.test(type)) return null; // a service exception: nothing here
  return readGeoTiff(await res.arrayBuffer());
}

/** How much of a raster over the site is real data (0 to 1). */
function coverage(sample: (p: LatLng) => number, origin: LatLng, size: number): number {
  let hit = 0, total = 0;
  for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) {
    total++;
    if (Number.isFinite(sample(localToLatLng(origin, (i / 8 - 0.5) * size, (j / 8 - 0.5) * size)))) hit++;
  }
  return hit / total;
}

/** A sampler over a raster in a projected grid. */
const gridSampler = (r: Raster | null, project: (p: LatLng) => { e: number; n: number }) =>
  r ? (p: LatLng) => { const g = project(p); return sampleRaster(r, g.e, g.n); } : null;

/** Loads a DTM + DSM pair from WCS services; null when neither has data at the site. */
async function wcsPair(
  origin: LatLng, size: number, get: Fetcher,
  project: (p: LatLng) => { e: number; n: number },
  dtm: { service: string; pick: RegExp }[],
  dsm: { service: string; pick: RegExp }[],
): Promise<{ dtm: ((p: LatLng) => number) | null; dsm: ((p: LatLng) => number) | null } | null> {
  const box = gridBox(origin, size, project);
  const first = async (options: { service: string; pick: RegExp }[]) => {
    for (const o of options) {
      try {
        const sampler = gridSampler(await wcsRaster(get, o.service, o.pick, box), project);
        if (sampler && coverage(sampler, origin, size) > 0.3) return sampler;
      } catch { /* try the next */ }
    }
    return null;
  };
  const [t, s] = await Promise.all([first(dtm), first(dsm)]);
  return t || s ? { dtm: t, dsm: s } : null;
}

const EA = 'https://environment.data.gov.uk/spatialdata';

export const ENGLAND_LIDAR: LidarSource = {
  id: 'ea',
  covers: p => p.lat > 49.8 && p.lat < 55.95 && p.lng > -6.5 && p.lng < 2.0,
  load: async (origin, size, get) => {
    const pair = await wcsPair(origin, size, get, toBritishGrid,
      [{ service: `${EA}/lidar-composite-digital-terrain-model-dtm-1m/wcs`, pick: /dtm|terrain/i }],
      [
        { service: `${EA}/lidar-composite-digital-surface-model-first-return-dsm-1m/wcs`, pick: /dsm|surface/i },
        { service: `${EA}/lidar-composite-digital-surface-model-last-return-dsm-1m/wcs`, pick: /dsm|surface/i },
      ]);
    return pair && { ...pair, source: 'Environment Agency LiDAR (1 m)', licence: 'Contains Environment Agency information © Environment Agency, Open Government Licence' };
  },
};

const PDOK_AHN = 'https://service.pdok.nl/rws/ahn/wcs/v1_0';

export const DUTCH_LIDAR: LidarSource = {
  id: 'ahn',
  covers: p => p.lat > 50.7 && p.lat < 53.7 && p.lng > 3.2 && p.lng < 7.3,
  load: async (origin, size, get) => {
    const pair = await wcsPair(origin, size, get, toDutchGrid,
      [{ service: PDOK_AHN, pick: /dtm_05m/i }, { service: PDOK_AHN, pick: /dtm/i }],
      [{ service: PDOK_AHN, pick: /dsm_05m/i }, { service: PDOK_AHN, pick: /dsm/i }]);
    return pair && { ...pair, source: 'AHN (0.5 m, PDOK)', licence: 'AHN, CC0' };
  },
};

const USGS_3DEP = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage';

export const US_LIDAR: LidarSource = {
  id: '3dep',
  covers: p => (p.lat > 24 && p.lat < 50 && p.lng > -125 && p.lng < -66) || (p.lat > 51 && p.lat < 72 && p.lng > -170 && p.lng < -129) || (p.lat > 18 && p.lat < 23 && p.lng > -161 && p.lng < -154),
  load: async (origin, size, get) => {
    const half = size / 2 + MARGIN;
    const sw = localToLatLng(origin, -half, half), ne = localToLatLng(origin, half, -half);
    const px = Math.min(1024, Math.ceil(half * 2));
    const url = `${USGS_3DEP}?bbox=${sw.lng},${sw.lat},${ne.lng},${ne.lat}&bboxSR=4326&imageSR=4326&size=${px},${px}`
      + '&format=tiff&pixelType=F32&noData=-9999&interpolation=RSP_BilinearInterpolation&f=image';
    const res = await get(url);
    if (/xml|html|json|text/.test(res.headers.get('content-type') ?? '')) return null;
    const r = await readGeoTiff(await res.arrayBuffer());
    const dtm = (p: LatLng) => sampleRaster(r, p.lng, p.lat);
    if (coverage(dtm, origin, size) < 0.3) return null;
    return { dtm, dsm: null, source: 'USGS 3DEP (1 m where flown)', licence: 'USGS 3DEP, public domain' };
  },
};

export const LIDAR_SOURCES: LidarSource[] = [ENGLAND_LIDAR, DUTCH_LIDAR, US_LIDAR];

/** The first source with data at the site, or null. Failures are reported through `onError`. */
export async function loadLidar(origin: LatLng, size: number, get: Fetcher, onError?: (source: string, err: unknown) => void): Promise<LidarData | null> {
  for (const s of LIDAR_SOURCES) {
    if (!s.covers(origin)) continue;
    try {
      const data = await s.load(origin, size, get);
      if (data) return data;
    } catch (err) {
      onError?.(s.id, err);
    }
  }
  return null;
}

/** Hosts the app's relay (api/lidar-proxy) will fetch from. */
export const LIDAR_HOSTS = ['environment.data.gov.uk', 'service.pdok.nl', 'elevation.nationalmap.gov'];
