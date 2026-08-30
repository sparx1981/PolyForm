/**
 * PolyForm — live preview for a chamfer drag.
 *
 * Chamfer's real construction is genuinely expensive to run on every mouse
 * move (it inserts dozens of new edges and builds every face directly) —
 * far too much to redo 60 times a second. This instead reads
 * `computeChamferInsets`, the read-only half of the same math chamferSolid
 * itself uses, and renders just each face's own shrunk-inward boundary as
 * a wireframe — the same "show the boundary, not the full solid" approach
 * OffsetPreview and FaceOffsetPreview already use for the same reason.
 *
 * It does not attempt to preview the bevel quads or corner triangles —
 * only the shrunk faces themselves. That is enough to see how much
 * material the current amount removes, without the extra cost of also
 * reconstructing every intermediate facet live.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import type { FaceId, Graph } from '../lib/geometry/types';
import { computeChamferInsets } from '../lib/geometry/chamfer';

export interface ChamferPreviewProps {
  graph: Graph;
  faces: FaceId[];
  amount: number;
  color?: string;
}

const PREVIEW_COLOR = '#0063A3';

export function ChamferPreview({ graph, faces, amount, color = PREVIEW_COLOR }: ChamferPreviewProps) {
  const lineGeometry = useMemo(() => {
    if (amount <= 0) return null;
    const { insetPoint } = computeChamferInsets(graph, faces, amount);

    const lines: number[] = [];
    for (const fid of faces) {
      const f = graph.faces.get(fid);
      const map = insetPoint.get(fid);
      if (!f || !map) continue;
      // Same vertex order as the face's own outer loop, read directly —
      // no need to re-derive it, computeChamferInsets already keyed the
      // map by these same vertex ids.
      const order = [...map.keys()];
      const pts = order.map((vid) => map.get(vid)!);
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % n]!;
        lines.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    if (lines.length === 0) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lines), 3));
    return geo;
  }, [graph, faces, amount]);

  if (!lineGeometry) return null;

  return (
    <lineSegments geometry={lineGeometry} raycast={() => null} renderOrder={4}>
      <lineBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
    </lineSegments>
  );
}

export default ChamferPreview;
