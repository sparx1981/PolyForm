/**
 * PolyForm — face offset binding.
 *
 * Shrinks or grows a SINGLE free face's own boundary within its own plane —
 * what the app's Offset tool has always done. See faceOffset.ts's own doc
 * comment for why this is a different operation from
 * `createOffsetBinding`/`offsetFaceVertices` in kernelOffset.ts, which
 * inflates a whole solid along each face's 3D normal instead.
 *
 * The distance is CURSOR-POSITION-based, not a dragged delta — matching the
 * original tool exactly: the cursor's signed distance to the polygon
 * boundary (negative inside, positive outside) directly IS the offset
 * amount at every moment, the same way hovering closer to or further from
 * the shape previewed a bigger or smaller reshape before.
 */

import type { FaceId, Vec2 } from '../lib/geometry/types';
import { signedDistanceToPolygon2D, insertFaceOffset } from '../lib/geometry/faceOffset';
import { planeBasis, projectToBasis } from '../lib/geometry/math';
import { loopVertexIds, getVertex } from '../lib/geometry/topology';
import { derive } from '../lib/geometry/derive';
import { snapshot, restore } from '../lib/geometry/heal';
import type { KernelArcHost } from './kernelArcHost';

export interface FaceOffsetSession {
  readonly faceId: FaceId;
  /** The face's own boundary, in its own 2D plane — captured once at begin. */
  readonly polygon2D: Vec2[];
  distance: number;
}

export interface FaceOffsetBinding {
  begin: (faceId: FaceId) => boolean;
  /** Feeds a cursor position, already projected into the face's own plane. */
  update: (cursor2D: Vec2) => number;
  commit: () => boolean;
  cancel: () => void;
  readonly active: boolean;
  readonly session: FaceOffsetSession | null;
  /** Projects a world point into the active session's 2D plane. */
  projectToSessionPlane: (world: { x: number; y: number; z: number }) => Vec2 | null;
}

export function createFaceOffsetBinding(
  host: KernelArcHost,
  bumpKernel: () => void,
): FaceOffsetBinding {
  let session: FaceOffsetSession | null = null;
  let basisCache: ReturnType<typeof planeBasis> | null = null;

  return {
    get active() {
      return session !== null;
    },
    get session() {
      return session;
    },

    begin(faceId) {
      const f = host.graph.faces.get(faceId);
      if (!f) return false;
      if (f.innerLoops.length > 0) return false;

      // No shared-edge check needed: insertion never touches the original
      // boundary, so a face's relationship to its neighbours (if it has
      // any — e.g. a wall of an already-extruded box) is never at risk.

      const basis = planeBasis(f.plane);
      basisCache = basis;
      const polygon2D = loopVertexIds(host.graph, f.outerLoop).map((vid) =>
        projectToBasis(getVertex(host.graph, vid).position, basis),
      );
      session = { faceId, polygon2D, distance: 0 };
      return true;
    },

    projectToSessionPlane(world) {
      if (!basisCache) return null;
      return projectToBasis(world, basisCache);
    },

    update(cursor2D) {
      if (!session) return 0;
      session.distance = signedDistanceToPolygon2D(cursor2D, session.polygon2D);
      return session.distance;
    },

    commit() {
      if (!session) return false;
      const { faceId, distance } = session;
      session = null;
      basisCache = null;
      if (Math.abs(distance) < host.tolerances.MIN_EDGE_LENGTH) return false;

      const before = snapshot(host.graph);
      try {
        const result = insertFaceOffset(
          { graph: host.graph, tolerances: host.tolerances, index: host.spatialIndex },
          faceId,
          distance,
        );
        if (!result.ok) {
          restore(host.graph, before);
          return false;
        }
        derive(host.graph, result.touched, host.deriveOptions);
        host.recordUndo(before);
        bumpKernel();
        return true;
      } catch {
        restore(host.graph, before);
        host.reindex();
        return false;
      }
    },

    cancel() {
      session = null;
      basisCache = null;
    },
  };
}
