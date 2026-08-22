import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TOLERANCES,
  UNIT_TOLERANCES,
  makeTolerances,
  TOUCH_OVERRIDES,
  type Tolerances,
  type Edge,
  type EdgeId,
  type VertexId,
} from './types';

describe('tolerances', () => {
  it('derives MIN_FACE_AREA from MIN_EDGE_LENGTH squared', () => {
    expect(DEFAULT_TOLERANCES.MIN_FACE_AREA).toBe(
      DEFAULT_TOLERANCES.MIN_EDGE_LENGTH ** 2,
    );
  });

  it('keeps the derivation intact when units are rebound', () => {
    for (const [unit, tol] of Object.entries(UNIT_TOLERANCES)) {
      expect(tol.MIN_FACE_AREA, unit).toBe(tol.MIN_EDGE_LENGTH ** 2);
    }
  });

  it('gives a millimetre model a millimetre-appropriate sliver threshold', () => {
    // The point of the unit binding: 1e-6 mm^2 would reject legitimate
    // mechanical detail. 1 mm^2 is correct rather than coincidental. §3
    expect(UNIT_TOLERANCES.millimetres.MIN_FACE_AREA).toBe(1.0);
    expect(UNIT_TOLERANCES.metres.MIN_FACE_AREA).toBeCloseTo(1e-6, 12);
  });

  it('will not let a caller override the derived value', () => {
    // MIN_FACE_AREA is omitted from the overrides type, so a stale value
    // cannot be smuggled in and silently drift from MIN_EDGE_LENGTH.
    const t = makeTolerances({ MIN_EDGE_LENGTH: 0.5 });
    expect(t.MIN_FACE_AREA).toBe(0.25);
  });

  it('expresses angular tolerances in radians', () => {
    expect(DEFAULT_TOLERANCES.COLINEARITY_TOLERANCE).toBeCloseTo(0.1 * (Math.PI / 180), 12);
    expect(DEFAULT_TOLERANCES.MIN_ARC_SWEEP).toBeCloseTo(Math.PI / 180, 12);
  });

  it('treats MIN_CROSS_MAGNITUDE as a sine, not a raw length', () => {
    // 1e-4 corresponds to ~0.006 degrees. 1e-6 would sit inside the
    // numerically unstable band rather than outside it. §5.2
    const angleDeg = Math.asin(DEFAULT_TOLERANCES.MIN_CROSS_MAGNITUDE) * (180 / Math.PI);
    expect(angleDeg).toBeGreaterThan(0.001);
    expect(angleDeg).toBeLessThan(0.1);
  });

  it('enlarges the snap radius for touch', () => {
    expect(TOUCH_OVERRIDES.SNAP_RADIUS_PX).toBeGreaterThan(
      DEFAULT_TOLERANCES.SNAP_RADIUS_PX,
    );
  });
});

describe('type contract', () => {
  it('places no upper bound on edge uses', () => {
    // Three walls meeting at a corner, or a fin on a panel, are legal.
    // A naive Edge { faceA, faceB } model would reject this. §2.4
    const edge: Edge = {
      id: 1 as EdgeId,
      v0: 1 as VertexId,
      v1: 2 as VertexId,
      uses: [],
      smooth: false,
      hidden: false,
      curve: null,
    };
    for (let i = 0; i < 5; i++) {
      edge.uses.push({ edge: edge.id, loop: i as never, reversed: i % 2 === 0 });
    }
    expect(edge.uses).toHaveLength(5);
  });

  it('brands IDs so they cannot be crossed accidentally', () => {
    const v = 1 as VertexId;
    const e = 1 as EdgeId;
    // @ts-expect-error VertexId is not assignable to EdgeId
    const wrong: EdgeId = v;
    expect(typeof wrong).toBe('number');
    expect(e).toBe(1);
  });

  it('exposes tolerances as a readonly shape', () => {
    const t: Tolerances = DEFAULT_TOLERANCES;
    expect(Object.keys(t).sort()).toEqual([
      'COLINEARITY_TOLERANCE',
      'COPLANARITY_TOLERANCE',
      'HOVER_DWELL_MS',
      'MIN_ARC_SWEEP',
      'MIN_CROSS_MAGNITUDE',
      'MIN_EDGE_LENGTH',
      'MIN_FACE_AREA',
      'SNAP_RADIUS_PX',
      'VERTEX_MERGE_TOLERANCE',
    ]);
  });
});
