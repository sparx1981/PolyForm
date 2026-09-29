import { averageRoofColour } from './buildingStyle';

/** Reads the colour of a roof from the site's picture taken from above (north up, `size` metres square, centred on the origin). */

const images = new Map<string, Promise<ImageData | null>>();

function loadPixels(url: string): Promise<ImageData | null> {
  let cached = images.get(url);
  if (!cached) {
    cached = new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return resolve(null);
          ctx.drawImage(img, 0, 0);
          resolve(ctx.getImageData(0, 0, canvas.width, canvas.height)); // throws if the picture is not readable
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
    images.set(url, cached);
  }
  return cached;
}

function inside(poly: readonly [number, number][], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!, [xj, zj] = poly[j]!;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** The typical roof colour of a building whose footprint is `footprint` (local x/z) standing at `origin`, or null. */
export async function sampleRoofColour(
  url: string, size: number, origin: readonly [number, number], footprint: readonly [number, number][],
): Promise<string | null> {
  const data = await loadPixels(url);
  if (!data || footprint.length < 3 || size <= 0) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of footprint) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const step = Math.max(0.5, Math.max(maxX - minX, maxZ - minZ) / 14);
  const pixels: [number, number, number][] = [];
  for (let x = minX + step / 2; x < maxX; x += step) {
    for (let z = minZ + step / 2; z < maxZ; z += step) {
      // Stay off the edges, where walls and shadows are.
      if (!inside(footprint, x, z)) continue;
      const u = (x + origin[0] + size / 2) / size, v = (z + origin[1] + size / 2) / size;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      const i = (Math.floor(v * data.height) * data.width + Math.floor(u * data.width)) * 4;
      pixels.push([data.data[i]!, data.data[i + 1]!, data.data[i + 2]!]);
    }
  }
  return averageRoofColour(pixels);
}
