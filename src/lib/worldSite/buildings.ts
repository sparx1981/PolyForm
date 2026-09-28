/**
 * PolyForm — World View: the existing buildings on an imported site, from OpenStreetMap.
 *
 * Each building comes in as its own object (type 'site_building'): its outline from the map,
 * standing on the site's ground, as tall as the map says. Where the map has no height the height
 * is worked out from its number of floors (3 m each), and failing that from what kind of building
 * it is. Outlines are kept in the object so it can be selected, moved, deleted or put back.
 *
 * Map data © OpenStreetMap contributors, available under the Open Database Licence.
 */

import type { Shape, SiteBuildingData, SiteBuildingSnapshot } from '../../types';
import { type LatLng, latLngToLocal, siteBounds } from './geo';

export const BUILDING_SOURCE_NAME = 'OpenStreetMap';
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
/** Storey height used when the map gives only a number of floors. */
export const LEVEL_HEIGHT = 3;
/** Most buildings brought in for one site; the nearest to the centre are kept. */
export const MAX_SITE_BUILDINGS = 1500;
/** The colour of a white-model building. */
export const SITE_BUILDING_COLOR = '#f1f0ec';
export const SITE_BUILDING_TAG = 'world-site';

/** The Overpass query for every building (outline ways and multipolygon relations) in a site. */
export function overpassQuery(origin: LatLng, size: number): string {
  // A little margin, so buildings whose middle is inside but a corner outside come whole.
  const b = siteBounds(origin, size + 40);
  const box = `${b.south.toFixed(7)},${b.west.toFixed(7)},${b.north.toFixed(7)},${b.east.toFixed(7)}`;
  return `[out:json][timeout:25];(way["building"](${box});relation["building"]["type"="multipolygon"](${box}););out geom;`;
}

interface OsmPoint { lat: number; lon: number }
interface OsmWay { type: 'way'; id: number; tags?: Record<string, string>; geometry?: OsmPoint[] }
interface OsmMember { type: string; role?: string; geometry?: OsmPoint[] }
interface OsmRelation { type: 'relation'; id: number; tags?: Record<string, string>; members?: OsmMember[] }
type OsmElement = OsmWay | OsmRelation | { type: string; id: number; tags?: Record<string, string> };

/** A building as the map describes it: outline rings in latitude/longitude, and its tags. */
export interface MapBuilding {
  sourceId: string;
  outer: LatLng[];
  holes: LatLng[][];
  tags: Record<string, string>;
}

const toLatLng = (g: OsmPoint[] | undefined): LatLng[] => (g ?? []).map(p => ({ lat: p.lat, lng: p.lon }));
const same = (a: LatLng, b: LatLng) => Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9;

/** Drops the repeated closing point of a ring. */
function openRing(r: LatLng[]): LatLng[] {
  return r.length > 1 && same(r[0]!, r[r.length - 1]!) ? r.slice(0, -1) : r;
}

/** Joins a relation's way pieces end to end into closed rings. Pieces that never close are dropped. */
export function assembleRings(pieces: LatLng[][]): LatLng[][] {
  const left = pieces.filter(p => p.length >= 2).map(p => [...p]);
  const rings: LatLng[][] = [];
  while (left.length) {
    let ring = left.shift()!;
    let grew = true;
    while (!same(ring[0]!, ring[ring.length - 1]!) && grew) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const p = left[i]!;
        const end = ring[ring.length - 1]!;
        if (same(p[0]!, end)) ring = ring.concat(p.slice(1));
        else if (same(p[p.length - 1]!, end)) ring = ring.concat([...p].reverse().slice(1));
        else continue;
        left.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4 && same(ring[0]!, ring[ring.length - 1]!)) rings.push(openRing(ring));
  }
  return rings;
}

/** The buildings in an Overpass JSON answer. */
export function parseOverpassBuildings(json: { elements?: OsmElement[] }): MapBuilding[] {
  const out: MapBuilding[] = [];
  for (const el of json.elements ?? []) {
    const tags = el.tags ?? {};
    if (!tags.building || tags.building === 'no') continue;
    if (el.type === 'way') {
      const ring = openRing(toLatLng((el as OsmWay).geometry));
      if (ring.length >= 3) out.push({ sourceId: `osm:way/${el.id}`, outer: ring, holes: [], tags });
    } else if (el.type === 'relation') {
      const members = (el as OsmRelation).members ?? [];
      const outers = assembleRings(members.filter(m => m.type === 'way' && m.role !== 'inner').map(m => toLatLng(m.geometry)));
      const inners = assembleRings(members.filter(m => m.type === 'way' && m.role === 'inner').map(m => toLatLng(m.geometry)));
      outers.forEach((ring, i) => {
        if (ring.length < 3) return;
        const holes = inners.filter(h => h.length >= 3 && pointInRing(h[0]!, ring));
        out.push({ sourceId: `osm:relation/${el.id}${outers.length > 1 ? `#${i}` : ''}`, outer: ring, holes, tags });
      });
    }
  }
  return out;
}

function pointInRing(p: LatLng, ring: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.lat > p.lat) !== (b.lat > p.lat) && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside;
  }
  return inside;
}

/**
 * A length tag in metres: "12", "12 m", "12.5m", "40'", "40 ft", "40'6\"". Null when it can't
 * be read (or isn't positive).
 */
export function parseLength(v: string | undefined): number | null {
  if (!v) return null;
  const t = v.trim().toLowerCase().replace(',', '.');
  let m = /^(\d+(?:\.\d+)?)\s*(m|metres?|meters?)?$/.exec(t);
  if (m) return Number(m[1]) > 0 ? Number(m[1]) : null;
  m = /^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/.exec(t);
  if (m) {
    const metres = Number(m[1]) * 0.3048 + (m[2] ? Number(m[2]) * 0.0254 : 0);
    return metres > 0 ? metres : null;
  }
  return null;
}

const ONE_STOREY = new Set(['garage', 'garages', 'shed', 'hut', 'kiosk', 'carport', 'bungalow', 'cabin', 'greenhouse', 'toilets', 'service', 'container', 'barn', 'farm_auxiliary', 'static_caravan', 'transformer_tower', 'roof']);
const THREE_STOREY = new Set(['apartments', 'office', 'commercial', 'retail', 'hotel', 'school', 'university', 'hospital', 'civic', 'public', 'college', 'government']);

/** How tall a building is (and its underside, for canopies), from its tags. */
export function buildingHeight(tags: Record<string, string>): {
  height: number; minHeight: number; source: SiteBuildingData['heightSource']; levels?: number;
} {
  const kind = tags.building ?? 'yes';
  const levels = Number(tags['building:levels']);
  const roofLevels = Number(tags['roof:levels']);
  const hasLevels = Number.isFinite(levels) && levels > 0;
  const minLevel = Number(tags['building:min_level']);
  const minHeight = parseLength(tags.min_height)
    ?? (Number.isFinite(minLevel) && minLevel > 0 ? minLevel * LEVEL_HEIGHT : 0);

  const tagged = parseLength(tags.height);
  if (tagged !== null) {
    return { height: tagged, minHeight: Math.min(minHeight, tagged - 0.1), source: 'tagged', levels: hasLevels ? levels : undefined };
  }
  if (hasLevels) {
    // Rooms in the roof add a little: half a storey each.
    const extra = Number.isFinite(roofLevels) && roofLevels > 0 ? roofLevels * LEVEL_HEIGHT * 0.5 : 0;
    const height = levels * LEVEL_HEIGHT + extra;
    return { height, minHeight: Math.min(minHeight, height - 0.1), source: 'levels', levels };
  }
  // A canopy (building=roof) is a thin slab on posts.
  if (kind === 'roof') return { height: 3.3, minHeight: minHeight || 3, source: 'estimated' };
  const guess = ONE_STOREY.has(kind) ? 1 : THREE_STOREY.has(kind) ? 3 : 2;
  return { height: guess * LEVEL_HEIGHT, minHeight: Math.min(minHeight, guess * LEVEL_HEIGHT - 0.1), source: 'estimated', levels: guess };
}

/** Area (always positive) and centroid of a plan ring. */
export function ringAreaCentroid(ring: [number, number][]): { area: number; cx: number; cz: number } {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i]!, [x1, z1] = ring[(i + 1) % ring.length]!;
    const f = x0 * z1 - x1 * z0;
    a += f; cx += (x0 + x1) * f; cz += (z0 + z1) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = ring.length || 1;
    return { area: 0, cx: ring.reduce((s, p) => s + p[0], 0) / n, cz: ring.reduce((s, p) => s + p[1], 0) / n };
  }
  return { area: Math.abs(a / 2), cx: cx / (3 * a), cz: cz / (3 * a) };
}

const round = (v: number, step = 0.01) => Math.round(v / step) * step;

/** A readable name for a building: its name, else its address, else its kind. */
export function buildingName(tags: Record<string, string>): string {
  if (tags.name) return tags.name;
  const num = tags['addr:housenumber'] ?? tags['addr:housename'];
  const street = tags['addr:street'];
  if (num && street) return `${num} ${street}`;
  if (street) return street;
  const kind = tags.building && tags.building !== 'yes' ? tags.building.replace(/_/g, ' ') : 'building';
  return `Existing ${kind}`;
}

/** Shape id for a map building: stable, so importing the same site again gives the same ids. */
export function siteBuildingId(sourceId: string): string {
  return `site-${sourceId.replace(/^osm:/, '').replace(/[^a-zA-Z0-9]+/g, '-')}`;
}

/**
 * The map's buildings as PolyForm objects standing on the site's ground. Only buildings whose
 * middle is inside the site are kept (at most MAX_SITE_BUILDINGS, nearest the centre first).
 * `groundAt(x, z)` is the ground height (model y) at a plan point.
 */
export function siteBuildingShapes(
  buildings: MapBuilding[],
  origin: LatLng,
  size: number,
  groundAt: (x: number, z: number) => number,
): Shape[] {
  const half = size / 2;
  const seen = new Set<string>();
  const placed: { shape: Shape; dist: number }[] = [];
  for (const b of buildings) {
    const id = siteBuildingId(b.sourceId);
    if (seen.has(id)) continue;
    const ring = b.outer.map(p => latLngToLocal(origin, p));
    const { area, cx, cz } = ringAreaCentroid(ring);
    if (area < 4 || Math.abs(cx) > half || Math.abs(cz) > half) continue;
    seen.add(id);

    // Stand it on its lowest ground, and measure its height from the ground at its middle.
    const grounds = ring.map(([x, z]) => groundAt(x, z));
    const middle = groundAt(cx, cz);
    const base = Math.min(middle, ...grounds);
    const h = buildingHeight(b.tags);
    const lift = middle - base;
    const data: SiteBuildingData = {
      sourceId: b.sourceId,
      footprint: ring.map(([x, z]) => [round(x - cx), round(z - cz)]),
      height: round(h.height + lift),
      heightSource: h.source,
      kind: b.tags.building,
    };
    if (b.holes.length) data.holes = b.holes.map(hole => hole.map(p => latLngToLocal(origin, p)).map(([x, z]) => [round(x - cx), round(z - cz)] as [number, number]));
    if (h.minHeight > 0.05) data.minHeight = round(h.minHeight + lift);
    if (h.levels !== undefined) data.levels = h.levels;
    placed.push({
      dist: Math.hypot(cx, cz),
      shape: {
        id,
        name: buildingName(b.tags),
        type: 'site_building',
        position: [round(cx, 0.001), round(base, 0.001), round(cz, 0.001)],
        quaternion: [0, 0, 0, 1],
        args: [],
        color: SITE_BUILDING_COLOR,
        roughness: 0.9,
        metalness: 0,
        tags: [SITE_BUILDING_TAG],
        siteBuildingData: data,
      },
    });
  }
  return placed.sort((a, b) => a.dist - b.dist).slice(0, MAX_SITE_BUILDINGS).map(p => p.shape);
}

/**
 * A building given a new overall height (metres above its lowest ground). A fitted roof keeps
 * its shape and pitch and moves up or down with it; the height counts as known from then on.
 */
export function withBuildingHeight(data: SiteBuildingData, height: number): SiteBuildingData {
  const { heightCheck: _check, ...rest } = data;
  const next: SiteBuildingData = { ...rest, height, heightSource: 'tagged' };
  if (data.roof) {
    const d = height - data.roof.ridge;
    next.roof = { ...data.roof, eave: data.roof.eave + d, ridge: height, planes: data.roof.planes.map(([a, b, c]) => [a, b, c + d]) };
    if (next.roof.eave <= (data.minHeight ?? 0) + 0.5) delete next.roof;
  }
  if (next.minHeight !== undefined && next.minHeight >= (next.roof?.eave ?? height)) next.minHeight = Math.max(0, (next.roof?.eave ?? height) - 0.3);
  return next;
}

/** What's kept of each imported building, for ghosts and putting back. */
export function snapshotBuildings(shapes: Shape[]): SiteBuildingSnapshot[] {
  return shapes
    .filter(s => s.type === 'site_building' && s.siteBuildingData)
    .map(s => ({ id: s.id, name: s.name ?? 'Existing building', position: [...s.position] as [number, number, number], data: s.siteBuildingData! }));
}

/** An imported building rebuilt from its snapshot. */
export function shapeFromSnapshot(s: SiteBuildingSnapshot): Shape {
  return {
    id: s.id,
    name: s.name,
    type: 'site_building',
    position: [...s.position] as [number, number, number],
    quaternion: [0, 0, 0, 1],
    args: [],
    color: SITE_BUILDING_COLOR,
    roughness: 0.9,
    metalness: 0,
    tags: [SITE_BUILDING_TAG],
    siteBuildingData: s.data,
  };
}

/** Imported buildings that are no longer in the model (deleted): the ones drawn as ghosts. */
export function removedBuildings(existing: SiteBuildingSnapshot[] | undefined, shapes: Shape[]): SiteBuildingSnapshot[] {
  if (!existing?.length) return [];
  const present = new Set(shapes.map(s => s.id));
  return existing.filter(b => !present.has(b.id));
}
