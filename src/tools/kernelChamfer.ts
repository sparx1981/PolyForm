/**
 * PolyForm — chamfer binding.
 *
 * Uniformly chamfers every edge of the closed solid a clicked face belongs
 * to, following the same begin/update/commit/cancel shape as every other
 * drag-based kernel tool this session (push/pull, offset, face-offset).
 *
 * One rule matters more here than anywhere else: `commit()` must NOT call
 * generic `derive()` again over `chamferSolid`'s own returned edges.
 * `chamferSolid` already performs a complete, direct construction — every
 * new face is built explicitly, not discovered by region-detection — and
 * its faces are marked `chamferLocked` specifically so a LATER, unrelated
 * derive() call elsewhere in the model can never re-examine them (see
 * derive()'s own doc comment). Re-deriving here, with these exact edges in
 * the touched set, would defeat that protection immediately: it is the
 * one scenario the fix explicitly does not cover, documented in
 * chamfer.test.ts. So this binding simply never does it.
 */

import type { FaceId } from '../lib/geometry/types';
import { chamferSolid, validateSolid } from '../lib/geometry/chamfer';
import { snapshot, restore } from '../lib/geometry/heal';
import type { KernelArcHost } from './kernelArcHost';

export interface ChamferSession {
  readonly faces: FaceId[];
  distance: number;
}

export interface ChamferBinding {
  /** Validates eligibility immediately, so a live preview never starts on a
   *  selection that could never chamfer — and so the caller can show the
   *  SPECIFIC reason (not a hole, not closed, etc.), not a generic failure. */
  begin: (faces: FaceId[]) => { ok: boolean; reason?: string };
  update: (distance: number) => void;
  /** Applies the chamfer. Returns false (with a reason) if nothing was committed. */
  commit: () => { ok: boolean; reason?: string };
  cancel: () => void;
  readonly active: boolean;
  readonly session: ChamferSession | null;
}

export function createChamferBinding(
  host: KernelArcHost,
  bumpKernel: () => void,
): ChamferBinding {
  let session: ChamferSession | null = null;

  return {
    get active() {
      return session !== null;
    },
    get session() {
      return session;
    },

    begin(faces) {
      const validated = validateSolid(host.graph, faces);
      if (!validated.ok) return { ok: false, reason: validated.reason };
      session = { faces: [...faces], distance: 0 };
      return { ok: true };
    },

    update(distance) {
      if (!session) return;
      session.distance = distance;
    },

    commit() {
      if (!session) return { ok: false, reason: 'no active session' };
      const { faces, distance } = session;
      session = null;
      if (distance <= 0) return { ok: false, reason: 'amount must be positive' };

      const before = snapshot(host.graph);
      try {
        const result = chamferSolid(
          { graph: host.graph, tolerances: host.tolerances, index: host.spatialIndex },
          faces,
          distance,
        );
        if (!result.ok) {
          restore(host.graph, before);
          return { ok: false, reason: result.reason ?? 'unknown reason' };
        }
        // Deliberately NOT calling derive() again here — see this file's
        // own doc comment for why that would undo chamferSolid's own
        // stability protection. No reindex() on success either: insertEdge
        // already updates host.spatialIndex incrementally as chamferSolid
        // runs, matching the same pattern push/pull and offset use — a
        // full reindex() is only needed after restore(), to rebuild the
        // index for the graph state being rolled BACK to.
        host.recordUndo(before);
        bumpKernel();
        return { ok: true };
      } catch (err) {
        restore(host.graph, before);
        host.reindex();
        return { ok: false, reason: err instanceof Error ? err.message : 'unknown error' };
      }
    },

    cancel() {
      session = null;
    },
  };
}
