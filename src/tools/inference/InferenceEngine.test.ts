import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { InferenceEngine } from './InferenceEngine';
import { SnapCandidate } from './types';
import { projectPointOntoLine, findOrthoTrackingProjection } from './math';

describe('InferenceEngine & Math', () => {
  describe('Math Projections', () => {
    it('projects point onto infinite line', () => {
      const p = new THREE.Vector3(5, 3, 2);
      const origin = new THREE.Vector3(0, 0, 0);
      const dir = new THREE.Vector3(1, 0, 0);

      const proj = projectPointOntoLine(p, origin, dir);
      expect(proj.x).toBeCloseTo(5);
      expect(proj.y).toBeCloseTo(0);
      expect(proj.z).toBeCloseTo(0);
    });

    it('finds orthogonal tracking ray along X, Y, or Z axis', () => {
      const ref = new THREE.Vector3(0, 0, 0);
      const query = new THREE.Vector3(4.0, 0.05, 0.05);

      const match = findOrthoTrackingProjection(ref, query, 0.20);
      expect(match).not.toBeNull();
      expect(match!.direction.x).toBe(1);
      expect(match!.label).toContain('X Axis');
      expect(match!.projectedPoint.x).toBeCloseTo(4.0);
    });
  });

  describe('InferenceEngine Controller', () => {
    let engine: InferenceEngine;

    beforeEach(() => {
      engine = new InferenceEngine({ hoverDwellMs: 500, snapTolerancePx: 14 });
    });

    it('snaps directly to candidate within screen distance tolerance', () => {
      const raw = new THREE.Vector3(2.1, 0, 3.1);
      const cand: SnapCandidate = {
        point: new THREE.Vector3(2.0, 0, 3.0),
        kind: 'endpoint',
        screenDistance: 8,
      };

      const result = engine.evaluate(raw, cand, 1000);
      expect(result.isLocked).toBe(true);
      expect(result.snappedPoint.x).toBe(2.0);
      expect(result.snappedPoint.z).toBe(3.0);
    });

    it('acquires reference point after hover dwell time threshold (>= 500ms)', () => {
      const cand: SnapCandidate = {
        point: new THREE.Vector3(10, 0, 10),
        kind: 'endpoint',
        screenDistance: 5,
      };

      // T = 0ms
      let res = engine.evaluate(cand.point, cand, 0);
      expect(res.activeReference).toBeNull();
      expect(engine.getAcquisitionProgress(250)).toBeCloseTo(0.5);

      // T = 500ms (Dwell fulfilled)
      res = engine.evaluate(cand.point, cand, 500);
      expect(res.activeReference).not.toBeNull();
      expect(res.activeReference!.point.x).toBe(10);
      expect(res.activeReference!.point.z).toBe(10);

      // Subsequent movement without candidate uses tracking guide
      const freePoint = new THREE.Vector3(15, 0, 10.05); // near X-axis tracking line
      const trackRes = engine.evaluate(freePoint, null, 600);
      expect(trackRes.isLocked).toBe(true);
      expect(trackRes.activeGuide).not.toBeNull();
      expect(trackRes.snappedPoint.z).toBeCloseTo(10); // Snapped to line z=10
    });
  });
});
