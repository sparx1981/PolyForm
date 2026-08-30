/**
 * PolyForm — fillet (rounded edges) binding.
 *
 * Same shape as kernelChamfer.ts, and the same rule matters here for the
 * identical reason: `commit()` must NOT call generic `derive()` again over
 * `filletSolid`'s own returned edges. `filletSolid` performs a complete,
 * direct construction — every new face is built explicitly — and its
 * faces are marked `chamferLocked` (the same marker chamfer uses) so a
 * LATER, unrelated derive() call elsewhere in the model can never
 * re-examine them. Re-deriving here would defeat that immediately.
 *
 * `begin()` validates with `validateBox`, not chamfer's `validateSolid`:
 * fillet's box-only restriction is stricter (chamfer accepts any closed,
 * hole-free, degree-3 solid; fillet additionally requires every face to
 * be a quad and every edge to meet at 90 degrees) — see fillet.ts's own
 * doc comment for exactly why that restriction exists.
 */

import type { FaceId } from '../lib/geometry/types';
import { filletSolid, validateBox } from '../lib/geometry/fillet';
import { snapshot, restore } from '../lib/geometry/heal';
import type { KernelArcHost } from './kernelArcHost';

export interface FilletSession {
  readonly faces: FaceId[];
  radius: number;
}

export interface FilletBinding {
  /** Validates eligibility immediately (box-only — see fillet.ts's own
   *  doc comment), so a live preview never starts on a selection that
   *  could never fillet, and the caller can show the SPECIFIC reason. */
  begin: (faces: FaceId[]) => { ok: boolean; reason?: string };
  update: (radius: number) => void;
  /** Applies the fillet. Returns false (with a reason) if nothing was committed. */
  commit: () => { ok: boolean; reason?: string };
  cancel: () => void;
  readonly active: boolean;
  readonly session: FilletSession | null;
}

/** A fixed default rather than a user-facing control for now — the
 *  existing radius/chamfer menu has no segment-count input yet. 6
 *  segments gives a visibly smooth curve without excessive face count. */
const DEFAULT_SEGMENTS = 6;

export function createFilletBinding(
  host: KernelArcHost,
  bumpKernel: () => void,
): FilletBinding {
  let session: FilletSession | null = null;

  return {
    get active() {
      return session !== null;
    },
    get session() {
      return session;
    },

    begin(faces) {
      const validated = validateBox(host.graph, faces);
      if (!validated.ok) return { ok: false, reason: validated.reason };
      session = { faces: [...faces], radius: 0 };
      return { ok: true };
    },

    update(radius) {
      if (!session) return;
      session.radius = radius;
    },

    commit() {
      if (!session) return { ok: false, reason: 'no active session' };
      const { faces, radius } = session;
      session = null;
      if (radius <= 0) return { ok: false, reason: 'radius must be positive' };

      const before = snapshot(host.graph);
      try {
        const result = filletSolid(
          { graph: host.graph, tolerances: host.tolerances, index: host.spatialIndex },
          faces,
          radius,
          DEFAULT_SEGMENTS,
        );
        if (!result.ok) {
          restore(host.graph, before);
          return { ok: false, reason: result.reason ?? 'unknown reason' };
        }
        // Deliberately NOT calling derive() again here — see this file's
        // own doc comment, and kernelChamfer.ts's identical one, for why.
        // No reindex() on success either, matching the same established
        // pattern — insertEdge already updates host.spatialIndex as
        // filletSolid runs.
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
