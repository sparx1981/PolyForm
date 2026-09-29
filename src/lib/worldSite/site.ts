/**
 * PolyForm — World View: putting an imported site together.
 *
 * A site is one editable terrain (the real ground, heights relative to its centre) carrying where
 * it is on Earth, plus one object per existing building. Importing again replaces the previous
 * site's ground and buildings; everything else in the model is left alone.
 */

import type { Shape, SiteBuildingSnapshot, WorldSiteInfo } from '../../types';
import { type LatLng, clampSiteSize, localToLatLng, metresPerPixel } from './geo';
import { type HeightTile, TERRAIN_SOURCE_NAME, gridHeightAt, siteHeights, tileSampler, tilesFor } from './terrain';
import { BUILDING_SOURCE_NAME, overpassQuery, parseOverpassBuildings, siteBuildingShapes, snapshotBuildings } from './buildings';
import type { LidarData } from './lidar';
import { parseStreets, streetsQuery } from './streets';
import { alignmentShift, lidarBuildings, lidarGround, localGrid } from './lidarSite';

export const SITE_GROUND_ID = 'site-ground';
export const SITE_GROUND_COLOR = '#d9d7d0';

/** Where the data comes from; the browser versions are in fetchSite.ts, tests pass stand-ins. */
export interface SiteIO {
  heightTiles: (tiles: { x: number; y: number; z: number }[]) => Promise<HeightTile[]>;
  overpass: (query: string) => Promise<{ elements?: unknown[] }>;
  /** National LiDAR for the site, if any covers it (see lidar.ts). */
  lidar?: (origin: LatLng, size: number) => Promise<LidarData | null>;
}

export interface SiteRequest {
  origin: LatLng;
  size: number;
  address?: string;
  groundStyle?: WorldSiteInfo['groundStyle'];
  /** Leave the buildings out (ground only). */
  skipBuildings?: boolean;
  /** Don't look for LiDAR (global heights and map building heights only). */
  skipLidar?: boolean;
  /** Leave out the roads and paths cars and people move along. */
  skipStreets?: boolean;
  now?: number;
}

export interface BuiltSite {
  ground: Shape;
  buildings: Shape[];
  /** Things that didn't work, in words for the user (the site is still usable). */
  warnings: string[];
}

/** Fetches and builds a site. Missing heights give flat ground; missing buildings give none. */
export async function buildSite(io: SiteIO, req: SiteRequest): Promise<BuiltSite> {
  const size = clampSiteSize(req.size);
  const warnings: string[] = [];
  const half = size / 2;
  const corners = [localToLatLng(req.origin, -half, -half), localToLatLng(req.origin, half, half)];

  let heightAt: (p: LatLng) => number = () => 0;
  let terrainSource = TERRAIN_SOURCE_NAME;
  try {
    const tiles = await io.heightTiles(tilesFor(corners));
    if (!tiles.length) throw new Error('no height tiles');
    heightAt = tileSampler(tiles);
  } catch (err) {
    warnings.push(`Ground heights couldn't be loaded, so the ground is flat (${err instanceof Error ? err.message : String(err)}).`);
    terrainSource = 'Flat (heights unavailable)';
  }
  const grid = siteHeights(req.origin, size, heightAt);

  // National LiDAR, where there is some: 1 m ground, then real building heights and roofs.
  let lidar: LidarData | null = null;
  if (io.lidar && !req.skipLidar) {
    try {
      lidar = await io.lidar(req.origin, size);
    } catch (err) {
      warnings.push(`LiDAR couldn't be loaded, so ground and building heights are from the global data and the map (${err instanceof Error ? err.message : String(err)}).`);
    }
  }
  let elevation = grid.elevation;
  let heights = grid.heights;
  let lidarUsed = false;
  if (lidar?.dtm) {
    const coarse = { gridX: grid.gridX, gridY: grid.gridY, width: size, depth: size, heights: grid.heights };
    const fine = lidarGround(size, grid.gridX, localGrid(req.origin, size + 2, 1, lidar.dtm), (x, z) => gridHeightAt(coarse, x, z));
    if (fine) {
      heights = fine.heights;
      elevation = fine.elevation;
      terrainSource = lidar.source;
      lidarUsed = true;
    }
  }
  const terrainData = { gridX: grid.gridX, gridY: grid.gridY, width: size, depth: size, heights };

  let buildings: Shape[] = [];
  if (!req.skipBuildings) {
    try {
      const json = await io.overpass(overpassQuery(req.origin, size));
      buildings = siteBuildingShapes(parseOverpassBuildings(json as never), req.origin, size, (x, z) => gridHeightAt(terrainData, x, z));
    } catch (err) {
      warnings.push(`Buildings couldn't be loaded from OpenStreetMap (${err instanceof Error ? err.message : String(err)}). Try again in a minute.`);
    }
  }

  // Roads and paths for moving cars and people. Not worth a warning when missing: they're
  // fetched again the first time street life is shown.
  let routes: WorldSiteInfo['routes'];
  if (!req.skipStreets) {
    try {
      routes = parseStreets(await io.overpass(streetsQuery(req.origin, size)), req.origin, size);
    } catch { /* fetched later */ }
  }

  // Building heights and roofs from the surface model (only alongside its own ground model, so
  // both share one datum).
  let lidarShift: [number, number] | undefined;
  if (lidar?.dsm && lidarUsed && buildings.length) {
    const dsm = lidar.dsm;
    const surface = localGrid(req.origin, size + 60, 0.5, p => dsm(p) - elevation);
    const ground = (x: number, z: number) => gridHeightAt(terrainData, x, z);
    lidarShift = alignmentShift(
      buildings.map(b => b.siteBuildingData!.footprint.map(([x, z]) => [x + b.position[0], z + b.position[2]] as [number, number])),
      (x, z) => surface(x, z) - ground(x, z) > 2.5,
    );
    buildings = lidarBuildings(buildings, surface, ground, lidarShift);
  }

  const site: WorldSiteInfo = {
    lat: req.origin.lat,
    lng: req.origin.lng,
    size,
    ...(req.address ? { address: req.address } : {}),
    elevation: Math.round(elevation * 100) / 100,
    terrainSource,
    ...(lidarUsed && lidar ? { lidarSource: lidar.source } : {}),
    ...(lidarShift && (lidarShift[0] || lidarShift[1]) ? { lidarShift } : {}),
    buildingSource: BUILDING_SOURCE_NAME,
    importedAt: req.now ?? Date.now(),
    groundStyle: req.groundStyle ?? 'satellite',
    showRemoved: false,
    ...(routes ? { routes } : {}),
  };
  return { ground: siteGroundShape(site, terrainData, snapshotBuildings(buildings)), buildings, warnings };
}

/** The site's ground: an ordinary terrain (so every terrain tool works on it) that knows where it is. */
export function siteGroundShape(
  site: WorldSiteInfo,
  grid: { gridX: number; gridY: number; width: number; depth: number; heights: number[] },
  existing: SiteBuildingSnapshot[],
): Shape {
  return {
    id: SITE_GROUND_ID,
    name: site.address ? `Site ground – ${site.address}` : 'Site ground',
    type: 'terrain',
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
    args: [grid.width, grid.depth, grid.gridX],
    color: SITE_GROUND_COLOR,
    roughness: 0.95,
    metalness: 0,
    tags: ['world-site'],
    terrainData: {
      ...grid,
      baseHeights: [...grid.heights],
      shadingMode: 'default',
      textureScale: 1,
      topography: 'surveyed',
      site,
      siteExisting: existing,
    },
  };
}

/** Whether a shape belongs to an imported site (its ground or one of its buildings). */
export function isSiteShape(s: Shape): boolean {
  // Auto Street Light's lamps belong to the site too: they go when it goes.
  return s.type === 'site_building' || (s.type === 'terrain' && !!s.terrainData?.site) || s.id.startsWith('auto-street-light-');
}

/** The model with the previous site (if any) swapped for a new one. */
export function replaceSite(shapes: Shape[], built: Pick<BuiltSite, 'ground' | 'buildings'>): Shape[] {
  return [built.ground, ...shapes.filter(s => !isSiteShape(s)), ...built.buildings];
}

/** The imported site's ground in a model, if there is one. */
export function findSiteGround(shapes: Shape[]): Shape | undefined {
  return shapes.find(s => s.type === 'terrain' && !!s.terrainData?.site);
}

/**
 * A Google Static Maps satellite picture covering exactly the site (north up), for draping on
 * its ground. Built when drawn, never saved, so the API key isn't stored in the model.
 */
export function siteSatelliteUrl(site: Pick<WorldSiteInfo, 'lat' | 'lng' | 'size'>, apiKey: string): string | null {
  if (!apiKey) return null;
  // The most detailed zoom whose 640-pixel limit still covers the site.
  let zoom = 21;
  while (zoom > 1 && site.size / metresPerPixel(site.lat, zoom) > 640) zoom--;
  const px = Math.max(1, Math.round(site.size / metresPerPixel(site.lat, zoom)));
  const params = new URLSearchParams({
    center: `${site.lat.toFixed(7)},${site.lng.toFixed(7)}`,
    zoom: String(zoom),
    size: `${px}x${px}`,
    scale: '2',
    maptype: 'satellite',
    key: apiKey,
  });
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}
