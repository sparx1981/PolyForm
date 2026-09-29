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
});
