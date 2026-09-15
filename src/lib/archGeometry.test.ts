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

  it('is actually round, not a rectangular frame', () => {
    // A circular frame's XY bounding box should be roughly square
    // (width ~= height) and noticeably smaller in area than a plain
    // rectangular box of the same width x height, since a circle/ring
    // doesn't fill the corners.
    const geom = createWindowGeometry(0.8, 0.8, 0.14, 'porthole');
    geom.computeBoundingBox();
    const box = geom.boundingBox!;
    const bboxW = box.max.x - box.min.x;
    const bboxH = box.max.y - box.min.y;
    expect(bboxW).toBeCloseTo(bboxH, 1);
    // The outer radius is width/2 = 0.4, so the bounding box should be
    // close to 0.8 x 0.8 (the ring's outer edge), not something wildly
    // different like a full rectangular frame's own sill extension.
    expect(bboxW).toBeGreaterThan(0.6);
    expect(bboxW).toBeLessThan(0.9);
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
