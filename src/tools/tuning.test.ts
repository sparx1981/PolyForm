import { describe, it, expect } from 'vitest';
import { rankSnap, snapRadiusFor, SNAP_RADIUS_PX, ENDPOINT_PREFERENCE_PX } from './tuning';

describe('per-kind snap radii', () => {
  it('gives endpoints the widest catch', () => {
    // Endpoints are what users aim at — they close loops and join edges.
    expect(snapRadiusFor('endpoint')).toBeGreaterThan(snapRadiusFor('midpoint'));
    expect(snapRadiusFor('midpoint')).toBeGreaterThan(snapRadiusFor('center'));
  });

  it('rejects a candidate outside its own radius', () => {
    expect(rankSnap('midpoint', SNAP_RADIUS_PX.midpoint + 1)).toBe(Infinity);
    // ...while an endpoint at the same distance is still live.
    expect(rankSnap('endpoint', SNAP_RADIUS_PX.midpoint + 1)).toBeLessThan(Infinity);
  });

  it('prefers an endpoint over a slightly nearer midpoint', () => {
    // The twitchiness fix: without this the snap flips between a corner and
    // the midpoint of an edge running through it as the cursor moves.
    expect(rankSnap('endpoint', 7)).toBeLessThan(rankSnap('midpoint', 5));
  });

  it('does not let the preference override a clearly nearer midpoint', () => {
    expect(rankSnap('midpoint', 1)).toBeLessThan(rankSnap('endpoint', 11));
  });

  it('grows every radius for touch', () => {
    for (const k of ['endpoint', 'midpoint', 'center'] as const) {
      expect(snapRadiusFor(k, true)).toBeGreaterThan(snapRadiusFor(k, false));
    }
  });

  it('the endpoint bonus is bounded', () => {
    // A bonus larger than the radius gap would make endpoints win from
    // anywhere, which is its own kind of wrong.
    expect(ENDPOINT_PREFERENCE_PX).toBeLessThan(SNAP_RADIUS_PX.endpoint);
  });
});
