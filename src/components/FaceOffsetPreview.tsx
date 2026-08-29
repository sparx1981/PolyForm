/**
 * PolyForm — live preview for a face-boundary offset.
 *
 * Shows the NEW ring that release will insert — a separate boundary drawn
 * inside or around the original, not a reshape of it. Computed via the
 * SAME `offsetPolygon2D` construction `insertFaceOffset` uses, so the
 * preview can never disagree with what commit actually produces.
 *
 * The original boundary is untouched by the real operation and needs no
 * preview of its own; only the new ring is shown.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import type { FaceId, Graph } from '../lib/geometry/types';
import { offsetPolygon2D } from '../lib/geometry/faceOffset';
import { getVertex, loopVertexIds } from '../lib/geometry/topology';
import { planeBasis, projectToBasis, unprojectFromBasis } from '../lib/geometry/math';

export interface FaceOffsetPreviewProps {
  graph: Graph;
  faceId: FaceId;
  distance: number;
  color?: string;
}

const PREVIEW_COLOR = '#0063A3';

export function FaceOffsetPreview({ graph, faceId, distance, color = PREVIEW_COLOR }: FaceOffsetPreviewProps) {
  const lineGeometry = useMemo(() => {
    if (Math.abs(distance) < 1e-6) return null;
    const f = graph.faces.get(faceId);
    if (!f) return null;

    const basis = planeBasis(f.plane);
    const order = loopVertexIds(graph, f.outerLoop);
    const points2D = order.map((vid) => projectToBasis(getVertex(graph, vid).position, basis));
    const offset2D = offsetPolygon2D(points2D, distance);
    const pts = offset2D.map((p) => unprojectFromBasis(p, basis));

    const lines: number[] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % n]!;
      lines.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    if (lines.length === 0) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lines), 3));
    return geo;
  }, [graph, faceId, distance]);

  if (!lineGeometry) return null;

  return (
    <lineSegments geometry={lineGeometry} raycast={() => null} renderOrder={4}>
      <lineBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
    </lineSegments>
  );
}

export default FaceOffsetPreview;
