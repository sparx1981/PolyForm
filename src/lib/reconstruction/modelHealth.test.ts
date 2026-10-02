import { describe, expect, it } from 'vitest';
import type { Shape } from '../../types';
import { createInteriorFurnitureShape } from '../interiors/parametricFurniture';
import { checkModelHealth } from './modelHealth';

const wall = (id: string, x: number, z: number, length: number): Shape => ({
  id, type: 'wall', position: [x, 1.4, z], args: [length, 2.8, 0.2], color: '#fff',
});

describe('model health', () => {
  it('finds duplicate walls and orphan openings', () => {
    const report = checkModelHealth([
      wall('a', 0, 0, 4),
      wall('b', 0, 0, 4),
      { id: 'door', type: 'door', position: [0, 1, 0], args: [0.9, 2.1, 0.2], color: '#fff', hostWallId: 'missing' },
    ]);
    expect(report.issues.some(issue => issue.code === 'duplicate-wall')).toBe(true);
    expect(report.issues.some(issue => issue.code === 'orphan-opening')).toBe(true);
    expect(report.healthy).toBe(false);
  });

  it('distinguishes hard furniture intersections from clearance warnings', () => {
    const sofa = createInteriorFurnitureShape('sofa', { id: 'sofa', position: [0, 0, 0] });
    const bed = createInteriorFurnitureShape('bed', { id: 'bed', position: [0.4, 0, 0] });
    let report = checkModelHealth([sofa, bed]);
    expect(report.issues.some(issue => issue.code === 'furniture-collision')).toBe(true);

    bed.position = [0, 0, 1.75];
    report = checkModelHealth([sofa, bed]);
    expect(report.issues.some(issue => issue.code === 'furniture-clearance')).toBe(true);
  });

  it('accepts a clean simple model', () => {
    const report = checkModelHealth([
      wall('a', 0, 0, 4),
      createInteriorFurnitureShape('cabinet', { id: 'cab', position: [0, 0, 2] }),
    ]);
    expect(report.errors).toBe(0);
    expect(report.healthy).toBe(true);
  });

  it('does not call walls on different storeys duplicates', () => {
    const upper: Shape = { ...wall('b', 0, 0, 4), position: [0, 4.2, 0] };
    expect(checkModelHealth([wall('a', 0, 0, 4), upper]).issues.filter(i => i.code === 'duplicate-wall')).toEqual([]);
  });

  it('reads the turn of a wall from its quaternion, as the connector saves it', () => {
    // Two walls meeting at a corner: one along x, one along z (a quarter turn saved only as a quaternion).
    const along: Shape = wall('a', 0, 0, 4);
    const across: Shape = { ...wall('b', 2, 2, 4), quaternion: [0, Math.SQRT1_2, 0, Math.SQRT1_2] };
    expect(checkModelHealth([along, across]).issues.filter(i => i.code === 'duplicate-wall')).toEqual([]);
    // The same wall twice, turned: still a duplicate.
    const again: Shape = { ...across, id: 'c' };
    expect(checkModelHealth([across, again]).issues.some(i => i.code === 'duplicate-wall')).toBe(true);
  });

  it('ignores furniture on another floor, but still finds real collisions on the same one', () => {
    const sofa = createInteriorFurnitureShape('sofa', { id: 'sofa', position: [0, 0, 0] });
    const upstairs = createInteriorFurnitureShape('bed', { id: 'bed', position: [0.4, 2.8, 0] });
    expect(checkModelHealth([sofa, upstairs]).issues.filter(i => i.code.startsWith('furniture'))).toEqual([]);
    const sameFloor = createInteriorFurnitureShape('bed', { id: 'bed2', position: [0.4, 0, 0] });
    expect(checkModelHealth([sofa, sameFloor]).issues.some(i => i.code === 'furniture-collision')).toBe(true);
  });
});
