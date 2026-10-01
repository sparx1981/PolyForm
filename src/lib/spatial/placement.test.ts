import { describe, expect, it } from 'vitest';
import type { Shape } from '../../types';
import type { PlacementProfile } from '../semantics/componentTypes';
import {
  clearanceFootprint,
  footprintsOverlap,
  placementCollisions,
  resolvePlacementCandidate,
  wallPlacementCandidate,
} from './placement';

const floorProfile: PlacementProfile = {
  hosts: ['floor', 'wall'],
  preferredHost: 'wall',
  clearanceM: { front: 0.8 },
};

describe('semantic placement engine', () => {
  it('prefers a compatible host and ignores incompatible candidates', () => {
    const winner = resolvePlacementCandidate([
      { type: 'grid', host: 'floor', position: [0, 0, 0], distanceM: 0.05 },
      { type: 'wall', host: 'wall', position: [1, 0, 0], distanceM: 0.4 },
      { type: 'surface', host: 'ceiling', position: [0, 2.5, 0], distanceM: 0.01 },
    ], floorProfile);
    expect(winner?.host).toBe('wall');
  });

  it('detects collision between rotated OBB footprints without AABB false positives', () => {
    const a = { center: [0, 0] as [number, number], halfSize: [1, 0.25] as [number, number], rotationY: Math.PI / 4 };
    const b = { center: [1.1, 1.1] as [number, number], halfSize: [0.3, 0.3] as [number, number], rotationY: 0 };
    expect(footprintsOverlap(a, b)).toBe(false);
    expect(footprintsOverlap(a, { ...b, center: [0.55, 0.55] })).toBe(false);
    expect(footprintsOverlap(a, { ...b, center: [0.55, -0.55] })).toBe(true);
  });

  it('distinguishes functional-clearance collisions from visible intersections', () => {
    const item = { center: [0, 0] as [number, number], halfSize: [0.5, 0.4] as [number, number], rotationY: 0, id: 'chair' };
    const obstacle = { center: [0, 0.95] as [number, number], halfSize: [0.2, 0.2] as [number, number], rotationY: 0, id: 'wall' };
    const collisions = placementCollisions(item, [obstacle], floorProfile);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].clearanceOnly).toBe(true);
    expect(clearanceFootprint(item, floorProfile.clearanceM).halfSize[1]).toBeCloseTo(0.8);
  });

  it('places wall-hosted furniture flush to a rotated wall', () => {
    const wall: Shape = {
      id: 'w',
      type: 'wall',
      position: [0, 1.4, 0],
      rotation: [0, Math.PI / 2, 0],
      args: [4, 2.8, 0.2],
      color: '#fff',
    };
    const candidate = wallPlacementCandidate(wall, 0, 0.6)!;
    expect(candidate.host).toBe('wall');
    expect(candidate.sourceId).toBe('w');
    expect(Math.hypot(candidate.position[0], candidate.position[2])).toBeCloseTo(0.4, 5);
  });
});
