import * as THREE from 'three';
import { inject } from '../graphics/shaderHooks';
import { TRAIL_LENGTH, ringOrigin, type GrassRing } from './bladeGrass';

/**
 * Lit single-blade grass on MeshStandardMaterial, so blades get the scene's sun, shadows, fog,
 * tone mapping and colour output. Techniques adapted from the MIT-licensed gpu-computed-grass
 * example in scottstts/Threejs-Awesome-Graphics-Agent-Skills: Voronoi clumps that share height,
 * facing and tone; Bezier blade spines; rounded blade normals; root occlusion; backlit
 * translucency; distance fading of density toward the ground colour.
 */
export interface BladeGrassUniforms {
  uTime: { value: number };
  uClock: { value: number };
  uWindStrength: { value: number };
  uWindDir: { value: THREE.Vector2 };
  uBaseHeight: { value: number };
  uHeightVariance: { value: number };
  uRootColor: { value: THREE.Color };
  uTipColor: { value: THREE.Color };
  uDryColor: { value: THREE.Color };
  uTranslucency: { value: number };
  uClumpSize: { value: number };
  /** World min corner (x, z) and size (w, d) of the terrain. */
  uBounds: { value: THREE.Vector4 };
  uHeights: { value: THREE.Texture | null };
  uMask: { value: THREE.Texture | null };
  uBaseY: { value: number };
  /** Distance is measured from here; y is ignored for orthographic plan views. */
  uLodOrigin: { value: THREE.Vector3 };
  uLodVertical: { value: number };
  uLodBias: { value: number };
  uTrail: { value: THREE.Vector4[] };
  uTrailRadius: { value: number };
  uTrailRecovery: { value: number };
  /** Size of one screen pixel in metres: a constant part (orthographic) plus one per metre of distance. */
  uPixelWorld: { value: number };
  uPixelAngle: { value: number };
}

/** Per-ring values: each ring has its own grid and fade band. */
export interface BladeRingUniforms {
  uOrigin: { value: THREE.Vector2 };
  uSpacing: { value: number };
  uCells: { value: number };
  /** Distance band over which the ring thins in (the finer ring hands over); x > y disables it. */
  uFadeIn: { value: THREE.Vector2 };
  /** Distance band over which the ring thins out. */
  uFade: { value: THREE.Vector2 };
  /** Wider blades where cells are wider, so coverage stays even. */
  uWidthScale: { value: number };
}

export function createBladeGrassUniforms(): BladeGrassUniforms {
  return {
    uTime: { value: 0 },
    uClock: { value: 0 },
    uWindStrength: { value: 0.3 },
    uWindDir: { value: new THREE.Vector2(Math.SQRT1_2, Math.SQRT1_2) },
    uBaseHeight: { value: 0.12 },
    uHeightVariance: { value: 0.1 },
    uRootColor: { value: new THREE.Color('#4f7340') },
    uTipColor: { value: new THREE.Color('#91b364') },
    uDryColor: { value: new THREE.Color('#b8b264') },
    uTranslucency: { value: 0.7 },
    uClumpSize: { value: 0.5 },
    uBounds: { value: new THREE.Vector4(-25, -25, 50, 50) },
    uHeights: { value: null },
    uMask: { value: null },
    uBaseY: { value: 0 },
    uLodOrigin: { value: new THREE.Vector3() },
    uLodVertical: { value: 1 },
    uLodBias: { value: 0 },
    uTrail: { value: Array.from({ length: TRAIL_LENGTH }, () => new THREE.Vector4(0, 0, -1e6, 0)) },
    uTrailRadius: { value: 0.6 },
    uTrailRecovery: { value: 3 },
    uPixelWorld: { value: 0 },
    uPixelAngle: { value: 0.001 },
  };
}

export function createBladeRingUniforms(): BladeRingUniforms {
  return {
    uOrigin: { value: new THREE.Vector2() },
    uSpacing: { value: 0.05 },
    uCells: { value: 1 },
    uFadeIn: { value: new THREE.Vector2(0, -1) },
    uFade: { value: new THREE.Vector2(1e5, 1e5) },
    uWidthScale: { value: 1 },
  };
}

/**
 * Centres a ring's grid on (x, z) and sets its cross-fades: each ring thins out over the outer
 * part of its own square and thins in where the finer ring before it thins out.
 */
export function updateRingUniforms(uniforms: BladeRingUniforms, ring: GrassRing, finer: GrassRing | undefined, x: number, z: number) {
  ringOrigin(ring, x, z, uniforms.uOrigin.value);
  uniforms.uSpacing.value = ring.spacing;
  uniforms.uCells.value = ring.cells;
  uniforms.uWidthScale.value = ring.widthScale;
  // Hand over gradually across the outer part of each ring, so density falls off smoothly.
  uniforms.uFade.value.set(ring.radius * 0.55, ring.radius * 0.97);
  if (finer) uniforms.uFadeIn.value.set(finer.radius * 0.55, finer.radius * 0.97);
  else uniforms.uFadeIn.value.set(0, -1);
}

/** Root and tip colours come from the user's pickers; sun-dried tips are derived from them. */
export function setBladeColors(uniforms: BladeGrassUniforms, root: string, tip: string) {
  uniforms.uRootColor.value.set(root);
  uniforms.uTipColor.value.set(tip);
  uniforms.uDryColor.value.set(tip).offsetHSL(-0.06, -0.1, 0.1);
}

/** 1%–100% animation slider to a wind bend angle (radians at the tip). */
export function bladeWindStrength(animationStrength: number): number {
  return Math.sqrt(Math.max(0, animationStrength)) * 1.4;
}

const common = /* glsl */ `
float gHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 gHash2(vec2 p) { return vec2(gHash(p), gHash(p + 17.31)); }
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), u.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0)), u.x), u.y);
}
`;

const vertexDeclarations = /* glsl */ `
uniform float uTime;
uniform float uClock;
uniform float uWindStrength;
uniform vec2 uWindDir;
uniform float uBaseHeight;
uniform float uHeightVariance;
uniform float uClumpSize;
uniform vec4 uBounds;
uniform sampler2D uHeights;
uniform sampler2D uMask;
uniform float uBaseY;
uniform vec3 uLodOrigin;
uniform float uLodVertical;
uniform float uLodBias;
uniform vec4 uTrail[${TRAIL_LENGTH}];
uniform float uTrailRadius;
uniform float uTrailRecovery;
uniform vec2 uOrigin;
uniform float uSpacing;
uniform float uCells;
uniform vec2 uFadeIn;
uniform vec2 uFade;
uniform float uWidthScale;
uniform float uPixelWorld;
uniform float uPixelAngle;
varying float vT;
varying float vSide;
varying float vClumpTone;
varying float vBladeTone;
varying float vDry;
varying float vFar;
${common}

// Bilinear sample of the terrain height grid, matching sampleTerrainElevation.
float gTerrainHeight(vec2 xz) {
  vec2 uv = (xz - uBounds.xy) / uBounds.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return uBaseY;
  ivec2 size = textureSize(uHeights, 0);
  vec2 g = uv * vec2(size - 1);
  ivec2 i0 = ivec2(floor(g));
  ivec2 i1 = min(i0 + 1, size - 1);
  vec2 f = g - vec2(i0);
  float h00 = texelFetch(uHeights, i0, 0).r, h10 = texelFetch(uHeights, ivec2(i1.x, i0.y), 0).r;
  float h01 = texelFetch(uHeights, ivec2(i0.x, i1.y), 0).r, h11 = texelFetch(uHeights, i1, 0).r;
  return uBaseY + mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

float gPresence(vec2 xz) {
  vec2 uv = (xz - uBounds.xy) / uBounds.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
  return smoothstep(0.35, 0.85, texture2D(uMask, uv).r);
}

vec3 gBezier(vec3 p1, vec3 p2, vec3 p3, float t) {
  float u = 1.0 - t;
  return 3.0 * u * u * t * p1 + 3.0 * u * t * t * p2 + t * t * t * p3;
}
vec3 gBezierTangent(vec3 p1, vec3 p2, vec3 p3, float t) {
  float u = 1.0 - t;
  return 3.0 * u * u * p1 + 6.0 * u * t * (p2 - p1) + 3.0 * t * t * (p3 - p2);
}
`;

const vertexBody = /* glsl */ `
float t = position.y;
float side = position.x;
vT = t;
vSide = side;

// Grid cell for this blade; hashes use the world cell so blades stay put as the grid slides.
float gIndex = float(gl_InstanceID);
vec2 gCellLocal = vec2(mod(gIndex, uCells), floor(gIndex / uCells));
vec2 gCell = floor(uOrigin / uSpacing + 0.5) + gCellLocal;
vec2 gRootXZ = (gCell + 0.1 + 0.8 * gHash2(gCell)) * uSpacing;
float gSeed = gHash(gCell + 41.7);

// Voronoi clump: blades in a clump share height, facing and tone, and lean outward.
vec2 gClumpCell = floor(gRootXZ / uClumpSize);
float gBestD = 1e9; vec2 gBestC = gClumpCell, gBestP = gRootXZ;
for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
  vec2 c = gClumpCell + vec2(float(i), float(j));
  vec2 p = (c + 0.15 + 0.7 * gHash2(c + 3.3)) * uClumpSize;
  float d = dot(p - gRootXZ, p - gRootXZ);
  if (d < gBestD) { gBestD = d; gBestC = c; gBestP = p; }
}
float gClumpSeed = gHash(gBestC + 9.1);
vec2 gFromCentre = gRootXZ - gBestP;
float gFromLen = length(gFromCentre);
vec2 gOutward = gFromLen > 1e-4 ? gFromCentre / gFromLen : vec2(1.0, 0.0);

float gGroundY = gTerrainHeight(gRootXZ);
vec3 gRoot = vec3(gRootXZ.x, gGroundY, gRootXZ.y);
vec3 gLodDelta = (gRoot - uLodOrigin) * vec3(1.0, uLodVertical, 1.0);
float gDist = length(gLodDelta) + uLodBias;

// Presence: terrain mask times this ring's density. Rings cross-fade by dropping blades in
// hash order (each blade shrinks over a short band) instead of shrinking every blade at once.
float gDensity = 1.0 - smoothstep(uFade.x, uFade.y, gDist);
if (uFadeIn.x < uFadeIn.y) gDensity *= smoothstep(uFadeIn.x, uFadeIn.y, gDist);
float gKeep = gPresence(gRootXZ) * smoothstep(gSeed * 0.9, gSeed * 0.9 + 0.1, gDensity);
// Skip blades behind the camera or well outside the view: they collapse to zero-area triangles.
float gReach = uBaseHeight + uHeightVariance;
vec4 gClip = projectionMatrix * viewMatrix * vec4(gRoot + vec3(0.0, gReach * 0.5, 0.0), 1.0);
float gMargin = gClip.w * 1.15 + gReach * 2.0;
if (gClip.w < -gReach || abs(gClip.x) > gMargin || abs(gClip.y) > gMargin) gKeep = 0.0;
vFar = smoothstep(6.0, 40.0, gDist);

// Blade shape.
float gHeight = (uBaseHeight + uHeightVariance * mix(gClumpSeed, gSeed, 0.35)) * (0.75 + 0.5 * gHash(gCell + 5.2));
gHeight *= gKeep;
// Real blade widths (a few millimetres), independent of how far apart blades are. Blades
// never get thinner than about one pixel, so distant grass doesn't break up into shimmer.
float gWidth = (mix(0.0035, 0.008, gHash(gCell + 2.9)) + gHeight * 0.012) * uWidthScale;
float gPixel = uPixelWorld + uPixelAngle * distance(cameraPosition, gRoot);
gWidth = max(gWidth, gPixel * 1.2) * step(1e-4, gHeight);
float gYaw = atan(gOutward.y, gOutward.x) + (gHash(gCell + 8.8) - 0.5) * 2.4;
vec2 gFacing = vec2(cos(gYaw), sin(gYaw));
vec2 gSideDir = vec2(-gFacing.y, gFacing.x);
float gRestBend = mix(0.15, 0.6, gHash(gCell + 6.1)) + 0.35 * vFar;

// Wind: gust fronts travel along the wind; a faster flutter rides on top.
float gAlong = dot(gRootXZ, uWindDir);
float gGust = pow(sin(gAlong * 0.35 - uTime * 0.55 + gNoise(gRootXZ * 0.04) * 3.0) * 0.5 + 0.5, 1.5);
float gSway = sin(uTime * (1.6 + gSeed) + gSeed * 6.2831 + gAlong * 0.6);
float gWind = uWindStrength * (0.25 + 0.85 * gGust) + uWindStrength * 0.18 * gSway;

// Walk trail: blades are pushed flat away from recent footprints and spring back.
vec2 gPush = vec2(0.0);
for (int k = 0; k < ${TRAIL_LENGTH}; k++) {
  vec4 fp = uTrail[k];
  vec2 away = gRootXZ - fp.xy;
  float d = length(away);
  float age = uClock - fp.z;
  float w = fp.w * (1.0 - smoothstep(uTrailRadius * 0.3, uTrailRadius, d))
    * (1.0 - smoothstep(0.0, uTrailRecovery, age));
  gPush += (d > 1e-4 ? away / d : gFacing) * w;
}
float gPushLen = min(length(gPush), 1.0);

// Lean vector in angle units: rest bend along the facing, wind, then trampling.
vec2 gLean = gFacing * gRestBend + uWindDir * gWind + (gPushLen > 0.0 ? normalize(gPush) : vec2(0.0)) * gPushLen * 1.35;
float gAngle = min(length(gLean), 1.45);
vec2 gLeanDir = gAngle > 1e-4 ? normalize(gLean) : gFacing;
vec3 gLeanDir3 = vec3(gLeanDir.x, 0.0, gLeanDir.y);
vec3 gTip = (gLeanDir3 * sin(gAngle) + vec3(0.0, cos(gAngle), 0.0)) * gHeight;
vec3 gP1 = vec3(0.0, gHeight * 0.4, 0.0);
vec3 gP2 = mix(gP1, gTip, 0.55) + vec3(0.0, gHeight * 0.12 * cos(gAngle), 0.0);
vec3 gSpine = gBezier(gP1, gP2, gTip, t);
vec3 gTangent = normalize(gBezierTangent(gP1, gP2, gTip, max(t, 0.02)) + vec3(0.0, 1e-4, 0.0));

vec3 gSide3 = vec3(gSideDir.x, 0.0, gSideDir.y);
vec3 gNormal = normalize(cross(gSide3, gTangent));
// Face the camera so both faces shade as the lit front (no back-face darkening).
vec3 gView = normalize(cameraPosition - (gRoot + gSpine));
if (dot(gNormal, gView) < 0.0) gNormal = -gNormal;

float gTaper = pow(1.0 - t, 0.9) * (1.0 - t * 0.1);
vec3 gPos = gRoot + gSpine + gSide3 * (side * gWidth * 0.5 * gTaper);
// Raised centre ridge: a V cross-section with rounded normals.
gPos += gNormal * (1.0 - abs(side)) * gWidth * 0.25 * gTaper;
vec3 gShadeNormal = normalize(gNormal + gSide3 * side * 0.55);
// Far blades shade like the ground they cover, which removes shimmer.
gShadeNormal = normalize(mix(gShadeNormal, vec3(0.0, 1.0, 0.0), vFar * 0.7 + 0.15));

vClumpTone = gClumpSeed;
vBladeTone = gHash(gCell + 13.7);
vDry = smoothstep(0.55, 0.9, gNoise(gRootXZ * 0.12 + 7.0)) * smoothstep(0.5, 1.0, t);
vec3 transformed = gPos;
`;

const fragmentDeclarations = /* glsl */ `
uniform vec3 uRootColor;
uniform vec3 uTipColor;
uniform vec3 uDryColor;
uniform float uTranslucency;
varying float vT;
varying float vSide;
varying float vClumpTone;
varying float vBladeTone;
varying float vDry;
varying float vFar;
`;

export function createBladeGrassMaterial(shared: BladeGrassUniforms, ring: BladeRingUniforms): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, shared, ring);
    shader.vertexShader = vertexDeclarations + shader.vertexShader;
    // The blade is built in world space; beginnormal runs first, so compute everything there.
    shader.vertexShader = inject(shader.vertexShader, '#include <beginnormal_vertex>', `${vertexBody}
      vec3 objectNormal = gShadeNormal;
      #ifdef USE_TANGENT
        vec3 objectTangent = gTangent;
      #endif
    `);
    shader.vertexShader = inject(shader.vertexShader, '#include <begin_vertex>', '');

    shader.fragmentShader = fragmentDeclarations + shader.fragmentShader;
    shader.fragmentShader = inject(shader.fragmentShader, '#include <color_fragment>', `
      #include <color_fragment>
      float gT = pow(vT, 1.2);
      vec3 gCol = mix(uRootColor, uTipColor, gT);
      gCol *= mix(0.82, 1.12, vClumpTone) * mix(0.9, 1.08, vBladeTone);
      gCol = mix(gCol, uDryColor, vDry * 0.6);
      // Root occlusion from the surrounding sward, eased off in the distance.
      gCol *= mix(mix(0.3, 1.0, pow(vT, 0.7)), 1.0, vFar * 0.5);
      // Faint lengthwise vein along the centre ridge.
      gCol *= 1.0 + 0.06 * (1.0 - abs(vSide)) * vT;
      diffuseColor.rgb *= gCol;
    `);
    shader.fragmentShader = inject(shader.fragmentShader, '#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      normal = normalize(vNormal);
    `);
    shader.fragmentShader = inject(shader.fragmentShader, '#include <opaque_fragment>', `
      {
        vec3 gToCamera = normalize(vViewPosition);
        float gThin = pow(vT, 1.2) * (1.0 - vFar);
        #if NUM_DIR_LIGHTS > 0
          // Sun shining through the blade toward the camera; directDiffuse carries shadowing.
          float gBack = pow(clamp(dot(-gToCamera, directionalLights[0].direction), 0.0, 1.0), 2.5);
          outgoingLight += reflectedLight.directDiffuse * vec3(0.9, 1.1, 0.5) * (gBack * gThin * uTranslucency * 1.6);
        #endif
      }
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey = () => 'polyform-blade-grass-v1';
  return material;
}

/**
 * Grass-coloured ground under the blades. Fades in from a few metres out, so distant grass (a
 * pixel or two per blade, too sparse to hide the soil) reads as a continuous sward, while up
 * close the real terrain shows between blades. Lit like the terrain; only where grass grows.
 */
export function createGrassCarpetMaterial(shared: BladeGrassUniforms, fade: { value: THREE.Vector2 }): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.95, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, shared, { uCarpetFade: fade });
    shader.vertexShader = 'varying vec3 vCarpetPos;\n' + shader.vertexShader;
    shader.vertexShader = inject(shader.vertexShader, '#include <project_vertex>', `
      #include <project_vertex>
      vCarpetPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
    `);
    shader.fragmentShader = /* glsl */ `
      varying vec3 vCarpetPos;
      uniform sampler2D uMask;
      uniform vec4 uBounds;
      uniform vec3 uLodOrigin, uRootColor, uTipColor, uDryColor;
      uniform float uLodVertical, uLodBias;
      uniform vec2 uCarpetFade;
      ${common}
    ` + shader.fragmentShader;
    shader.fragmentShader = inject(shader.fragmentShader, '#include <clipping_planes_fragment>', `
      #include <clipping_planes_fragment>
      vec2 cUv = (vCarpetPos.xz - uBounds.xy) / uBounds.zw;
      float cMask = texture2D(uMask, clamp(cUv, 0.0, 1.0)).r;
      vec3 cDelta = (vCarpetPos - uLodOrigin) * vec3(1.0, uLodVertical, 1.0);
      float cCover = smoothstep(0.35, 0.85, cMask) * smoothstep(uCarpetFade.x, uCarpetFade.y, length(cDelta) + uLodBias);
      // Dithered coverage: opaque (so blades sort and shadow normally) but softly faded.
      float cDither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      if (cCover <= cDither) discard;
    `);
    shader.fragmentShader = inject(shader.fragmentShader, '#include <color_fragment>', `
      #include <color_fragment>
      // The sward seen from afar: mostly blade mid-length colour, with patches and dry areas.
      float cPatch = gNoise(vCarpetPos.xz * 0.35) * 0.6 + gNoise(vCarpetPos.xz * 1.7 + 3.0) * 0.4;
      vec3 cCol = mix(uRootColor, uTipColor, 0.35 + 0.3 * cPatch) * mix(0.8, 1.05, cPatch);
      cCol = mix(cCol, uDryColor, smoothstep(0.55, 0.9, gNoise(vCarpetPos.xz * 0.12 + 7.0)) * 0.35);
      diffuseColor.rgb *= cCol;
    `);
  };
  material.customProgramCacheKey = () => 'polyform-grass-carpet-v1';
  return material;
}
