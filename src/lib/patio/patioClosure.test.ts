import { describe, it, expect } from 'vitest';
import type { Shape } from '../../types';
import {
  buildCloseTargets, buildingOutlines, closeCandidates, joinedEdges, projectOntoPath, smoothRoundRuns,
  snapOutlineToTargets, snapRectangleSide, trimAgainstPatios, wallFootprint, TUCK,
} from './patioClosure';
import { denseOutline, polygonArea, type Vec2 } from './patioGeometry';

const flat = () => 0;
let n = 0;

/** A wall like the Wall tool makes: centred on a→b, extended by half its thickness past each end. */
function wall(a: Vec2, b: Vec2, thickness = 0.2, height = 2.4): Shape {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
  const angle = Math.atan2(dz, dx);
  return {
    id: `w${n++}`, type: 'wall', color: '#fff',
    position: [(a[0] + b[0]) / 2, height / 2, (a[1] + b[1]) / 2],
    quaternion: [0, Math.sin(-angle / 2), 0, Math.cos(-angle / 2)],
    args: [len + thickness, height, thickness],
  };
}

/** A 6 x 4 room (wall centrelines), so the outer faces are x = ±3.1, z = ±2.1. */
const room = (): Shape[] => [
  wall([-3, -2], [3, -2]), wall([3, -2], [3, 2]), wall([3, 2], [-3, 2]), wall([-3, 2], [-3, -2]),
];

const area = (points: Vec2[], bulges: number[]) => Math.abs(polygonArea(denseOutline(points, bulges, 0.05).points));

describe('building outlines', () => {
  it('joins a room\'s walls into one outline with the room as a hole', () => {
    const outlines = buildingOutlines(room(), flat);
    const outer = outlines.filter(o => !o.hole);
    expect(outer).toHaveLength(1);
    expect(Math.abs(polygonArea(outer[0].ring))).toBeCloseTo(6.2 * 4.2, 1);
    expect(outlines.some(o => o.hole)).toBe(true);
  });

  it('uses a wall\'s mitred footprint when it has one', () => {
    const w = wall([0, 0], [4, 0]);
    w.args = [4, 2.4, 0.2];
    w.wallMiterFootprint = [[-2.1, 0.1], [-1.9, -0.1], [1.9, -0.1], [2.1, 0.1]];
    const fp = wallFootprint(w)!;
    // The outer face runs the full mitred length (4.2 m), not the box's 4 m.
    const xs = fp.map(p => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4.2, 6);
  });

  it('pulls the building target 10 mm inside the wall faces', () => {
    const target = buildCloseTargets(room(), flat).find(t => t.kind === 'building' && t.area)!;
    // A point on the outer face is TUCK from the target path.
    expect(projectOntoPath(target.path, [0, 2.1])!.distance).toBeCloseTo(TUCK, 3);
  });
});

describe('closing against a building', () => {
  const targets = buildCloseTargets(room(), flat);
  // Drawn on the +z side of the house, both ends 0.4 m short of the wall.
  const chain: Vec2[] = [[-2, 2.5], [-2, 5], [2, 5], [2, 2.5]];

  it('joins the loose ends straight to the wall and follows it, never wrapping round the house', () => {
    const c = closeCandidates({ chain, chainBulges: [0, 0, 0], targets });
    expect(c.length).toBeGreaterThan(0);
    const best = c[0];
    // 4 m wide, from z = 5 down to the tucked face at 2.09.
    expect(best.area).toBeCloseTo(4 * (5 - 2.09), 1);
    expect(best.level).toBeCloseTo(0, 6);
    // Exactly one edge runs along the house.
    expect(best.joined.filter(Boolean)).toHaveLength(1);
    // No candidate covers the house.
    for (const cand of c) expect(cand.area).toBeLessThan(20);
  });

  it('closes along a long wall (the tuck under it never counts as covering the house)', () => {
    const long = buildCloseTargets([wall([-10, 0], [10, 0])], flat);
    const c = closeCandidates({ chain: [[-9, 0.1], [-9, 3], [9, 3], [9, 0.1]], chainBulges: [0, 0, 0], targets: long });
    expect(c.length).toBeGreaterThan(0);
    expect(c[0].area).toBeCloseTo(18 * (3 - 0.09), 1);
  });

  it('does not add a stub when an end is already on the wall', () => {
    const onWall: Vec2[] = [[-2, 2.1], [-2, 5], [2, 5], [2, 2.1]];
    const best = closeCandidates({ chain: onWall, chainBulges: [0, 0, 0], targets })[0];
    expect(best.points).toHaveLength(4);
  });

  it('offers nothing when an end is out of reach', () => {
    const far: Vec2[] = [[-2, 9], [-2, 12], [2, 12]];
    expect(closeCandidates({ chain: far, chainBulges: [0, 0], targets })).toEqual([]);
  });

  it('wraps round a corner of the house when the ends are on two sides', () => {
    // From the +z side round the +x corner to the +x side.
    const corner: Vec2[] = [[2, 2.5], [2, 4], [5, 4], [5, 0], [3.5, 0]];
    const best = closeCandidates({ chain: corner, chainBulges: [0, 0, 0, 0], targets })[0];
    expect(best).toBeDefined();
    expect(best.joined.filter(Boolean).length).toBeGreaterThanOrEqual(2);
    // The 3 x 4 box from x 2..5, z 0..4, less the corner of the house (to its tucked faces).
    expect(best.area).toBeCloseTo(3 * 4 - (3.09 - 2) * 2.09, 1);
  });
});

describe('closing against a fence and the house together', () => {
  it('routes along the fence and then the house where they meet', () => {
    const fence: Shape = {
      id: 'f', type: 'fence', color: '#000', position: [0, 0, 0], args: [],
      fenceData: { points: [[1, 2.1], [1, 8]], style: 'close-board', height: 1.8, seed: 1 },
    };
    const targets = buildCloseTargets([...room(), fence], flat);
    const chain: Vec2[] = [[-2, 2.5], [-2, 5], [0.5, 5]];
    const best = closeCandidates({ chain, chainBulges: [0, 0], targets })[0];
    expect(best).toBeDefined();
    // Bounded by the fence side (x = 0.96) and the tucked house face (z = 2.09).
    expect(best.area).toBeCloseTo((0.96 + 2) * (5 - 2.09), 1);
    expect(best.level).toBeCloseTo(0, 6);
  });
});

describe('closing between two things that do not meet', () => {
  it('closes straight across, without marking that edge as joined', () => {
    // A fence that stops 1.5 m short of the house.
    const fence: Shape = {
      id: 'f2', type: 'fence', color: '#000', position: [0, 0, 0], args: [],
      fenceData: { points: [[1, 3.6], [1, 8]], style: 'close-board', height: 1.8, seed: 1 },
    };
    const targets = buildCloseTargets([...room(), fence], flat);
    const chain: Vec2[] = [[-2, 2.5], [-2, 5], [0.5, 5]];
    const best = closeCandidates({ chain, chainBulges: [0, 0], targets })[0];
    expect(best).toBeDefined();
    // The straight bridge from the fence to the house is a free edge (kerbed).
    expect(best.joined.filter(Boolean).length).toBe(0);
  });
});

describe('round buildings', () => {
  it('follows a many-sided outline with a true arc under the walls', () => {
    const ring: Vec2[] = Array.from({ length: 32 }, (_, i) => [4 * Math.cos(2 * Math.PI * i / 32), 4 * Math.sin(2 * Math.PI * i / 32)] as Vec2);
    const path = smoothRoundRuns(ring);
    expect(path.points.length).toBeLessThan(10);
    expect(path.bulges.some(b => Math.abs(b) > 0.01)).toBe(true);
    // The arc touches the middle of each flat piece and stays inside the corners.
    const mid: Vec2 = [(ring[0][0] + ring[1][0]) / 2, (ring[0][1] + ring[1][1]) / 2];
    expect(projectOntoPath(path, mid)!.distance).toBeLessThan(0.002);
  });

  it('keeps the flat pieces when they are too coarse for an arc to stay under the walls', () => {
    const ring: Vec2[] = Array.from({ length: 8 }, (_, i) => [4 * Math.cos(2 * Math.PI * i / 8), 4 * Math.sin(2 * Math.PI * i / 8)] as Vec2);
    const path = smoothRoundRuns(ring);
    expect(path.points).toHaveLength(8);
    expect(path.bulges.every(b => b === 0)).toBe(true);
  });
});

describe('rectangles and existing patios', () => {
  const targets = buildCloseTargets(room(), flat);

  it('moves a dragged rectangle\'s near side onto the wall', () => {
    const corners: Vec2[] = [[-1, 2.6], [1, 2.6], [1, 5], [-1, 5]];
    const snapped = snapRectangleSide(corners, targets)!;
    expect(snapped[0][1]).toBeCloseTo(2.1 - TUCK, 3);
    expect(snapped[1][1]).toBeCloseTo(2.1 - TUCK, 3);
    expect(snapped[2][1]).toBe(5);
  });

  it('closes the gap on an existing patio drawn a little short of the wall', () => {
    const points: Vec2[] = [[-1, 2.25], [1, 2.25], [1, 5], [-1, 5]];
    const r = snapOutlineToTargets(points, [0, 0, 0, 0], targets);
    expect(r.moved).toBe(1);
    expect(r.points[0][1]).toBeCloseTo(2.1 - TUCK, 3);
    expect(r.points[3][1]).toBe(5);
    expect(joinedEdges(r.points, [0, 0, 0, 0], targets)).toEqual([true, false, false, false]);
  });

  it('trims a new outline back to an existing patio', () => {
    const existing = { points: [[0, 0], [2, 0], [2, 2], [0, 2]] as Vec2[], bulges: [0, 0, 0, 0], closed: true };
    const r = trimAgainstPatios([[1, 0], [3, 0], [3, 2], [1, 2]], [0, 0, 0, 0], [existing])!;
    expect(area(r.points, r.bulges)).toBeCloseTo(2, 2);
    expect(trimAgainstPatios([[5, 5], [6, 5], [6, 6]], [0, 0, 0], [existing])).toBeNull();
  });
});
