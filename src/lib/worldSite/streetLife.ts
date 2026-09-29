/**
 * PolyForm — World View: where the moving cars and people go on an imported site.
 *
 * Every route becomes one or more loops: a two-way road is driven down one side and back up the
 * other (keeping left or right as the country does), a path or pavement is walked there and back
 * a little to one side. Cars and people are spread along the loops and keep a steady speed, so
 * cars on the same loop never catch each other up. A few people stand about in pairs, and anyone
 * designed-in benches get someone sitting on them. Everything here is plain numbers; the drawing
 * is in components/SiteStreetLife.tsx.
 */

import type { SiteRoute, StreetLifeLevel } from '../../types';
import { lineLength } from './streets';

type P = [number, number];

/** A closed loop to travel round, with the distance to each point. */
export interface Loop {
  pts: P[];
  cum: number[];
  length: number;
  /** For a road: the speed a car can take at each point (slower through bends), m/s. */
  speeds?: number[];
}

export function makeLoop(pts: P[]): Loop {
  const cum = [0];
  for (let i = 1; i <= pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i % pts.length]!;
    cum.push(cum[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return { pts, cum, length: cum[cum.length - 1]! };
}

/** Position and heading (unit direction) `d` metres round a loop. */
export function pointOnLoop(loop: Loop, d: number): { x: number; z: number; dx: number; dz: number } {
  const n = loop.pts.length;
  if (!loop.length) return { x: loop.pts[0]?.[0] ?? 0, z: loop.pts[0]?.[1] ?? 0, dx: 1, dz: 0 };
  let t = ((d % loop.length) + loop.length) % loop.length;
  // Binary search for the segment.
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (loop.cum[mid]! <= t) lo = mid; else hi = mid - 1;
  }
  const a = loop.pts[lo]!, b = loop.pts[(lo + 1) % n]!;
  const seg = loop.cum[lo + 1]! - loop.cum[lo]!;
  t = seg > 0 ? (t - loop.cum[lo]!) / seg : 0;
  const dx = seg > 0 ? (b[0] - a[0]) / seg : 1, dz = seg > 0 ? (b[1] - a[1]) / seg : 0;
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx, dz };
}

/**
 * Rounds every corner of a path with a curve, so nothing turns on the spot. A corner is cut back
 * by about `radius` (never more than half of either side) and curved through the old corner.
 */
export function roundCorners(pts: P[], radius: number, closed = true): P[] {
  const n = pts.length;
  if (n < 3 || radius <= 0) return pts.map(p => [p[0], p[1]]);
  const out: P[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    if (!closed && (i === 0 || i === n - 1)) { out.push([p[0], p[1]]); continue; }
    const a = pts[(i - 1 + n) % n]!, b = pts[(i + 1) % n]!;
    const inLen = Math.hypot(p[0] - a[0], p[1] - a[1]), outLen = Math.hypot(b[0] - p[0], b[1] - p[1]);
    if (inLen < 1e-6 || outLen < 1e-6) { out.push([p[0], p[1]]); continue; }
    const ux = (p[0] - a[0]) / inLen, uz = (p[1] - a[1]) / inLen;
    const vx = (b[0] - p[0]) / outLen, vz = (b[1] - p[1]) / outLen;
    const turn = Math.acos(Math.max(-1, Math.min(1, ux * vx + uz * vz)));
    if (turn < 0.05) { out.push([p[0], p[1]]); continue; }
    // A tighter bend needs less cut-back for the same radius.
    const cut = Math.min(radius * Math.tan(turn / 2), inLen / 2, outLen / 2);
    const c1: P = [p[0] - ux * cut, p[1] - uz * cut], c2: P = [p[0] + vx * cut, p[1] + vz * cut];
    const steps = Math.max(2, Math.ceil(turn / 0.2));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, m = 1 - t;
      out.push([m * m * c1[0] + 2 * m * t * p[0] + t * t * c2[0], m * m * c1[1] + 2 * m * t * p[1] + t * t * c2[1]]);
    }
  }
  return out;
}

/** Sideways acceleration a car keeps to, and how hard it brakes and pulls away, m/s². */
const LATERAL_G = 2.2, BRAKE = 2.6, PULL_AWAY = 1.8, SLOWEST = 2.2;

/**
 * A loop for cars: corners rounded, and a speed at every point that drops through bends (fast enough
 * to be lively, never faster than the road's speed) with time to slow down before them.
 */
export function makeRoadLoop(pts: P[], maxSpeed: number, radius = 6): Loop {
  const loop = makeLoop(roundCorners(pts, radius, true));
  const n = loop.pts.length;
  const speeds: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = loop.pts[(i - 1 + n) % n]!, p = loop.pts[i]!, b = loop.pts[(i + 1) % n]!;
    const l1 = Math.hypot(p[0] - a[0], p[1] - a[1]), l2 = Math.hypot(b[0] - p[0], b[1] - p[1]);
    if (l1 < 1e-6 || l2 < 1e-6) { speeds.push(maxSpeed); continue; }
    const cos = ((p[0] - a[0]) * (b[0] - p[0]) + (p[1] - a[1]) * (b[1] - p[1])) / (l1 * l2);
    const turn = Math.acos(Math.max(-1, Math.min(1, cos)));
    const bend = turn > 0.02 ? (l1 + l2) / 2 / turn : Infinity; // radius of the bend here
    speeds.push(Math.max(SLOWEST, Math.min(maxSpeed, Math.sqrt(LATERAL_G * bend))));
  }
  // Slow down in time: no point may be more than braking distance faster than the next.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 2 * n - 1; i >= 0; i--) {
      const k = i % n, next = (k + 1) % n;
      const ds = loop.cum[next === 0 ? n : next]! - loop.cum[k]!;
      speeds[k] = Math.min(speeds[k]!, Math.sqrt(speeds[next]! ** 2 + 2 * BRAKE * ds));
    }
  }
  loop.speeds = speeds;
  return loop;
}

/** How fast a car may go `d` metres round a road loop. */
export function roadSpeedAt(loop: Loop, d: number): number {
  if (!loop.speeds || !loop.length) return 8;
  const n = loop.pts.length;
  const t = ((d % loop.length) + loop.length) % loop.length;
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (loop.cum[mid]! <= t) lo = mid; else hi = mid - 1;
  }
  const seg = loop.cum[lo + 1]! - loop.cum[lo]!;
  const f = seg > 0 ? (t - loop.cum[lo]!) / seg : 0;
  return loop.speeds[lo]! + (loop.speeds[(lo + 1) % n]! - loop.speeds[lo]!) * f;
}

/**
 * Which way a car is about to turn: 1 for right, -1 for left, 0 for straight on, from how much the
 * road bends over the next `ahead` metres (and the bit it is in the middle of).
 */
export function turnSignal(loop: Loop, d: number, ahead: number): -1 | 0 | 1 {
  const h0 = pointOnLoop(loop, d), h1 = pointOnLoop(loop, d + ahead);
  const cross = h0.dx * h1.dz - h0.dz * h1.dx; // > 0: turning right (seen from above, x east, z south)
  const dot = h0.dx * h1.dx + h0.dz * h1.dz;
  const angle = Math.atan2(cross, dot);
  return angle > 0.4 ? 1 : angle < -0.4 ? -1 : 0;
}

/**
 * A line moved sideways by `off` metres: positive is to the right of the direction of travel
 * (seen from above, x east and z south, right of (dx, dz) is (-dz, dx)).
 */
export function offsetLine(pts: P[], off: number): P[] {
  if (pts.length < 2 || !off) return pts.map(p => [p[0], p[1]]);
  const normals = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, z0] = pts[i]!, [x1, z1] = pts[i + 1]!;
    const len = Math.hypot(x1 - x0, z1 - z0) || 1;
    normals.push([-(z1 - z0) / len, (x1 - x0) / len] as P);
  }
  return pts.map((p, i) => {
    const a = normals[Math.max(0, i - 1)]!, b = normals[Math.min(normals.length - 1, i)]!;
    let nx = a[0] + b[0], nz = a[1] + b[1];
    const len = Math.hypot(nx, nz);
    if (len < 1e-6) { nx = b[0]; nz = b[1]; } else { nx /= len; nz /= len; }
    // Keep the offset at full width round a bend (up to a limit, so hairpins don't spike).
    const cos = Math.max(0.5, nx * b[0] + nz * b[1]);
    return [p[0] + (nx * off) / cos, p[1] + (nz * off) / cos];
  });
}

/** There along one side of a line and back along the other, as one loop. */
function thereAndBack(pts: P[], side: number): P[] {
  return [...offsetLine(pts, side), ...offsetLine([...pts].reverse(), side)];
}

/** A semicircle turning round the end of a road, from one lane's end to the other's, bulging the way the road runs. */
function turningHead(from: P, to: P, centre: P, dir: P): P[] {
  const a: P = [from[0] - centre[0], from[1] - centre[1]];
  const rotate = (v: P, ang: number): P => [v[0] * Math.cos(ang) - v[1] * Math.sin(ang), v[0] * Math.sin(ang) + v[1] * Math.cos(ang)];
  const mid = rotate(a, Math.PI / 2);
  const sign = mid[0] * dir[0] + mid[1] * dir[1] >= 0 ? 1 : -1;
  const out: P[] = [];
  for (let k = 1; k < 8; k++) { const r = rotate(a, (sign * Math.PI * k) / 8); out.push([centre[0] + r[0], centre[1] + r[1]]); }
  // `to` closes the head; the caller already has it as the next point.
  void to;
  return out;
}

/** There along one lane and back along the other, turning round the road's ends in a smooth half circle. */
function driveThereAndBack(pts: P[], side: number): P[] {
  const fwd = offsetLine(pts, side), back = offsetLine([...pts].reverse(), side);
  const dirAt = (line: P[], atEnd: boolean): P => {
    const a = atEnd ? line[line.length - 2]! : line[1]!, b = atEnd ? line[line.length - 1]! : line[0]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; // out past the end
  };
  const endHead = turningHead(fwd[fwd.length - 1]!, back[0]!, pts[pts.length - 1]!, dirAt(pts, true));
  const startHead = turningHead(back[back.length - 1]!, fwd[0]!, pts[0]!, dirAt(pts, false));
  return [...fwd, ...endHead, ...back, ...startHead];
}

export interface StreetCar { loop: number; start: number; speed: number; color: number }
export interface StreetWalker { loop: number; start: number; speed: number; child: boolean; body: number }
export interface StreetStander { x: number; z: number; yaw: number; child: boolean; body: number }
export interface StreetSitter { x: number; y: number; z: number; yaw: number; body: number }

export interface StreetPlan {
  carLoops: Loop[];
  walkLoops: Loop[];
  cars: StreetCar[];
  walkers: StreetWalker[];
  standers: StreetStander[];
  sitters: StreetSitter[];
}

/** A seat someone could sit on: centre of the seat, facing direction (yaw about y, 0 = +z). */
export interface Seat { x: number; y: number; z: number; yaw: number }

export interface StreetPlanOptions {
  level: StreetLifeLevel;
  /** Traffic keeps left (UK, Japan...). */
  leftHand: boolean;
  /** A phone or small tablet: fewer of everything. */
  small?: boolean;
  seats?: Seat[];
  seed?: number;
}

/** How many per 100 m of road (cars) or walkable line (people), and the most there can be. */
const DENSITY: Record<Exclude<StreetLifeLevel, 'off'>, { cars: number; people: number; maxCars: number; maxPeople: number }> = {
  quiet: { cars: 0.7, people: 2, maxCars: 8, maxPeople: 24 },
  normal: { cars: 1.6, people: 5, maxCars: 18, maxPeople: 50 },
  busy: { cars: 3, people: 10, maxCars: 30, maxPeople: 90 },
};
/** Nearest two cars on one loop come to each other, metres. */
const CAR_GAP = 14;
/** How many different car colours and figure builds the drawing has. */
export const CAR_COLOURS = 8;
export const BODY_TYPES = 4;

function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shares `total` between items by weight, at least 0 each, rounding fairly. */
function share(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum || total <= 0) return weights.map(() => 0);
  const exact = weights.map(w => (total * w) / sum);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) { if (left-- <= 0) break; out[i]!++; }
  return out;
}

/** Where every car and person on a site goes. */
export function planStreetLife(routes: SiteRoute[], opts: StreetPlanOptions): StreetPlan {
  const empty: StreetPlan = { carLoops: [], walkLoops: [], cars: [], walkers: [], standers: [], sitters: [] };
  if (opts.level === 'off') return empty;
  const rand = random(opts.seed ?? 1);
  const d = DENSITY[opts.level];
  const scale = opts.small ? 0.5 : 1;
  // Right-hand traffic drives on the right of its direction (+), left-hand on the left (-).
  const keep = opts.leftHand ? -1 : 1;

  const carLoops: Loop[] = [];
  const carSpeeds: number[] = [];
  const speedOf = (w: number) => Math.min(13, 6 + w * 0.6);
  const walkLines: P[][] = [];
  let roadLength = 0;
  for (const r of routes) {
    if (r.points.length < 2) continue;
    const len = lineLength(r.points);
    if (r.kind === 'road') {
      const w = r.width ?? 6;
      roadLength += len;
      // Wider roads are faster: about 20 mph on a lane, 30 on a main road. Bends are taken slower.
      const speed = speedOf(w);
      const radius = Math.max(5, w);
      if (r.oneway) carLoops.push(makeRoadLoop(offsetLine(r.points, (keep * w) / 6), speed, radius));
      else carLoops.push(makeRoadLoop(driveThereAndBack(r.points, (keep * w) / 4), speed, radius));
      carSpeeds.push(speed);
      if (!r.noPavement) {
        walkLines.push(offsetLine(r.points, w / 2 + 1));
        walkLines.push(offsetLine(r.points, -(w / 2 + 1)));
      }
    } else {
      walkLines.push(r.points);
    }
  }
  const walkLoops = walkLines.filter(l => lineLength(l) >= 3).map(l => makeLoop(roundCorners(thereAndBack(l, 0.45), 1.5, true)));

  // Cars: evenly spaced round each loop, all at that loop's speed so none catch up.
  const cars: StreetCar[] = [];
  // At least one car on any road and a couple of people on any walkway, however short.
  const carTotal = Math.min(Math.round(d.maxCars * scale), Math.max(roadLength > 0 ? 1 : 0, Math.round((roadLength / 100) * d.cars * scale)));
  const carCounts = share(carTotal, carLoops.map(l => l.length));
  carLoops.forEach((loop, i) => {
    const n = Math.min(carCounts[i]!, Math.floor(loop.length / CAR_GAP));
    const speed = carSpeeds[i]!;
    const offset = rand() * loop.length;
    for (let k = 0; k < n; k++) {
      cars.push({ loop: i, start: offset + (k * loop.length) / n, speed, color: Math.floor(rand() * CAR_COLOURS) });
    }
  });

  // People: most walking, a few standing in pairs, seats taken first.
  const walkLength = walkLoops.reduce((a, l) => a + l.length / 2, 0);
  const peopleTotal = Math.min(Math.round(d.maxPeople * scale), Math.max(walkLength > 0 ? 2 : 0, Math.round((walkLength / 100) * d.people * scale)));
  const sitters: StreetSitter[] = [];
  for (const s of (opts.seats ?? []).slice(0, Math.max(0, Math.ceil(peopleTotal / 4)))) {
    sitters.push({ x: s.x, y: s.y, z: s.z, yaw: s.yaw, body: Math.floor(rand() * BODY_TYPES) });
  }
  const standingPairs = Math.floor(peopleTotal * 0.08);
  const walkerTotal = Math.max(0, peopleTotal - standingPairs * 2);
  const walkers: StreetWalker[] = [];
  share(walkerTotal, walkLoops.map(l => l.length)).forEach((n, i) => {
    for (let k = 0; k < n; k++) {
      const child = rand() < 0.15;
      walkers.push({
        loop: i,
        start: rand() * walkLoops[i]!.length,
        speed: child ? 1.0 + rand() * 0.25 : 1.15 + rand() * 0.35,
        child,
        body: Math.floor(rand() * BODY_TYPES),
      });
    }
  });
  const standers: StreetStander[] = [];
  for (let k = 0; k < standingPairs && walkLoops.length; k++) {
    // Somewhere along a walked line, just off it, two people facing each other.
    const loop = walkLoops[Math.floor(rand() * walkLoops.length)]!;
    const p = pointOnLoop(loop, rand() * loop.length);
    const ox = -p.dz * 0.9, oz = p.dx * 0.9; // a step to the side of the walkers
    const yaw = Math.atan2(p.dx, p.dz);
    const cx = p.x + ox, cz = p.z + oz;
    standers.push({ x: cx - p.dx * 0.4, z: cz - p.dz * 0.4, yaw, child: false, body: Math.floor(rand() * BODY_TYPES) });
    standers.push({ x: cx + p.dx * 0.4, z: cz + p.dz * 0.4, yaw: yaw + Math.PI, child: rand() < 0.2, body: Math.floor(rand() * BODY_TYPES) });
  }
  return { carLoops, walkLoops, cars, walkers, standers, sitters };
}

/**
 * A walking figure's limb angles at a moment: legs and arms swing opposite each other, one full
 * stride every `stride` metres walked. Radians, forwards positive.
 */
export function gait(distance: number, stride = 1.4): { leftLeg: number; rightLeg: number; leftArm: number; rightArm: number; bob: number } {
  const phase = (distance / stride) * Math.PI * 2;
  const s = Math.sin(phase);
  return { leftLeg: 0.42 * s, rightLeg: -0.42 * s, leftArm: -0.32 * s, rightArm: 0.32 * s, bob: Math.abs(Math.cos(phase)) * 0.025 };
}
