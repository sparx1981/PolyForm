import { useSyncExternalStore } from 'react';
import type { FaceId } from '../lib/geometry/types';

/**
 * What has been picked with the Combine tool, in click order (the first leads). Shared by the
 * 3D view (which takes the clicks) and the overlay (which shows the Combine bar).
 */
export type CombinePick = { kind: 'kernel'; face: FaceId } | { kind: 'shape'; id: string };
/** A pick resolved to what it combines: all of a kernel shape's faces, or a Shape. */
export type CombineSolid = { kind: 'kernel'; faces: FaceId[] } | { kind: 'shape'; id: string };

let picks: CombinePick[] = [];
const listeners = new Set<() => void>();

export function getCombinePicks(): CombinePick[] {
  return picks;
}

export function setCombinePicks(next: CombinePick[] | ((prev: CombinePick[]) => CombinePick[])): void {
  const value = typeof next === 'function' ? next(picks) : next;
  if (value === picks) return;
  picks = value;
  listeners.forEach(l => l());
}

export function useCombinePicks(): CombinePick[] {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getCombinePicks,
    getCombinePicks,
  );
}

/** Event the overlay sends for the 3D view to combine solids: detail { picks, op }. */
export const COMBINE_SOLIDS_EVENT = 'polyform:combine-solids';
