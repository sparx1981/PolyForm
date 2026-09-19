import React, { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import type { HeightMapValue } from '../../types';
import { SurfaceDepth } from '../../lib/graphics';
import { subdivideDepthGeometry } from '../../lib/graphics/depthGeometry';

/**
 * Child of one of KernelGeometry's per-render-group meshes; applies that
 * group's height map (if any) the same way SurfaceDepthBinding does for a
 * Shape's own mesh, just driven by a plain HeightMapValue instead of a
 * Shape. facesByRenderGroup already keeps faces with different height maps
 * in separate meshes, so every face sharing this one has the identical
 * value - no per-face reconciliation needed here.
 *
 * `revision` is in the effect's dependency list deliberately: KernelGeometry
 * fully re-tessellates on every kernel edit (push/pull, split, etc.), so the
 * mesh's base geometry object is replaced even when the height map itself
 * hasn't changed, and this needs to re-subdivide/re-attach against the new one.
 */
export function KernelSurfaceDepthBinding({ surfaceDepth, revision }: { surfaceDepth: HeightMapValue | undefined; revision: number }) {
  const marker = useRef<THREE.Object3D>(null);
  const active = useRef<SurfaceDepth | null>(null);
  const latest = useRef(surfaceDepth); latest.current = surfaceDepth;
  const values = () => ({
    scale: Number.isFinite(latest.current?.displacementScale) ? Math.max(0, Math.min(0.2, latest.current!.displacementScale!)) : 0.04,
    bias: Number.isFinite(latest.current?.displacementBias) ? Math.max(-0.2, Math.min(0.2, latest.current!.displacementBias!)) : 0,
  });

  useLayoutEffect(() => {
    if (!surfaceDepth?.displacementMapUrl) return;
    const mesh = marker.current?.parent;
    if (!(mesh instanceof THREE.Mesh)) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.length === 0 || !materials.every(mat => mat instanceof THREE.MeshStandardMaterial)) return;
    const original = mesh.geometry;
    if (!original.hasAttribute('uv') || !original.hasAttribute('normal')) return;

    let disposed = false, relief: SurfaceDepth | undefined, subdivided: THREE.BufferGeometry | undefined, displayedGeometry: THREE.BufferGeometry | undefined;
    const originalRaycast = mesh.raycast;
    const texture = new THREE.TextureLoader().load(surfaceDepth.displacementMapUrl, () => {
      if (disposed) return;
      texture.colorSpace = THREE.NoColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      subdivided = subdivideDepthGeometry(original, surfaceDepth.surfaceDepthSegments ?? 16);
      mesh.geometry = subdivided;
      const { scale, bias } = values();
      relief = new SurfaceDepth(texture, scale, bias, 0.4).init(mesh);
      active.current = relief; displayedGeometry = mesh.geometry;
      // Preserve original tessellated triangles for face-index picking (paint/select).
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceDepth?.displacementMapUrl, surfaceDepth?.surfaceDepthSegments, revision]);

  useLayoutEffect(() => { const { scale, bias } = values(); active.current?.configure(scale, bias); }, [surfaceDepth?.displacementScale, surfaceDepth?.displacementBias]);

  return <object3D ref={marker} />;
}
