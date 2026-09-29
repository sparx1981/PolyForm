import type { StreetPlan } from './streetLife';
import { pointOnLoop, roadSpeedAt, turnSignal } from './streetLife';

/**
 * Cars and people that notice each other. Each car has a position round its loop and a speed it
 * gains and loses: it slows for bends, keeps clear of the car ahead, and stops for anyone in its
 * way; people wait at the kerb for a car that is coming and can't stop. Plain numbers, stepped
 * each frame from components/SiteStreetLife.tsx.
 */

export interface CarSim {
  s: number; v: number;
  x: number; z: number; dx: number; dz: number;
  /** 1 = indicating right, -1 = left, 0 = straight on. */
  signal: -1 | 0 | 1;
  braking: boolean;
}
export interface WalkSim {
  s: number;
  x: number; z: number; dx: number; dz: number;
  waiting: boolean;
}

const CAR_LENGTH = 4.5;
const PULL_AWAY = 1.8, BRAKE = 4.5;
/** How far ahead and to the side a car looks for someone in its way. */
const LOOK_PEOPLE = 11, HALF_LANE_PEOPLE = 1.7;
const LOOK_CARS = 12, HALF_LANE_CARS = 1.5;

export function startSims(plan: StreetPlan): { cars: CarSim[]; walkers: WalkSim[] } {
  const cars = plan.cars.map(c => {
    const p = pointOnLoop(plan.carLoops[c.loop]!, c.start);
    return { s: c.start, v: 0, x: p.x, z: p.z, dx: p.dx, dz: p.dz, signal: 0 as const, braking: false };
  });
  const walkers = plan.walkers.map(w => {
    const p = pointOnLoop(plan.walkLoops[w.loop]!, w.start);
    return { s: w.start, x: p.x, z: p.z, dx: p.dx, dz: p.dz, waiting: false };
  });
  return { cars, walkers };
}

/** Where (x, z) sits in front of and beside something heading (dx, dz) from (px, pz). */
function relative(px: number, pz: number, dx: number, dz: number, x: number, z: number): { ahead: number; side: number } {
  const rx = x - px, rz = z - pz;
  return { ahead: rx * dx + rz * dz, side: rx * -dz + rz * dx };
}

export function stepStreet(plan: StreetPlan, cars: CarSim[], walkers: WalkSim[], dt: number): void {
  if (dt <= 0) return;
  const step = Math.min(dt, 0.1);

  // Cars: how fast each may go given what is in front of it.
  cars.forEach((car, i) => {
    const spec = plan.cars[i]!;
    const loop = plan.carLoops[spec.loop]!;
    let allowed = roadSpeedAt(loop, car.s);
    let blocked = false;

    // The car ahead on this same road.
    for (let j = 0; j < cars.length; j++) {
      if (j === i || plan.cars[j]!.loop !== spec.loop) continue;
      let gap = ((cars[j]!.s - car.s) % loop.length + loop.length) % loop.length - CAR_LENGTH;
      if (gap > 30) continue;
      gap = Math.max(0, gap);
      const limit = Math.max(0, (gap - 3.5) * 0.8);
      if (limit < allowed) { allowed = limit; blocked = true; }
    }
    // Cars on other roads that are lower in the order have right of way (so two never wait for each other).
    for (let j = 0; j < i; j++) {
      const other = cars[j]!;
      if (plan.cars[j]!.loop === spec.loop) continue;
      const r = relative(car.x, car.z, car.dx, car.dz, other.x, other.z);
      if (r.ahead > 0 && r.ahead < LOOK_CARS && Math.abs(r.side) < HALF_LANE_CARS) {
        const limit = Math.max(0, (r.ahead - 5) * 0.7);
        if (limit < allowed) { allowed = limit; blocked = true; }
      }
    }
    // People in the way: crossing, or standing on the road.
    const people = (x: number, z: number) => {
      const r = relative(car.x, car.z, car.dx, car.dz, x, z);
      if (r.ahead > 0 && r.ahead < LOOK_PEOPLE && Math.abs(r.side) < HALF_LANE_PEOPLE) {
        const limit = Math.max(0, (r.ahead - 3.5) * 0.9);
        if (limit < allowed) { allowed = limit; blocked = true; }
      }
    };
    for (const w of walkers) people(w.x, w.z);
    for (const st of plan.standers) people(st.x, st.z);

    if (car.v > allowed) car.v = Math.max(allowed, car.v - BRAKE * step);
    else car.v = Math.min(allowed, car.v + PULL_AWAY * step);
    car.braking = blocked && car.v < allowed + 0.5 || car.v > allowed + 0.3;
    car.s += car.v * step;
    const p = pointOnLoop(loop, car.s);
    car.x = p.x; car.z = p.z; car.dx = p.dx; car.dz = p.dz;
    // Indicate for the bend coming up (further ahead when going faster).
    car.signal = turnSignal(loop, car.s, 10 + car.v * 1.5);
  });

  // People: stop at the kerb for a car that is coming, unless it has already stopped for them.
  walkers.forEach((w, i) => {
    const spec = plan.walkers[i]!;
    const loop = plan.walkLoops[spec.loop]!;
    const inFront = pointOnLoop(loop, w.s + 1.4);
    const inCorridor = (x: number, z: number, c: CarSim) => {
      const r = relative(c.x, c.z, c.dx, c.dz, x, z);
      return r.ahead > -1.5 && r.ahead < 10 && Math.abs(r.side) < 1.9;
    };
    let wait = false;
    for (const c of cars) {
      if (c.v < 1) continue; // stopped: it is waiting for us
      if (inCorridor(inFront.x, inFront.z, c) && !inCorridor(w.x, w.z, c)) { wait = true; break; }
    }
    w.waiting = wait;
    if (!wait) w.s += spec.speed * step;
    const p = pointOnLoop(loop, w.s);
    w.x = p.x; w.z = p.z; w.dx = p.dx; w.dz = p.dz;
  });
}
