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
 *
 * Re-applying to an already-chamfered solid: clicking Chamfer again on a
 * solid that's already chamferLocked is not treated as an ordinary,
 * fresh chamfer attempt — validateSolid would reject it outright, since
 * the result of a chamfer is no longer a plain box/solid shape. Instead,
 * `begin()` detects this case and reads back each shrunk face's own
 * `originalBoundary` (set by chamferSolid itself — see its own doc
 * comment on that field), so `commit()` can reconstruct the ORIGINAL
 * sharp solid and chamfer it fresh with the new amount. This deliberately
 * is NOT built on undo(): undo() rolls back the whole graph snapshot,
 * which risks unwinding unrelated edits made since the original chamfer,
 * and finding "the same solid" again afterward would need a separate,
 * fragile spatial re-lookup. Reconstructing directly from stored
 * boundaries avoids both problems entirely. The whole sequence — delete
 * the chamfered result, rebuild the sharp solid, chamfer it again — runs
 * inside ONE commit(), so it is one undo entry: undoing a re-applied
 * chamfer returns to the PREVIOUS chamfered state, not to an intermediate
 * "sharp box" the user never asked to see.
 */

import type { EdgeId, FaceId, Vec3 } from '../lib/geometry/types';
import { chamferSolid, validateSolid } from '../lib/geometry/chamfer';
import { deleteGroupFacesAndEdges } from './kernelSelection';
import { insertEdge } from '../lib/geometry/insert';
import { derive } from '../lib/geometry/derive';
import { snapshot, restore } from '../lib/geometry/heal';
import type { KernelArcHost } from './kernelArcHost';

export interface ChamferSession {
  readonly faces: FaceId[];
  distance: number;
  /** Present only when re-applying to an already-chamfered solid — see
   *  this file's own doc comment for the full mechanism. */
  readonly reapplyFrom?: readonly (readonly Vec3[])[];
}

export interface ChamferBinding {
  /** Validates eligibility immediately, so a live preview never starts on a
   *  selection that could never chamfer — and so the caller can show the
   *  SPECIFIC reason (not a hole, not closed, etc.), not a generic failure.
   *  Also handles the re-apply case transparently — see this file's own
   *  doc comment. */
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
      const alreadyChamfered = faces.some(
        (fid) => host.graph.faces.get(fid)?.attributes.custom.chamferLocked === true,
      );

      if (alreadyChamfered) {
        const reapplyFrom: Vec3[][] = [];
        for (const fid of faces) {
          const ob = host.graph.faces.get(fid)?.attributes.custom.originalBoundary as
            | Vec3[]
            | undefined;
          if (ob) reapplyFrom.push(ob);
        }
        if (reapplyFrom.length === 0) {
          return { ok: false, reason: 'cannot find the original shape to re-chamfer from' };
        }
        session = { faces: [...faces], distance: 0, reapplyFrom };
        return { ok: true };
      }

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
      const { faces, distance, reapplyFrom } = session;
      session = null;
      // A non-re-apply chamfer still requires a positive amount — there's
      // no sharp shape to "return to" otherwise. Re-applying is different:
      // dragging the amount down to (or past) zero is how the user
      // returns an already-chamfered solid to its original sharp shape —
      // see the `distance <= 0` branch below, after reconstruction.
      if (!reapplyFrom && distance <= 0) {
        return { ok: false, reason: 'amount must be positive' };
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

          const revalidated = validateSolid(host.graph, targetFaces);
          if (!revalidated.ok) {
            restore(host.graph, before);
            host.reindex();
            return { ok: false, reason: 'could not reconstruct the original shape' };
          }

          // Dragged back down to zero (or below): the reconstructed
          // sharp solid IS the desired result — the user is returning
          // to the original shape, not re-chamfering it. Stop here,
          // rather than calling chamferSolid with a non-positive amount
          // (which would itself refuse and roll everything back).
          if (distance <= 0) {
            host.recordUndo(before);
            bumpKernel();
            return { ok: true };
          }
        }

        const result = chamferSolid(ctx, targetFaces, distance);
        if (!result.ok) {
          restore(host.graph, before);
          host.reindex();
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
