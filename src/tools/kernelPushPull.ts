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
import { classifyPushFace, COLLAPSE, distanceToNextFace, moveCap } from '../lib/geometry/pushpullSolid';
import { removeFace } from '../lib/geometry/topology';
import { scale as scaleVec } from '../lib/geometry/math';
import type { KernelArcHost } from './kernelArcHost';

/**
 * The same marker Rectangle/Circle/Triangle set on the face they create
 * (see Viewport.tsx's ring-commit block) — kept here as the single source
 * of truth for the key name, so the two sides can't drift apart.
 */
export const ISOLATED_SHAPE_KEY = 'isolatedShape';

/**
 * Extrudes a kernel face by `distance` as one transaction and one undo entry. Shared by the
 * Push/Pull tool and `sdk.drawing.pushPull`, so a script does exactly what the tool does.
 * The caller refreshes the view (bumpKernel).
 */
export interface PushPullCommitOptions {
  /**
   * Push a copy: the face stays where it is and the extrusion stacks on it as a new segment
   * (how floors are stacked). Without it, a face that is part of a solid moves the solid's walls
   * with it instead of building a second slab.
   */
  readonly copy?: boolean;
}

export function commitKernelPushPull(host: KernelArcHost, faceId: FaceId, distance: number, options: PushPullCommitOptions = {}): boolean {
  if (Math.abs(distance) < host.tolerances.MIN_EDGE_LENGTH) return false;
  const before = snapshot(host.graph);
  try {
    // A face that is part of a closed solid: move a cap, or consume an embedded face.
    let kind = options.copy ? 'other' : classifyPushFace(host.graph, faceId, host.tolerances);
    if (kind === 'cap') {
      const moved = moveCap(host.graph, faceId, distance, host.tolerances, host.deriveOptions);
      if (moved.ok) { host.recordUndo(before); return true; }
      // Pushing a cap through the far side would leave nothing: refuse, and change nothing.
      if (moved.reason === COLLAPSE) return false;
      kind = 'other';
    } else if (kind === 'embedded') {
      const f = host.graph.faces.get(faceId);
      const reach = f ? distanceToNextFace(host.graph, faceId, scaleVec(f.plane.normal, Math.sign(distance))) : null;
      // A recess that would break through the far side is left to the ordinary push/pull.
      if (reach !== null && Math.abs(distance) >= reach - host.tolerances.MIN_EDGE_LENGTH) kind = 'other';
    }
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
    // The face it grew from is no longer a boundary between solid and air: it goes.
    if (kind === 'embedded') removeFace(host.graph, faceId);
    host.recordUndo(before);
    return true;
  } catch {
    restore(host.graph, before);
    host.reindex();
    return false;
  }
}

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
  commit: (options?: PushPullCommitOptions) => boolean;
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

    commit(options) {
      if (!session) return false;
      const { faceId, distance } = session;
      session = null;
      if (Math.abs(distance) < host.tolerances.MIN_EDGE_LENGTH) return false;

      const ok = commitKernelPushPull(host, faceId, distance, options);
      if (ok) bumpKernel();
      return ok;
    },

    cancel() {
      session = null;
    },
  };
}
