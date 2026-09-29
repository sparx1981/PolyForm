import { describe, expect, it } from 'vitest';
import { flockSizes, gooseFlock, wheelingFlock } from './birds';

describe('bird flocks', () => {
  it('wheels a flock round the site, above the ground and on the site', () => {
    const flock = wheelingFlock(12, 200, 26);
    expect(flock).toHaveLength(26);
    for (const b of flock) {
      expect(b.y).toBeGreaterThan(15);
      expect(Math.hypot(b.x, b.z)).toBeLessThan(200);
      expect(b.visible).toBe(true);
    }
    // They move on.
    expect(wheelingFlock(20, 200, 26)[0]!.x).not.toBeCloseTo(flock[0]!.x, 1);
  });
  it('flies geese across in a V, then rests before the next pass', () => {
    const early = gooseFlock(1, 200, 7);
    expect(early.every(b => b.visible)).toBe(true);
    // Followers are behind the leader along the heading.
    const heading = [Math.sin(early[0]!.yaw), Math.cos(early[0]!.yaw)];
    for (const b of early.slice(1)) expect((b.x - early[0]!.x) * heading[0]! + (b.z - early[0]!.z) * heading[1]!).toBeLessThan(0);
    const flight = (200 * 1.5 + 80) / 11;
    expect(gooseFlock(flight + 5, 200, 7).some(b => b.visible)).toBe(false);
    expect(gooseFlock(flight + 20, 200, 7).every(b => b.visible)).toBe(true);
  });
  it('has smaller flocks when quiet or on a phone', () => {
    expect(flockSizes('quiet').wheeling).toBeLessThan(flockSizes('busy').wheeling);
    expect(flockSizes('normal', true).wheeling).toBeLessThan(flockSizes('normal').wheeling);
  });
});
