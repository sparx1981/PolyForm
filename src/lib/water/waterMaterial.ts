import * as THREE from 'three';
import { inject } from '../graphics/shaderHooks';
import { WATER_PATCH } from './waterSim';

/**
 * Water drawn as two passes over the same surface, after the terrain:
 *
 * 1. Transmittance (multiply blend): the ground already rendered under the water is dimmed by
 *    Beer–Lambert absorption along the refracted view ray and the sunlight's path down to it,
 *    and by what the Fresnel term reflects away. Colour shifts with depth for free: red goes
 *    first, so shallows read green-blue and deep water darkens.
 * 2. Surface light (additive blend): a lit MeshStandardMaterial that adds the scene's
 *    environment reflection and sun glints (Fresnel from the material's BRDF), light scattered
 *    back out of the water column, and caustics focused on the bed.
 *
 * Depth comes from the terrain height grid, so no depth pre-pass is needed. Techniques and the
 * clear-water optical coefficients follow Clearwater (github.com/Aureliengmz/clearwater, MIT).
 */
export interface WaterUniforms {
  uSurf: { value: THREE.Texture | null };
  uCaus: { value: THREE.Texture | null };
  uCausShift: { value: THREE.Vector2 };
  uL: { value: number };
  uLevel: { value: number };
  uFallbackDepth: { value: number };
  uAbsorb: { value: THREE.Vector3 };
  uScatter: { value: THREE.Vector3 };
  /** 0 for a small calm pond, 1 for a lake with longer wind waves. */
  uLakeWaves: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uHeights: { value: THREE.Texture | null };
  uBounds: { value: THREE.Vector4 };
  uBaseY: { value: number };
  uHasTerrain: { value: number };
  /** Planar reflection of the scene at the water level (see WaterReflection). */
  uReflection: { value: THREE.Texture | null };
  uReflectionMatrix: { value: THREE.Matrix4 };
  uUseReflection: { value: number };
}

export function createWaterUniforms(): WaterUniforms {
  return {
    uSurf: { value: null }, uCaus: { value: null }, uCausShift: { value: new THREE.Vector2() },
    uL: { value: WATER_PATCH }, uLevel: { value: 0 }, uFallbackDepth: { value: 1.2 },
    uAbsorb: { value: new THREE.Vector3(0.55, 0.13, 0.12) }, uScatter: { value: new THREE.Vector3(0.05, 0.08, 0.09) },
    uLakeWaves: { value: 0 }, uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
    uHeights: { value: null }, uBounds: { value: new THREE.Vector4(0, 0, 1, 1) }, uBaseY: { value: 0 }, uHasTerrain: { value: 0 },
    uReflection: { value: null }, uReflectionMatrix: { value: new THREE.Matrix4() }, uUseReflection: { value: 0 },
  };
}

const common = /* glsl */ `
uniform sampler2D uSurf, uCaus, uHeights, uReflection;
uniform mat4 uReflectionMatrix;
uniform float uUseReflection;
uniform vec2 uCausShift;
uniform float uL, uLevel, uFallbackDepth, uLakeWaves, uBaseY, uHasTerrain;
uniform vec3 uAbsorb, uScatter, uSunDir;
uniform vec4 uBounds;
const float WATER_IOR = 1.3335;

// Three octaves of the same tiling FFT patch, rotated so the tiling never lines up:
// the patch itself, a finer copy for close-up detail, and a larger copy for lake swell.
float gSlopeVariance;
vec3 waterNormal(vec2 xz, float distanceToEye) {
  const mat2 M = mat2(0.8, -0.6, 0.6, 0.8);
  const mat2 M3 = mat2(0.28, 0.96, -0.96, 0.28);
  vec4 A = texture(uSurf, xz / uL);
  vec4 B = texture(uSurf, (M * xz) / (uL * 0.41) + 0.37);
  vec4 D = texture(uSurf, (M3 * xz) / (uL * 2.7) + 0.19);
  float calm = mix(0.55, 1.0, uLakeWaves);
  vec2 slope = calm * (A.yz + 0.10 * (transpose(M) * B.yz) * exp(-distanceToEye * 0.05))
    + 0.6 * uLakeWaves * (transpose(M3) * D.yz);
  // Sub-pixel slope spread (LEAN mapping): widens distant glints instead of sparkling noise.
  gSlopeVariance = calm * calm * (max(A.w - dot(A.yz, A.yz), 0.0) + 0.01 * max(B.w - dot(B.yz, B.yz), 0.0));
  return normalize(vec3(-slope.x, 1.0, -slope.y));
}

float waterFresnel(float ci) {
  ci = clamp(ci, 0.0, 1.0);
  float st2 = (1.0 - ci * ci) / (WATER_IOR * WATER_IOR);
  if (st2 >= 1.0) return 1.0;
  float ct = sqrt(1.0 - st2);
  float rs = (ci - WATER_IOR * ct) / (ci + WATER_IOR * ct), rp = (WATER_IOR * ci - ct) / (WATER_IOR * ci + ct);
  return 0.5 * (rs * rs + rp * rp);
}

// Bed height under the water, bilinear on the terrain grid (as sampleTerrainElevation).
float bedHeight(vec2 xz) {
  if (uHasTerrain < 0.5) return uLevel - uFallbackDepth;
  vec2 uv = (xz - uBounds.xy) / uBounds.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return uLevel - uFallbackDepth;
  ivec2 size = textureSize(uHeights, 0);
  vec2 g = uv * vec2(size - 1);
  ivec2 i0 = ivec2(floor(g)), i1 = min(i0 + 1, size - 1);
  vec2 f = g - vec2(i0);
  float h00 = texelFetch(uHeights, i0, 0).r, h10 = texelFetch(uHeights, ivec2(i1.x, i0.y), 0).r;
  float h01 = texelFetch(uHeights, ivec2(i0.x, i1.y), 0).r, h11 = texelFetch(uHeights, i1, 0).r;
  return uBaseY + mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

struct WaterSample { vec3 n; float F; vec3 viewT; vec3 bedT; float depth; vec2 bedXZ; float sunCos; };

WaterSample sampleWater(vec3 P) {
  WaterSample w;
  vec3 v = normalize(cameraPosition - P);
  w.n = waterNormal(P.xz, length(cameraPosition - P));
  float nv = dot(w.n, v);
  if (nv < 0.02) { w.n = normalize(w.n + v * (0.02 - nv)); nv = dot(w.n, v); }
  w.F = waterFresnel(nv);
  vec3 tr = refract(-v, w.n, 1.0 / WATER_IOR);
  w.depth = max(uLevel - bedHeight(P.xz), 0.0);
  float s = w.depth / max(-tr.y, 0.12);
  w.bedXZ = P.xz + tr.xz * s;
  vec3 sunT = refract(-normalize(uSunDir), vec3(0.0, 1.0, 0.0), 1.0 / WATER_IOR);
  w.sunCos = max(-sunT.y, 0.12);
  vec3 extinction = uAbsorb + uScatter;
  w.viewT = exp(-extinction * s);
  w.bedT = w.viewT * mix(vec3(1.0), exp(-extinction * w.depth / w.sunCos), 0.7);
  return w;
}
`;

const vertexVarying = /* glsl */ `
varying vec3 vWaterPos;
`;

/** Pass 1: multiplies what is already on screen (the bed) by the water's transmittance. */
export function createWaterTransmittanceMaterial(uniforms: WaterUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: vertexVarying + /* glsl */ `
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWaterPos = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: common + vertexVarying + /* glsl */ `
      void main() {
        WaterSample w = sampleWater(vWaterPos);
        gl_FragColor = vec4(w.bedT * (1.0 - w.F), 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.SrcColorFactor,
    toneMapped: false,
  });
}

/** Pass 2: reflections, glints, in-scattered light and caustics, added on top. */
export function createWaterSurfaceMaterial(uniforms: WaterUniforms): THREE.MeshStandardMaterial {
  // Rough, so the standard BRDF adds no specular of its own: glints are Clearwater's below.
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, transparent: true, depthWrite: false });
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.OneFactor;
  material.blendDst = THREE.OneFactor;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = vertexVarying + shader.vertexShader;
    shader.vertexShader = inject(shader.vertexShader, '#include <project_vertex>', `
      #include <project_vertex>
      vWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
    `);
    shader.fragmentShader = common + vertexVarying + 'WaterSample gWater;\n' + shader.fragmentShader;
    shader.fragmentShader = inject(shader.fragmentShader, '#include <color_fragment>', `
      #include <color_fragment>
      gWater = sampleWater(vWaterPos);
      // Light scattered back out of the water column: grows with depth, tinted by what survives.
      vec3 gAlbedo = uScatter / (uAbsorb + uScatter);
      diffuseColor.rgb = gAlbedo * (1.0 - gWater.viewT) * 0.12;
    `);
    shader.fragmentShader = inject(shader.fragmentShader, '#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      normal = normalize((viewMatrix * vec4(gWater.n, 0.0)).xyz);
    `);
    shader.fragmentShader = inject(shader.fragmentShader, '#include <opaque_fragment>', `
      #if NUM_DIR_LIGHTS > 0
      {
        // Caustics: sunlight focused by the waves onto the bed, seen back through the water.
        vec3 gCaus = texture(uCaus, (gWater.bedXZ - uCausShift) / uL, 1.0).rgb;
        float gShallow = smoothstep(0.02, 0.25, gWater.depth);
        vec3 gSun = directionalLights[0].color * max(normalize(uSunDir).y, 0.0);
        // Only the focused light above the average is added (the bed is already lit by the sun);
        // the texture's peaks reach 40x average, so they are compressed.
        vec3 gFocus = min(max(gCaus - 1.0, 0.0), vec3(3.0));
        outgoingLight += gSun * gFocus * gWater.bedT * (1.0 - gWater.F) * 0.035 * gShallow;

        // Sun glints: Beckmann distribution widened by the slope variance (no long GGX tail).
        vec3 gL = normalize(uSunDir), gV = normalize(cameraPosition - vWaterPos), gN = gWater.n;
        float gA2 = 0.00012 + 1.2 * gSlopeVariance;
        vec3 gH = normalize(gV + gL);
        float gNH = max(dot(gN, gH), 0.0), gNL = max(dot(gN, gL), 0.0), gNV = max(dot(gN, gV), 0.02);
        float gC2 = max(gNH * gNH, 1e-4), gTan2 = (1.0 - gC2) / gC2;
        float gD = exp(-gTan2 / gA2) / (3.14159265 * gA2 * gC2 * gC2);
        float gVis = 0.5 / (gNL * sqrt(gNV * gNV * (1.0 - gA2) + gA2) + gNV * sqrt(gNL * gNL * (1.0 - gA2) + gA2) + 1e-5);
        float gFh = waterFresnel(max(dot(gH, gV), 0.0));
        outgoingLight += directionalLights[0].color * min(gD * gVis * gFh * gNL, 80.0);
      }
      #endif
      if (uUseReflection > 0.5) {
        // Mirror image of the scene, rippled by the wave normal. Replaces the sky-only
        // environment reflection (the material's envMapIntensity is 0 while this is on).
        vec4 gProj = uReflectionMatrix * vec4(vWaterPos + vec3(gWater.n.x, 0.0, gWater.n.z) * 0.6, 1.0);
        vec3 gMirror = texture(uReflection, gProj.xy / gProj.w).rgb;
        outgoingLight += gMirror * gWater.F;
      }
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey = () => 'polyform-water-surface-v3';
  return material;
}
