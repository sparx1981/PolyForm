/**
 * WorldView's tool panel: which of its sections can be opened,. Kept apart from the component so the rules can be tested.
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
