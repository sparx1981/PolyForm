import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  createGableRidgeCapGeometry, createHipRidgeCapGeometry, createApexCapGeometry, computeGeneralRoofApex,
  createGeneralPolygonalRoofSlopesGeometry,
} from './archRoofGenerator';

function yRange(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  return geometry.boundingBox!;
}

describe('ridge caps sit on the roof', () => {
  it('gable: the cap straddles the ridge, never hovering above it', () => {
    const ridge = 2;
    const box = yRange(createGableRidgeCapGeometry(10, 6, ridge, 0.3));
    expect(box.max.y).toBeLessThan(ridge + 0.05);
    expect(box.min.y).toBeLessThan(ridge);
  });

  it('hip: the cap straddles the ridge, never hovering above it', () => {
    const ridge = 2.5;
    const box = yRange(createHipRidgeCapGeometry(12, 7, ridge, 0.3));
    expect(box.max.y).toBeLessThan(ridge + 0.05);
    expect(box.min.y).toBeLessThan(ridge);
  });

  it('pyramid (general polygon) roofs cap their actual apex', () => {
    // An irregular pentagon: its apex is neither at the bounding-box centre nor at full ridge height.
    const eave: [number, number][] = [[-5, -4], [6, -4], [7, 2], [0, 5], [-5, 3]];
    const ridge = 6;
    const slopes = yRange(createGeneralPolygonalRoofSlopesGeometry(eave, eave, ridge, 35));
    const apex = computeGeneralRoofApex(eave, ridge, 35);
    expect(slopes.max.y).toBeCloseTo(apex[1]);
    const cap = yRange(createApexCapGeometry(eave, apex));
    expect(cap.max.y).toBeLessThan(apex[1] + 0.05);
    expect(cap.max.x).toBeLessThan(apex[0] + 0.3);
    expect(cap.min.x).toBeGreaterThan(apex[0] - 0.3);
  });
});
