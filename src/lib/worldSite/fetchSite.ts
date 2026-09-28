/**
 * PolyForm — World View: fetching a site's data in the browser.
 *
 * Every service here is free and answers browsers directly (CORS):
 *  - ground heights: Terrain Tiles on AWS open data,
 *  - buildings: OpenStreetMap through the Overpass API (with fallback mirrors, as the public
 *    servers are busy at times),
 *  - LiDAR (England, the Netherlands, the USA): straight from the national services, or through
 *    the app's relay (api/lidar-proxy) when a service doesn't answer browsers,
 *  - finding a place: coordinates as typed, UK postcodes through postcodes.io, then Google's
 *    geocoder when there's a key, then OpenStreetMap's Nominatim.
 */

import { type LatLng, parseLatLng, ukPostcode } from './geo';
import { type HeightTile, decodeTerrariumPixels, terrariumTileUrl } from './terrain';
import type { SiteIO } from './site';
import { loadLidar } from './lidar';

/** Public Overpass servers, tried in turn (the main one is often busy). */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 30000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** RGBA pixels of an image file. */
async function imagePixels(blob: Blob): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(blob);
  const w = bitmap.width, h = bitmap.height;
  const canvas: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return ctx.getImageData(0, 0, w, h).data;
}

async function fetchHeightTile(t: { x: number; y: number; z: number }): Promise<HeightTile> {
  const res = await fetchWithTimeout(terrariumTileUrl(t.z, t.x, t.y));
  if (!res.ok) throw new Error(`height tile ${t.z}/${t.x}/${t.y}: HTTP ${res.status}`);
  return { ...t, heights: decodeTerrariumPixels(await imagePixels(await res.blob())) };
}

/** An Overpass answer, if it is one (a busy server answers with an HTML or XML error page). */
async function overpassJson(res: Response): Promise<{ elements?: unknown[] }> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json().catch(() => null);
  if (!json || !Array.isArray(json.elements)) throw new Error('not a map answer');
  return json;
}

/**
 * Buildings from OpenStreetMap: through the app's relay first (api/overpass, which tries each
 * public server in turn from the server side, where a busy server's missing CORS header doesn't
 * matter, and caches the answer), then straight to each server from the browser.
 */
async function fetchOverpass(query: string): Promise<{ elements?: unknown[] }> {
  const errors: string[] = [];
  try {
    return await overpassJson(await fetchWithTimeout(`/api/overpass?data=${encodeURIComponent(query)}`, {}, 60000));
  } catch (err) {
    errors.push(`relay: ${err instanceof Error ? err.message : String(err)}`);
  }
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      return await overpassJson(await fetchWithTimeout(`${url}?data=${encodeURIComponent(query)}`, {}, 20000));
    } catch (err) {
      errors.push(`${new URL(url).host}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.warn('[WorldView] OpenStreetMap buildings failed:', errors);
  throw new Error('the OpenStreetMap servers are busy or unreachable');
}

/**
 * A LiDAR request: straight to the service, and if the browser isn't allowed to read the answer
 * (no CORS) through the app's relay, which fetches it server-side.
 */
async function fetchLidar(url: string): Promise<Response> {
  try {
    const res = await fetchWithTimeout(url, {}, 45000);
    if (res.ok) return res;
  } catch { /* blocked or offline: try the relay */ }
  const res = await fetchWithTimeout(`/api/lidar-proxy?url=${encodeURIComponent(url)}`, {}, 60000);
  if (!res.ok) throw new Error(`LiDAR service: HTTP ${res.status}`);
  return res;
}

/** The browser's way of getting a site's data. */
export const browserSiteIO: SiteIO = {
  heightTiles: tiles => Promise.all(tiles.map(fetchHeightTile)),
  overpass: fetchOverpass,
  lidar: (origin, size) => loadLidar(origin, size, fetchLidar, (source, err) => console.warn(`[WorldView] LiDAR (${source}) failed:`, err)),
};

export interface Place extends LatLng {
  address: string;
}

/**
 * Finds a place from what was typed: "lat, lng", a UK postcode, or any address. Null when
 * nothing was found.
 */
export async function findPlace(text: string, googleApiKey?: string): Promise<Place | null> {
  const coords = parseLatLng(text);
  if (coords) return { ...coords, address: `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}` };

  const postcode = ukPostcode(text);
  if (postcode) {
    try {
      const res = await fetchWithTimeout(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.replace(' ', ''))}`, {}, 10000);
      if (res.ok) {
        const data = await res.json();
        if (data?.result?.latitude != null) {
          const r = data.result;
          return { lat: r.latitude, lng: r.longitude, address: [postcode, r.admin_ward, r.admin_district].filter(Boolean).join(', ') };
        }
      }
    } catch { /* fall through to the general geocoders */ }
  }

  if (googleApiKey) {
    try {
      const res = await fetchWithTimeout(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(text)}&key=${googleApiKey}`, {}, 10000);
      const data = await res.json();
      const r = data?.status === 'OK' ? data.results?.[0] : null;
      if (r) return { lat: r.geometry.location.lat, lng: r.geometry.location.lng, address: r.formatted_address };
    } catch { /* fall through */ }
  }

  try {
    const res = await fetchWithTimeout(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&limit=1`, { headers: { 'Accept-Language': 'en' } }, 10000);
    const data = await res.json();
    if (Array.isArray(data) && data[0]) return { lat: Number(data[0].lat), lng: Number(data[0].lon), address: data[0].display_name };
  } catch { /* nothing found */ }
  return null;
}
