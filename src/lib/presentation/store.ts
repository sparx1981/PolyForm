import { useSyncExternalStore } from 'react';

/**
 * Presentation mode's live settings. A small store of its own (rather than more AppContext
 * state) because it's read every frame inside the 3D canvas and by the floating panel, and none
 * of it is saved with the model.
 */
export type CutMode = 'off' | 'plan' | 'section-x' | 'section-z';

export interface PresentationState {
  /** The editor's presentation panel is open (the client page is always "active"). */
  active: boolean;
  /** Target explode amount, 0-1; the scene eases towards it. */
  explode: number;
  cut: CutMode;
  /** World height (plan cut) or position along x / z (sections), metres. */
  cutAt: number;
  /** Keep the other side of a section instead. */
  cutFlip: boolean;
  xray: boolean;
  /** Build-up progress, 0-1. 1 = everything in place. */
  build: number;
  buildPlaying: boolean;
  /** Seconds a full build-up takes. */
  buildSeconds: number;
  /** Model extent (set by the driver), for the panel's cut slider range. */
  bounds: { min: [number, number, number]; max: [number, number, number] } | null;
  storeys: number;
}

export const INITIAL_PRESENTATION: PresentationState = {
  active: false,
  explode: 0,
  cut: 'off',
  cutAt: 1.2,
  cutFlip: false,
  xray: false,
  build: 1,
  buildPlaying: false,
  buildSeconds: 8,
  bounds: null,
  storeys: 0,
};

let state: PresentationState = INITIAL_PRESENTATION;
const listeners = new Set<() => void>();

export const presentation = {
  get: () => state,
  set(patch: Partial<PresentationState> | ((s: PresentationState) => Partial<PresentationState>)) {
    const next = typeof patch === 'function' ? patch(state) : patch;
    let changed = false;
    for (const k in next) {
      if ((next as any)[k] !== (state as any)[k]) { changed = true; break; }
    }
    if (!changed) return;
    state = { ...state, ...next };
    listeners.forEach(l => l());
  },
  /** Everything back to normal (effects off), keeping `active` as given. */
  reset(active = state.active) {
    state = { ...INITIAL_PRESENTATION, active, bounds: state.bounds, storeys: state.storeys, buildSeconds: state.buildSeconds };
    listeners.forEach(l => l());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};

export function usePresentation(): PresentationState {
  return useSyncExternalStore(presentation.subscribe, presentation.get, presentation.get);
}

/** Starts the build-up from an empty site. */
export function playBuild() {
  presentation.set({ build: 0, buildPlaying: true });
}

/** True while any effect changes how the model looks. */
export function effectsInUse(s: PresentationState) {
  return s.explode > 0 || s.cut !== 'off' || s.xray || s.build < 1 || s.buildPlaying;
}
