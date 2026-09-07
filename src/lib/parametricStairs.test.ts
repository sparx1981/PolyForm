import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  DEFAULT_STAIRCASE_HEIGHT,
  DEFAULT_IDEAL_STEP_HEIGHT,
  DEFAULT_STRIDE_CONSTANT,
  scanSceneForTargetHeight,
  calculateParametricStairs,
  createParametricStaircaseGeometry
} from './parametricStairs';
import { Shape } from '../types';

describe('Parametric Stair Tool Core Logic & Constraints', () => {
  describe('Target Height Detection & Scene Scanning', () => {
    it('falls back to default_staircase_height (2.7m) when scene has no walls or floors', () => {
      const emptyScene: Shape[] = [];
      const scan = scanSceneForTargetHeight(emptyScene, 0);

      expect(scan.source).toBe('default');
      expect(scan.targetHeight).toBe(DEFAULT_STAIRCASE_HEIGHT);
      expect(scan.targetHeight).toBe(2.70);
    });

    it('falls back to default height when scene objects are irrelevant (e.g. tree, bench)', () => {
      const scene: Shape[] = [
        {
          id: 'tree-1',
          type: 'tree',
          position: [0, 0, 0],
          args: [1, 4, 1],
          color: '#22c55e'
        },
        {
          id: 'bench-1',
          type: 'bench',
          position: [2, 0, 2],
          args: [1, 0.5, 0.5],
          color: '#854d0e'
        }
      ];
      const scan = scanSceneForTargetHeight(scene, 0);

      expect(scan.source).toBe('default');
      expect(scan.targetHeight).toBe(2.70);
    });

    it('detects wall object and determines target height from its top elevation', () => {
      // Polyform wall centered at y = 1.4 with height 2.8 -> top elevation = 1.4 + 1.4 = 2.8m
      const wallShape: Shape = {
        id: 'wall-1',
        name: 'Living Room Wall',
        type: 'wall',
        position: [0, 1.4, 0],
        args: [4.0, 2.8, 0.2],
        color: '#f8fafc',
        tags: ['architecture', 'wall']
      };

      const scan = scanSceneForTargetHeight([wallShape], 0);

      expect(scan.source).toBe('wall');
      expect(scan.detectedObjectId).toBe('wall-1');
      expect(scan.detectedElevation).toBeCloseTo(2.80, 2);
      expect(scan.targetHeight).toBeCloseTo(2.80, 2);
    });

    it('detects upper floor slab object and determines target height accurately', () => {
      // Upper floor slab at y = 3.0, thickness 0.20 -> top elevation = 3.0 + 0.1 = 3.10m
      const slabShape: Shape = {
        id: 'slab-upper-1',
        name: 'Second Floor Slab',
        type: 'poly',
        position: [0, 3.0, 0],
        args: { height: 0.20, vertices: [[-2, -2], [2, -2], [2, 2], [-2, 2]] },
        color: '#cbd5e1',
        tags: ['architecture', 'floor-slab']
      };

      const scan = scanSceneForTargetHeight([slabShape], 0);

      expect(scan.source).toBe('upper_floor');
      expect(scan.detectedObjectId).toBe('slab-upper-1');
      expect(scan.detectedElevation).toBeCloseTo(3.10, 2);
      expect(scan.targetHeight).toBeCloseTo(3.10, 2);
    });

    it('prioritizes upper floor slab over wall when both exist', () => {
      const wallShape: Shape = {
        id: 'wall-1',
        name: 'Ground Wall',
        type: 'wall',
        position: [0, 1.4, 0],
        args: [4.0, 2.8, 0.2],
        color: '#f8fafc'
      };
      const slabShape: Shape = {
        id: 'slab-1',
        name: 'First Floor Slab',
        type: 'box',
        position: [0, 2.8, 0],
        args: [4.0, 0.2, 4.0],
        color: '#cbd5e1',
        tags: ['architecture', 'floor-slab']
      };

      const scan = scanSceneForTargetHeight([wallShape, slabShape], 0);

      expect(scan.source).toBe('upper_floor');
      expect(scan.detectedObjectId).toBe('slab-1');
      expect(scan.targetHeight).toBeCloseTo(2.90, 2); // 2.8 + 0.1
    });

    it('accounts for non-zero baseElevation when calculating targetHeight', () => {
      // Base elevation is 1.0m, wall top elevation is 3.8m -> required rise is 2.8m
      const wallShape: Shape = {
        id: 'wall-1',
        name: 'Elevated Wall',
        type: 'wall',
        position: [0, 2.4, 0],
        args: [4.0, 2.8, 0.2],
        color: '#f8fafc'
      };

      const scan = scanSceneForTargetHeight([wallShape], 1.0);

      expect(scan.targetHeight).toBeCloseTo(2.80, 2);
    });
  });

  describe('Parametric Step Calculation & Equal Riser Heights', () => {
    it('calculates optimal step count and exact actual riser height with equal risers', () => {
      const targetHeight = 2.80; // meters
      const calc = calculateParametricStairs({ targetHeight });

      // ideal_step_height = 0.1778m (~7 inches)
      // 2.80 / 0.1778 = 15.748 -> rounded to nearest whole number = 16 steps
      expect(calc.stepCount).toBe(16);

      // actual_step_height = 2.80 / 16 = 0.175m (17.5 cm)
      expect(calc.actualStepHeight).toBeCloseTo(0.175, 4);

      // The product of step count and actual step height must EXACTLY match the target height
      expect(calc.stepCount * calc.actualStepHeight).toBeCloseTo(targetHeight, 5);
    });

    it('ensures every step has equal riser height for arbitrary heights', () => {
      const testHeights = [1.20, 2.16, 2.65, 2.70, 3.00, 3.45, 4.20];

      for (const h of testHeights) {
        const calc = calculateParametricStairs({ targetHeight: h });

        expect(calc.stepCount).toBe(Math.round(h / DEFAULT_IDEAL_STEP_HEIGHT));
        expect(calc.actualStepHeight).toBeCloseTo(h / calc.stepCount, 5);
        expect(calc.stepCount * calc.actualStepHeight).toBeCloseTo(h, 5);
      }
    });

    it('respects a custom ideal step height if specified', () => {
      const customIdeal = 0.15; // 15 cm step
      const calc = calculateParametricStairs({
        targetHeight: 3.0,
        idealStepHeight: customIdeal
      });

      expect(calc.stepCount).toBe(20); // 3.0 / 0.15 = 20
      expect(calc.actualStepHeight).toBeCloseTo(0.15, 5);
    });
  });

  describe('Slope & Depth Adjustment via Ergonomic Formula', () => {
    it('calculates tread depth using Blondel standard ergonomic formula (2R + T = 24 to 25 inches / 63cm)', () => {
      const targetHeight = 2.80;
      const calc = calculateParametricStairs({ targetHeight });

      // actualStepHeight = 0.175m
      // 2 * R = 0.35m
      // Tread = 0.63m - 0.35m = 0.28m (28 cm / 11 inches)
      expect(calc.treadDepth).toBeCloseTo(0.28, 3);

      // Check standard ergonomic formula: (2 * Riser) + Tread ≈ 0.63m
      const formulaCheck = (2 * calc.actualStepHeight) + calc.treadDepth;
      expect(formulaCheck).toBeCloseTo(DEFAULT_STRIDE_CONSTANT, 3);

      // Total run length must dynamically equal stepCount * treadDepth
      expect(calc.totalRun).toBeCloseTo(calc.stepCount * calc.treadDepth, 4);
    });

    it('adjusts tread depth dynamically when riser height changes, preventing steep or shallow slope', () => {
      // Steeper stairs (e.g. targetHeight 2.0m with 10 steps = 0.20m riser)
      const steepCalc = calculateParametricStairs({
        targetHeight: 2.0,
        idealStepHeight: 0.20
      });
      // Tread should be narrower to compensate: 0.63 - 2 * 0.20 = 0.23m
      expect(steepCalc.treadDepth).toBeCloseTo(0.23, 2);

      // Shallow stairs (e.g. targetHeight 1.5m with 10 steps = 0.15m riser)
      const shallowCalc = calculateParametricStairs({
        targetHeight: 1.5,
        idealStepHeight: 0.15
      });
      // Tread should be deeper to maintain comfortable stride: 0.63 - 2 * 0.15 = 0.33m
      expect(shallowCalc.treadDepth).toBeCloseTo(0.33, 2);
    });

    it('clamps tread depth within safe architectural ergonomic bounds (0.22m to 0.38m)', () => {
      // Very steep target
      const verySteep = calculateParametricStairs({
        targetHeight: 3.0,
        idealStepHeight: 0.26
      });
      expect(verySteep.treadDepth).toBeGreaterThanOrEqual(0.22);

      // Very shallow target
      const veryShallow = calculateParametricStairs({
        targetHeight: 1.0,
        idealStepHeight: 0.10
      });
      expect(veryShallow.treadDepth).toBeLessThanOrEqual(0.38);
    });
  });

  describe('Iterative Construction & No Global Stretching', () => {
    it('constructs individual steps iteratively in a loop without Y-axis scaling', () => {
      const result = createParametricStaircaseGeometry({
        targetHeight: 2.80,
        width: 1.0,
        stairStructure: 'closed',
        railingMode: 'both'
      });

      expect(result.geometry).toBeDefined();
      expect(result.calculation.stepCount).toBe(16);
      expect(result.calculation.actualStepHeight).toBeCloseTo(0.175, 4);

      // Compute bounding box of generated geometry
      result.geometry.computeBoundingBox();
      const bbox = result.geometry.boundingBox!;

      // Width check
      expect(bbox.max.x - bbox.min.x).toBeCloseTo(1.0, 1);

      // Total height check (including railing or step rise)
      // The stair steps themselves span from -targetHeight/2 to +targetHeight/2
      // with railing extending above by ~0.95m
      const heightSpan = bbox.max.y - bbox.min.y;
      expect(heightSpan).toBeGreaterThanOrEqual(2.80);

      // Run length check (Z span) - within 0.2m accounting for nosing overhangs and railing newel posts
      const runSpan = bbox.max.z - bbox.min.z;
      expect(Math.abs(runSpan - result.calculation.totalRun)).toBeLessThan(0.2);
    });

    it('generates open, floating, and mono-stringer structures iteratively with equal risers', () => {
      const structures = ['open', 'floating', 'mono-stringer'] as const;

      for (const struct of structures) {
        const result = createParametricStaircaseGeometry({
          targetHeight: 2.70,
          stairStructure: struct,
          railingMode: 'none'
        });

        expect(result.geometry).toBeInstanceOf(THREE.BufferGeometry);
        expect(result.geometry.attributes.position.count).toBeGreaterThan(0);
        expect(result.calculation.actualStepHeight).toBeCloseTo(2.70 / result.calculation.stepCount, 5);
      }
    });

    it('integrates scene scanning directly into parametric staircase generation', () => {
      const wallShape: Shape = {
        id: 'wall-test',
        name: 'Studio Wall',
        type: 'wall',
        position: [0, 1.5, 0],
        args: [5.0, 3.0, 0.2],
        color: '#ffffff'
      };

      const result = createParametricStaircaseGeometry({
        shapes: [wallShape],
        baseElevation: 0,
        stairStructure: 'closed'
      });

      // Target height detected from wall top = 1.5 + 1.5 = 3.0m
      expect(result.calculation.targetHeight).toBeCloseTo(3.0, 2);
      expect(result.calculation.source).toBe('wall');
      expect(result.calculation.stepCount).toBe(Math.round(3.0 / DEFAULT_IDEAL_STEP_HEIGHT));
      expect(result.calculation.actualStepHeight * result.calculation.stepCount).toBeCloseTo(3.0, 5);
    });
  });
});
