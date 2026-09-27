import { describe, it, expect } from 'vitest';
import { safeOffsetPolygon2D, selfIntersects } from './safeOffset';
import type { Vec2 } from './types';

const area = (p: Vec2[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]!; return s + a.x * b.y - b.x * a.y; }, 0) / 2);
const square = (s: number): Vec2[] => [{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: s }, { x: 0, y: s }];
const circle = (r: number, n: number, cx = 0, cy = 0): Vec2[] =>
  Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos((2 * Math.PI * i) / n), y: cy + r * Math.sin((2 * Math.PI * i) / n) }));

describe('safeOffsetPolygon2D', () => {
  it('matches a plain offset on a square, both ways and either winding', () => {
    expect(area(safeOffsetPolygon2D(square(4), -1).points)).toBeCloseTo(4, 6);
    expect(area(safeOffsetPolygon2D(square(4), 1).points)).toBeCloseTo(36, 6);
    expect(area(safeOffsetPolygon2D(square(4).reverse(), -1).points)).toBeCloseTo(4, 6);
  });

  it('refuses an offset larger than the shape', () => {
    const r = safeOffsetPolygon2D(square(4), -2.5);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/larger/);
    expect(safeOffsetPolygon2D(circle(1, 64), -1.2).ok).toBe(false);
  });

  it('shrinks a finely divided circle cleanly', () => {
    const r = safeOffsetPolygon2D(circle(1, 128), -0.9);
    expect(r.ok).toBe(true);
    expect(selfIntersects(r.points)).toBe(false);
    expect(area(r.points)).toBeCloseTo(Math.PI * 0.01, 2);
  });

  it('removes a tight curve that the offset passes, instead of looping it', () => {
    // A 10 x 4 block with a small round bump (radius 0.3) on its top edge, grown by 0.5:
    // the inside of the bump's joins run backwards and must collapse.
    const bump = Array.from({ length: 17 }, (_, i) => {
      const a = Math.PI - (Math.PI * i) / 16;
      return { x: 5 + 0.3 * Math.cos(a), y: 4 - 0.3 * Math.sin(a) }; // a notch dipping into the block
    });
    const poly: Vec2[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, ...bump.slice().reverse(), { x: 0, y: 4 }];
    const r = safeOffsetPolygon2D(poly, 0.5);
    expect(r.ok).toBe(true);
    expect(r.collapsed).toBeGreaterThan(0);
    expect(selfIntersects(r.points)).toBe(false);
  });

  it('cuts a long spike at a sharp corner (mitre limit 2x)', () => {
    const sharp: Vec2[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1.5 }]; // about 8.5 degrees at (10, 0)
    const r = safeOffsetPolygon2D(sharp, 0.5);
    expect(r.ok).toBe(true);
    expect(r.bevelled).toBeGreaterThan(0);
    // The cut sits 2 x 0.5 from the corner along its bisector; its ends are only a little
    // further out. An unlimited mitre would reach about 6.7 m.
    const nearCorner = r.points.filter(p => Math.hypot(p.x - 10, p.y) < 3);
    expect(nearCorner.length).toBe(2);
    for (const p of nearCorner) expect(Math.hypot(p.x - 10, p.y)).toBeLessThan(1.1);
  });

  it('keeps the largest piece when a narrow neck pinches the shape apart', () => {
    // Two squares joined by a 0.5 wide neck: shrinking by 0.4 closes the neck.
    const dumbbell: Vec2[] = [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 1.75 }, { x: 6, y: 1.75 }, { x: 6, y: 0 }, { x: 9, y: 0 },
      { x: 9, y: 3 }, { x: 6, y: 3 }, { x: 6, y: 2.25 }, { x: 4, y: 2.25 }, { x: 4, y: 4 }, { x: 0, y: 4 },
    ];
    const r = safeOffsetPolygon2D(dumbbell, -0.4);
    expect(r.ok).toBe(true);
    expect(r.split).toBe(true);
    expect(selfIntersects(r.points)).toBe(false);
    // The larger (4 x 4) end, shrunk: about 3.2 x 3.2.
    expect(area(r.points)).toBeGreaterThan(9);
    expect(area(r.points)).toBeLessThan(10.5);
  });
});
