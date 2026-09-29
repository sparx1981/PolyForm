/**
 * PolyForm — World View: Google's Photorealistic 3D Tiles around an imported site.
 *
 * The tiles are a viewing layer: one fused mesh of ground and buildings that can't be edited,
 * measured or exported. What this file does is the maths that lets it sit under the editable
 * site: where the tiles go, the box cut out of them, how far to lift them, and the colours for
 * styled buildings. The scene wiring is in components/GoogleTilesLayer.tsx.
 */

import type { SiteBuildingData, SiteBuildingStyleTags } from '../../types';

const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;
const E2 = WGS84_F * (2 - WGS84_F);
const DEG = Math.PI / 180;

export type V3 = [number, number, number];

/** The side, in metres, of the square map picture drawn for the map overlay at a latitude and coverage radius. */
export function overlayTileMeters(lat: number, radius: number): number {
  const zoom = Math.max(1, Math.min(20, Math.floor(Math.log2((156543.03392 * Math.cos(lat * DEG) * 640) / (radius * 2)))));
  return (156543.03392 * Math.cos(lat * DEG)) / 2 ** zoom * 640;
}

/** Earth-centred, earth-fixed position (metres) of a latitude, longitude (degrees) and height above the ellipsoid. */
export function ecef(lat: number, lng: number, height = 0): V3 {
  const la = lat * DEG, lo = lng * DEG;
  const sinLa = Math.sin(la), cosLa = Math.cos(la);
  const n = WGS84_A / Math.sqrt(1 - E2 * sinLa * sinLa);
  return [
    (n + height) * cosLa * Math.cos(lo),
    (n + height) * cosLa * Math.sin(lo),
    (n * (1 - E2) + height) * sinLa,
  ];
}

/** East, north and up unit vectors at a place, in earth-centred coordinates. */
export function enuBasis(lat: number, lng: number): { east: V3; north: V3; up: V3 } {
  const la = lat * DEG, lo = lng * DEG;
  const sinLa = Math.sin(la), cosLa = Math.cos(la), sinLo = Math.sin(lo), cosLo = Math.cos(lo);
  return {
    east: [-sinLo, cosLo, 0],
    north: [-sinLa * cosLo, -sinLa * sinLo, cosLa],
    up: [cosLa * cosLo, cosLa * sinLo, sinLa],
  };
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The matrix (16 numbers, column-major, as THREE.Matrix4.fromArray takes them) that turns the
 * tiles' earth-centred coordinates into the site's frame: the site centre at the origin, x east,
 * y up, z south (north is -z, as everywhere in the model). `lift` raises the result, metres.
 */
export function tilesToSiteMatrix(lat: number, lng: number, height = 0, lift = 0): number[] {
  const p0 = ecef(lat, lng, height);
  const { east, north, up } = enuBasis(lat, lng);
  const south: V3 = [-north[0], -north[1], -north[2]];
  const rows: V3[] = [east, up, south];
  const t = rows.map((r, i) => -dot(r, p0) + (i === 1 ? lift : 0));
  // Column-major: each column is one input axis.
  return [
    rows[0]![0], rows[1]![0], rows[2]![0], 0,
    rows[0]![1], rows[1]![1], rows[2]![1], 0,
    rows[0]![2], rows[1]![2], rows[2]![2], 0,
    t[0]!, t[1]!, t[2]!, 1,
  ];
}

export interface ClipPlane { normal: V3; constant: number }

/**
 * Four planes that, with THREE's `clipIntersection`, cut a square column out of the tiles: the
 * site's area less an `inset`, straight up and down. Clipped where a point is on the negative
 * side of every plane, i.e. inside the square.
 */
export function cutoutPlanes(size: number, inset = 0): ClipPlane[] {
  const h = Math.max(0, size / 2 - inset);
  return [
    { normal: [1, 0, 0], constant: -h },
    { normal: [-1, 0, 0], constant: -h },
    { normal: [0, 0, 1], constant: -h },
    { normal: [0, 0, -1], constant: -h },
  ];
}

/**
 * How far to raise the tiles so their ground meets the site's. Google's heights are measured
 * from the ellipsoid, the site's from sea level, and the two differ by tens of metres in places,
 * so each sample pairs a height read off the tiles with the site's ground height at the same
 * spot. Roofs and trees make the tile heights too high, so the lowest quarter is used.
 */
export function estimateLift(samples: { tiles: number; ground: number }[]): number {
  const diffs = samples.filter(s => Number.isFinite(s.tiles) && Number.isFinite(s.ground)).map(s => s.tiles - s.ground).sort((a, b) => a - b);
  if (diffs.length === 0) return 0;
  const quarter = diffs.slice(0, Math.max(1, Math.ceil(diffs.length / 4)));
  const mid = quarter[Math.floor(quarter.length / 2)]!;
  return -mid;
}

// ---------------------------------------------------------------------------
// Styled buildings
// ---------------------------------------------------------------------------

const NAMED: Record<string, string> = {
  white: '#f2f0ea', grey: '#a8a8a6', gray: '#a8a8a6', black: '#3a3a3a', red: '#a94a3a', brown: '#8a6248',
  beige: '#d9c8a6', cream: '#ece1c6', yellow: '#dcc46a', orange: '#cf8a4a', green: '#7d9a78', blue: '#7f9bb5',
  silver: '#b9bcbf', tan: '#c8ad8a', pink: '#d9a9a0',
};

/** A CSS colour for a map colour value: a #hex, or one of the common colour names. Null if unknown. */
export function mapColour(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return NAMED[v] ?? null;
}

