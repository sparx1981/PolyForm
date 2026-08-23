/**
 * PolyForm — drawing tool tuning.
 *
 * Values that no test can settle: they are judged by using the tool. Kept in
 * one place so they can be adjusted without hunting through Viewport.
 */

/**
 * Snap radii in screen pixels, PER KIND.
 *
 * A single radius for everything makes snapping feel twitchy: every edge
 * contributes a midpoint and every face a centre, so in a model of any density
 * the cursor is nearly always inside something's radius and the snap jumps
 * between candidates as you move.
 *
 * Endpoints are what users actually aim at — they close loops and join edges —
 * so they keep the widest catch. Midpoints and centres are useful but
 * occasional, and a tighter radius means they only fire when genuinely
 * intended.
 */
export const SNAP_RADIUS_PX = {
  endpoint: 12,
  midpoint: 7,
  center: 6,
} as const;

/** Touch has no hover state and a fatter pointer, so everything grows. §8 */
export const SNAP_RADIUS_TOUCH_PX = {
  endpoint: 24,
  midpoint: 14,
  center: 12,
} as const;

export type SnapKindName = keyof typeof SNAP_RADIUS_PX;

export const snapRadiusFor = (kind: SnapKindName, touch = false): number =>
  (touch ? SNAP_RADIUS_TOUCH_PX : SNAP_RADIUS_PX)[kind];

/**
 * How strongly an endpoint outranks a midpoint or centre at similar screen
 * distance. Subtracted from an endpoint's measured distance when ranking, so
 * a corner wins over the midpoint of an edge passing near it rather than the
 * two fighting over a few pixels.
 */
export const ENDPOINT_PREFERENCE_PX = 6;

/** Dwell before a hovered point is treated as an acquired reference. §4.2 */
export const HOVER_DWELL_MS = 200;

/** Preview line opacity, distinguishing it from committed geometry. §4.2 */
export const PREVIEW_OPACITY = 0.6;

/**
 * Effective ranking distance: measured screen distance, minus the endpoint
 * bonus, and Infinity when outside that kind's radius.
 */
export function rankSnap(
  kind: SnapKindName,
  screenDistance: number,
  touch = false,
): number {
  if (screenDistance > snapRadiusFor(kind, touch)) return Infinity;
  return kind === 'endpoint' ? screenDistance - ENDPOINT_PREFERENCE_PX : screenDistance;
}
