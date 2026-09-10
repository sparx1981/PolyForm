import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  evaluateCatmullRomSpline,
  calculateGradePercentage,
  clampSplineGrade,
  distancePointToLineSegment2D,
  pointInPolygon2D,
} from './math';
import { calculatePadElevationAtPoint, calculateCutFillForPad } from './padGeometry';
import { generateRoadRibbonGeometry } from './roadGeometry';
import type { PadModifier, CurbDitchProfile } from './types';

describe('Terrain Studio - Math Utilities', () => {
  it('evaluateCatmullRomSpline handles small and normal point sets', () => {
    expect(evaluateCatmullRomSpline([], 4)).toEqual([]);

    const single = evaluateCatmullRomSpline([[0, 0, 0]], 4);
    expect(single).toEqual([[0, 0, 0]]);

    const twoPts = evaluateCatmullRomSpline([[0, 0, 0], [10, 0, 0]], 2);
    expect(twoPts.length).toBe(3);
    expect(twoPts[0]).toEqual([0, 0, 0]);
    expect(twoPts[1]).toEqual([5, 0, 0]);
    expect(twoPts[2]).toEqual([10, 0, 0]);

    const spline = evaluateCatmullRomSpline(
      [
        [0, 0, 0],
        [10, 2, 5],
        [20, 4, 10],
        [30, 1, 15],
      ],
      4,
      false
    );
    expect(spline.length).toBeGreaterThan(4);
    expect(spline[0][0]).toBeCloseTo(0);
    expect(spline[0][1]).toBeCloseTo(0);
  });

  it('calculateGradePercentage computes rise over run percentage correctly', () => {
    // 100m run, 8m rise -> 8%
    const grade1 = calculateGradePercentage([0, 0, 0], [100, 8, 0]);
    expect(grade1).toBeCloseTo(8, 2);

    // 50m run (dx=30, dz=40), -5m drop -> -10%
    const grade2 = calculateGradePercentage([0, 10, 0], [30, 5, 40]);
    expect(grade2).toBeCloseTo(-10, 2);

    // Identical horizontal position
    const gradeZero = calculateGradePercentage([5, 10, 5], [5, 20, 5]);
    expect(gradeZero).toBe(0);
  });

  it('clampSplineGrade clamps slopes that exceed maxGradePercent', () => {
    const points: [number, number, number][] = [
      [0, 0, 0],
      [10, 5, 0], // 50% slope, exceeds 10%
      [20, 10, 0],
    ];

    const clamped = clampSplineGrade(points, 10);
    expect(clamped[0]).toEqual([0, 0, 0]);
    // With 10% max grade over 10m run, max elevation gain is 1.0m
    expect(clamped[1][1]).toBeCloseTo(1.0, 4);
    expect(clamped[2][1]).toBeCloseTo(2.0, 4);
  });

  it('distancePointToLineSegment2D calculates exact projection and distance', () => {
    // Segment from (0, 0) to (10, 0)
    // Point at (5, 5) -> proj is (5, 0), distance is 5
    const res1 = distancePointToLineSegment2D(5, 5, 0, 0, 10, 0);
    expect(res1.projection).toEqual([5, 0]);
    expect(res1.distance).toBeCloseTo(5);
    expect(res1.t).toBeCloseTo(0.5);

    // Point before start (-5, 0)
    const res2 = distancePointToLineSegment2D(-5, 3, 0, 0, 10, 0);
    expect(res2.projection).toEqual([0, 0]);
    expect(res2.distance).toBeCloseTo(Math.hypot(-5, 3));
    expect(res2.t).toBe(0);

    // Point past end (15, 0)
    const res3 = distancePointToLineSegment2D(15, 0, 0, 0, 10, 0);
    expect(res3.projection).toEqual([10, 0]);
    expect(res3.distance).toBeCloseTo(5);
    expect(res3.t).toBe(1);
  });

  it('pointInPolygon2D identifies points inside and outside polygon', () => {
    const square: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];

    expect(pointInPolygon2D(5, 5, square)).toBe(true);
    expect(pointInPolygon2D(15, 5, square)).toBe(false);
    expect(pointInPolygon2D(-1, -1, square)).toBe(false);
  });
});

describe('Terrain Studio - Pad Geometry & Earthwork', () => {
  const rectPad: PadModifier = {
    id: 'pad-1',
    name: 'Main Platform',
    type: 'pad',
    enabled: true,
    primitive: 'rectangle',
    center: [0, 0, 0],
    dimensions: [20, 20],
    rotationY: 0,
    targetElevation: 10,
    batterDistance: 5,
    batterProfile: 'linear',
  };

  it('calculatePadElevationAtPoint identifies inside rect pad', () => {
    const res = calculatePadElevationAtPoint(5, 5, 2, rectPad);
    expect(res.isInside).toBe(true);
    expect(res.isBatter).toBe(false);
    expect(res.targetY).toBe(10);
    expect(res.differential).toBe(8); // 10 - 2 = 8m fill
  });

  it('calculatePadElevationAtPoint handles linear batter falloff', () => {
    // Rect half-width is 10. Point at x=12.5 is 2.5m into 5m batter (t = 0.5)
    const res = calculatePadElevationAtPoint(12.5, 0, 0, rectPad);
    expect(res.isInside).toBe(false);
    expect(res.isBatter).toBe(true);
    expect(res.targetY).toBeCloseTo(5.0); // 10 + (0 - 10) * 0.5 = 5.0
    expect(res.differential).toBeCloseTo(5.0);
  });

  it('calculatePadElevationAtPoint handles outside batter zone', () => {
    // Point at x=20 is 10m away from edge (edge is at 10, batter is 5, limit is 15)
    const res = calculatePadElevationAtPoint(20, 0, 3, rectPad);
    expect(res.isInside).toBe(false);
    expect(res.isBatter).toBe(false);
    expect(res.targetY).toBe(3);
    expect(res.differential).toBe(0);
  });

  it('calculatePadElevationAtPoint handles curved and stepped batter profiles', () => {
    const curvedPad: PadModifier = { ...rectPad, batterProfile: 'curved' };
    const resCurved = calculatePadElevationAtPoint(12.5, 0, 0, curvedPad);
    expect(resCurved.isBatter).toBe(true);
    // Smoothstep at t=0.5: 0.5*0.5*(3 - 1) = 0.5
    expect(resCurved.targetY).toBeCloseTo(5.0);

    const steppedPad: PadModifier = { ...rectPad, batterProfile: 'stepped' };
    const resStepped = calculatePadElevationAtPoint(11, 0, 0, steppedPad);
    expect(resStepped.isBatter).toBe(true);
  });

  it('calculatePadElevationAtPoint handles circle pads', () => {
    const circlePad: PadModifier = {
      id: 'pad-circle-1',
      name: 'Round Pavilion',
      type: 'pad',
      enabled: true,
      primitive: 'circle',
      center: [0, 0, 0],
      dimensions: [20, 20], // diameter 20, radius 10
      rotationY: 0,
      targetElevation: 8,
      batterDistance: 4,
      batterProfile: 'linear',
    };

    // Inside circle (dist 6 < 10)
    const inside = calculatePadElevationAtPoint(6, 0, 2, circlePad);
    expect(inside.isInside).toBe(true);
    expect(inside.targetY).toBe(8);

    // In batter (dist 12: 2m past edge, batter is 4m, t = 0.5)
    const batter = calculatePadElevationAtPoint(12, 0, 0, circlePad);
    expect(batter.isBatter).toBe(true);
    expect(batter.targetY).toBeCloseTo(4);

    // Outside batter (dist 16 > 10 + 4)
    const outside = calculatePadElevationAtPoint(16, 0, 0, circlePad);
    expect(outside.isInside).toBe(false);
    expect(outside.isBatter).toBe(false);
    expect(outside.targetY).toBe(0);
  });

  it('calculateCutFillForPad computes accurate volume metrics', () => {
    const flatTerrain = {
      gridX: 11,
      gridY: 11,
      width: 50,
      depth: 50,
      heights: new Array(121).fill(0), // ground at 0
    };

    const metrics = calculateCutFillForPad(rectPad, flatTerrain);
    expect(metrics.fillVolumeM3).toBeGreaterThan(0);
    expect(metrics.fillAreaM2).toBeGreaterThan(0);
    expect(metrics.cutVolumeM3).toBe(0);
    expect(metrics.netVolumeM3).toBe(metrics.fillVolumeM3);
  });
});

describe('Terrain Studio - Road Ribbon Geometry', () => {
  const spline: [number, number, number][] = [
    [0, 0, 0],
    [0, 0, 20],
    [10, 1, 40],
    [20, 2, 60],
  ];

  const profile: CurbDitchProfile = {
    width: 0.15,
    height: 0.15,
    ditchWidth: 1.2,
    ditchDepth: 0.35,
    hasCurb: true,
    hasDitch: true,
  };

  it('generateRoadRibbonGeometry generates complete BufferGeometry with position, normal, and uv', () => {
    const geo = generateRoadRibbonGeometry(spline, 6, profile);

    expect(geo).toBeInstanceOf(THREE.BufferGeometry);
    const posAttr = geo.getAttribute('position');
    const normAttr = geo.getAttribute('normal');
    const uvAttr = geo.getAttribute('uv');

    expect(posAttr).toBeDefined();
    expect(normAttr).toBeDefined();
    expect(uvAttr).toBeDefined();

    expect(posAttr.count).toBeGreaterThan(0);
    expect(normAttr.count).toBe(posAttr.count);
    expect(uvAttr.count).toBe(posAttr.count);

    const index = geo.getIndex();
    expect(index).not.toBeNull();
    expect(index!.count).toBeGreaterThan(0);
  });

  it('generateRoadRibbonGeometry handles degenerate input gracefully', () => {
    const emptyGeo = generateRoadRibbonGeometry([], 6, profile);
    expect(emptyGeo.getAttribute('position').count).toBe(0);

    const singleGeo = generateRoadRibbonGeometry([[0, 0, 0]], 6, profile);
    expect(singleGeo.getAttribute('position').count).toBe(0);
  });
});
