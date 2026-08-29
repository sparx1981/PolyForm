/**
 * PolyForm — live preview for an offset drag.
 *
 * Offset has no single matrix to preview with, unlike a rigid group
 * transform: each vertex moves by an amount that depends on how many faces
 * touch it (see grouptransform.ts's own doc comment on `offsetFaceVertices`).
 * So this reads `computeOffsetPositions` directly — the SAME function
 * commit uses — rather than a second, hand-copied version of the math that
 * could silently drift from what actually gets applied.
 *
 * Wireframe only, deliberately: a solid fill would need re-tessellating
 * every face's new boundary live, including any holes, which is real extra
 * work for a preview whose whole job is just showing where the edges will
 * land.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import type { FaceId, Graph } from '../lib/geometry/types';
import { computeOffsetPositions } from '../lib/geometry/grouptransform';
import { getVertex } from '../lib/geometry/topology';

export interface OffsetPreviewProps {
  graph: Graph;
  faces: FaceId[];
  distance: number;
  color?: string;
}

const PREVIEW_COLOR = '#0063A3';

export function OffsetPreview({ graph, faces, distance, color = PREVIEW_COLOR }: OffsetPreviewProps) {
  const lineGeometry = useMemo(() => {
    if (Math.abs(distance) < 1e-6) return null;
    const newPositions = computeOffsetPositions(graph, faces, distance);

    const lines: number[] = [];
    for (const fid of faces) {
      const f = graph.faces.get(fid);
      if (!f) continue;
      for (const lid of [f.outerLoop, ...f.innerLoops]) {
        const loop = graph.loops.get(lid);
        if (!loop) continue;
        const pts = loop.uses.map((u) => {
          const e = graph.edges.get(u.edge)!;
          const vid = u.reversed ? e.v1 : e.v0;
          return newPositions.get(vid) ?? getVertex(graph, vid).position;
        });
        const n = pts.length;
        for (let i = 0; i < n; i++) {
          const a = pts[i]!;
          const b = pts[(i + 1) % n]!;
          lines.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
    }
    if (lines.length === 0) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lines), 3));
    return geo;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, faces.join(','), distance]);

  if (!lineGeometry) return null;

  return (
    <lineSegments geometry={lineGeometry} raycast={() => null} renderOrder={4}>
      <lineBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
    </lineSegments>
  );
}

export default OffsetPreview;
