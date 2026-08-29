/**
 * PolyForm — group transform binding.
 *
 * Move, scale and rotate for an arbitrary set of kernel faces, mirroring
 * push/pull's shape exactly: begin/update/commit/cancel, with the graph
 * touched once, on commit, so one drag is one undo entry.
 *
 * The existing single-Shape TransformControls wiring in Viewport drives one
 * mesh's position/quaternion/scale and writes it back on release — there is
 * no way to hand it "these six faces" and have it mean anything (see the
 * doc comment on lib/geometry/grouptransform.ts). This is the piece that
 * lets Viewport point a transform gizmo at an arbitrary kernel selection
 * instead: attach the gizmo to a dummy pivot object, and feed this binding
 * the delta each frame.
 *
 * The pure geometric operations (translateFaces, scaleFaces, rotateFaces,
 * boundsOfFaces) live in lib/geometry/grouptransform.ts and are tested
 * there independently of any session or undo concern. This file is the
 * thinner layer that turns a UI gesture into one call to them.
 */

import type { EdgeId, FaceId, Vec3 } from '../lib/geometry/types';
import {
  boundsOfFaces, edgesToRederive, transformFaces,
  scalePivotMatrix, rotatePivotMatrix,
} from '../lib/geometry/grouptransform';
import { translation, IDENTITY } from '../lib/geometry/mat4';
import { derive } from '../lib/geometry/derive';
import { snapshot, restore } from '../lib/geometry/heal';
import type { Mat4 } from '../lib/geometry/types';
import type { KernelArcHost } from './kernelArcHost';

export type TransformKind = 'translate' | 'scale' | 'rotate';

export interface GroupTransformSession {
  readonly faces: FaceId[];
  /** Pivot for scale and rotate — fixed at the START of the drag. */
  readonly pivot: Vec3;
  /**
   * The matrix the drag would apply right now, relative to the graph's
   * state at `begin()`. Recomputed fresh on every `update()` call rather
   * than composed incrementally — a scale gesture reports "2x now", not
   * "1.01x again, on top of the last 1.01x" — so floating-point drift never
   * accumulates across a long drag, and cancelling mid-gesture is exact.
   */
  matrix: Mat4;
  kind: TransformKind | null;
}

export interface GroupTransformBinding {
  begin: (faces: FaceId[], pivot?: Vec3) => void;
  updateTranslate: (delta: Vec3) => void;
  updateScale: (factor: Vec3) => void;
  updateRotate: (axis: Vec3, radians: number) => void;
  /** Applies the pending matrix. Returns false when nothing was committed. */
  commit: () => boolean;
  cancel: () => void;
  readonly active: boolean;
  readonly session: GroupTransformSession | null;
}

const MIN_SCALE = 1e-6;

export function createGroupTransformBinding(
  host: KernelArcHost,
  bumpKernel: () => void,
): GroupTransformBinding {
  let session: GroupTransformSession | null = null;

  return {
    get active() {
      return session !== null;
    },
    get session() {
      return session;
    },

    begin(faces, pivot) {
      const center = pivot ?? boundsOfFaces(host.graph, faces)?.center;
      if (!center || faces.length === 0) return;
      session = { faces: [...faces], pivot: center, matrix: IDENTITY, kind: null };
    },

    updateTranslate(delta) {
      if (!session) return;
      session.kind = 'translate';
      session.matrix = translation(delta);
    },

    updateScale(factor) {
      if (!session) return;
      // A factor of zero or near-zero would collapse the group into a
      // single point — not a scale a user is likely to have meant, and
      // unrecoverable once committed (the geometry has zero extent, so a
      // later scale-up cannot reconstruct it). Clamp rather than apply.
      const safe: Vec3 = {
        x: Math.abs(factor.x) < MIN_SCALE ? Math.sign(factor.x || 1) * MIN_SCALE : factor.x,
        y: Math.abs(factor.y) < MIN_SCALE ? Math.sign(factor.y || 1) * MIN_SCALE : factor.y,
        z: Math.abs(factor.z) < MIN_SCALE ? Math.sign(factor.z || 1) * MIN_SCALE : factor.z,
      };
      session.kind = 'scale';
      session.matrix = scalePivotMatrix(session.pivot, safe);
    },

    updateRotate(axis, radians) {
      if (!session) return;
      session.kind = 'rotate';
      session.matrix = rotatePivotMatrix(session.pivot, axis, radians);
    },

    commit() {
      if (!session || session.kind === null) {
        session = null;
        return false;
      }
      const { faces, matrix } = session;
      session = null;

      const before = snapshot(host.graph);
      try {
        transformFaces(host.graph, faces, matrix);
        const touched: Set<EdgeId> = edgesToRederive(host.graph, faces);
        derive(host.graph, touched, host.deriveOptions);
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
    },
  };
}
