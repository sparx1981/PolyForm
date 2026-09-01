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
 *
 * Re-applying to an already-filleted solid: the identical mechanism as
 * kernelChamfer.ts's own — see that file's doc comment for the full
 * reasoning (why not undo(), why one commit() is one undo entry). The
 * `originalBoundary` field filletSolid stores on each shrunk face is the
 * same one chamferSolid stores; both write it, either binding can read it
 * back, since a solid could in principle have been chamfered OR filleted
 * before — this binding does not care which, only that the data is there.
 */

import type { EdgeId, FaceId, Vec3 } from '../lib/geometry/types';
import { filletSolid, validateBox } from '../lib/geometry/fillet';
import { computeSafeMaxAmount } from '../lib/geometry/chamfer';
import { deleteGroupFacesAndEdges } from './kernelSelection';
import { insertEdge } from '../lib/geometry/insert';
import { derive } from '../lib/geometry/derive';
import { snapshot, restore } from '../lib/geometry/heal';
import type { KernelArcHost } from './kernelArcHost';

export interface FilletSession {
  readonly faces: FaceId[];
  radius: number;
  /** Present only when re-applying to an already-chamfered/filleted solid
   *  — see this file's own doc comment. */
  readonly reapplyFrom?: readonly (readonly Vec3[])[];
}

export interface FilletBinding {
  /** Validates eligibility immediately (box-only — see fillet.ts's own
   *  doc comment), so a live preview never starts on a selection that
   *  could never fillet, and the caller can show the SPECIFIC reason.
   *  Also handles the re-apply case transparently — see this file's own
   *  doc comment. */
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
      const alreadyDone = faces.some(
        (fid) => host.graph.faces.get(fid)?.attributes.custom.chamferLocked === true,
      );

      if (alreadyDone) {
        const reapplyFrom: Vec3[][] = [];
        for (const fid of faces) {
          const ob = host.graph.faces.get(fid)?.attributes.custom.originalBoundary as
            | Vec3[]
            | undefined;
          if (ob) reapplyFrom.push(ob);
        }
        if (reapplyFrom.length === 0) {
          return { ok: false, reason: 'cannot find the original shape to re-round from' };
        }
        session = { faces: [...faces], radius: 0, reapplyFrom };
        return { ok: true };
      }

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
      const { faces, radius, reapplyFrom } = session;
      session = null;
      // A non-re-apply fillet still requires a positive radius — there's
      // no sharp shape to "return to" otherwise. Re-applying is
      // different: dragging the radius down to (or past) zero is how
      // the user returns an already-filleted solid to its original
      // sharp shape — see the `radius <= 0` branch below, after
      // reconstruction. Mirrors kernelChamfer.ts's own identical fix.
      if (!reapplyFrom && radius <= 0) {
        return { ok: false, reason: 'radius must be positive' };
      }

      const before = snapshot(host.graph);
      const ctx = { graph: host.graph, tolerances: host.tolerances, index: host.spatialIndex };
      try {
        let targetFaces = faces;

        if (reapplyFrom) {
          deleteGroupFacesAndEdges(host.graph, faces);
          const facesBefore = new Set(host.graph.faces.keys());
          const touched = new Set<EdgeId>();
          for (const boundary of reapplyFrom) {
            const n = boundary.length;
            for (let i = 0; i < n; i++) {
              for (const e of insertEdge(ctx, boundary[i]!, boundary[(i + 1) % n]!).touched) {
                touched.add(e);
              }
            }
          }
          derive(host.graph, touched, host.deriveOptions);
          targetFaces = [...host.graph.faces.keys()].filter((fid) => !facesBefore.has(fid));

          const revalidated = validateBox(host.graph, targetFaces);
          if (!revalidated.ok) {
            restore(host.graph, before);
            host.reindex();
            return { ok: false, reason: 'could not reconstruct the original shape' };
          }

          // Dragged back down to zero (or below): the reconstructed
          // sharp box IS the desired result — the user is returning to
          // the original shape, not re-rounding it.
          if (radius <= 0) {
            host.recordUndo(before);
            bumpKernel();
            return { ok: true };
          }
        }

        // Same clamp, and the same reasoning, as kernelChamfer.ts's
        // identical fix — see computeSafeMaxAmount's own doc comment
        // for the full mechanism (and why fillet shares chamfer's own
        // face-shrink math, and therefore its identical failure mode).
        const safeMax = computeSafeMaxAmount(host.graph, targetFaces) * 0.95;
        const clampedRadius = Math.min(radius, safeMax);
        const result = filletSolid(ctx, targetFaces, clampedRadius, DEFAULT_SEGMENTS);
        if (!result.ok) {
          restore(host.graph, before);
          host.reindex();
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
