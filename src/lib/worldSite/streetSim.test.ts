import { describe, expect, it } from 'vitest';
import type { SiteRoute } from '../../types';
import { planStreetLife, makeRoadLoop, roadSpeedAt, turnSignal, roundCorners } from './streetLife';
import { startSims, stepStreet } from './streetSim';

const road: SiteRoute = { id: 'r', kind: 'road', points: [[-60, 0], [60, 0]], source: 'map', width: 6 };
const cross: SiteRoute = { id: 'c', kind: 'path', points: [[0, -20], [0, 20]], source: 'drawn' };

describe('rounded bends', () => {
  it('turns a corner with a curve, not on the spot', () => {
    const r = roundCorners([[0, 0], [20, 0], [20, 20], [0, 20]], 5, true);
    expect(r.length).toBeGreaterThan(4);
    // No point sits on the sharp corner any more.
    expect(r.some(p => p[0] === 20 && p[1] === 0)).toBe(false);
  });
  it('slows cars into a bend and lets them go fast on the straight', () => {
    const loop = makeRoadLoop([[0, 0], [60, 0], [60, 3], [0, 3]], 12, 6);
    const speeds = loop.speeds!;
    expect(Math.max(...speeds)).toBeGreaterThan(8);
    expect(Math.min(...speeds)).toBeLessThan(4);
    expect(roadSpeedAt(loop, 30)).toBeGreaterThan(roadSpeedAt(loop, 61));
  });
  it('signals the way a car is about to turn', () => {
    // East, then turning south: a right turn seen from above.
    const loop = makeRoadLoop([[0, 0], [40, 0], [40, 40], [0, 40]], 10, 4);
    expect(turnSignal(loop, 30, 14)).toBe(1);
    expect(turnSignal(loop, 5, 10)).toBe(0);
  });
});

describe('cars and people notice each other', () => {
  it('stops a car for a person standing in its lane', () => {
    const plan = planStreetLife([road], { level: 'quiet', leftHand: true, seed: 2 });
    const { cars, walkers } = startSims(plan);
    const car = cars[0]!;
    // Put a person in the lane ahead of the car.
    plan.standers.push({ x: car.x + car.dx * 8, z: car.z + car.dz * 8, yaw: 0, child: false, body: 0 });
    for (let t = 0; t < 400; t++) stepStreet(plan, cars, walkers, 0.05);
    const gap = Math.hypot(plan.standers[0]!.x - car.x, plan.standers[0]!.z - car.z);
    expect(car.v).toBeLessThan(0.5);
    expect(gap).toBeGreaterThan(2.5);
  });
  it('keeps cars from running into the one ahead', () => {
    const plan = planStreetLife([road], { level: 'busy', leftHand: true, seed: 5 });
    const { cars, walkers } = startSims(plan);
    for (let t = 0; t < 1200; t++) stepStreet(plan, cars, walkers, 0.05);
    const loop = plan.carLoops[0]!;
    for (let i = 0; i < cars.length; i++) for (let j = 0; j < cars.length; j++) {
      if (i === j) continue;
      const gap = ((cars[j]!.s - cars[i]!.s) % loop.length + loop.length) % loop.length;
      expect(gap).toBeGreaterThan(3.5);
    }
  });
  it('makes a person wait for a car that is coming', () => {
    const plan = planStreetLife([road, cross], { level: 'busy', leftHand: true, seed: 4 });
    const { cars, walkers } = startSims(plan);
    let waited = false;
    for (let t = 0; t < 2400 && !waited; t++) { stepStreet(plan, cars, walkers, 0.05); waited = walkers.some(w => w.waiting); }
    expect(waited).toBe(true);
  });
});
