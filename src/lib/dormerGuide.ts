/**
 * What the dormer tool shows on the roof while a dormer is being placed: the spots it would fit (green
 * dots) and, under the pointer, the dormer's outline in green (fits) or red (doesn't, with the reason).
 * The roof panel writes it and the 3D view draws it, so neither needs to know about the other.
 */
export interface DormerGuideState {
  /** Where the roof is (spots and outlines are relative to it). */
  origin: [number, number, number];
  spots: { x: number; z: number; y: number }[];
  ghost: { footprint: [number, number][]; y: number; ok: boolean } | null;
}

let state: DormerGuideState | null = null;
const listeners = new Set<() => void>();

export const dormerGuide = {
  get: () => state,
  set(next: DormerGuideState | null) { state = next; listeners.forEach(l => l()); },
  patch(part: Partial<DormerGuideState>) { if (state) { state = { ...state, ...part }; listeners.forEach(l => l()); } },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
};
