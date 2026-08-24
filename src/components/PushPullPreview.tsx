/**
 * PolyForm — push/pull ghost preview.
 *
 * Shows the extrusion as it is dragged, without touching the kernel.
 *
 * The geometry is applied once, on release, so the undo stack holds one entry
 * for the drag rather than a hundred intermediate states. That is the right
 * trade for the model — but it left the user dragging blind, which is the
 * wrong trade for the interaction. This draws what the release will produce,
 * from the boundary captured at the start of the drag.
 *
 * Nothing here reads or mutates the graph.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import type { Vec3 } from '../lib/geometry/types';
import { planeBasis, projectToBasis } from '../lib/geometry/math';
import { triangulate } from '../lib/geometry/tessellate';

export interface PushPullPreviewProps {
  /** Boundary rings: outer first, then holes. */
  rings: Vec3[][];
  normal: Vec3;
  distance: number;
  color?: string;
}

const PREVIEW_COLOR = '#0063A3';

export function PushPullPreview({ rings, normal, distance, color = PREVIEW_COLOR }: PushPullPreviewProps) {
  const { solid, outline } = useMemo(() => {
    const positions: number[] = [];
    const lines: number[] = [];
    const off = new THREE.Vector3(normal.x, normal.y, normal.z).multiplyScalar(distance);

    for (const ring of rings) {
      const n = ring.length;
      if (n < 3) continue;

      // Side walls: one quad per boundary edge, as two triangles.
      for (let i = 0; i < n; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % n]!;
        const at = { x: a.x + off.x, y: a.y + off.y, z: a.z + off.z };
        const bt = { x: b.x + off.x, y: b.y + off.y, z: b.z + off.z };
        positions.push(
          a.x, a.y, a.z, b.x, b.y, b.z, bt.x, bt.y, bt.z,
          a.x, a.y, a.z, bt.x, bt.y, bt.z, at.x, at.y, at.z,
        );
        // Vertical rung plus the top edge, so the shape reads even when the
        // translucent fill is hard to see against the model behind it.
        lines.push(a.x, a.y, a.z, at.x, at.y, at.z);
        lines.push(at.x, at.y, at.z, bt.x, bt.y, bt.z);
      }
    }

    // The cap, triangulated in the face's own plane.
    const outer = rings[0];
    if (outer && outer.length >= 3) {
      const plane = { point: outer[0]!, normal };
      const basis = planeBasis(plane);
      const outer2 = outer.map((p) => projectToBasis(p, basis));
      const holes2 = rings.slice(1).map((r) => r.map((p) => projectToBasis(p, basis)));
      const { points, indices } = triangulate(outer2, holes2);
      for (let t = 0; t < indices.length; t += 3) {
        for (const k of [indices[t]!, indices[t + 1]!, indices[t + 2]!]) {
          const p = points[k]!;
          const world = new THREE.Vector3(basis.origin.x, basis.origin.y, basis.origin.z)
            .addScaledVector(new THREE.Vector3(basis.u.x, basis.u.y, basis.u.z), p.x)
            .addScaledVector(new THREE.Vector3(basis.v.x, basis.v.y, basis.v.z), p.y)
            .add(off);
          positions.push(world.x, world.y, world.z);
        }
      }
    }

    const solidGeo = new THREE.BufferGeometry();
    solidGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    solidGeo.computeVertexNormals();

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lines), 3));

    return { solid: solidGeo, outline: lineGeo };
  }, [rings, normal, distance]);

  if (Math.abs(distance) < 1e-6) return null;

  return (
    <group name="pushpull-preview">
      {/*
        Not raycastable, and drawn after the model. A preview that can be
        clicked would swallow the pointer events that are driving the drag.
      */}
      <mesh geometry={solid} raycast={() => null} renderOrder={3}>
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.22}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <lineSegments geometry={outline} raycast={() => null} renderOrder={4}>
        <lineBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
      </lineSegments>
    </group>
  );
}

/** Kept so the file's exports read consistently with the other components. */
export type PushPullPreviewEvent = ThreeEvent<PointerEvent>;

export default PushPullPreview;
