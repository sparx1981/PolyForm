/**
 * How much daylight the scene has, from the sun's intensity. At the default sun (1.0) and above it
 * is 1, so nothing changes; as the sun goes down to 0 it eases to 0, and the ambient, sky and
 * environment light fade with it, so a sun at 0 reads as night rather than a bright, shadowless day.
 */
const FULL_DAYLIGHT_AT = 0.6;

/** What ambient, sky and environment light fall to at night (a little stays, or nothing would be visible). */
export const NIGHT_LIGHT_FLOOR = 0.04;

export function daylightFactor(sunIntensity: number): number {
  const t = Math.min(1, Math.max(0, sunIntensity / FULL_DAYLIGHT_AT));
  return t * t * (3 - 2 * t);
}

/** A light level scaled for the time of day: unchanged by day, down to `floor` of itself at night. */
export function scaleForDaylight(daylight: number, floor: number = NIGHT_LIGHT_FLOOR): number {
  return floor + (1 - floor) * daylight;
}

/** Colour of the plain-colour background (no sky chosen) by night. */
export const NIGHT_BACKGROUND = '#05070f';
/** Ambient light takes a cool moonlight tint at night. */
export const NIGHT_AMBIENT_COLOR = '#9db4ff';
