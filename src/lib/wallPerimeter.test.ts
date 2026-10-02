import { describe, expect, it } from 'vitest';
import { outerWallLoop, type Pt, type WallLine } from './wallPerimeter';

const wall = (ax: number, az: number, bx: number, bz: number): WallLine => ({ a: [ax, az], b: [bx, bz] });
const area = (poly: Pt[]) => Math.abs(poly.reduce((sum, p, i) => { const q = poly[(i + 1) % poly.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
/** True when no two non-adjacent edges of the polygon cross. */
function isSimple(poly: Pt[]): boolean {
  const n = poly.length;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;
    const a = poly[i], b = poly[(i + 1) % n], c = poly[j], d = poly[(j + 1) % n];
    if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return false;
  }
  return true;
}
const sameCorners = (poly: Pt[] | null, expected: Pt[]) => {
  expect(poly).not.toBeNull();
  expect(poly!.length).toBe(expected.length);
  for (const e of expected) expect(poly!.some(p => Math.hypot(p[0] - e[0], p[1] - e[1]) < 1e-6)).toBe(true);
};

// A 10 m x 8 m house, walls on the centre lines, each ending exactly at its neighbour's centre line.
const north = wall(0, 0, 10, 0), east = wall(10, 0, 10, 8), south = wall(10, 8, 0, 8), west = wall(0, 8, 0, 0);
const outer = [north, east, south, west];
const rectangle: Pt[] = [[0, 0], [10, 0], [10, 8], [0, 8]];

describe('outerWallLoop', () => {
  it('traces a plain room', () => {
    sameCorners(outerWallLoop(outer), rectangle);
  });

  it('ignores a partition that meets two outer walls (T-junctions)', () => {
    sameCorners(outerWallLoop([...outer, wall(5, 0, 5, 8)]), rectangle);
  });

  it('ignores partitions that cross and divide the house into four rooms', () => {
    const loop = outerWallLoop([...outer, wall(5, 0, 5, 8), wall(0, 4, 10, 4)]);
    sameCorners(loop, rectangle);
    expect(area(loop!)).toBeCloseTo(80);
  });

  it('ignores a partition with a T of its own and one that stops short of the wall face', () => {
    // A hallway wall, a room off it, and a partition ending 0.1 m from the outer wall's centre line.
    const loop = outerWallLoop([...outer, wall(4, 0.1, 4, 8), wall(4, 5, 10, 5), wall(0, 3, 3.9, 3)]);
    sameCorners(loop, rectangle);
  });

  it('ignores a partition that pokes through the outer wall', () => {
    sameCorners(outerWallLoop([...outer, wall(5, -0.2, 5, 8.2)]), rectangle);
  });

  it('ignores a free-standing wall and one with a free end', () => {
    sameCorners(outerWallLoop([...outer, wall(2, 2, 4, 2), wall(5, 0, 5, 3)]), rectangle);
  });

  it('is not affected by the order the walls were drawn in', () => {
    const walls = [wall(0, 4, 10, 4), south, wall(5, 0, 5, 8), west, north, east];
    sameCorners(outerWallLoop(walls), rectangle);
  });

  it('is not affected by which way each wall was drawn', () => {
    const flipped = [...outer, wall(5, 0, 5, 8)].map(w => ({ a: w.b, b: w.a }));
    sameCorners(outerWallLoop(flipped), rectangle);
  });

  it('keeps an L-shaped house L-shaped, with partitions inside either wing', () => {
    const l = [wall(0, 0, 4, 0), wall(4, 0, 4, 6), wall(4, 6, -4, 6), wall(-4, 6, -4, -4), wall(-4, -4, 0, -4), wall(0, -4, 0, 0)];
    const expected: Pt[] = [[0, 0], [4, 0], [4, 6], [-4, 6], [-4, -4], [0, -4]];
    sameCorners(outerWallLoop(l), expected);
    sameCorners(outerWallLoop([...l, wall(0, 3, 4, 3), wall(-4, 2, 0, 2), wall(-2, -4, -2, 6)]), expected);
  });

  it('copes with walls that overlap at the corners, as drawn walls do', () => {
    // Each wall runs half a wall thickness past its neighbour's centre line.
    const walls = [wall(-0.1, 0, 10.1, 0), wall(10, -0.1, 10, 8.1), wall(10.1, 8, -0.1, 8), wall(0, 8.1, 0, -0.1), wall(5, 0.1, 5, 7.9)];
    const loop = outerWallLoop(walls);
    expect(loop).not.toBeNull();
    expect(loop!.length).toBe(4);
    expect(area(loop!)).toBeCloseTo(80, 5);
  });

  it('treats collinear walls end to end as one side', () => {
    const walls = [wall(0, 0, 5, 0), wall(5, 0, 10, 0), east, south, west, wall(5, 0, 5, 8)];
    sameCorners(outerWallLoop(walls), rectangle);
  });

  it('gives a simple outline for a house divided into many rooms', () => {
    const loop = outerWallLoop([...outer, wall(3, 0, 3, 8), wall(7, 0, 7, 8), wall(0, 4, 3, 4), wall(7, 3, 10, 3), wall(3, 5, 7, 5)]);
    sameCorners(loop, rectangle);
    expect(isSimple(loop!)).toBe(true);
  });

  it('returns null when the walls enclose nothing', () => {
    expect(outerWallLoop([north])).toBeNull();
    expect(outerWallLoop([north, east, wall(10, 8, 5, 8)])).toBeNull();
    expect(outerWallLoop([wall(0, 0, 10, 0), wall(0, 3, 10, 3), wall(0, 6, 10, 6)])).toBeNull();
  });
});
