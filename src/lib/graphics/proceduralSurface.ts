// Procedural surface-depth presets: generate a grayscale height map (and its
// matching tangent-space normal map, derived from the same height data via a
// Sobel filter) entirely in-browser, so a user gets a usable relief pattern
// with a few slider nudges instead of having to source/author height and
// normal map images themselves.

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SurfaceDepthPresetParams {
  /** Pattern repeat frequency across the map, roughly 1 (coarse) - 10 (fine). */
  scale: number;
  /** Contrast/variance of the height pattern, 0 (flat) - 1 (strong). */
  strength: number;
  seed: number;
}

export const DEFAULT_SURFACE_DEPTH_PARAMS: SurfaceDepthPresetParams = { scale: 4, strength: 0.6, seed: 1 };

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return { canvas, ctx };
}

function grayFill(ctx: CanvasRenderingContext2D, size: number, value: number) {
  const v = Math.round(value * 255);
  ctx.fillStyle = `rgb(${v},${v},${v})`;
  ctx.fillRect(0, 0, size, size);
}

/** Tileable value noise: bilinear-interpolated lattice with wrap-around neighbors. */
function valueNoise(size: number, cells: number, rand: () => number): Float32Array {
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  const out = new Float32Array(size * size);
  const fade = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    const gy = (y / size) * cells;
    const y0 = Math.floor(gy) % cells, y1 = (y0 + 1) % cells, fy = fade(gy - Math.floor(gy));
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * cells;
      const x0 = Math.floor(gx) % cells, x1 = (x0 + 1) % cells, fx = fade(gx - Math.floor(gx));
      const a = lattice[y0 * cells + x0], b = lattice[y0 * cells + x1];
      const c = lattice[y1 * cells + x0], d = lattice[y1 * cells + x1];
      out[y * size + x] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
  }
  return out;
}

function paintField(ctx: CanvasRenderingContext2D, size: number, field: Float32Array, base = 0.5, gain = 1) {
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < field.length; i++) {
    const v = Math.max(0, Math.min(1, base + (field[i] - 0.5) * gain));
    const byte = Math.round(v * 255);
    image.data[i * 4] = byte; image.data[i * 4 + 1] = byte; image.data[i * 4 + 2] = byte; image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

function bumpyHeight({ scale, strength, seed }: SurfaceDepthPresetParams, size: number): HTMLCanvasElement {
  const rand = mulberry32(seed * 1000 + 1);
  const { canvas, ctx } = makeCanvas(size);
  const cells = Math.max(2, Math.round(scale));
  const coarse = valueNoise(size, cells, rand);
  const fine = valueNoise(size, cells * 3, rand);
  const field = new Float32Array(size * size);
  for (let i = 0; i < field.length; i++) field[i] = coarse[i] * 0.7 + fine[i] * 0.3;
  paintField(ctx, size, field, 0.5, 0.55 + strength * 0.9);
  return canvas;
}

function wavyHeight({ scale, strength, seed }: SurfaceDepthPresetParams, size: number): HTMLCanvasElement {
  const rand = mulberry32(seed * 1000 + 2);
  const { canvas, ctx } = makeCanvas(size);
  const freq = Math.max(1, scale) * 2;
  const angle = rand() * Math.PI * 0.25;
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  const field = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const p = u * cosA - v * sinA;
      const ripple = Math.sin(p * Math.PI * 2 * freq) * 0.6 + Math.sin((u + v) * Math.PI * 2 * (freq * 0.5)) * 0.4;
      field[y * size + x] = 0.5 + ripple * 0.5;
    }
  }
  paintField(ctx, size, field, 0.5, 0.4 + strength * 0.9);
  return canvas;
}

function brickHeight({ scale, strength, seed }: SurfaceDepthPresetParams, size: number): HTMLCanvasElement {
  const rand = mulberry32(seed * 1000 + 3);
  const { canvas, ctx } = makeCanvas(size);
  grayFill(ctx, size, 0.5 + strength * 0.35);
  const rows = Math.max(2, Math.round(scale));
  const rowH = size / rows;
  const cols = Math.max(2, Math.round(scale * 1.6));
  const colW = size / cols;
  const mortar = Math.max(1, size * 0.012);
  ctx.fillStyle = `rgb(${Math.round((0.5 - strength * 0.45) * 255)},${Math.round((0.5 - strength * 0.45) * 255)},${Math.round((0.5 - strength * 0.45) * 255)})`;
  for (let r = -1; r <= rows; r++) {
    const offset = (r % 2 === 0) ? 0 : colW / 2;
    for (let c = -1; c <= cols; c++) {
      const bx = c * colW + offset;
      const by = r * rowH;
      ctx.fillRect(bx - mortar / 2, by, mortar, rowH);
    }
    ctx.fillRect(0, r * rowH - mortar / 2, size, mortar);
  }
  // Subtle per-brick tonal variation so faces aren't perfectly flat.
  const brickShade = ctx.getImageData(0, 0, size, size);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols + 1; c++) {
      const tone = (rand() - 0.5) * strength * 40;
      const offset = (r % 2 === 0) ? 0 : colW / 2;
      const bx = Math.round(c * colW + offset), by = Math.round(r * rowH);
      for (let y = by; y < Math.min(size, by + rowH); y++) {
        for (let x = Math.max(0, bx); x < Math.min(size, bx + colW); x++) {
          const idx = (y * size + x) * 4;
          const v = Math.max(0, Math.min(255, brickShade.data[idx] + tone));
          brickShade.data[idx] = brickShade.data[idx + 1] = brickShade.data[idx + 2] = v;
        }
      }
    }
  }
  ctx.putImageData(brickShade, 0, 0);
  return canvas;
}

function stoneHeight({ scale, strength, seed }: SurfaceDepthPresetParams, size: number): HTMLCanvasElement {
  const rand = mulberry32(seed * 1000 + 4);
  const { canvas, ctx } = makeCanvas(size);
  const cellCount = Math.max(3, Math.round(scale * 2.5));
  const points: { x: number; y: number; h: number }[] = [];
  for (let i = 0; i < cellCount * cellCount; i++) points.push({ x: rand() * size, y: rand() * size, h: 0.45 + rand() * 0.45 });
  const wrapped = points.flatMap(p => [-1, 0, 1].flatMap(dx => [-1, 0, 1].map(dy => ({ x: p.x + dx * size, y: p.y + dy * size, h: p.h }))));
  const field = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let best = Infinity, second = Infinity, bestH = 0.5;
      for (const p of wrapped) {
        const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
        if (d < best) { second = best; best = d; bestH = p.h; } else if (d < second) second = d;
      }
      const edge = Math.min(1, (Math.sqrt(second) - Math.sqrt(best)) / (size / cellCount / 3));
      field[y * size + x] = bestH * edge;
    }
  }
  paintField(ctx, size, field, 0.5, 0.5 + strength * 0.9);
  return canvas;
}

function woodGrainHeight({ scale, strength, seed }: SurfaceDepthPresetParams, size: number): HTMLCanvasElement {
  const rand = mulberry32(seed * 1000 + 5);
  const { canvas, ctx } = makeCanvas(size);
  const cx = size * (0.2 + rand() * 0.6), cy = size * (0.2 + rand() * 0.6);
  const rings = Math.max(2, scale);
  const warp = valueNoise(size, Math.max(2, Math.round(scale)), rand);
  const field = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      const r = Math.hypot(dx, dy) / size;
      const wobble = (warp[y * size + x] - 0.5) * 0.3;
      const ring = Math.sin((r + wobble) * Math.PI * 2 * rings) * 0.5 + 0.5;
      field[y * size + x] = ring;
    }
  }
  paintField(ctx, size, field, 0.5, 0.35 + strength * 0.9);
  return canvas;
}

export interface SurfaceDepthPreset {
  id: string;
  name: string;
  description: string;
  generateHeight: (params: SurfaceDepthPresetParams, size: number) => HTMLCanvasElement;
}

export const SURFACE_DEPTH_PRESETS: SurfaceDepthPreset[] = [
  { id: 'bumpy', name: 'Bumpy', description: 'Soft organic bumps, good for rendered stucco, plaster or ground.', generateHeight: bumpyHeight },
  { id: 'wavy', name: 'Wavy', description: 'Rolling ripples, good for water, fabric or corrugated surfaces.', generateHeight: wavyHeight },
  { id: 'brick', name: 'Brick', description: 'Coursed brick/block joints with recessed mortar lines.', generateHeight: brickHeight },
  { id: 'stone', name: 'Stone', description: 'Irregular cobbled/paved cells with recessed gaps.', generateHeight: stoneHeight },
  { id: 'woodGrain', name: 'Wood grain', description: 'Concentric growth rings, good for timber and cut logs.', generateHeight: woodGrainHeight },
];

export function findSurfaceDepthPreset(id: string | undefined): SurfaceDepthPreset | undefined {
  return SURFACE_DEPTH_PRESETS.find(p => p.id === id);
}

/** Sobel-derived tangent-space normal map from a grayscale height canvas. Wraps at the
 * edges so the result tiles seamlessly under RepeatWrapping, matching the height map. */
export function heightCanvasToNormalCanvas(height: HTMLCanvasElement, strength = 1): HTMLCanvasElement {
  const size = height.width;
  const src = height.getContext('2d')!.getImageData(0, 0, size, size).data;
  const at = (x: number, y: number) => src[((((y % size) + size) % size) * size + (((x % size) + size) % size)) * 4] / 255;
  const { canvas, ctx } = makeCanvas(size);
  const out = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
      const gx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const gy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      let nx = -gx * strength, ny = -gy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const idx = (y * size + x) * 4;
      out.data[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      out.data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out.data[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      out.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

/** Derives a height map from an existing color/albedo image's luminance, for objects
 * that already have a texture - lets Surface Depth key off detail already on the model
 * instead of requiring a separate height map upload. */
export async function heightCanvasFromImageUrl(url: string, size = 256): Promise<HTMLCanvasElement> {
  const response = await fetch(url);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const { canvas, ctx } = makeCanvas(size);
  ctx.drawImage(bitmap, 0, 0, size, size);
  bitmap.close();
  const image = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const luma = 0.2126 * image.data[i] + 0.7152 * image.data[i + 1] + 0.0722 * image.data[i + 2];
    image.data[i] = image.data[i + 1] = image.data[i + 2] = luma;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png');
}
