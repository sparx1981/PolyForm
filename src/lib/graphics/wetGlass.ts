import * as THREE from 'three';
import type { GraphicsSettings } from './graphicsSettings';
import { WEATHER_DEFAULTS } from './WeatherSystem';
import { inject } from './shaderHooks';

/**
 * Rain and snow on window and door glass. The glass becomes transmissive, and a procedural
 * height field of water on the pane (static beads, drops sliding down with bead trails) bends
 * the view through it: the field's slope is the glass normal, its height the refraction
 * thickness. Snow frosts the pane in from its edges and leaves small flakes that melt.
 *
 * The drop field follows the classic "rain on a window" layering (static beads plus two
 * sliding layers at different scales) but is written from scratch for world-space panes.
 */

/** How wet or snowy the glass should be for the current weather, 0..1 each. */
export function glassWeatherTargets(weather: GraphicsSettings['weather'] | undefined): { rain: number; snow: number } {
  if (!weather?.enabled) return { rain: 0, snow: 0 };
  const layer = (kind: 'rain' | 'snow') => {
    const settings = weather.layers[kind];
    if (!settings?.enabled || settings.count <= 0) return 0;
    const relative = settings.count / WEATHER_DEFAULTS[kind].count;
    return THREE.MathUtils.clamp(0.25 + 0.5 * relative, 0, 1);
  };
  return { rain: layer('rain'), snow: layer('snow') };
}

/** Shared by every wet pane; driven once per frame (see GlassWeatherDriver). */
export const wetGlassUniforms = {
  uGlassTime: { value: 0 },
  uGlassRain: { value: 0 },
  uGlassSnow: { value: 0 },
};

/** Eases the glass towards the weather: panes wet up over seconds and dry more slowly. */
export function stepGlassWeather(target: { rain: number; snow: number }, delta: number) {
  const u = wetGlassUniforms;
  // Wrap time so float precision never erodes the cell animation in long sessions.
  u.uGlassTime.value = (u.uGlassTime.value + delta) % 3600;
  const ease = (current: number, goal: number) => current + (goal - current) * Math.min(1, delta * (goal > current ? 0.35 : 0.12));
  u.uGlassRain.value = ease(u.uGlassRain.value, target.rain);
  u.uGlassSnow.value = ease(u.uGlassSnow.value, target.snow);
}

const vertexPrelude = /* glsl */ `
varying vec3 vGlassLocal;
varying vec3 vGlassLocalNormal;
varying vec2 vGlassUv;
varying vec3 vGlassT;
varying vec3 vGlassB;
`;

const fragmentPrelude = /* glsl */ `
uniform float uGlassTime, uGlassRain, uGlassSnow;
varying vec3 vGlassLocal;
varying vec3 vGlassLocalNormal;
varying vec2 vGlassUv;
varying vec3 vGlassT;
varying vec3 vGlassB;

// Hash without sine (Dave Hoskins, MIT).
float gHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec3 gHash3(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yzz) * q.zyx); }
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), f.x), f.y);
}
// Height of a spherical cap of radius r at distance d from its centre.
float gCap(float d, float r) { return r > 0. ? sqrt(max(0., r * r - d * d)) : 0.; }

// Beads sitting still on the glass: appear as rain hits, then slowly evaporate.
float gBeads(vec2 p, float t, float amount, float scale) {
  vec2 q = p * scale, id = floor(q), f = fract(q) - .5;
  vec3 h = gHash3(id);
  if (h.z > amount) return 0.;
  float life = fract(t * .06 + h.x * 7.13);
  float r = mix(.1, .3, fract(h.y * 13.1)) * smoothstep(0., .02, life) * (1. - smoothstep(.5, 1., life));
  return gCap(length(f - (h.xy - .5) * .36), r) / scale;
}

// Drops sliding down in columns, stick-slip, leaving a trail of small beads behind them.
float gSlide(vec2 p, float t, float amount, float scale, inout float trail) {
  const float CH = 5.;
  vec2 q = p * scale;
  float column = floor(q.x);
  q.y += gHash(vec2(column, 3.7)) * 11.;
  vec2 id = vec2(column, floor(q.y / CH));
  vec2 st = vec2(fract(q.x), fract(q.y / CH));
  vec3 h = gHash3(id + 17.);
  if (h.z > amount) return 0.;
  float ti = fract(t * (.18 + .3 * h.y) + h.x);
  float fall = ti - sin(ti * 18.85) / 18.85;               // monotone, with pauses
  float y = mix(.9, .1, fall);
  float wiggleY = st.y * CH * 2.1 + h.x * 6.28;
  float x = .5 + (h.y - .5) * .3 + .07 * sin(wiggleY);
  float xd = .5 + (h.y - .5) * .3 + .07 * sin(y * CH * 2.1 + h.x * 6.28);
  vec2 dp = vec2(st.x - xd, (st.y - y) * CH);
  dp.y *= dp.y > 0. ? .7 : 1.2;                            // tapered above, round below
  float alive = smoothstep(0., .04, ti) * (1. - smoothstep(.9, 1., ti));
  float body = gCap(length(dp), mix(.2, .3, h.x)) * alive;
  float above = (st.y - y) * CH;
  float inTrail = step(0., above) * (1. - smoothstep(0., 1.5 + 2. * h.y, above)) * alive;
  float tx = abs(st.x - x);
  trail = max(trail, inTrail * smoothstep(.22, .1, tx));
  float beadRow = st.y * CH * 2.5;
  float bh = gHash(vec2(floor(beadRow), h.x * 91. + column));
  float br = .12 * inTrail * step(.3, bh) * (.6 + .4 * bh);
  float bead = gCap(length(vec2(tx, (fract(beadRow) - .5) / 2.5)), br);
  return max(body, bead) / scale;
}

// Water height on the pane in metres (and how much of it was wiped clear by trails).
float gWater(vec2 p, float t, out float trail) {
  trail = 0.;
  float rain = uGlassRain, snow = uGlassSnow;
  float h = gBeads(p, t, .2 * step(.01, rain) + .55 * rain + .12 * snow, 55.);
  if (rain > .01) {
    h = max(h, gSlide(p, t, smoothstep(.15, .8, rain) * .7, 20., trail));
    h = max(h, gSlide(p * 1.63 + 3.1, t, smoothstep(0., .5, rain) * .55, 20., trail) / 1.63);
  }
  return h;
}

// A snowflake stuck to the pane, six-armed, melting away over its life.
float gFlakes(vec2 p, float t, float amount) {
  vec2 q = p * 32., id = floor(q), f = fract(q) - .5;
  vec3 h = gHash3(id + 41.);
  if (h.z > amount) return 0.;
  float life = fract(t * .025 + h.x * 5.7);
  float size = mix(.18, .42, h.y) * (1. - smoothstep(.35, 1., life)) * smoothstep(0., .02, life);
  f -= (h.xy - .5) * .15;
  float r = length(f), a = atan(f.y, f.x) + h.x * 6.28;
  float arms = pow(abs(cos(3. * a)), 8.);
  float shape = max(arms * (1. - smoothstep(size * .9, size, r)) * smoothstep(.045, .02, abs(sin(3. * a)) * r),
                    1. - smoothstep(size * .18, size * .28, r));
  return shape;
}
`;

/** Makes a MeshPhysicalMaterial wet: call once, before it first renders. */
export function makeWetGlass(material: THREE.MeshPhysicalMaterial) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, wetGlassUniforms);
    shader.vertexShader = vertexPrelude + shader.vertexShader;
    shader.vertexShader = inject(shader.vertexShader, '#include <project_vertex>', `
      #include <project_vertex>
      vGlassLocal = position;
      vGlassLocalNormal = normal;
      vGlassUv = uv;
      vGlassT = normalize((modelViewMatrix * vec4(1., 0., 0., 0.)).xyz);
      vGlassB = normalize((modelViewMatrix * vec4(0., 1., 0., 0.)).xyz);
    `);
    shader.fragmentShader = fragmentPrelude + shader.fragmentShader;
    shader.fragmentShader = inject(shader.fragmentShader, '#include <color_fragment>', `
      #include <color_fragment>
      // Only the pane faces (local XY plane) carry water; the thin edges stay plain glass.
      float gPane = step(.5, abs(vGlassLocalNormal.z));
      vec2 gP = vGlassLocal.xy;
      float gT = uGlassTime;
      float gTrail, gTx, gTy;
      float gH = gWater(gP, gT, gTrail) * gPane;
      const float gE = .0012;
      vec2 gSlope = vec2(gWater(gP + vec2(gE, 0.), gT, gTx) * gPane - gH, gWater(gP + vec2(0., gE), gT, gTy) * gPane - gH) / gE;
      float gWet = smoothstep(0., .0004, gH);

      // Snow: frost creeping in from the pane edges (heavier low down), and stuck flakes.
      vec2 gEdge2 = min(vGlassUv, 1. - vGlassUv);
      float gEdge = min(gEdge2.x, gEdge2.y * mix(.7, 1.3, vGlassUv.y));
      float gFrostNoise = gNoise(gP * 18.) * .6 + gNoise(gP * 55.) * .4;
      // Ice crystals: ridged noise gives feathery, fern-like growth rather than a soft haze.
      float gCrystal = pow(1. - abs(2. * gNoise(gP * 60. + gFrostNoise * 3.) - 1.), 3.) * .6
                     + pow(1. - abs(2. * gNoise(gP * 170.) - 1.), 4.) * .4;
      float gReach = uGlassSnow * (.06 + .22 * uGlassSnow);
      float gFrost = gPane * (1. - smoothstep(gReach * .4, gReach, gEdge + (gFrostNoise - .5) * .08)) * step(.01, uGlassSnow);
      float gFlake = gPane * (uGlassSnow > .01 ? gFlakes(gP, gT, uGlassSnow * .55) : 0.);
      float gOpaque = clamp(max(gFrost * (.2 + .65 * gCrystal), gFlake * .92), 0., 1.);
      // Steep drop rims bend light away (total internal reflection): they read darker.
      float gRim = smoothstep(.6, 2.2, length(gSlope)) * gWet;
    `);
    shader.fragmentShader = inject(shader.fragmentShader, '#include <roughnessmap_fragment>', `
      #include <roughnessmap_fragment>
      // A light mist on wet glass, wiped clear where drops have run; frost scatters strongly.
      float gMist = uGlassRain * .16 * (1. - gTrail) * (1. - gWet);
      roughnessFactor = max(roughnessFactor, max(gMist, gFrost * (.3 + .3 * gCrystal)));
    `);
    shader.fragmentShader = inject(shader.fragmentShader, '#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      normal = normalize(normal - (gSlope.x * vGlassT + gSlope.y * vGlassB) * .6);
    `);
    const transmission = THREE.ShaderChunk.transmission_fragment
      .replace('material.transmission = transmission;', 'material.transmission = transmission * (1. - gOpaque);')
      .replace('material.thickness = thickness;', 'material.thickness = thickness + gH * 45.;');
    if (transmission === THREE.ShaderChunk.transmission_fragment) throw new Error('PolyForm shader anchor missing: transmission_fragment');
    shader.fragmentShader = inject(shader.fragmentShader, '#include <transmission_fragment>', `
      ${transmission}
      totalDiffuse *= 1. - gRim * .45;
    `);
  };
  material.customProgramCacheKey = () => 'polyform-wet-glass-v1';
  return material;
}
