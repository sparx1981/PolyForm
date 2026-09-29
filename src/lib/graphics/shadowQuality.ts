/**
 * Shadow settings for the lights the user adds (spot, point, directional and projector).
 *
 * three.js gives every light a 512 x 512 shadow map with no depth bias at all, which makes flat
 * surfaces lit at a shallow angle (a floor under a downlight) break up into stripes and noise:
 * each pixel shadows itself a little. A bigger map, a small depth bias and a bias along the
 * surface normal remove that, and a radius of a couple of texels softens the edge without the
 * grain a wider blur shows.
 *
 * Spread onto a light element: `<spotLight {...SPOT_SHADOW} />`.
 */
export const SPOT_SHADOW = {
  'shadow-mapSize': [1024, 1024] as [number, number],
  'shadow-bias': -0.0004,
  'shadow-normalBias': 0.03,
  'shadow-radius': 2,
};

export const POINT_SHADOW = {
  // A point light draws six faces, so this map is kept smaller.
  'shadow-mapSize': [1024, 1024] as [number, number],
  'shadow-bias': -0.001,
  'shadow-normalBias': 0.05,
  'shadow-radius': 2,
};

export const DIRECTIONAL_SHADOW = {
  'shadow-mapSize': [2048, 2048] as [number, number],
  'shadow-bias': -0.0005,
  'shadow-normalBias': 0.03,
  'shadow-radius': 1.5,
};

/** The sun's blur radius, in shadow-map texels (see components/graphics/SunShadowRig.tsx). */
export const SUN_SHADOW_RADIUS = 1.25;
