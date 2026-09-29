/**
 * PolyForm — World View: how an existing building should look, from what the map says it is.
 *
 * A building's kind (house, warehouse, church, office ...), its height and its floors decide the
 * wall material, the roof, and the pattern of windows and doors. Nothing here is a photograph:
 * walls use real PBR materials at true scale, windows and doors are generated from the floors
 * and the length of each wall, and roofs take the colour seen from above. Where the map gives a
 * colour or material (building:colour, building:material, roof:colour, roof:material) that wins.
 */

import type { SiteBuildingData } from '../../types';
import { mapColour } from './googleTiles';

export type WallMaterial = 'brick' | 'render' | 'stone' | 'concrete' | 'metal' | 'glass';
export type RoofMaterial = 'tiles' | 'metal' | 'flat';
export type WindowPattern = 'none' | 'punched' | 'ribbon' | 'curtain' | 'high' | 'lancet' | 'shopfront' | 'glazed';
export type DoorKind = 'none' | 'front' | 'roller';

export const PATTERN_CODE: Record<WindowPattern, number> = { none: 0, punched: 1, ribbon: 2, curtain: 3, high: 4, lancet: 5, shopfront: 6, glazed: 7 };
export const DOOR_CODE: Record<DoorKind, number> = { none: 0, front: 1, roller: 2 };

export interface BuildingProfile {
  /** What sort of building this was treated as, for the panel and tests. */
  category: BuildingCategory;
  wall: WallMaterial;
  /** Colour multiplied over the wall material (near white for a natural look). */
  wallTint: string;
  roof: RoofMaterial;
  roofTint: string;
  pattern: WindowPattern;
  door: DoorKind;
  storeys: number;
  /** Height of one floor, metres (the eave height shared out between the floors). */
  storeyHeight: number;
  /** Window rhythm along a wall, metres. */
  bayWidth: number;
  windowWidth: number;
  windowHeight: number;
  /** Height of a window's bottom above its floor. */
  sill: number;
  /** Height of the wall tops (where the roof starts), above the building's base. */
  eave: number;
}

export type BuildingCategory =
  | 'house' | 'apartments' | 'retail' | 'office' | 'tower' | 'industrial' | 'garage' | 'religious' | 'civic' | 'glasshouse' | 'other';

const HOUSES = /^(house|detached|semidetached_house|terrace|terraced_house|residential|bungalow|cabin|farm|static_caravan|houseboat|semi)$/;
const FLATS = /^(apartments|dormitory|hotel|flats|block)$/;
const SHOPS = /^(retail|supermarket|kiosk|shop|mall|commercial)$/;
const OFFICES = /^(office|bank|government)$/;
const INDUSTRIAL = /^(industrial|warehouse|factory|hangar|manufacture|storage_tank|service|depot|barn|farm_auxiliary|stable|cowshed|shed)$/;
const GARAGES = /^(garage|garages|carport|parking|hut)$/;
const RELIGIOUS = /^(church|cathedral|chapel|mosque|temple|synagogue|monastery|shrine|religious)$/;
const CIVIC = /^(school|university|college|hospital|civic|public|train_station|kindergarten|fire_station|sports_hall|stadium|museum|theatre|library)$/;
const GLASSHOUSE = /^(greenhouse|conservatory)$/;

/** Tall enough to be treated as a tower, whatever the map calls it. */
export const TOWER_HEIGHT = 38;

/** Deterministic 0..1 from a string and a salt, so the same building always looks the same. */
export function hash01(text: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13; h = Math.imul(h, 3266489917); h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

export function categoryOf(kind: string | undefined, height: number): BuildingCategory {
  const k = (kind ?? '').trim().toLowerCase();
  if (height >= TOWER_HEIGHT && !GLASSHOUSE.test(k) && !RELIGIOUS.test(k) && !INDUSTRIAL.test(k)) return 'tower';
  if (HOUSES.test(k)) return 'house';
  if (FLATS.test(k)) return 'apartments';
  if (OFFICES.test(k)) return 'office';
  if (SHOPS.test(k)) return 'retail';
  if (INDUSTRIAL.test(k)) return 'industrial';
  if (GARAGES.test(k)) return 'garage';
  if (RELIGIOUS.test(k)) return 'religious';
  if (CIVIC.test(k)) return 'civic';
  if (GLASSHOUSE.test(k)) return 'glasshouse';
  return 'other';
}

const WALL_FROM_TAG: Record<string, WallMaterial> = {
  brick: 'brick', bricks: 'brick', stone: 'stone', sandstone: 'stone', limestone: 'stone', granite: 'stone', marble: 'stone',
  concrete: 'concrete', cement_block: 'concrete', glass: 'glass', metal: 'metal', steel: 'metal', aluminium: 'metal', tin: 'metal',
  plaster: 'render', render: 'render', stucco: 'render', wood: 'render', timber_framing: 'render',
};

const ROOF_FROM_TAG: Record<string, RoofMaterial> = {
  roof_tiles: 'tiles', tile: 'tiles', tiles: 'tiles', slate: 'tiles', concrete: 'flat', tar_paper: 'flat', gravel: 'flat', eternit: 'flat',
  metal: 'metal', tin: 'metal', copper: 'metal', steel: 'metal', glass: 'flat', thatch: 'tiles',
};

const ROOF_TINT_FROM_TAG: Record<string, string> = { slate: '#4a4f56', roof_tiles: '#a25a40', tile: '#a25a40', copper: '#6d9c88', thatch: '#a08a5c', metal: '#9aa0a6', tin: '#9aa0a6' };

const lighten = (hex: string, f: number) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `#${[c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
};

const BRICK_TINTS = ['#ffffff', '#f2e6dc', '#e9d3c2', '#ddc0b0', '#f6efe6'];
const RENDER_TINTS = ['#f4f1ea', '#ece4d4', '#e2e6e4', '#f0e2d0', '#e8ddd0'];
const METAL_TINTS = ['#c9ced2', '#b7c2cb', '#d8d2c2', '#9fb0a6', '#c2b8a8'];

export interface StyleInput {
  sourceId: string;
  kind?: string | undefined;
  height: number;
  levels?: number | undefined;
  roof?: { shape: string; eave: number } | undefined;
  style?: SiteBuildingData['style'] | undefined;
}

/** The look of a building. `sampledRoof` is the colour seen from above, if it could be read. */
export function buildingProfile(data: StyleInput, sampledRoof?: string | null): BuildingProfile {
  const category = categoryOf(data.kind, data.height);
  const tags = data.style ?? {};
  const seed = data.sourceId;
  const eave = Math.max(2.4, data.roof && data.roof.shape !== 'flat' ? data.roof.eave : data.height);
  const pitched = !!data.roof && data.roof.shape !== 'flat';

  // Walls: the map's material first, else what this kind of building is usually made of.
  let wall: WallMaterial;
  let pattern: WindowPattern;
  let door: DoorKind = 'none';
  switch (category) {
    case 'house': wall = hash01(seed, 1) < 0.68 ? 'brick' : 'render'; pattern = 'punched'; door = 'front'; break;
    case 'apartments': wall = hash01(seed, 1) < 0.5 ? 'brick' : 'render'; pattern = 'punched'; door = 'front'; break;
    case 'retail': wall = hash01(seed, 1) < 0.5 ? 'brick' : 'render'; pattern = 'shopfront'; door = 'front'; break;
    case 'office': wall = data.height >= 20 ? 'glass' : 'render'; pattern = data.height >= 20 ? 'curtain' : 'ribbon'; door = 'front'; break;
    case 'tower': wall = 'glass'; pattern = 'curtain'; door = 'front'; break;
    case 'industrial': wall = 'metal'; pattern = 'high'; door = 'roller'; break;
    case 'garage': wall = hash01(seed, 1) < 0.5 ? 'brick' : 'render'; pattern = 'none'; door = 'roller'; break;
    case 'religious': wall = 'stone'; pattern = 'lancet'; door = 'none'; break;
    case 'civic': wall = hash01(seed, 1) < 0.6 ? 'brick' : 'render'; pattern = 'ribbon'; door = 'front'; break;
    case 'glasshouse': wall = 'glass'; pattern = 'glazed'; door = 'none'; break;
    default: wall = 'render'; pattern = 'punched'; door = 'front';
  }
  const tagged = tags.material ? WALL_FROM_TAG[tags.material] : undefined;
  if (tagged) {
    wall = tagged;
    if (tagged === 'glass' && (pattern === 'punched' || pattern === 'none')) pattern = 'curtain';
    if (tagged === 'metal' && pattern === 'punched') pattern = 'high';
  }

  // Floors: the map's count, else about one per 2.7-3.6 m depending on the kind.
  const typical = { house: 2.6, apartments: 3.0, retail: 3.6, office: 3.6, tower: 3.8, civic: 3.6, other: 3.0, industrial: 6, garage: 2.6, religious: 8, glasshouse: 3 }[category];
  const oneStorey = category === 'industrial' || category === 'garage' || category === 'religious';
  const storeys = oneStorey ? 1 : Math.max(1, Math.round(data.levels ?? eave / typical));
  let storeyHeight = eave / storeys;
  if (oneStorey) storeyHeight = eave;

  let bayWidth = 3.2, windowWidth = 1.0, windowHeight = 1.3, sill = 0.9;
  switch (category) {
    case 'house': bayWidth = 2.8 + hash01(seed, 2) * 0.8; windowWidth = 0.95; windowHeight = Math.min(1.3, storeyHeight * 0.5); sill = 0.85; break;
    case 'apartments': bayWidth = 3.4; windowWidth = 1.4; windowHeight = Math.min(1.5, storeyHeight * 0.55); sill = 0.8; break;
    case 'retail': bayWidth = 4.0; windowWidth = 1.5; windowHeight = 1.3; sill = 0.9; break;
    case 'office': bayWidth = data.height >= 20 ? 1.5 : 3.0; windowHeight = Math.min(1.8, storeyHeight * 0.55); sill = 0.9; break;
    case 'tower': bayWidth = 1.5; break;
    case 'industrial': bayWidth = 3.0; break;
    case 'religious': bayWidth = 4.2; windowWidth = 1.0; break;
    case 'civic': bayWidth = 3.0; windowHeight = Math.min(1.6, storeyHeight * 0.5); sill = 0.9; break;
    case 'glasshouse': bayWidth = 1.2; break;
    default: bayWidth = 3.2;
  }

  // Colours.
  const tagWall = mapColour(tags.colour);
  let wallTint: string;
  if (tagWall) wallTint = tagWall;
  else if (wall === 'brick') wallTint = BRICK_TINTS[Math.floor(hash01(seed, 3) * BRICK_TINTS.length)]!;
  else if (wall === 'render') wallTint = RENDER_TINTS[Math.floor(hash01(seed, 3) * RENDER_TINTS.length)]!;
  else if (wall === 'metal') wallTint = METAL_TINTS[Math.floor(hash01(seed, 3) * METAL_TINTS.length)]!;
  else if (wall === 'glass') wallTint = lighten('#7f95a8', 0.85 + hash01(seed, 3) * 0.3);
  else wallTint = '#ffffff';

  // Roof: a pitched roof is tiled; industrial roofs are sheet metal; the rest are flat.
  let roof: RoofMaterial = pitched ? 'tiles' : category === 'industrial' ? 'metal' : 'flat';
  const taggedRoof = tags.roofMaterial ? ROOF_FROM_TAG[tags.roofMaterial] : undefined;
  if (taggedRoof) roof = taggedRoof;
  const taggedRoofTint = mapColour(tags.roofColour) ?? (tags.roofMaterial ? ROOF_TINT_FROM_TAG[tags.roofMaterial] : undefined);
  let roofTint: string;
  if (taggedRoofTint) roofTint = taggedRoofTint;
  else if (sampledRoof) roofTint = sampledRoof;
  else if (roof === 'tiles') roofTint = ['#a25a40', '#4e535a', '#6d6a66', '#8c5a48'][Math.floor(hash01(seed, 4) * 4)]!;
  else if (roof === 'metal') roofTint = '#9aa0a6';
  else roofTint = '#6f7174';

  return { category, wall, wallTint, roof, roofTint, pattern, door, storeys, storeyHeight, bayWidth, windowWidth, windowHeight, sill, eave };
}

// ---------------------------------------------------------------------------
// Roof colour from the picture taken from above
// ---------------------------------------------------------------------------

/** The typical roof colour among sampled pixels, ignoring trees, deep shadow and glare. Null if too few are usable. */
export function averageRoofColour(pixels: readonly [number, number, number][]): string | null {
  const usable = pixels.filter(([r, g, b]) => {
    const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const green = g > r * 1.05 && g > b * 1.05;
    return !green && l > 0.1 && l < 0.92;
  });
  if (usable.length < Math.max(6, pixels.length * 0.2)) return null;
  const median = (channel: 0 | 1 | 2) => {
    const v = usable.map(p => p[channel]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)]!;
  };
  const rgb = [median(0), median(1), median(2)];
  return `#${rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}
