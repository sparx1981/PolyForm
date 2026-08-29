/**
 * PolyForm — live preview for a face-boundary offset.
 *
 * Reads `computeFaceOffset` directly — the SAME function commit uses — so
 * the preview can never disagree with what release actually produces.
 * Wireframe only, matching OffsetPreview.tsx's own reasoning: a solid fill
 * would mean re-tessellating the reshaped boundary every frame, real extra
 * work for a preview whose job is just showing where the edges will land.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import type { FaceId, Graph } from '../lib/geometry/types';
import { computeFaceOffset } from '../lib/geometry/faceOffset';
import { getVertex, loopVertexIds } from '../lib/geometry/topology';

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
    const result = computeFaceOffset(graph, faceId, distance);
    if (!result.ok || !result.positions) return null;

    const f = graph.faces.get(faceId);
    if (!f) return null;
    const order = loopVertexIds(graph, f.outerLoop);
    const pts = order.map((vid) => result.positions!.get(vid) ?? getVertex(graph, vid).position);

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
