import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_CAMERA_VIEW, STANDARD_VIEWS, cameraView, distanceForOrthoZoom, frameView, orthoZoomFor, sanitizeCameraView, viewDirection } from './cameraView';

describe('camera view maths', () => {
  it('has unit view directions, with isometric views at equal angles to all axes', () => {
    for (const v of STANDARD_VIEWS) expect(Math.hypot(...viewDirection(v.id))).toBeCloseTo(1, 9);
    const iso = viewDirection('iso-se');
    expect(iso[0]).toBeCloseTo(iso[1], 9); expect(iso[1]).toBeCloseTo(iso[2], 9);
    expect(THREE.MathUtils.radToDeg(Math.asin(iso[1]))).toBeCloseTo(35.264, 2);
    expect(viewDirection('iso-nw')).toEqual([-iso[0], iso[1], -iso[2]]);
    expect(viewDirection('front')).toEqual([0, 0, 1]);
  });
  it('converts between perspective distance and orthographic zoom both ways', () => {
    const zoom = orthoZoomFor(20, 50, 800);
    expect(distanceForOrthoZoom(zoom, 50, 800)).toBeCloseTo(20, 9);
    // Same visible height: a perspective camera at 20 m and an ortho camera at that zoom both show 2*20*tan(25 deg) metres.
    expect(800 / zoom).toBeCloseTo(2 * 20 * Math.tan(THREE.MathUtils.degToRad(25)), 9);
  });
  it('frames a bounding sphere so it fits, in both projections', () => {
    const base = { view: 'front' as const, center: { x: 5, y: 2, z: -3 }, radius: 10, fov: 50, viewportWidth: 1200, viewportHeight: 800 };
    const p = frameView({ ...base, projection: 'perspective' });
    expect(p.target).toEqual([5, 2, -3]); expect(p.zoom).toBeUndefined();
    const camera = new THREE.PerspectiveCamera(50, 1.5); camera.position.set(...p.position); camera.lookAt(...p.target); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
    for (const dx of [-10, 10]) for (const dy of [-10, 10]) {
      const ndc = new THREE.Vector3(5 + dx, 2 + dy, -3).project(camera);
      expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1); expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1);
    }
    const o = frameView({ ...base, projection: 'orthographic', view: 'plan' });
    expect(o.zoom).toBeCloseTo(400 / 11.5, 9);
    expect(o.position[1]).toBeGreaterThan(o.target[1] + 20);
    expect(o.position[0]).toBeCloseTo(5, 2);
  });
  it('survives an empty or tiny model and a narrow viewport', () => {
    const f = frameView({ view: 'iso-se', center: { x: 0, y: 0, z: 0 }, radius: 0, projection: 'perspective', fov: 50, viewportWidth: 300, viewportHeight: 900 });
    expect(f.position.every(Number.isFinite)).toBe(true);
  });
});

describe('camera view settings', () => {
  it('clamps and repairs bad input', () => {
    expect(sanitizeCameraView(null)).toEqual(DEFAULT_CAMERA_VIEW);
    expect(sanitizeCameraView({ projection: 'fisheye', fov: 400 })).toEqual({ projection: 'perspective', fov: 100 });
    expect(sanitizeCameraView({ projection: 'orthographic', fov: NaN })).toEqual({ projection: 'orthographic', fov: 50 });
  });
  it('notifies listeners only on change', () => {
    let calls = 0; const off = cameraView.subscribe(() => calls++);
    cameraView.set({ fov: 30 }); cameraView.set({ fov: 30 });
    expect(calls).toBe(1); expect(cameraView.get().fov).toBe(30);
    cameraView.set({ projection: 'orthographic' }); expect(cameraView.get().projection).toBe('orthographic');
    cameraView.set(DEFAULT_CAMERA_VIEW); off();
  });
});

describe('camera view reset', () => {
  it('returns to perspective with the standard lens', () => {
    cameraView.set({ projection: 'orthographic', fov: 18 });
    expect(cameraView.get()).toEqual({ projection: 'orthographic', fov: 18 });
    cameraView.reset();
    expect(cameraView.get()).toEqual(DEFAULT_CAMERA_VIEW);
  });
});
