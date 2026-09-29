/**
 * PolyForm — World View: the streets of an imported site, as routes for moving cars and people.
 *
 * Roads and footpaths come from OpenStreetMap as lines (nothing is drawn for them: the ground
 * shows through). Cars drive along the roads; people walk the footpaths and the pavements either
 * side of ordinary roads. The designer can add routes of their own, e.g. across a new garden.
 *
 * Map data © OpenStreetMap contributors, available under the Open Database Licence.
 */

import type { Shape, SiteRoute, StreetLifeLevel, WorldSiteInfo } from '../../types';
import { type LatLng, latLngToLocal, siteBounds } from './geo';

type P = [number, number];

/** The Overpass query for every road and path in a site (and a little beyond, so none stops short). */
export function streetsQuery(origin: LatLng, size: number): string {
  const b = siteBounds(origin, size + 40);
  const box = `${b.south.toFixed(7)},${b.west.toFixed(7)},${b.north.toFixed(7)},${b.east.toFixed(7)}`;
  return `[out:json][timeout:25];way["highway"](${box});out geom;`;
}

/** Road widths by kind, metres (a typical carriageway; pavements are added beside it). */
const ROAD_WIDTH: Record<string, number> = {
  motorway: 11, trunk: 10, primary: 8, secondary: 7.5, tertiary: 7, unclassified: 6,
  residential: 6, living_street: 5, service: 4, road: 6,
  motorway_link: 5, trunk_link: 5, primary_link: 5, secondary_link: 5, tertiary_link: 5,
};
/** Ways people walk on (and cars don't). */
const PATHS = new Set(['footway', 'path', 'pedestrian', 'steps', 'bridleway', 'track', 'corridor']);
/** Roads with no pavement worth walking beside. */
const NO_PAVEMENT = new Set(['motorway', 'trunk', 'motorway_link', 'trunk_link']);

interface OsmWay { type: string; id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }

/** Parts of a line inside a square `half` metres from the centre each way (Liang-Barsky per segment). */
export function clipToSquare(line: P[], half: number): P[][] {
  const out: P[][] = [];
  let run: P[] = [];
  const close = () => { if (run.length >= 2) out.push(run); run = []; };
  for (let i = 0; i + 1 < line.length; i++) {
    const [x0, z0] = line[i]!, [x1, z1] = line[i + 1]!;
    const dx = x1 - x0, dz = z1 - z0;
    let t0 = 0, t1 = 1;
    let inside = true;
    for (const [p, q] of [[-dx, x0 + half], [dx, half - x0], [-dz, z0 + half], [dz, half - z0]] as const) {
      if (p === 0) { if (q < 0) { inside = false; break; } continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) { inside = false; break; } if (r > t0) t0 = r; }
      else { if (r < t0) { inside = false; break; } if (r < t1) t1 = r; }
    }
    if (!inside) { close(); continue; }
    const a: P = [x0 + dx * t0, z0 + dz * t0], b: P = [x0 + dx * t1, z0 + dz * t1];
    const last = run[run.length - 1];
    if (!last || t0 > 0 || Math.hypot(last[0] - a[0], last[1] - a[1]) > 1e-6) { close(); run.push(a); }
    run.push(b);
    if (t1 < 1) close();
  }
  close();
  return out;
}

/** Length of a line, metres. */
export function lineLength(line: P[]): number {
  let d = 0;
  for (let i = 0; i + 1 < line.length; i++) d += Math.hypot(line[i + 1]![0] - line[i]![0], line[i + 1]![1] - line[i]![1]);
  return d;
}

/** The site's roads and footpaths from an Overpass answer, cut to the site (x east, z south). */
export function parseStreets(json: { elements?: unknown[] }, origin: LatLng, size: number): SiteRoute[] {
  const routes: SiteRoute[] = [];
  const half = size / 2;
  for (const el of (json.elements ?? []) as OsmWay[]) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const tags = el.tags ?? {};
    const hw = tags.highway ?? '';
    // Underground, private-access and area outlines aren't somewhere to see traffic.
    if (tags.area === 'yes' || tags.tunnel === 'yes' || tags.layer?.startsWith('-')) continue;
    const isPath = PATHS.has(hw) || (hw === 'cycleway' && /yes|designated/.test(tags.foot ?? ''));
    const width = ROAD_WIDTH[hw];
    if (!isPath && width === undefined) continue;
    if (!isPath && hw === 'service' && /parking_aisle|drive-through/.test(tags.service ?? '')) continue;
    const line = el.geometry.map(g => latLngToLocal(origin, { lat: g.lat, lng: g.lon }));
    clipToSquare(line, half).forEach((pts, k) => {
      if (lineLength(pts) < 3) return;
      const points = pts.map(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100] as P);
      const id = `osm-way-${el.id}${k ? `-${k}` : ''}`;
      if (isPath) routes.push({ id, kind: 'path', points, source: 'map' });
      else {
        const w = tags.width && Number.isFinite(parseFloat(tags.width)) ? parseFloat(tags.width) : width!;
        routes.push({
          id, kind: 'road', points, source: 'map', width: w,
          ...(tags.oneway === 'yes' || tags.junction === 'roundabout' ? { oneway: true } : {}),
          ...(NO_PAVEMENT.has(hw) || tags.sidewalk === 'no' ? { noPavement: true } : {}),
        });
      }
    });
  }
  return routes;
}

/** Whether traffic keeps left at a place (UK, Ireland, Japan, Australia, India...). Rough boxes. */
export function drivesOnLeft(p: LatLng): boolean {
  const boxes: [number, number, number, number][] = [
    // [south, west, north, east]
    [49.8, -8.7, 61, 1.9], // Great Britain and Ireland
    [24, 122.9, 46, 146], // Japan
    [-44, 112, -10, 154], // Australia
    [-47.5, 166, -34, 179], // New Zealand
    [6, 68, 36, 97.5], // India, Sri Lanka, Nepal, Bangladesh
    [-35, 16, -22, 33], // South Africa and neighbours
    [-5, 29, 5, 42], // Kenya, Uganda, Tanzania (north)
    [1, 99.5, 7, 104.5], // Malaysia, Singapore
    [-11, 95, 6, 141], // Indonesia
    [13.5, 97, 20.5, 106], // Thailand
    [22, 113.8, 22.6, 114.4], // Hong Kong
  ];
  // Myanmar sits inside the India box but drives on the right.
  if (p.lat > 10 && p.lat < 28.5 && p.lng > 92.2 && p.lng < 98.5) return false;
  return boxes.some(([s, w, n, e]) => p.lat >= s && p.lat <= n && p.lng >= w && p.lng <= e);
}

/** What the route tool draws next: a walking route (people) or a driving route (cars). */
export const routeTool: { kind: SiteRoute['kind'] } = { kind: 'path' };

/**
 * The model with a designer-drawn route added to its imported site. Points are in the model
 * (x, z); they're kept relative to the site ground so they move with it. Unchanged when there's
 * no site or fewer than two points.
 */
export function withDrawnRoute(shapes: Shape[], kind: SiteRoute['kind'], points: [number, number][], id = `drawn-${Math.random().toString(36).slice(2, 9)}`): Shape[] {
  if (points.length < 2) return shapes;
  return shapes.map(s => {
    const site = s.type === 'terrain' ? s.terrainData?.site : undefined;
    if (!site) return s;
    const route: SiteRoute = {
      id, kind, source: 'drawn',
      points: points.map(([x, z]) => [Math.round((x - s.position[0]) * 100) / 100, Math.round((z - s.position[2]) * 100) / 100]),
      // A drawn road is a drive or lane: no pavements beside it.
      ...(kind === 'road' ? { width: 4.5, noPavement: true } : {}),
    };
    return { ...s, terrainData: { ...s.terrainData!, site: { ...site, routes: [...(site.routes ?? []), route] } } };
  });
}

/** The model with some of its site's routes taken away (by id). */
export function withoutRoutes(shapes: Shape[], ids: string[]): Shape[] {
  const drop = new Set(ids);
  return shapes.map(s => {
    const site = s.type === 'terrain' ? s.terrainData?.site : undefined;
    if (!site?.routes?.some(r => drop.has(r.id))) return s;
    return { ...s, terrainData: { ...s.terrainData!, site: { ...site, routes: site.routes.filter(r => !drop.has(r.id)) } } };
  });
}

/** The model with its imported site's settings changed (e.g. how busy the street is). */
export function withSiteSettings(shapes: Shape[], patch: Partial<Pick<WorldSiteInfo, 'streetLife' | 'streetLifeInEditor'>>): Shape[] {
  return shapes.map(s => (s.type === 'terrain' && s.terrainData?.site
    ? { ...s, terrainData: { ...s.terrainData, site: { ...s.terrainData.site, ...patch } } }
    : s));
}

export const STREET_LIFE_LEVELS: { id: StreetLifeLevel; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'quiet', label: 'Quiet' },
  { id: 'normal', label: 'Normal' },
  { id: 'busy', label: 'Busy' },
];
