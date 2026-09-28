import { useSyncExternalStore } from 'react';

// Where the Text / 3D Text tool was clicked, waiting for its words. Set from inside the 3D canvas,
// read by the dialog outside it (TextPlacementDialog).

type V3 = [number, number, number];

export interface TextPlacement {
  kind: 'text' | 'text3d';
  point: V3;
  normal: V3;
  towardsViewer: V3;
}

let current: TextPlacement | null = null;
const listeners = new Set<() => void>();

export function setTextPlacement(next: TextPlacement | null): void {
  current = next;
  listeners.forEach(l => l());
}

export function useTextPlacement(): TextPlacement | null {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => current,
  );
}
