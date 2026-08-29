/**
 * PolyForm — live preview for a group move/scale/rotate.
 *
 * Simpler than the push/pull preview by construction: translate, scale and
 * rotate are all a single matrix applied to geometry that already exists —
 * no new topology is created mid-drag, unlike an extrusion's fresh walls and
 * cap. So the original faces are tessellated ONCE, at the start of the
 * drag, and three.js's own matrix machinery does the rest: wrap that mesh in
 * a <group> whose matrix is set directly each frame.
 *
 * As with push/pull, the kernel graph itself is untouched until commit —
 * this is a ghost, not a live edit.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import type { FaceId, Graph, Mat4 } from '../lib/geometry/types';
import { tessellateFace, mergeBuffers } from '../lib/geometry/tessellate';

export interface GroupTransformPreviewProps {
  /** The graph as it stood at the START of the drag — read once. */
  graph: Graph;
  faces: FaceId[];
  matrix: Mat4;
  color?: string;
}

const PREVIEW_COLOR = '#0063A3';

export function GroupTransformPreview({
  graph,
  faces,
  matrix,
  color = PREVIEW_COLOR,
}: GroupTransformPreviewProps) {
  // Tessellated ONCE — deliberately not keyed on anything that changes
  // during the drag, since the underlying faces are never touched until
  // commit. Re-tessellating every frame would cost real work for no
  // visual difference.
  const { solidGeo, lineGeo } = useMemo(() => {
    const meshes = faces
      .map((id) => tessellateFace(graph, id))
      .filter((m): m is NonNullable<typeof m> => m !== null);
    if (meshes.length === 0) return { solidGeo: null, lineGeo: null };

    const merged = mergeBuffers(meshes);
    const solid = new THREE.BufferGeometry();
    solid.setAttribute('position', new THREE.BufferAttribute(merged.position, 3));
    solid.setAttribute('normal', new THREE.BufferAttribute(merged.normal, 3));
    solid.setIndex(new THREE.BufferAttribute(merged.index, 1));

    // Wireframe from the same triangles, so the outline reads even where
    // the translucent fill is hard to see against the model behind it.
    const line = new THREE.WireframeGeometry(solid);

    return { solidGeo: solid, lineGeo: line };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, faces.join(',')]);

  const m = useMemo(() => {
    const mat = new THREE.Matrix4();
    // Mat4.m is row-major (see lib/geometry/types.ts), and THREE.Matrix4.set
    // also takes its 16 arguments in row-major reading order — so this is a
    // direct copy, not a transpose.
    const e = matrix.m;
    mat.set(
      e[0]!, e[1]!, e[2]!, e[3]!,
      e[4]!, e[5]!, e[6]!, e[7]!,
      e[8]!, e[9]!, e[10]!, e[11]!,
      e[12]!, e[13]!, e[14]!, e[15]!,
    );
    return mat;
  }, [matrix]);

  if (!solidGeo || !lineGeo) return null;

  return (
    <group matrix={m} matrixAutoUpdate={false}>
      {/*
        Not raycastable, and drawn after the model. A preview that can be
        clicked would swallow the pointer events driving the drag.
      */}
      <mesh geometry={solidGeo} raycast={() => null} renderOrder={3}>
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.2}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <lineSegments geometry={lineGeo} raycast={() => null} renderOrder={4}>
        <lineBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
      </lineSegments>
    </group>
  );
}

export default GroupTransformPreview;
