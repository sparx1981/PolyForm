import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createWindowGeometry, createDoorGeometry } from './archGeometry';

describe('createWindowGeometry - porthole style', () => {
  it('produces a valid geometry with position data', () => {
    const geom = createWindowGeometry(0.8, 0.8, 0.14, 'porthole');
    const posAttr = geom.getAttribute('position');
    expect(posAttr).toBeDefined();
    expect(posAttr.count).toBeGreaterThan(0);
  });

  it('is round, with its outer edge matching the window width/height', () => {
    // The ring's outer radius is derived directly from width/height, so the
    // overall bounding box (a circle inscribed in the square wall opening)
    // should be close to width x height, not something wildly different.
    const geom = createWindowGeometry(0.8, 0.8, 0.14, 'porthole');
    geom.computeBoundingBox();
    const box = geom.boundingBox!;
    const bboxW = box.max.x - box.min.x;
    const bboxH = box.max.y - box.min.y;
    expect(bboxW).toBeCloseTo(bboxH, 1);
    expect(bboxW).toBeGreaterThan(0.75);
    expect(bboxW).toBeLessThan(0.85);
  });

  it('actually merges the ring and glass instead of falling back to a plain box', () => {
    // TorusGeometry and CylinderGeometry must stay index-compatible when
    // merged (mergeGeometries fails silently on a mismatch and this style
    // falls back to createWindowGeometry's plain THREE.BoxGeometry, which
    // has no material groups and only 24 vertices). A properly merged
    // result has multiple groups (frame vs. glass materials).
    const geom = createWindowGeometry(0.8, 0.8, 0.14, 'porthole');
    expect(geom.groups.length).toBeGreaterThan(1);
    expect(geom.getAttribute('position').count).toBeGreaterThan(24);
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

describe('createDoorGeometry - open archway styles (no physical door leaf)', () => {
  it('produces valid, non-empty geometry for both archway styles', () => {
    for (const style of ['archway-square', 'archway-round']) {
      const geom = createDoorGeometry(1.0, 2.1, 0.15, style);
      expect(geom.getAttribute('position').count).toBeGreaterThan(0);
    }
  });

  it('has far less geometry than a real door - no leaf, plates or lever hardware', () => {
    // An archway is just the frame (jambs + header); flush additionally builds a full
    // panel plus escutcheon plates and lever handles on both faces.
    const archway = createDoorGeometry(1.0, 2.1, 0.15, 'archway-square');
    const flush = createDoorGeometry(1.0, 2.1, 0.15, 'flush');
    expect(flush.getAttribute('position').count).toBeGreaterThan(archway.getAttribute('position').count);
  });

  it('the rounded archway has a true arched head reaching above the springline', () => {
    const geom = createDoorGeometry(1.0, 2.2, 0.15, 'archway-round');
    geom.computeBoundingBox();
    const box = geom.boundingBox!;
    // Apex of the arch should reach close to the full opening height (within the frame
    // thickness), not stop flat at some lower springline.
    expect(box.max.y).toBeGreaterThan(2.2 / 2 - 0.1);
  });

  it('the square archway keeps the plain straight header, unlike the rounded one', () => {
    const square = createDoorGeometry(1.0, 2.2, 0.15, 'archway-square');
    const round = createDoorGeometry(1.0, 2.2, 0.15, 'archway-round');
    // Different vertex counts confirm the two styles actually build distinct geometry
    // (straight header vs. a dozen curved arch segments), not the same thing twice.
    expect(square.getAttribute('position').count).not.toBe(round.getAttribute('position').count);
  });

  it('does not throw and falls back sanely for degenerate dimensions', () => {
    expect(() => createDoorGeometry(0.01, 0.01, 0.01, 'archway-round')).not.toThrow();
  });

  it('still produces the normal flush-panel geometry for unrelated styles', () => {
    const geom = createDoorGeometry(0.9, 2.1, 0.15, 'flush');
    expect(geom.groups.length).toBeGreaterThan(1);
  });
});
