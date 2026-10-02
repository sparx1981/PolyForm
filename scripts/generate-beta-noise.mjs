// Original deterministic animated blue noise. Not NVIDIA's licensed STBN asset.
// 128x128x64 R8 layout expected by the renderer.
//
// Space: one 128x128 blue-noise ranking made with void-and-cluster (Ulichney), so neighbouring pixels differ
// strongly and every value 0..255 appears equally often.
// Time: frame f is that ranking shifted by f times the golden ratio (modulo 1). Each pixel's sequence over time is then
// a low-discrepancy sequence, so the cloud and shadow accumulation settles in a handful of frames instead of
// averaging independent random numbers; every frame keeps an exactly uniform histogram.
import { writeFileSync } from 'node:fs';

const width = 128, count = width * width, depth = 64, SIGMA = 1.9, RADIUS = Math.ceil(SIGMA * 3);
let seed = 0x706f6c79;
function random() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; }

const kernel = [];
for (let dy = -RADIUS; dy <= RADIUS; dy++) for (let dx = -RADIUS; dx <= RADIUS; dx++)
  kernel.push([dx, dy, Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA))]);
const energy = new Float64Array(count), on = new Uint8Array(count);
function set(index, value) {
  const x = index % width, y = (index / width) | 0, sign = value ? 1 : -1;
  on[index] = value ? 1 : 0;
  for (const [dx, dy, w] of kernel) energy[((y + dy + width) % width) * width + (x + dx + width) % width] += sign * w;
}
function extreme(wantOnes, highest) {
  let best = -1, bestValue = highest ? -Infinity : Infinity;
  for (let i = 0; i < count; i++) {
    if ((on[i] === 1) !== wantOnes) continue;
    if (highest ? energy[i] > bestValue : energy[i] < bestValue) { bestValue = energy[i]; best = i; }
  }
  return best;
}

// Phase 1: an even binary pattern of about 10% ones.
const initial = Math.round(count * 0.1);
for (let placed = 0; placed < initial;) { const i = Math.floor(random() * count); if (!on[i]) { set(i, 1); placed++; } }
for (;;) {
  const cluster = extreme(true, true); set(cluster, 0);
  const hole = extreme(false, false);
  if (hole === cluster) { set(cluster, 1); break; }
  set(hole, 1);
}
const pattern = Uint8Array.from(on);
const rank = new Uint16Array(count);
// Phase 2: remove the tightest clusters one at a time; the last removed gets the lowest rank.
for (let r = initial - 1; r >= 0; r--) { const i = extreme(true, true); rank[i] = r; set(i, 0); }
// Phase 3: from the pattern, fill the largest voids in order.
energy.fill(0); on.fill(0);
for (let i = 0; i < count; i++) if (pattern[i]) set(i, 1);
for (let r = initial; r < count; r++) { const i = extreme(false, false); rank[i] = r; set(i, 1); }

const result = new Uint8Array(count * depth);
const GOLDEN = 0.6180339887498949;
for (let frame = 0; frame < depth; frame++) {
  const shift = Math.round(((frame * GOLDEN) % 1) * 256);
  for (let i = 0; i < count; i++) result[frame * count + i] = (Math.floor(rank[i] / count * 256) + shift) & 255;
}
writeFileSync(new URL('../public/beta/stbn.bin', import.meta.url), result);
