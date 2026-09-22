import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyDepthEdgeFade, subdivideDepthGeometry } from './depthGeometry';
import { createWallMiterFootprintGeometry } from '../archGeometry';

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

  it('fades at a closed solid\'s crease edges (no open edges, but faces meet at sharp angles)', () => {
    // A box is fully watertight - every edge belongs to exactly two triangles, so there is no
    // open/boundary edge anywhere. But each pair of adjacent faces meets at 90 degrees, which is
    // exactly the case a wall's own solid (front face meeting its end/miter face) needs caught:
    // independent per-face displacement at those edges would still pull the surface apart.
    // Subdivided so each face has interior vertices away from any edge - an unsubdivided box's
    // vertices are ALL corners (every coordinate at +-0.5), with nothing to tell "face center"
    // apart from "face edge".
    const geometry = subdivideDepthGeometry(new THREE.BoxGeometry(1, 1, 1), 8);
    const fade = geometry.getAttribute('pfEdgeFade');
    const position = geometry.getAttribute('position');
    let minCenterFade = Infinity, maxCornerFade = 0;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
      const onEdge = [x, y, z].filter(v => Math.abs(Math.abs(v) - 0.5) < 1e-6).length >= 2;
      const nearCenterOfFace = Math.abs(Math.abs(x) - 0.5) < 1e-6 ? Math.abs(y) < 0.2 && Math.abs(z) < 0.2
        : Math.abs(Math.abs(y) - 0.5) < 1e-6 ? Math.abs(x) < 0.2 && Math.abs(z) < 0.2
        : Math.abs(x) < 0.2 && Math.abs(y) < 0.2;
      if (onEdge) maxCornerFade = Math.max(maxCornerFade, fade.getX(i));
      if (nearCenterOfFace) minCenterFade = Math.min(minCenterFade, fade.getX(i));
    }
    expect(maxCornerFade).toBeCloseTo(0, 5);
    expect(minCenterFade).toBeCloseTo(1, 5);
  });

  it('fades at a mitered wall solid\'s own crease edges (the reported wall-corner PBR gap)', () => {
    // Reproduces the exact reported bug: createWallMiterFootprintGeometry builds a fully
    // closed, watertight ExtrudeGeometry (a real footprint outline, extruded with top/bottom
    // caps) - it has zero open/boundary edges, so before the crease check was added,
    // applyDepthEdgeFade found nothing to fade and pfEdgeFade was 1 everywhere, letting
    // independent per-face displacement pull the mitered corner apart visibly.
    const footprint: [number, number][] = [[0, 0], [3, 0], [3, 0.2], [0.2, 0.2], [0.2, 2], [0, 2]];
    const geometry = createWallMiterFootprintGeometry(footprint, 2.4);
    const subdivided = subdivideDepthGeometry(geometry, 16);
    const fade = subdivided.getAttribute('pfEdgeFade');
    expect(fade).toBeDefined();
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < fade.count; i++) { min = Math.min(min, fade.getX(i)); max = Math.max(max, fade.getX(i)); }
    expect(min).toBeCloseTo(0, 5); // the solid's own face-to-face creases must fade toward 0
    expect(max).toBe(1); // and still reach full strength away from every crease
  });

  it('does not fade a smoothly curved closed mesh (no creases, only gentle normal change)', () => {
    // A sphere is also watertight, but has no sharp creases anywhere - adjacent triangles'
    // normals differ only slightly. This must stay a true no-op, unlike the box case above.
    const geometry = new THREE.SphereGeometry(1, 24, 16).toNonIndexed();
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
