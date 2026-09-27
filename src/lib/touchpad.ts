/**
 * A touchpad's two-finger scroll, as opposed to a mouse wheel: pixel deltas that are small,
 * fractional or sideways (a wheel moves in whole notches of about 100 px, straight up/down).
 */
export function isTouchpadScroll(e: Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY'>): boolean {
  if (e.deltaMode !== 0) return false;
  if (e.deltaX !== 0) return true;
  return Math.abs(e.deltaY) < 50 || !Number.isInteger(e.deltaY);
}
