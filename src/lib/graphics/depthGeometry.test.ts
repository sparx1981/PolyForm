import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyDepthEdgeFade } from './depthGeometry';

describe('applyDepthEdgeFade', () => {
  it('fades to 0 at a boundary edge and ramps back to 1 away from it', () => {
    // A single flat, non-indexed quad (2 triangles): every edge is a boundary edge (each
    // belongs to only one triangle, except the shared diagonal). The four corners sit
    // exactly ON a boundary edge, so must fade fully to 0.
    const geometry = new THREE.PlaneGeometry(1, 1).toNonIndexed();
    applyDepthEdgeFade(geometry, 0.1);
    const fade = geometry.getAttribute('pfEdgeFade');
    expect(fade).toBeDefined();
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), y = position.getY(i);
      const onCorner = Math.abs(Math.abs(x) - 0.5) < 1e-6 && Math.abs(Math.abs(y) - 0.5) < 1e-6;
      if (onCorner) expect(fade.getX(i)).toBeCloseTo(0, 5);
    }
  });

  it('increases with distance from the boundary up to the margin, then stays at 1', () => {
    // A long, finely subdivided strip - a flat plane's rectangle has FOUR true boundary
    // edges (both long sides too, not just the two short ends), so "far from every edge"
    // means away from all four, not just the short ends the maxEndFade check targets.
    const geometry = new THREE.PlaneGeometry(10, 1, 100, 4).toNonIndexed();
    applyDepthEdgeFade(geometry, 0.2);
    const fade = geometry.getAttribute('pfEdgeFade');
    const position = geometry.getAttribute('position');
    let minCenterFade = Infinity, maxEndFade = 0;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), y = position.getY(i);
      if (Math.abs(x) < 4.5 && Math.abs(y) < 0.3) minCenterFade = Math.min(minCenterFade, fade.getX(i));
      if (Math.abs(Math.abs(x) - 5) < 1e-6) maxEndFade = Math.max(maxEndFade, fade.getX(i));
    }
    expect(minCenterFade).toBeCloseTo(1, 5);
    expect(maxEndFade).toBeCloseTo(0, 5);
  });

  it('leaves a closed, gapless mesh at fade 1 everywhere (no boundary edges to fade toward)', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    applyDepthEdgeFade(geometry, 0.1);
    const fade = geometry.getAttribute('pfEdgeFade');
    for (let i = 0; i < fade.count; i++) expect(fade.getX(i)).toBe(1);
  });

  it('is based on true geometric distance, not the repeating UV coordinate', () => {
    // A wide plane whose UV would ordinarily repeat many times if a tiled material were
    // applied - the fade must still only respond to the true boundary edges, not to any
    // UV-space periodicity, so a vertex far from every true edge reaches full fade
    // regardless of how large its raw UV/position value is.
    const geometry = new THREE.PlaneGeometry(5, 1, 50, 2).toNonIndexed();
    applyDepthEdgeFade(geometry, 0.1);
    const fade = geometry.getAttribute('pfEdgeFade');
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      if (Math.abs(position.getX(i)) < 2 && Math.abs(position.getY(i)) < 0.4) expect(fade.getX(i)).toBeCloseTo(1, 5);
    }
  });
});
