/**
 * PolyForm — push/pull binding.
 *
 * Bridges Viewport's drag to the kernel's extrusion. Kept out of the
 * component so the interaction rules are testable: what counts as a drag,
 * when a commit is worth making, and how a live preview is discarded.
 */

import type { FaceId, Vec3 } from '../lib/geometry/types';
import { loopPoints } from '../lib/geometry/topology';
import { pushPull, pushPullDistanceFromRay } from '../lib/geometry/pushpull';
import { insertIsolatedEdge } from '../lib/geometry/insert';
import { derive } from '../lib/geometry/derive';
import { snapshot, restore } from '../lib/geometry/heal';
import type { KernelArcHost } from './kernelArcHost';

/**
 * The same marker Rectangle/Circle/Triangle set on the face they create
 * (see Viewport.tsx's ring-commit block) — kept here as the single source
 * of truth for the key name, so the two sides can't drift apart.
 */
export const ISOLATED_SHAPE_KEY = 'isolatedShape';

export interface PushPullSession {
  readonly faceId: FaceId;
  readonly grabPoint: Vec3;
  /** Distance shown to the user right now. */
  distance: number;
  /**
   * Boundary rings of the face, captured at the start of the drag.
   *
   * The preview is drawn from these rather than read from the graph each
   * frame: the graph does not change until release, so re-reading it would
   * return the same points at the cost of a lookup per frame — and it keeps
   * the preview honest if the face is somehow altered mid-drag.
   */
  readonly rings: Vec3[][];
  readonly normal: Vec3;
}

export interface PushPullBinding {
  begin: (faceId: FaceId, grabPoint: Vec3) => void;
  /** Returns the live distance, for the measurement readout. */
  update: (ray: { origin: Vec3; direction: Vec3 }) => number | null;
  /** Applies the extrusion. Returns false when nothing was committed. */
  commit: () => boolean;
  cancel: () => void;
  readonly active: boolean;
  readonly session: PushPullSession | null;
}

/**
 * Creates the binding.
 *
 * The extrusion is applied ONCE, on commit — not on every pointer move.
 * Extruding live would push a fresh transaction through the kernel per frame,
 * and the undo stack would fill with a hundred intermediate states of one
 * drag. The readout follows the cursor; the geometry lands when released.
 */
export function createPushPullBinding(
  host: KernelArcHost,
  bumpKernel: () => void,
): PushPullBinding {
  let session: PushPullSession | null = null;

  return {
    get active() {
      return session !== null;
    },
    get session() {
      return session;
    },

    begin(faceId, grabPoint) {
      const face = host.graph.faces.get(faceId);
      if (!face) return;
      const rings = [face.outerLoop, ...face.innerLoops].map((lid) => loopPoints(host.graph, lid));
      session = { faceId, grabPoint, distance: 0, rings, normal: face.plane.normal };
    },

    update(ray) {
      if (!session) return null;
      const d = pushPullDistanceFromRay(host.graph, session.faceId, ray, session.grabPoint);
      if (d === null) return session.distance; // degenerate view; hold the last value
      session.distance = d;
      return d;
    },

    commit() {
      if (!session) return false;
      const { faceId, distance } = session;
      session = null;
      if (Math.abs(distance) < host.tolerances.MIN_EDGE_LENGTH) return false;

      const before = snapshot(host.graph);
      try {
        // A face drawn by Rectangle/Circle/Triangle carries this marker
        // (set once, right when the ring closes — see Viewport.tsx) so
        // that EXTRUDING it stays consistent with how it was drawn: its
        // own new geometry (the far cap, the side walls) must also stay
        // isolated from unrelated geometry it happens to cross in 3D
        // space, or the fix at the flat-drawing stage is undone the
        // moment the shape is pushed/pulled — confirmed directly as the
        // actual cause of a second, overlapping extruded shape visibly
        // losing a wedge where it crossed the first one. A face without
        // the marker (drawn with Line/Arc, or a plain rectangle before
        // this existed) keeps the ordinary sticky behaviour untouched —
        // this check is additive, not a change to the default.
        const face = host.graph.faces.get(faceId);
        const isIsolated = face?.attributes.custom?.[ISOLATED_SHAPE_KEY] === true;
        const r = pushPull(
          { graph: host.graph, tolerances: host.tolerances, index: host.spatialIndex },
          faceId,
          distance,
          { tolerances: host.tolerances, ...(isIsolated ? { insertFn: insertIsolatedEdge } : {}) },
        );
        if (!r.ok) {
          restore(host.graph, before);
          return false;
        }
        derive(host.graph, r.touched, host.deriveOptions);
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
