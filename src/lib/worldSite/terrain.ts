/**
 * PolyForm — World View: real ground heights for an imported site.
 *
 * Heights come from the free global Terrain Tiles on AWS (Mapzen "Terrarium" encoding). They
 * blend the best open data for each place: national LiDAR where it has been published (parts of
 * the UK, the USA and others) and 30 m satellite data elsewhere. At zoom 15 a pixel is about 3 m
 * in the UK; the site's editable grid is laid out at 1 m and filled in smoothly between pixels.
 *
 * The pure part (decoding, sampling, laying out the grid) is here and tested; fetching the tiles
 * is in fetchSite.ts.
 */

import type { TerrainData } from '../../types';
import { type LatLng, localToLatLng, worldPixel } from './geo';

/** The zoom the tiles are read at: the most detailed the service has. */
export const TERRAIN_ZOOM = 15;
export const TERRAIN_SOURCE_NAME = 'Terrain Tiles (AWS open data)';
export const terrariumTileUrl = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

/** Height in metres above sea level from a Terrarium pixel. */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** A decoded 256 x 256 tile: heights in metres, row by row from the top (north). */
export interface HeightTile {
  x: number;
  y: number;
  z: number;
  heights: Float32Array;
}

/** RGBA pixels (as from a canvas) to heights. */
export function decodeTerrariumPixels(rgba: ArrayLike<number>, size = 256): Float32Array {
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) out[i] = decodeTerrarium(rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!);
  return out;
}

/** Which tiles (x, y at `z`) cover every point in `points`, with a pixel of margin. */
export function tilesFor(points: LatLng[], z = TERRAIN_ZOOM): { x: number; y: number; z: number }[] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    const w = worldPixel(p, z);
    minX = Math.min(minX, w.x - 1); maxX = Math.max(maxX, w.x + 1);
    minY = Math.min(minY, w.y - 1); maxY = Math.max(maxY, w.y + 1);
  }
  const n = 2 ** z;
  const out: { x: number; y: number; z: number }[] = [];
  for (let ty = Math.floor(minY / 256); ty <= Math.floor(maxY / 256); ty++) {
    for (let tx = Math.floor(minX / 256); tx <= Math.floor(maxX / 256); tx++) {
      out.push({ x: ((tx % n) + n) % n, y: Math.max(0, Math.min(n - 1, ty)), z });
    }
  }
  return out;
}

/**
 * A function giving the height (metres above sea level) anywhere the tiles cover, blending the
 * four nearest pixel centres. Points off the tiles take the nearest pixel that is on them.
 */
export function tileSampler(tiles: HeightTile[]): (p: LatLng) => number {
  if (!tiles.length) return () => 0;
  const z = tiles[0]!.z;
  const byKey = new Map(tiles.map(t => [`${t.x}/${t.y}`, t]));
  const minTX = Math.min(...tiles.map(t => t.x)), maxTX = Math.max(...tiles.map(t => t.x));
  const minTY = Math.min(...tiles.map(t => t.y)), maxTY = Math.max(...tiles.map(t => t.y));
  const pixel = (gx: number, gy: number): number => {
    gx = Math.max(minTX * 256, Math.min(maxTX * 256 + 255, gx));
    gy = Math.max(minTY * 256, Math.min(maxTY * 256 + 255, gy));
    const t = byKey.get(`${Math.floor(gx / 256)}/${Math.floor(gy / 256)}`);
    if (!t) return NaN;
    return t.heights[(gy % 256) * 256 + (gx % 256)]!;
  };
  return (p: LatLng) => {
    const w = worldPixel(p, z);
    // Pixel centres sit at +0.5.
    const fx = w.x - 0.5, fy = w.y - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const h00 = pixel(x0, y0), h10 = pixel(x0 + 1, y0), h01 = pixel(x0, y0 + 1), h11 = pixel(x0 + 1, y0 + 1);
    const vals = [h00, h10, h01, h11];
    if (vals.some(v => !Number.isFinite(v))) {
      const ok = vals.filter(Number.isFinite);
      return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : 0;
    }
    return (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
  };
}

/** Grid points along each side of a site `size` metres across: 1 m apart, at most 201. */
export function siteGridCount(size: number): number {
  return Math.max(8, Math.min(201, Math.round(size) + 1));
}

/**
 * The site's ground as a terrain grid, heights relative to the centre (so the centre is y = 0).
 * Row 0 is the north edge, matching how terrain grids are drawn.
 */
export function siteHeights(origin: LatLng, size: number, heightAt: (p: LatLng) => number): {
  gridX: number; gridY: number; heights: number[]; elevation: number;
} {
  const n = siteGridCount(size);
  const elevation = heightAt(origin);
  const heights: number[] = new Array(n * n);
  for (let j = 0; j < n; j++) {
    const z = -size / 2 + (j * size) / (n - 1);
    for (let i = 0; i < n; i++) {
      const x = -size / 2 + (i * size) / (n - 1);
      heights[j * n + i] = Math.round((heightAt(localToLatLng(origin, x, z)) - elevation) * 1000) / 1000;
    }
  }
  return { gridX: n, gridY: n, heights, elevation };
}

/** The height of a terrain grid at (x, z) in the terrain's own frame, blending its four nearest points. */
export function gridHeightAt(t: Pick<TerrainData, 'gridX' | 'gridY' | 'width' | 'depth' | 'heights'>, x: number, z: number): number {
  const fx = Math.max(0, Math.min(t.gridX - 1, ((x + t.width / 2) / t.width) * (t.gridX - 1)));
  const fz = Math.max(0, Math.min(t.gridY - 1, ((z + t.depth / 2) / t.depth) * (t.gridY - 1)));
  const i0 = Math.min(t.gridX - 2, Math.floor(fx)), j0 = Math.min(t.gridY - 2, Math.floor(fz));
  const tx = fx - i0, tz = fz - j0;
  const h = (i: number, j: number) => t.heights[j * t.gridX + i] ?? 0;
  return (h(i0, j0) * (1 - tx) + h(i0 + 1, j0) * tx) * (1 - tz) + (h(i0, j0 + 1) * (1 - tx) + h(i0 + 1, j0 + 1) * tx) * tz;
}
