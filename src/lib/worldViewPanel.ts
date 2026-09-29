/**
 * WorldView's tool panel: which of its sections can be opened, and how the 3D preview map is
 * set up. Kept apart from the component so the rules can be tested.
 */

/** Sections behind the address box stay locked until there is a place to work on. */
export function worldViewUnlocked(state: {
  /** The place's address, as set by a successful search (empty until then). */
  address?: string | null;
  /** The flat map overlay is already on. */
  overlayActive: boolean;
  /** The model already has an imported 3D site. */
  hasImportedSite: boolean;
}): boolean {
  return Boolean(state.address && state.address.trim()) || state.overlayActive || state.hasImportedSite;
}

/**
 * What the Google Photorealistic 3D map is created with. `mode` has to be given: without it the
 * map element draws nothing (a blank area, no error). HYBRID is imagery with labels.
 */
export function buildMap3DOptions(
  lib: { MapMode?: { HYBRID?: unknown; SATELLITE?: unknown } } | null | undefined,
  lat: number,
  lng: number,
): { center: { lat: number; lng: number; altitude: number }; range: number; tilt: number; heading: number; mode: unknown } {
  return {
    center: { lat, lng, altitude: 250 },
    range: 900,
    tilt: 60,
    heading: 0,
    mode: lib?.MapMode?.HYBRID ?? 'HYBRID',
  };
}
