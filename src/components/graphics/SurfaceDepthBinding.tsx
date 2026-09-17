import React, { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Shape } from '../../types';
import { SurfaceDepth } from '../../lib/graphics';
import { canApplySurfaceDepth, subdivideDepthGeometry } from '../../lib/graphics/depthGeometry';

/** Child of the existing model mesh; geometry stays unmodified in the saved model. */
export function SurfaceDepthBinding({ shape }: { shape: Shape }) {
  const marker = useRef<THREE.Object3D>(null);
  const active = useRef<SurfaceDepth | null>(null);
  const latest = useRef(shape); latest.current = shape;
  const values = () => ({ scale: Number.isFinite(latest.current.displacementScale) ? Math.max(0, Math.min(0.2, latest.current.displacementScale!)) : 0.04,
    bias: Number.isFinite(latest.current.displacementBias) ? Math.max(-0.2, Math.min(0.2, latest.current.displacementBias!)) : 0 });
  useLayoutEffect(() => {
    if (!shape.surfaceDepthEnabled || !shape.displacementMapUrl || !canApplySurfaceDepth(shape)) return;
    const mesh = marker.current?.parent;
    if (!(mesh instanceof THREE.Mesh) || !(mesh.material instanceof THREE.MeshStandardMaterial)) return;
    const original = mesh.geometry;
    if (!original.hasAttribute('uv') || !original.hasAttribute('normal')) return;
    let disposed = false, relief: SurfaceDepth | undefined, subdivided: THREE.BufferGeometry | undefined, displayedGeometry: THREE.BufferGeometry | undefined;
    const originalRaycast = mesh.raycast;
    const texture = new THREE.TextureLoader().load(shape.displacementMapUrl, () => {
      if (disposed) return;
      texture.colorSpace = THREE.NoColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      subdivided = subdivideDepthGeometry(original, shape.surfaceDepthSegments ?? 16);
      mesh.geometry = subdivided;
      const { scale, bias } = values();
      relief = new SurfaceDepth(texture, scale, bias, 0.4).init(mesh);
      active.current = relief; displayedGeometry = mesh.geometry;
      // Preserve original modelling face IDs for selection/painting operations.
      mesh.raycast = function (raycaster, intersections) {
        const displayed = this.geometry; this.geometry = original;
        try { originalRaycast.call(this, raycaster, intersections); } finally { this.geometry = displayed; }
      };
    }, undefined, () => console.warn('[Surface depth] Height texture could not be loaded'));
    return () => {
      disposed = true; active.current = null;
      const current = mesh.geometry;
      const ownsGeometry = current === displayedGeometry || current === subdivided;
      relief?.dispose();
      mesh.geometry = ownsGeometry ? original : current; mesh.raycast = originalRaycast;
      subdivided?.dispose(); texture.dispose();
    };
  }, [shape.surfaceDepthEnabled, shape.displacementMapUrl,
    shape.surfaceDepthSegments, shape.type, shape.args, shape.geometryData, shape.terrainData, shape.surfaceMaterials, shape.bevelAmount]);
  useLayoutEffect(() => { const { scale, bias } = values(); active.current?.configure(scale, bias); }, [shape.displacementScale, shape.displacementBias]);
  return <object3D ref={marker} />;
}
