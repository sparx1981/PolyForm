/**
 * PolyForm — World View: from latitude and longitude to model metres, and back.
 *
 * A site is at most 200 m across, so a flat local plane around its centre is exact to well under
 * a millimetre: x points east, z points south (north is -z, the top of a plan), y is up.
 */

/** Earth's radius as the web maps use it (spherical Web Mercator), metres. */
export const EARTH_RADIUS = 6378137;
/** The largest site that can be imported: a square this many metres across. */
export const MAX_SITE_SIZE = 200;
export const MIN_SITE_SIZE = 20;

const DEG = Math.PI / 180;

export interface LatLng {
  lat: number;
  lng: number;
}

/** Metres east (x) and south (z) of `origin`. */
export function latLngToLocal(origin: LatLng, p: LatLng): [number, number] {
  const x = (p.lng - origin.lng) * DEG * EARTH_RADIUS * Math.cos(origin.lat * DEG);
  const z = -(p.lat - origin.lat) * DEG * EARTH_RADIUS;
  return [x, z];
}

/** The latitude and longitude `x` metres east and `z` metres south of `origin`. */
export function localToLatLng(origin: LatLng, x: number, z: number): LatLng {
  return {
    lat: origin.lat - z / (DEG * EARTH_RADIUS),
    lng: origin.lng + x / (DEG * EARTH_RADIUS * Math.cos(origin.lat * DEG)),
  };
}

/** The south-west and north-east corners of a square `size` metres across, centred on `origin`. */
export function siteBounds(origin: LatLng, size: number): { south: number; west: number; north: number; east: number } {
  const half = size / 2;
  const sw = localToLatLng(origin, -half, half);
  const ne = localToLatLng(origin, half, -half);
  return { south: sw.lat, west: sw.lng, north: ne.lat, east: ne.lng };
}

/** Clamps a requested size to what can be imported. */
export function clampSiteSize(size: number): number {
  if (!Number.isFinite(size)) return 100;
  return Math.max(MIN_SITE_SIZE, Math.min(MAX_SITE_SIZE, Math.round(size)));
}

/** Web Mercator world pixel of a point at zoom `z` (256-pixel tiles). */
export function worldPixel(p: LatLng, z: number): { x: number; y: number } {
  const scale = 256 * 2 ** z;
  const lat = Math.max(-85.05112878, Math.min(85.05112878, p.lat));
  const s = Math.sin(lat * DEG);
  return {
    x: ((p.lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
  };
}

/** Ground metres per pixel of a Web Mercator image at zoom `z` and latitude `lat`. */
export function metresPerPixel(lat: number, z: number): number {
  return (2 * Math.PI * EARTH_RADIUS * Math.cos(lat * DEG)) / (256 * 2 ** z);
}

/**
 * Parses "51.5007, -0.1246" (or with a space, or "lat,lng" in brackets) into a point, or null
 * when the text isn't a pair of coordinates.
 */
export function parseLatLng(text: string): LatLng | null {
  const m = /^\s*[([]?\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*[)\]]?\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** A UK postcode (e.g. "SW1A 1AA", "sw1a1aa"), tidied to its usual form, or null. */
export function ukPostcode(text: string): string | null {
  const t = text.trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(t)) return null;
  return `${t.slice(0, -3)} ${t.slice(-3)}`;
}
