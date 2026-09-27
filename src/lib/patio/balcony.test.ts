import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Shape } from '../../types';
import { buildPatio, infillCount, polygonArea, SPINDLE, type Vec2 } from './patioGeometry';
import { DEFAULT_BALCONY, DEFAULT_BALCONY_LOOK, DEFAULT_PATIO_TEMPLATE, type BalconySupport, type PatioData } from './patioTypes';
import { balconyAtOpening, balconyWarnings, BALCONY_STEP_DOWN, followHostWalls, JULIET_DEPTH, moveWithWall, outsideSide } from './balcony';
import { makePatioShape } from './patioPlacement';

/** A 6 m wall along x at z = 0, 2.5 m high on a first floor at y = 3, 0.3 m thick. */
const wall: Shape = { id: 'w', type: 'wall', position: [0, 3 + 1.25, 0], quaternion: [0, 0, 0, 1], args: [6, 2.5, 0.3], color: '#fff' };
/** A 1.2 m wide, 2.1 m high door 1 m along it, on the wall's floor. */
const door: Shape = { id: 'd', type: 'door', position: [1, 3 + 1.05, 0], quaternion: [0, 0, 0, 1], args: [1.2, 2.1, 0.1], color: '#fff', hostWallId: 'w' };

function balconyData(support: BalconySupport, overrides: Partial<PatioData> = {}): PatioData {
  const points: Vec2[] = [[-1.2, 0], [1.2, 0], [1.2, 1.5], [-1.2, 1.5]];
  return {
    ...DEFAULT_PATIO_TEMPLATE, ...DEFAULT_BALCONY_LOOK, kind: 'balcony', points,
    bulges: points.map(() => 0), wallEdges: [true, false, false, false], steps: [],
    balcony: { ...DEFAULT_BALCONY, support }, ...overrides,
  } as PatioData;
}

const box = (g: THREE.BufferGeometry | undefined) => { g!.computeBoundingBox(); return g!.boundingBox!; };

describe('balconyAtOpening', () => {
  it('centres on the door, a margin wider each side, standing out from the wall face', () => {
    const p = balconyAtOpening(door, wall, 1, { depth: 1.5, margin: 0.6, juliet: false })!;
    const xs = p.world.map(q => q[0]), zs = p.world.map(q => q[1]);
    expect(Math.min(...xs)).toBeCloseTo(1 - 0.6 - 0.6);
    expect(Math.max(...xs)).toBeCloseTo(1 + 0.6 + 0.6);
    // Wall face at z = 0.15, tucked 10 mm in; 1.5 m deep.
    expect(Math.min(...zs)).toBeCloseTo(0.14);
    expect(Math.max(...zs)).toBeCloseTo(1.64);
    expect(p.wallEdges).toEqual([true, false, false, false]);
    expect(p.level).toBeCloseTo(3 - BALCONY_STEP_DOWN);
    expect(p.outward).toEqual([0, 1]);
  });

  it('goes on the other face for side -1', () => {
    const p = balconyAtOpening(door, wall, -1, { depth: 1.5, margin: 0.6, juliet: false })!;
    expect(Math.max(...p.world.map(q => q[1]))).toBeCloseTo(-0.14);
    expect(Math.min(...p.world.map(q => q[1]))).toBeCloseTo(-1.64);
  });

  it('stays within the wall', () => {
    const nearEnd = { ...door, position: [2.3, door.position[1], 0] as [number, number, number] };
    const p = balconyAtOpening(nearEnd, wall, 1, { depth: 1.5, margin: 0.6, juliet: false })!;
    expect(Math.max(...p.world.map(q => q[0]))).toBeCloseTo(3);
  });

  it('a Juliet is shallow, just wider than the door, and starts at the sill', () => {
    const p = balconyAtOpening(door, wall, 1, { depth: 1.5, margin: 0.6, juliet: true })!;
    const zs = p.world.map(q => q[1]);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(JULIET_DEPTH);
    expect(Math.max(...p.world.map(q => q[0])) - Math.min(...p.world.map(q => q[0]))).toBeCloseTo(1.3);
    expect(p.level).toBeCloseTo(3);
  });

  it('a window takes the storey floor, not its sill', () => {
    const window: Shape = { ...door, id: 'win', type: 'window', position: [1, 3 + 1.5, 0], args: [1.2, 1.2, 0.1] };
    expect(balconyAtOpening(window, wall, 1, { depth: 1.5, margin: 0.6, juliet: false })!.level).toBeCloseTo(3 - BALCONY_STEP_DOWN);
  });

  it('picks the outside: the camera side, unless that side is inside a building', () => {
    expect(outsideSide(door, wall, [1, 10], () => false)).toBe(1);
    expect(outsideSide(door, wall, [1, -10], () => false)).toBe(-1);
    // Looking from inside the house: still goes outside.
    expect(outsideSide(door, wall, [1, -10], p => p[1] < 0)).toBe(1);
  });
});

describe('balcony geometry', () => {
  const ground = () => -3;

  it('a cantilever balcony has a floor on a 200 mm slab and guarding on the three open sides only', () => {
    const b = buildPatio(balconyData('cantilever'), ground);
    expect(b.parts.surface).toBeDefined();
    expect(box(b.parts.slab).min.y).toBeCloseTo(-0.03 - 0.2, 2);
    const glass = box(b.parts.glass);
    // No guarding along the wall edge (z = 0).
    expect(glass.min.z).toBeGreaterThan(0.02);
    expect(box(b.parts.railMetal).max.y).toBeGreaterThanOrEqual(1.1 - 1e-3);
    expect(b.parts.steel).toBeDefined(); // the drip
  });

  it('brackets reach down the wall; posts reach the ground', () => {
    const brackets = buildPatio(balconyData('brackets'), ground);
    expect(box(brackets.parts.steel).min.y).toBeLessThan(-0.8);
    expect(box(brackets.parts.steel).min.y).toBeGreaterThan(-2);
    const posts = buildPatio(balconyData('posts'), ground);
    expect(box(posts.parts.steel).min.y).toBeLessThan(-3);
  });

  it('boards on a steel frame get joists', () => {
    const b = buildPatio(balconyData('brackets', { balcony: { ...DEFAULT_BALCONY, support: 'brackets', floor: 'boards' } }), ground);
    expect(b.stats.boardLength).toBeGreaterThan(0);
    expect(b.parts.slab).toBeUndefined();
  });

  it('a Juliet is guarding alone, along the outer edge', () => {
    const points: Vec2[] = [[-0.65, 0], [0.65, 0], [0.65, JULIET_DEPTH], [-0.65, JULIET_DEPTH]];
    const b = buildPatio(balconyData('juliet', { points }), ground);
    expect(b.parts.surface).toBeUndefined();
    expect(b.parts.slab).toBeUndefined();
    const glass = box(b.parts.glass);
    expect(glass.max.x - glass.min.x).toBeGreaterThan(1);
    expect(glass.max.z - glass.min.z).toBeLessThan(0.05);
  });

  it('solid guarding is an upstand wall with a coping', () => {
    const b = buildPatio(balconyData('cantilever', { railing: 'solid' }), ground);
    expect(box(b.parts.wall).max.y).toBeCloseTo(1.1);
  });

  it('railing height follows the setting', () => {
    const b = buildPatio(balconyData('cantilever', { railing: 'metal', balcony: { ...DEFAULT_BALCONY, railingHeight: 1.25 } }), ground);
    expect(box(b.parts.railMetal).max.y).toBeCloseTo(1.28, 2);
  });
});

describe('guarding', () => {
  it('spindles and balusters are always under 100 mm apart', () => {
    for (const style of ['timber', 'metal'] as const) {
      const spec = SPINDLE[style];
      for (let clear = 0.1; clear < 2; clear += 0.037) {
        const count = infillCount(clear, spec.width, spec.gap);
        const gap = (clear - count * spec.width) / (count + 1);
        expect(gap).toBeLessThan(0.1);
      }
    }
  });

  it('warns about low guarding, none at all and climbable cables', () => {
    expect(balconyWarnings(balconyData('cantilever'))).toEqual([]);
    expect(balconyWarnings(balconyData('cantilever', { balcony: { ...DEFAULT_BALCONY, railingHeight: 1.0 } }))[0]).toMatch(/1000 mm high/);
    expect(balconyWarnings(balconyData('cantilever', { railing: 'none' }))[0]).toMatch(/No guarding/);
    expect(balconyWarnings(balconyData('cantilever', { railing: 'cable' }))[0]).toMatch(/climb/);
    expect(balconyWarnings({ ...balconyData('cantilever'), kind: 'deck', railing: 'none' })).toEqual([]);
  });
});

describe('following the wall', () => {
  const place = () => {
    const p = balconyAtOpening(door, wall, 1, { depth: 1.5, margin: 0.6, juliet: false })!;
    const shape = makePatioShape({ id: 'b', name: 'Balcony 1', world: p.world, bulges: [0, 0, 0, 0], level: p.level, wallEdges: p.wallEdges, kind: 'balcony', template: { ...DEFAULT_PATIO_TEMPLATE, ...DEFAULT_BALCONY_LOOK } });
    return { ...shape, hostWallId: 'w' };
  };
  const world = (s: Shape) => s.patioData!.points.map(([x, z]) => [x + s.position[0], z + s.position[2]] as Vec2);

  it('moves with a moved wall', () => {
    const b = place();
    const moved = { ...wall, position: [2, 4.25, 3] as [number, number, number] };
    const out = followHostWalls([moved, door, b], [wall, door, b]);
    const nb = out.find(s => s.id === 'b')!;
    expect(nb.position[0]).toBeCloseTo(b.position[0] + 2);
    expect(nb.position[1]).toBeCloseTo(b.position[1]);
    expect(nb.position[2]).toBeCloseTo(b.position[2] + 3);
  });

  it('turns with a turned wall', () => {
    const b = place();
    // A quarter turn about the wall's middle: +x becomes -z (three.js rotation about +y).
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const turned = { ...wall, quaternion: [q.x, q.y, q.z, q.w] as [number, number, number, number] };
    const nb = followHostWalls([turned, b], [wall, b]).find(s => s.id === 'b')!;
    // The balcony stood out on +z; it now stands out on +x, across x = 0.14..1.64.
    const xs = world(nb).map(p => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(0.14);
    expect(Math.max(...xs)).toBeCloseTo(1.64);
    expect(Math.abs(polygonArea(nb.patioData!.points))).toBeCloseTo(Math.abs(polygonArea(b.patioData!.points)));
  });

  it('stays put when the wall is only lengthened', () => {
    const b = place();
    const longer = { ...wall, position: [1, 4.25, 0] as [number, number, number], args: [8, 2.5, 0.3] };
    const nb = followHostWalls([longer, b], [wall, b]).find(s => s.id === 'b')!;
    expect(nb.position).toEqual(b.position);
  });

  it('is deleted with its wall', () => {
    const b = place();
    expect(followHostWalls([door, b], [wall, door, b]).some(s => s.id === 'b')).toBe(false);
  });

  it('leaves a balcony alone when the edit changed it too (undo restores both)', () => {
    const b = place();
    const moved = { ...wall, position: [2, 4.25, 3] as [number, number, number] };
    const restored = { ...b, position: [9, 9, 9] as [number, number, number] };
    const out = followHostWalls([moved, restored], [wall, b]);
    expect(out.find(s => s.id === 'b')!.position).toEqual([9, 9, 9]);
  });

  it('moveWithWall keeps the offset from the wall', () => {
    const b = place();
    const moved = moveWithWall(b, wall, { ...wall, position: [0, 4.25, 1] });
    expect(moved.position[2] - b.position[2]).toBeCloseTo(1);
  });
});
