import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const data = new Uint8Array(readFileSync(new URL('../../../public/beta/stbn.bin', import.meta.url)));
const W = 128, N = W * W, D = 64;
const at = (f: number, x: number, y: number) => data[f * N + ((y + W) % W) * W + ((x + W) % W)]!;

describe('Beta animated blue noise volume', () => {
  it('has the layout the cloud renderer reads', () => { expect(data.length).toBe(N * D); });
  it('uses every value equally often in every frame', () => {
    for (const f of [0, 1, 17, 63]) {
      const counts = new Array<number>(256).fill(0);
      for (let i = 0; i < N; i++) counts[data[f * N + i]!]!++;
      expect(Math.min(...counts)).toBe(64); expect(Math.max(...counts)).toBe(64);
    }
  });
  it('is spatially blue: neighbours differ more than random numbers would', () => {
    // Independent uniform values differ by 256/3 = 85 on average; blue noise pushes neighbours apart.
    let sum = 0, n = 0;
    for (let y = 0; y < W; y += 2) for (let x = 0; x < W; x++) { sum += Math.abs(at(0, x, y) - at(0, x + 1, y)) + Math.abs(at(0, x, y) - at(0, x, y + 1)); n += 2; }
    expect(sum / n).toBeGreaterThan(90);
  });
  it('is stratified in time: any 13 consecutive frames cover a pixel\'s range without big gaps', () => {
    for (const [x, y] of [[0, 0], [5, 77], [100, 31], [127, 127]] as const) {
      const values = Array.from({ length: 13 }, (_, f) => at(f, x, y)).sort((a, b) => a - b);
      let largest = 256 - values[12]! + values[0]!;
      for (let i = 1; i < 13; i++) largest = Math.max(largest, values[i]! - values[i - 1]!);
      // 13 random numbers leave a gap of about 70 on average; a golden-ratio sequence never exceeds ~2.6 / 13 of the range.
      expect(largest).toBeLessThanOrEqual(Math.ceil(256 * 2.7 / 13));
    }
  });
});
