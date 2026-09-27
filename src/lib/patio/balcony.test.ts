import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Shape } from '../../types';
import { buildPatio, infillCount, polygonArea, SPINDLE, type Vec2 } from './patioGeometry';
import { DEFAULT_BALCONY, DEFAULT_BALCONY_LOOK, DEFAULT_PATIO_TEMPLATE, type BalconyLevel, type BalconySupport, type PatioData } from './patioTypes';
import { balconyAtOpening, balconyFrame, balconyWarnings, BALCONY_STEP_DOWN, followHostWalls, JULIET_DEPTH, moveWithWall, newLevel, outsideSide, placeBalcony, reshapeBalcony, syncBalconyLevels, wallChain } from './balcony';
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

describe('curved walls', () => {
  /** A semicircular wall of radius 5 in 15-degree straight pieces, 0.3 m thick, floor at y = 3. */
  const R = 5, STEP = Math.PI / 12;
  const pieces: Shape[] = Array.from({ length: 12 }, (_, i) => {
    const phi = (i + 0.5) * STEP;
    const a = Math.atan2(-Math.cos(phi), -Math.sin(phi));
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
    const r = R * Math.cos(STEP / 2);
    return {
      id: `c${i}`, type: 'wall', position: [r * Math.cos(phi), 4.25, r * Math.sin(phi)] as [number, number, number],
      quaternion: [q.x, q.y, q.z, q.w] as [number, number, number, number], args: [2 * R * Math.sin(STEP / 2), 2.5, 0.3], color: '#fff',
    };
  });
  const host = pieces[6];
  const curvedDoor: Shape = { id: 'cd', type: 'door', position: [host.position[0], 3 + 1.05, host.position[2]], quaternion: host.quaternion, args: [0.9, 2.1, 0.1], color: '#fff', hostWallId: host.id };
  const shapes = [...pieces, curvedDoor];
  // The wall's normal points into the circle; the balcony goes outside.
  const opts = { depth: 1.5, margin: 0.6, juliet: false };

  it('traces the whole curve either side of the door', () => {
    expect(wallChain(host, -1, shapes).map(p => p.wall.id)).toEqual(pieces.map(p => p.id));
  });

  it('follows the curve: back edge on the wall face, front 1.5 m further out', () => {
    const p = placeBalcony(curvedDoor, host, -1, shapes, { ...opts, front: 'curve' })!;
    expect(p.curved).toBe(true);
    const back = p.world.filter((_, i) => p.wallEdges[i] || p.wallEdges[i - 1]);
    for (const q of back) expect(Math.hypot(q[0], q[1])).toBeGreaterThan(5.0);
    for (const q of back) expect(Math.hypot(q[0], q[1])).toBeLessThan(5.2);
    for (const q of p.front) expect(Math.hypot(q[0], q[1])).toBeGreaterThan(6.4);
    // Wider than the door by 0.6 m each side, measured along the wall.
    let along = 0;
    for (let i = 0; i + 1 < back.length; i++) along += Math.hypot(back[i + 1][0] - back[i][0], back[i + 1][1] - back[i][1]);
    expect(along).toBeCloseTo(0.9 + 1.2, 1);
    expect(p.level).toBeCloseTo(3 - BALCONY_STEP_DOWN);
  });

  it('a straight front stands at least the depth off the wall everywhere', () => {
    const p = placeBalcony(curvedDoor, host, -1, shapes, { ...opts, front: 'straight' })!;
    expect(p.front).toHaveLength(2);
    const [f0, f1] = p.front;
    const d = [f1[0] - f0[0], f1[1] - f0[1]], l = Math.hypot(d[0], d[1]);
    const back = p.world.filter((_, i) => p.wallEdges[i] || p.wallEdges[i - 1]);
    const distances = back.map(q => Math.abs((q[0] - f0[0]) * -d[1] / l + (q[1] - f0[1]) * d[0] / l));
    expect(Math.min(...distances)).toBeCloseTo(1.5, 2);
  });

  it('builds a curved balcony with brackets spaced along the curve', () => {
    const p = placeBalcony(curvedDoor, host, -1, shapes, { ...opts, front: 'curve' })!;
    const shape = makePatioShape({ id: 'cb', name: 'Balcony', world: p.world, bulges: p.world.map(() => 0), level: p.level, wallEdges: p.wallEdges, kind: 'balcony',
      template: { ...DEFAULT_PATIO_TEMPLATE, ...DEFAULT_BALCONY_LOOK, balcony: { ...DEFAULT_BALCONY, support: 'brackets' } } });
    const b = buildPatio(shape.patioData!, () => -3);
    expect(b.parts.steel).toBeDefined();
    expect(b.parts.glass).toBeDefined();
    expect(b.stats.area).toBeGreaterThan(2.5);
  });

  it('a straight run of wall still gets a plain rectangle, and a Juliet always does', () => {
    expect(placeBalcony(door, wall, 1, [wall, door], { ...opts, front: 'curve' })!.curved).toBe(false);
    const straightNeighbour: Shape = { ...wall, id: 'w2', position: [6, wall.position[1], 0] };
    expect(placeBalcony(door, wall, 1, [wall, straightNeighbour, door], { ...opts, front: 'curve' })!.world).toHaveLength(4);
    expect(placeBalcony(curvedDoor, host, -1, shapes, { ...opts, juliet: true, front: 'curve' })!.curved).toBe(false);
  });

  it('stops at a building corner', () => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const corner: Shape = { ...wall, id: 'corner', position: [3, wall.position[1], -3], quaternion: [q.x, q.y, q.z, q.w], args: [6, 2.5, 0.3] };
    expect(wallChain(wall, 1, [wall, corner]).map(p => p.wall.id)).toEqual(['w']);
  });

  it('reshapes from the door for a new front, and stays with the door when its wall is replaced', () => {
    const p = placeBalcony(curvedDoor, host, -1, shapes, { ...opts, front: 'curve' })!;
    const shape: Shape = { ...makePatioShape({ id: 'cb', name: 'Balcony', world: p.world, bulges: p.world.map(() => 0), level: p.level, wallEdges: p.wallEdges, kind: 'balcony',
      template: { ...DEFAULT_PATIO_TEMPLATE, ...DEFAULT_BALCONY_LOOK, balcony: { ...DEFAULT_BALCONY, hostOpeningId: 'cd', curvedWall: true, front: 'curve', depth: 1.5, margin: 0.6 } } }), hostWallId: host.id };
    const straight = reshapeBalcony(shape, [...shapes, shape], { front: 'straight' })!;
    expect(straight.patioData!.balcony!.front).toBe('straight');
    expect(straight.patioData!.points.length).toBeLessThan(shape.patioData!.points.length);
    expect(straight.position[1]).toBeCloseTo(shape.position[1]);

    // Pieces merged into one wall that now hosts the door.
    const merged: Shape = { ...host, id: 'merged' };
    const movedDoor = { ...curvedDoor, hostWallId: 'merged' };
    const next = [...pieces.filter(w => w.id !== host.id), merged, movedDoor, shape];
    const out = followHostWalls(next, [...shapes, shape]);
    expect(out.find(s => s.id === 'cb')!.hostWallId).toBe('merged');
  });
});

describe('widths and levels', () => {
  const opts = { depth: 1.5, margin: 0.6, juliet: false };
  const make = (left = 1.2, right = 1.2): Shape => {
    const p = balconyAtOpening(door, wall, 1, { ...opts, left, right })!;
    return { ...makePatioShape({ id: 'b', name: 'Balcony 1', world: p.world, bulges: [0, 0, 0, 0], level: p.level, wallEdges: p.wallEdges, kind: 'balcony',
      template: { ...DEFAULT_PATIO_TEMPLATE, ...DEFAULT_BALCONY_LOOK, balcony: { ...DEFAULT_BALCONY, hostOpeningId: 'd', widthLeft: left, widthRight: right } } }), hostWallId: 'w' };
  };
  const worldOf = (s: Shape) => s.patioData!.points.map(([x, z]) => [x + s.position[0], z + s.position[2]] as Vec2);

  it('width left and right are measured from the door centre, as seen from outside', () => {
    // Outside is +z; facing the wall from there, right is +x. The door is at x = 1.
    const p = balconyAtOpening(door, wall, 1, { ...opts, left: 0.5, right: 1.5 })!;
    const xs = p.world.map(q => q[0]);
    expect(Math.min(...xs)).toBeCloseTo(0.5);
    expect(Math.max(...xs)).toBeCloseTo(2.5);
    // From the other side (outside is -z) right is -x.
    const q = balconyAtOpening(door, wall, -1, { ...opts, left: 0.5, right: 1.5 })!;
    expect(Math.min(...q.world.map(v => v[0]))).toBeCloseTo(-0.5);
    expect(Math.max(...q.world.map(v => v[0]))).toBeCloseTo(1.5);
  });

  it('reshapes to new widths and keeps them', () => {
    const b = make();
    const wider = reshapeBalcony(b, [wall, door, b], { widthRight: 2 })!;
    const xs = worldOf(wider).map(p => p[0]);
    expect(Math.max(...xs)).toBeCloseTo(3);
    expect(Math.min(...xs)).toBeCloseTo(-0.2);
    expect(wider.patioData!.balcony!.widthRight).toBe(2);
    const f = balconyFrame(wider)!;
    expect(f.centre[0]).toBeCloseTo(1);
    expect(f.left).toBeCloseTo(1.2);
    expect(f.rightReach).toBeCloseTo(2);
  });

  const withLevel = (parent: Shape, patch: Partial<BalconyLevel>, attach: 'front' | 'left' | 'right' = 'front') => {
    const level = { ...newLevel(parent, attach)!, ...patch };
    const child: Shape = { ...parent, id: 'c', patioData: { ...parent.patioData!, balcony: { ...parent.patioData!.balcony!, level } } };
    return syncBalconyLevels([wall, door, parent, child]);
  };

  it('a front level at the same level joins with no guarding between', () => {
    const out = withLevel(make(), { rise: 0 });
    const parent = out.find(s => s.id === 'b')!, child = out.find(s => s.id === 'c')!;
    const zs = worldOf(child).map(p => p[1]);
    expect(Math.min(...zs)).toBeCloseTo(0.14 + 1.5);
    expect(Math.max(...zs)).toBeCloseTo(0.14 + 1.5 + 1.2);
    expect(child.position[1]).toBeCloseTo(parent.position[1]);
    expect(parent.patioData!.balcony!.railGaps).toHaveLength(1);
    expect(child.patioData!.balcony!.railGaps).toHaveLength(1);
    expect(child.patioData!.balcony!.stepFlight).toBeUndefined();
    // No guarding where they meet: the parent's front railing is gone there.
    const railZ = (s: Shape) => { const g = buildPatio(s.patioData!, () => -3).parts.glass; if (!g) return []; g.computeBoundingBox(); return [g.boundingBox!.min.z, g.boundingBox!.max.z]; };
    expect(railZ(parent)[1]).toBeLessThan(1.4);
  });

  it('a level a step up gets steps down onto the balcony, guarded except across them', () => {
    const out = withLevel(make(), { rise: 0.5 });
    const child = out.find(s => s.id === 'c')!, parent = out.find(s => s.id === 'b')!;
    const f = child.patioData!.balcony!.stepFlight!;
    expect(f.count).toBe(3);
    expect(f.top).toBe(0);
    expect(f.bottom).toBeCloseTo(-0.5);
    expect(f.dir[1]).toBeCloseTo(-1); // down towards the wall, onto the balcony
    expect(child.position[1]).toBeCloseTo(parent.position[1] + 0.5);
    const [gap] = child.patioData!.balcony!.railGaps!;
    expect(Math.hypot(gap[1][0] - gap[0][0], gap[1][1] - gap[0][1])).toBeCloseTo(1.0);
    expect(buildPatio(child.patioData!, () => -3).parts.steps).toBeDefined();
  });

  it('a level a step down has its steps on the level itself', () => {
    const out = withLevel(make(), { rise: -0.34 });
    const f = out.find(s => s.id === 'c')!.patioData!.balcony!.stepFlight!;
    expect(f.count).toBe(2);
    expect(f.top).toBeCloseTo(0.34);
    expect(f.bottom).toBe(0);
    expect(f.dir[1]).toBeCloseTo(1);
  });

  it('a side level runs along the wall', () => {
    const out = withLevel(make(), { rise: 0 }, 'right');
    const child = out.find(s => s.id === 'c')!;
    const xs = worldOf(child).map(p => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(2.2);
    expect(Math.max(...xs)).toBeCloseTo(3.7);
    expect(child.patioData!.wallEdges[0]).toBe(true);
  });

  it('follows its parent and goes with it', () => {
    const parent = make();
    let shapes = withLevel(parent, { rise: 0 });
    const wider = reshapeBalcony(shapes.find(s => s.id === 'b')!, shapes, { widthRight: 2, depth: 2 })!;
    shapes = syncBalconyLevels(shapes.map(s => s.id === 'b' ? wider : s));
    const zs = worldOf(shapes.find(s => s.id === 'c')!).map(p => p[1]);
    expect(Math.min(...zs)).toBeCloseTo(0.14 + 2);
    expect(syncBalconyLevels(shapes.filter(s => s.id !== 'b')).some(s => s.id === 'c')).toBe(false);
  });
});
