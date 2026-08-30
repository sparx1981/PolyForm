/**
 * PolyForm — genuinely thick line segments for kernel edges.
 *
 * `KernelGeometry` was rendering its edges with raw `<lineSegments>` +
 * `<lineBasicMaterial>` — and native WebGL line width is capped at 1px on
 * virtually every browser/GPU (an ANGLE/driver restriction, not something
 * any prop on that material can override). The edge-line THICKNESS setting
 * consequently had no visible effect, however it was wired through.
 *
 * `LineSegments2`/`LineSegmentsGeometry`/`LineMaterial` (three.js's own
 * addons, the same machinery behind drei's `<Line>`/`<Edges>` — which is
 * how Shape edges already get real thickness) render lines as actual
 * screen-space geometry via a custom shader instead of relying on the
 * driver's native line rasteriser, so `linewidth` genuinely does something.
 *
 * The one thing this technique requires that a plain material doesn't:
 * `LineMaterial`'s shader needs the canvas's CURRENT pixel size (its
 * `resolution` uniform) to convert a linewidth given in pixels into the
 * correct screen-space thickness. Get this stale — e.g. read once at
 * mount and never updated — and the line width silently drifts wrong the
 * moment the window resizes. This component keeps it live via `useFrame`.
 */

import { useMemo, useRef, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

export interface ThickLineSegmentsProps {
  /** Flat [x0,y0,z0, x1,y1,z1, ...] — consecutive PAIRS are independent
   *  segments, exactly like a raw BufferGeometry position attribute for
   *  THREE.LineSegments. Not a connected polyline. */
  positions: Float32Array;
  color: string;
  /** 0–1, applied on top of the material's own opacity. */
  opacity?: number;
  /** In pixels. */
  linewidth?: number;
  renderOrder?: number;
}

export function ThickLineSegments({
  positions,
  color,
  opacity = 1,
  linewidth = 1,
  renderOrder,
}: ThickLineSegmentsProps) {
  const { gl } = useThree();
  const materialRef = useRef<LineMaterial | null>(null);

  const geometry = useMemo(() => {
    const geo = new LineSegmentsGeometry();
    geo.setPositions(positions);
    return geo;
  }, [positions]);

  const material = useMemo(() => {
    const mat = new LineMaterial({
      color: new THREE.Color(color).getHex(),
      linewidth,
      transparent: opacity < 1,
      opacity,
      depthTest: true,
    });
    materialRef.current = mat;
    return mat;
  }, [color, linewidth, opacity]);

  // The resolution uniform converts a pixel linewidth into the correct
  // screen-space thickness — stale on resize otherwise. ResizeObserver on
  // the canvas element itself catches every reason its size could change
  // (window resize, but also a sidebar toggling or any other layout
  // change that resizes the canvas without resizing the window, which a
  // plain window 'resize' listener alone would miss). Reads the drawing
  // buffer size, not the CSS size, since that is what the shader needs.
  useEffect(() => {
    const updateResolution = () => {
      const size = new THREE.Vector2();
      gl.getSize(size);
      const ratio = gl.getPixelRatio();
      material.resolution.set(size.x * ratio, size.y * ratio);
    };
    updateResolution();
    const observer = new ResizeObserver(updateResolution);
    observer.observe(gl.domElement);
    return () => observer.disconnect();
  }, [gl, material]);

  const line = useMemo(() => new LineSegments2(geometry, material), [geometry, material]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  return (
    <primitive
      object={line}
      renderOrder={renderOrder}
      raycast={() => null}
      // Matches the previous raw <lineSegments frustumCulled={false}> —
      // a line's bounding volume, computed from its own position data,
      // can be too conservative at some camera angles and cull edges
      // that should still be visible.
      frustumCulled={false}
    />
  );
}

export default ThickLineSegments;
