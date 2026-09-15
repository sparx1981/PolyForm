import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createWindowGeometry } from './archGeometry';

describe('createWindowGeometry - porthole style', () => {
  it('produces a valid geometry with position data', () => {
    const geom = createWindowGeometry(0.8, 0.8, 0.14, 'porthole');
    const posAttr = geom.getAttribute('position');
    expect(posAttr).toBeDefined();
    expect(posAttr.count).toBeGreaterThan(0);
  });

  it('has a square footprint matching the wall opening, with a round ring inset within it', () => {
    // The mounting plate spans the full rectangular wall opening (closing
    // the corner gaps around the round ring), so the overall bounding box
    // should match width x height almost exactly.
    const geom = createWindowGeometry(0.8, 0.8, 0.14, 'porthole');
    geom.computeBoundingBox();
    const box = geom.boundingBox!;
    const bboxW = box.max.x - box.min.x;
    const bboxH = box.max.y - box.min.y;
    expect(bboxW).toBeCloseTo(bboxH, 1);
    expect(bboxW).toBeGreaterThan(0.75);
    expect(bboxW).toBeLessThan(0.85);
  });

  it('does not throw and falls back sanely for degenerate dimensions', () => {
    expect(() => createWindowGeometry(0.01, 0.01, 0.01, 'porthole')).not.toThrow();
  });

  it('still produces the normal rectangular-frame geometry for other styles', () => {
    const geom = createWindowGeometry(1.2, 1.2, 0.12, 'cross');
    geom.computeBoundingBox();
    const box = geom.boundingBox!;
    // A rectangular window's sill extends past the frame width, so its
    // bounding box should be noticeably wider than a circular one's.
    expect(box.max.x - box.min.x).toBeGreaterThan(1.2);
  });
});
