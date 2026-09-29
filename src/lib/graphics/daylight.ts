/**
 * The Sun Intensity slider runs 0 to 100: 0 is night, 50 is ordinary daylight, 100 is a bright
 * sun that still looks natural. The scene's sun intensity behind it is 1.0 at 50 and tops out at
 * MAX_SUN. A new model starts at 40 (a little under full daylight).
 */
export const NORMAL_SUN = 1.0;
export const MAX_SUN = 2.2;
export const DEFAULT_SUN_SLIDER = 40;
export const DEFAULT_SUN = sliderToSun(DEFAULT_SUN_SLIDER);

export function sliderToSun(slider: number): number {
  const v = Math.min(100, Math.max(0, slider));
  return v <= 50 ? (v / 50) * NORMAL_SUN : NORMAL_SUN + ((v - 50) / 50) * (MAX_SUN - NORMAL_SUN);
}

export function sunToSlider(sun: number): number {
  const s = Math.max(0, sun);
  return s <= NORMAL_SUN ? (s / NORMAL_SUN) * 50 : Math.min(100, 50 + ((s - NORMAL_SUN) / (MAX_SUN - NORMAL_SUN)) * 50);
}

/**
 * How much daylight the scene has, from the sun's intensity. From ordinary daylight (1.0) up it is
 * 1, so nothing changes; as the sun goes down to 0 it eases to 0, and the ambient, sky and
 * environment light fade with it, so a sun at 0 reads as night rather than a bright, shadowless day.
 */
const FULL_DAYLIGHT_AT = NORMAL_SUN;

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
