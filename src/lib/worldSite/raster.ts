/**
 * PolyForm — World View: height rasters (GeoTIFFs from the LiDAR services), read and sampled.
 */

import { fromArrayBuffer } from 'geotiff';

/**
 * A north-up grid of heights. (x0, y0) is the top-left corner of the top-left cell, in the
 * raster's own map units; cells are dx wide and dy tall, rows running south.
 */
export interface Raster {
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  width: number;
  height: number;
  data: ArrayLike<number>;
  nodata?: number | null;
}

/** Reads the first band of a GeoTIFF. */
export async function readGeoTiff(buffer: ArrayBuffer): Promise<Raster> {
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const [minX, , , maxY] = image.getBoundingBox();
  const [rx, ry] = image.getResolution();
  const band = await image.readRasters({ samples: [0], interleave: true });
  return {
    x0: minX,
    y0: maxY,
    dx: Math.abs(rx),
    dy: Math.abs(ry),
    width: image.getWidth(),
    height: image.getHeight(),
    data: band as unknown as ArrayLike<number>,
    nodata: image.getGDALNoData(),
  };
}

/** Whether a cell value is real data (not the raster's "no data" marker or an absurd value). */
function valid(v: number, nodata: number | null | undefined): boolean {
  return Number.isFinite(v) && v !== nodata && v > -1000 && v < 10000;
}

/**
 * Height at map point (x, y), blending the four nearest cell centres; cells with no data are
 * left out of the blend. NaN outside the raster or where there's no data at all.
 */
export function sampleRaster(r: Raster, x: number, y: number): number {
  const fx = (x - r.x0) / r.dx - 0.5;
  const fy = (r.y0 - y) / r.dy - 0.5;
  if (fx < -0.5 || fy < -0.5 || fx > r.width - 0.5 || fy > r.height - 0.5) return NaN;
  const c0 = Math.max(0, Math.min(r.width - 1, Math.floor(fx)));
  const r0 = Math.max(0, Math.min(r.height - 1, Math.floor(fy)));
  const c1 = Math.min(r.width - 1, c0 + 1), r1 = Math.min(r.height - 1, r0 + 1);
  const tx = Math.max(0, Math.min(1, fx - c0)), ty = Math.max(0, Math.min(1, fy - r0));
  let sum = 0, weight = 0;
  const add = (c: number, row: number, w: number) => {
    const v = r.data[row * r.width + c]!;
    if (w > 0 && valid(v, r.nodata)) { sum += v * w; weight += w; }
  };
  add(c0, r0, (1 - tx) * (1 - ty));
  add(c1, r0, tx * (1 - ty));
  add(c0, r1, (1 - tx) * ty);
  add(c1, r1, tx * ty);
  return weight > 1e-6 ? sum / weight : NaN;
}
