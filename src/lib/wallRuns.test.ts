import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Shape } from '../types';
import { edgesOffPlanes, joinedEndPlanes, sameShapePart, wallRuns } from './wallRuns';

/** A wall from a to b (x/z), 2.7 m high, 0.3 m thick, on the ground. */
function wall(id: string, a: [number, number], b: [number, number], extra: Partial<Shape> = {}): Shape {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
  return {
    id, type: 'wall', color: '#fff', args: [len, 2.7, 0.3],
    position: [(a[0] + b[0]) / 2, 1.35, (a[1] + b[1]) / 2],
    quaternion: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], ...extra,
  };
}

describe('wallRuns', () => {
  // A straight stretch, then a curve (10 degree steps), then a sharp corner.
  const straight1 = wall('s1', [-4, 0], [-2, 0]);
  const straight2 = wall('s2', [-2, 0], [0, 0]);
  const curve: Shape[] = [];
  let p: [number, number] = [0, 0];
  for (let i = 0; i < 4; i++) {
    const a = ((i + 1) * 10 * Math.PI) / 180;
    const q: [number, number] = [p[0] + Math.cos(a), p[1] + Math.sin(a)];
    curve.push(wall(`c${i}`, p, q));
    p = q;
  }
  const corner = wall('k', p, [p[0] - 3, p[1] + 3]); // turns ~95 degrees
  const shapes = [straight1, straight2, ...curve, corner];

  it('joins the straight stretch and the curve into one run, ending at the corner', () => {
    const runs = wallRuns(shapes);
    expect([...runs.runOf.get('s1')!].sort()).toEqual(['c0', 'c1', 'c2', 'c3', 's1', 's2']);
    expect(runs.runOf.get('k')).toEqual(['k']);
    expect(runs.joined.get('s1')).toEqual({ start: false, end: true });
    expect(runs.joined.get('c3')).toEqual({ start: true, end: false });
  });

  it('tells the curve from the straight stretch', () => {
    const runs = wallRuns(shapes);
    expect(sameShapePart(runs, 's1').sort()).toEqual(['s1', 's2']);
    expect(sameShapePart(runs, 'c2').sort()).toEqual(['c0', 'c1', 'c2', 'c3']);
    // The last straight piece turns only where it meets the curve: it stays straight.
    expect(runs.curved.has('s2')).toBe(false);
    expect(runs.curved.has('c3')).toBe(true);
  });

  it('keeps a long straight wall between two curves straight', () => {
    // A 6 m wall, with 1 m pieces turning 10 degrees each at both ends.
    const mid = wall('m', [0, 0], [6, 0]);
    const right: Shape[] = [], left: Shape[] = [];
    let p: [number, number] = [6, 0], q: [number, number] = [0, 0];
    for (let i = 0; i < 3; i++) {
      const a = ((i + 1) * 10 * Math.PI) / 180;
      const np: [number, number] = [p[0] + Math.cos(a), p[1] + Math.sin(a)];
      right.push(wall(`r${i}`, p, np)); p = np;
      const nq: [number, number] = [q[0] - Math.cos(a), q[1] + Math.sin(a)];
      left.push(wall(`l${i}`, nq, q)); q = nq;
    }
    const runs = wallRuns([mid, ...right, ...left]);
    expect(runs.runOf.get('m')).toHaveLength(7);
    expect(sameShapePart(runs, 'm')).toEqual(['m']);
    expect(sameShapePart(runs, 'r1').sort()).toEqual(['r0', 'r1', 'r2']);
  });

  it('does not join walls on different storeys or of different thickness', () => {
    const upper = wall('u', [0, 0], [2, 0], { position: [1, 1.35 + 2.7, 0] });
    const thin = wall('t', [0, 0], [2, 0], { args: [2, 2.7, 0.1] });
    expect(wallRuns([straight2, upper]).runOf.get('u')).toEqual(['u']);
    expect(wallRuns([straight2, thin]).runOf.get('t')).toEqual(['t']);
  });

  it('drops the edge lines lying on a joined end', () => {
    const w = wall('x', [0, 0], [2, 0]);
    const g = new THREE.BoxGeometry(2, 2.7, 0.3);
    const edges = new THREE.EdgesGeometry(g).attributes.position.array;
    const all = edgesOffPlanes(edges, []).length / 6;
    const one = edgesOffPlanes(edges, joinedEndPlanes(w, { start: true, end: false })).length / 6;
    const both = edgesOffPlanes(edges, joinedEndPlanes(w, { start: true, end: true })).length / 6;
    expect(all).toBe(12);
    expect(one).toBe(8); // the end face's 4 edges go
    expect(both).toBe(4); // only the long top and bottom edges stay
  });
});
