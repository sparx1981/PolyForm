import React, { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Shape } from '../../types';
import { SurfaceDepth } from '../../lib/graphics';
import { canApplySurfaceDepth, subdivideDepthGeometry } from '../../lib/graphics/depthGeometry';
import { useApp } from '../../AppContext';

export interface MaterialDepth {
  enabled: boolean;
  scaleMeters: number;
  biasMeters: number;
  calibrated: boolean;
}

const clamp = (value: number | undefined, min: number, max: number, fallback: number) =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value!)) : fallback;

/** Child of the existing model mesh; geometry stays unmodified in the saved model.
 *
 * Two mutually exclusive height sources feed the same relief: a shape's own legacy
 * `displacementMapUrl` (loaded here via TextureLoader), or a catalog-bound material's
 * `materialDepth`/`heightTexture` pair - already resolved and loaded (through
 * ManagedTextureManager, which can decode the half-float EXR height maps Poly Haven
 * ships; TextureLoader cannot) by useManagedBindingTextures/useMaterialBindings. That
 * managed texture is owned and disposed by its own hook via refcounting, so it must
 * never be disposed here. */
export function SurfaceDepthBinding({ shape, materialDepth, heightTexture }: {
  shape: Shape; materialDepth?: MaterialDepth | null; heightTexture?: THREE.Texture;
}) {
  const { diagLog } = useApp();
  const marker = useRef<THREE.Object3D>(null);
  const active = useRef<SurfaceDepth | null>(null);
  const latest = useRef(shape); latest.current = shape;
  const latestDepth = useRef(materialDepth); latestDepth.current = materialDepth;
  const usingManagedHeight = Boolean(materialDepth?.enabled && heightTexture);
  const values = () => usingManagedHeight
    ? { scale: clamp(latestDepth.current!.scaleMeters, 0, 0.2, 0.04), bias: clamp(latestDepth.current!.biasMeters, -0.2, 0.2, 0) }
    : { scale: clamp(latest.current.displacementScale, 0, 0.2, 0.04), bias: clamp(latest.current.displacementBias, -0.2, 0.2, 0) };
  useLayoutEffect(() => {
    if (!usingManagedHeight && (!shape.surfaceDepthEnabled || !shape.displacementMapUrl)) return;
    if (!canApplySurfaceDepth(shape)) return;
    const mesh = marker.current?.parent;
    if (!(mesh instanceof THREE.Mesh)) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    // Surface depth is available on any shape type, but a handful of objects (mainly
    // vertex-colored landscape props) render with a plain/non-standard material or
    // geometry with no UVs, which this can't drive. Warn rather than fail silently, since
    // the toggle now offers no advance way to tell which objects those are.
    if (materials.length === 0 || !materials.every(mat => mat instanceof THREE.MeshStandardMaterial)) {
      console.warn('[Surface depth] This object’s material doesn’t support height maps.'); return;
    }
    const original = mesh.geometry;
    if (!original.hasAttribute('uv') || !original.hasAttribute('normal')) {
      console.warn('[Surface depth] This object’s geometry has no UVs to map a height map onto.'); return;
    }
    let disposed = false, relief: SurfaceDepth | undefined, subdivided: THREE.BufferGeometry | undefined, displayedGeometry: THREE.BufferGeometry | undefined;
    const originalRaycast = mesh.raycast;
    const attach = (texture: THREE.Texture) => {
      if (disposed) return;
      subdivided = subdivideDepthGeometry(original, shape.surfaceDepthSegments ?? 16);
      mesh.geometry = subdivided;
      const { scale, bias } = values();
      relief = new SurfaceDepth(texture, scale, bias, 0.4).init(mesh);
      active.current = relief; displayedGeometry = mesh.geometry;
      // Temporary diagnostic: confirms whether the edge-fade attribute this specific mesh's
      // depth relies on actually made it onto the live geometry, and how much of the surface
      // it's suppressing - if a corner still shows a gap/crack despite this, the cause isn't
      // the displacement mechanism this attribute controls.
      const fadeAttr = subdivided.getAttribute('pfEdgeFade');
      if (fadeAttr) {
        let min = Infinity, max = -Infinity, zeroCount = 0;
        for (let i = 0; i < fadeAttr.count; i++) {
          const v = fadeAttr.getX(i);
          min = Math.min(min, v); max = Math.max(max, v);
          if (v < 0.01) zeroCount++;
        }
        diagLog('EFFECT', `SurfaceDepth attached to "${shape.name || shape.type}" (${shape.id})`, {
          shapeId: shape.id, shapeType: shape.type, vertexCount: fadeAttr.count,
          pfEdgeFadeMin: min, pfEdgeFadeMax: max, nearZeroFadeVertexCount: zeroCount,
          scale, bias,
        });
      } else {
        diagLog('ERROR', `SurfaceDepth attached to "${shape.name || shape.type}" (${shape.id}) with NO pfEdgeFade attribute`, { shapeId: shape.id });
      }
      // Preserve original modelling face IDs for selection/painting operations.
      mesh.raycast = function (raycaster, intersections) {
        const displayed = this.geometry; this.geometry = original;
        try { originalRaycast.call(this, raycaster, intersections); } finally { this.geometry = displayed; }
      };
    };
    let ownedTexture: THREE.Texture | undefined;
    if (usingManagedHeight) {
      attach(heightTexture!);
    } else {
      const texture = new THREE.TextureLoader().load(shape.displacementMapUrl!, () => {
        texture.colorSpace = THREE.NoColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        attach(texture);
      }, undefined, () => console.warn('[Surface depth] Height texture could not be loaded'));
      ownedTexture = texture;
    }
    return () => {
      disposed = true; active.current = null;
      const current = mesh.geometry;
      const ownsGeometry = current === displayedGeometry || current === subdivided;
      relief?.dispose();
      mesh.geometry = ownsGeometry ? original : current; mesh.raycast = originalRaycast;
      subdivided?.dispose(); ownedTexture?.dispose();
    };
  }, [shape.surfaceDepthEnabled, shape.displacementMapUrl, usingManagedHeight, heightTexture,
    shape.surfaceDepthSegments, shape.type, shape.args, shape.geometryData, shape.terrainData, shape.surfaceMaterials, shape.bevelAmount]);
  useLayoutEffect(() => { const { scale, bias } = values(); active.current?.configure(scale, bias); },
    [shape.displacementScale, shape.displacementBias, materialDepth?.scaleMeters, materialDepth?.biasMeters]);
  return <object3D ref={marker} />;
}
