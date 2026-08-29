/**
 * PolyForm — offset binding.
 *
 * Uniformly grows or shrinks a set of faces along their own normals,
 * mirroring push/pull's session shape exactly: begin/update/commit/cancel,
 * with the graph touched once, on commit, so one drag is one undo entry.
 *
 * The pure operation lives in lib/geometry/grouptransform.ts
 * (`offsetFaceVertices`, `computeOffsetPositions`) and is tested there
 * independently of any session or undo concern. This is the thinner layer
 * that turns a drag into one call to it.
 *
 * Unlike push/pull, offset has no single matrix to preview with: each
 * vertex moves by an amount that depends on how many faces touch it, so a
 * live preview reads `computeOffsetPositions` directly (see
 * OffsetPreview.tsx) rather than reusing GroupTransformPreview's
 * one-matrix approach.
 */

import type { FaceId } from '../lib/geometry/types';
import { edgesToRederive, offsetFaceVertices } from '../lib/geometry/grouptransform';
import { derive } from '../lib/geometry/derive';
import { snapshot, restore } from '../lib/geometry/heal';
import type { KernelArcHost } from './kernelArcHost';

export interface OffsetSession {
  readonly faces: FaceId[];
  distance: number;
}

export interface OffsetBinding {
  begin: (faces: FaceId[]) => void;
  update: (distance: number) => void;
  /** Applies the pending distance. Returns false when nothing was committed. */
  commit: () => boolean;
  cancel: () => void;
  readonly active: boolean;
  readonly session: OffsetSession | null;
}

export function createOffsetBinding(
  host: KernelArcHost,
  bumpKernel: () => void,
): OffsetBinding {
  let session: OffsetSession | null = null;

  return {
    get active() {
      return session !== null;
    },
    get session() {
      return session;
    },

    begin(faces) {
      if (faces.length === 0) return;
      session = { faces: [...faces], distance: 0 };
    },

    update(distance) {
      if (!session) return;
      session.distance = distance;
    },

    commit() {
      if (!session) return false;
      const { faces, distance } = session;
      session = null;
      if (Math.abs(distance) < host.tolerances.MIN_EDGE_LENGTH) return false;

      const before = snapshot(host.graph);
      try {
        offsetFaceVertices(host.graph, faces, distance);
        const touched = edgesToRederive(host.graph, faces);
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
