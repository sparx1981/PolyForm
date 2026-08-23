/**
 * PolyForm — push/pull binding.
 *
 * Bridges Viewport's drag to the kernel's extrusion. Kept out of the
 * component so the interaction rules are testable: what counts as a drag,
 * when a commit is worth making, and how a live preview is discarded.
 */

import type { FaceId, Vec3 } from '../lib/geometry/types';
import { pushPull, pushPullDistanceFromRay } from '../lib/geometry/pushpull';
import { derive } from '../lib/geometry/derive';
import { snapshot, restore } from '../lib/geometry/heal';
import type { KernelArcHost } from './kernelArcHost';

export interface PushPullSession {
  readonly faceId: FaceId;
  readonly grabPoint: Vec3;
  /** Distance shown to the user right now. */
  distance: number;
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
      session = { faceId, grabPoint, distance: 0 };
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
        const r = pushPull(
          { graph: host.graph, tolerances: host.tolerances, index: host.spatialIndex },
          faceId,
          distance,
          { tolerances: host.tolerances },
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
