import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { BezierTool } from './BezierTool';
import { KernelBezierHost } from './KernelBezierHost';
import { tessellateBezierSpan, tessellateEntireCurve } from './tessellate';
import { BezierKnot, BezierCurveState } from './types';
import { KernelSession } from '../../lib/geometry';

describe('Bézier Curve Engine (v2.0)', () => {
  describe('Parametric Tessellation', () => {
    it('evaluates cubic span correctly between knots', () => {
      const k0: BezierKnot = {
        point: new THREE.Vector3(0, 0, 0),
        handleIn: null,
        handleOut: new THREE.Vector3(1, 2, 0),
        mode: 'mirrored'
      };
      const k1: BezierKnot = {
        point: new THREE.Vector3(4, 0, 0),
        handleIn: new THREE.Vector3(3, 2, 0),
        handleOut: null,
        mode: 'mirrored'
      };

      const points = tessellateBezierSpan(k0, k1, 24);
      expect(points.length).toBe(25); // 24 divisions = 25 points
      expect(points[0].x).toBeCloseTo(0);
      expect(points[0].y).toBeCloseTo(0);
      expect(points[24].x).toBeCloseTo(4);
      expect(points[24].y).toBeCloseTo(0);

      // Apex should be raised due to control handles at y=2
      const midPoint = points[12];
      expect(midPoint.y).toBeGreaterThan(1.0);
    });

    it('tessellates open curve across multiple spans without duplicate vertices', () => {
      const knots: BezierKnot[] = [
        { point: new THREE.Vector3(0, 0, 0), handleIn: null, handleOut: new THREE.Vector3(0, 1, 0), mode: 'mirrored' },
        { point: new THREE.Vector3(2, 0, 0), handleIn: new THREE.Vector3(1, 0, 0), handleOut: new THREE.Vector3(3, 0, 0), mode: 'mirrored' },
        { point: new THREE.Vector3(4, 0, 0), handleIn: new THREE.Vector3(4, 1, 0), handleOut: null, mode: 'mirrored' },
      ];

      const points = tessellateEntireCurve(knots, false, 12);
      // 2 spans of 12 divisions: span 1 has 13 points, span 2 adds 12 = 25 points total
      expect(points.length).toBe(25);
      expect(points[0].distanceTo(knots[0].point)).toBeCloseTo(0);
      expect(points[points.length - 1].distanceTo(knots[2].point)).toBeCloseTo(0);
    });

    it('tessellates closed curve connecting back to start knot', () => {
      const knots: BezierKnot[] = [
        { point: new THREE.Vector3(0, 0, 0), handleIn: new THREE.Vector3(-1, 0, 0), handleOut: new THREE.Vector3(1, 0, 0), mode: 'mirrored' },
        { point: new THREE.Vector3(2, 2, 0), handleIn: new THREE.Vector3(2, 1, 0), handleOut: new THREE.Vector3(2, 3, 0), mode: 'mirrored' },
        { point: new THREE.Vector3(0, 4, 0), handleIn: new THREE.Vector3(1, 4, 0), handleOut: new THREE.Vector3(-1, 4, 0), mode: 'mirrored' },
      ];

      const points = tessellateEntireCurve(knots, true, 10);
      // 3 spans of 10 divisions: 1 + 3 * 10 = 31 points (last point lands back on knot 0)
      expect(points.length).toBe(31);
      expect(points[points.length - 1].distanceTo(knots[0].point)).toBeCloseTo(0);
    });
  });

  describe('Bézier Tool State Machine & Vector Mechanics', () => {
    it('creates sharp knot on click without drag', () => {
      const tool = new BezierTool();
      tool.activate();

      const res = tool.onPointerDown(new THREE.Vector3(1, 0, 1), false);
      expect(res.closed).toBe(false);
      expect(res.knotIndex).toBe(0);

      const knots = tool.getKnots();
      expect(knots.length).toBe(1);
      expect(knots[0].point.x).toBeCloseTo(1);
      expect(knots[0].handleOut).toBeNull();
      expect(knots[0].handleIn).toBeNull();

      tool.onPointerUp();
      expect(tool.getKnots()[0].handleOut).toBeNull();
    });

    it('creates symmetric C1 continuous tangent handles on click & drag', () => {
      const tool = new BezierTool();
      tool.activate();

      tool.onPointerDown(new THREE.Vector3(0, 0, 0), false);
      tool.onPointerMove(new THREE.Vector3(1, 0, 2), false); // drag handle to (1, 0, 2)
      tool.onPointerUp();

      const knot = tool.getKnots()[0];
      expect(knot.mode).toBe('mirrored');
      expect(knot.handleOut).not.toBeNull();
      expect(knot.handleOut?.x).toBeCloseTo(1);
      expect(knot.handleOut?.z).toBeCloseTo(2);

      // Inward handle mirrors outward handle 180 degrees opposite
      expect(knot.handleIn).not.toBeNull();
      expect(knot.handleIn?.x).toBeCloseTo(-1);
      expect(knot.handleIn?.z).toBeCloseTo(-2);
    });

    it('breaks tangent handle symmetry when Alt/Option is pressed', () => {
      const tool = new BezierTool();
      tool.activate();

      tool.onPointerDown(new THREE.Vector3(0, 0, 0), false);
      tool.onPointerMove(new THREE.Vector3(1, 0, 2), true); // Alt pressed -> broken mode
      tool.onPointerUp();

      const knot = tool.getKnots()[0];
      expect(knot.mode).toBe('broken');
      expect(knot.handleOut?.x).toBeCloseTo(1);
      expect(knot.handleOut?.z).toBeCloseTo(2);
      expect(knot.handleIn).toBeNull(); // Broken handle does not auto-mirror handleIn
    });

    it('detects loop closure when clicking near origin knot', () => {
      const tool = new BezierTool();
      tool.activate();

      tool.onPointerDown(new THREE.Vector3(0, 0, 0), false);
      tool.onPointerUp();

      tool.onPointerDown(new THREE.Vector3(5, 0, 0), false);
      tool.onPointerUp();

      tool.onPointerDown(new THREE.Vector3(5, 0, 5), false);
      tool.onPointerUp();

      // Click near origin (0, 0, 0)
      const res = tool.onPointerDown(new THREE.Vector3(0.05, 0, 0.05), false);
      expect(res.closed).toBe(true);
      expect(tool.getState().isClosed).toBe(true);
    });

    it('updates dynamic resolution when typing segment count (e.g. 36s)', () => {
      const tool = new BezierTool();
      tool.activate();

      tool.onPointerDown(new THREE.Vector3(0, 0, 0), false);
      tool.onPointerUp();
      tool.onPointerDown(new THREE.Vector3(4, 0, 0), false);
      tool.onPointerUp();

      expect(tool.getSegmentsPerSpan()).toBe(24); // default
      tool.updateResolution(36);
      expect(tool.getSegmentsPerSpan()).toBe(36);
      expect(tool.getTessellatedPoints().length).toBe(37);
    });

    it('locks tangent magnitude when user sets exact tangent length', () => {
      const tool = new BezierTool();
      tool.activate();

      tool.onPointerDown(new THREE.Vector3(0, 0, 0), false);
      tool.onPointerMove(new THREE.Vector3(1, 0, 0), false);
      tool.onPointerUp();

      tool.setTangentLength(2.5);
      const knot = tool.getKnots()[0];
      expect(knot.handleOut?.distanceTo(knot.point)).toBeCloseTo(2.5);
      expect(knot.handleIn?.distanceTo(knot.point)).toBeCloseTo(2.5);
    });
  });

  describe('Kernel Integration & Non-destructive Rollback Host', () => {
    it('commits curve with KernelSession and replaces intermediate undo states', () => {
      const session = new KernelSession();
      const onChange = vi.fn();
      const host = new KernelBezierHost(session, onChange);

      const state: BezierCurveState = {
        knots: [
          { point: new THREE.Vector3(0, 0, 0), handleIn: null, handleOut: new THREE.Vector3(0, 0, 1), mode: 'mirrored' },
          { point: new THREE.Vector3(2, 0, 0), handleIn: new THREE.Vector3(2, 0, 1), handleOut: null, mode: 'mirrored' }
        ],
        segmentsPerSpan: 12,
        isClosed: false,
        activePlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      };

      const res = host.commitCurve(state, false);
      expect(res.ok).toBe(true);
      expect(onChange).toHaveBeenCalled();
      expect(session.canUndo).toBe(true);

      // Now update state with replaceUndo = true (live drag behavior)
      state.segmentsPerSpan = 16;
      const res2 = host.commitCurve(state, true);
      expect(res2.ok).toBe(true);
      // Undo depth should remain 1 instead of growing to 2
      expect(host.undoDepth).toBe(1);
    });
  });
});
