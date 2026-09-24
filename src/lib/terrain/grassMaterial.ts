import * as THREE from 'three';
import { inject } from '../graphics/shaderHooks';

/**
 * Lit grass: a MeshStandardMaterial so tufts receive the scene's sun, shadows, fog, tone
 * mapping and colour-space output like every other surface, extended with:
 * - rooted circular-arc wind with travelling gust fronts and tip flutter;
 * - two colour gradients blended by soft world-space patches, plus macro brightness variation;
 * - up-biased normals so thin blades shade like a canopy instead of flickering per blade;
 * - backlit translucency and a faint rim, both scaled by the sun's shadowed direct light;
 * - distance thinning (instances above the kept rank shrink to nothing) with wider survivors.
 */
export interface GrassUniforms {
  uTime: { value: number };
  uWindStrength: { value: number };
  uWindDir: { value: THREE.Vector2 };
  uBaseHeight: { value: number };
  uHeightVariance: { value: number };
  uRootColor: { value: THREE.Color };
  uTipColor: { value: THREE.Color };
  uRootColorB: { value: THREE.Color };
  uTipColorB: { value: THREE.Color };
  uPatchScale: { value: number };
  uTranslucency: { value: number };
  /** x: distance where thinning starts, y: where it ends, z: share kept beyond y. */
  uLod: { value: THREE.Vector3 };
  uLodEnabled: { value: number };
}

export function createGrassUniforms(): GrassUniforms {
  return {
    uTime: { value: 0 },
    uWindStrength: { value: 0 },
    uWindDir: { value: new THREE.Vector2(Math.SQRT1_2, Math.SQRT1_2) },
    uBaseHeight: { value: 0.05 },
    uHeightVariance: { value: 0.1 },
    uRootColor: { value: new THREE.Color('#4f7340') },
    uTipColor: { value: new THREE.Color('#91b364') },
    uRootColorB: { value: new THREE.Color('#4f7340') },
    uTipColorB: { value: new THREE.Color('#91b364') },
    uPatchScale: { value: 0.35 },
    uTranslucency: { value: 0.6 },
    uLod: { value: new THREE.Vector3(12, 60, 0.12) },
    uLodEnabled: { value: 1 },
  };
}

/** Second gradient: sun-dried patches are warmer and lighter than the user's base colours. */
export function setGrassColors(uniforms: GrassUniforms, root: string, tip: string) {
  uniforms.uRootColor.value.set(root);
  uniforms.uTipColor.value.set(tip);
  uniforms.uRootColorB.value.set(root).offsetHSL(-0.015, 0.03, 0.01);
  uniforms.uTipColorB.value.set(tip).offsetHSL(-0.03, 0.06, 0.03);
}

/**
 * Maps the 1%–100% animation slider to a tip bend angle. The square root keeps the default
 * 1% visibly alive while 100% bends blades most of the way over.
 */
export function grassBendStrength(animationStrength: number): number {
  return Math.sqrt(Math.max(0, animationStrength)) * 1.6;
}

const noise = /* glsl */ `
float pfHash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float pfNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(pfHash21(i), pfHash21(i + vec2(1.0, 0.0)), u.x),
    mix(pfHash21(i + vec2(0.0, 1.0)), pfHash21(i + vec2(1.0)), u.x), u.y);
}
`;

const vertexDeclarations = /* glsl */ `
attribute vec4 aShapeOffset;
attribute float aHeightVariance;
attribute float aHeightPercent;
attribute float aBladeTone;
attribute float aRank;
uniform float uTime;
uniform float uWindStrength;
uniform vec2 uWindDir;
uniform float uBaseHeight;
uniform float uHeightVariance;
uniform vec3 uLod;
uniform float uLodEnabled;
varying float vHeightPercent;
varying float vColorJitter;
varying float vBladeTone;
varying vec2 vGrassXZ;
${noise}
`;

const vertexBody = /* glsl */ `
#include <begin_vertex>
vHeightPercent = aHeightPercent;
vColorJitter = aShapeOffset.w;
vBladeTone = aBladeTone;
vec3 pfOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
vGrassXZ = pfOrigin.xz;

// Distance thinning. The CPU draws each tile's lowest ranks; here the tufts just above the
// kept share shrink smoothly so thinning never pops, and survivors widen to keep coverage.
float pfKeep = 1.0;
if (uLodEnabled > 0.5) {
  pfKeep = mix(1.0, uLod.z, smoothstep(uLod.x, uLod.y, distance(pfOrigin, cameraPosition)));
}
float pfCut = pfKeep * 1.08;
float pfFade = 1.0 - smoothstep(pfCut - 0.08, pfCut, aRank);
float pfWiden = clamp(inversesqrt(max(pfKeep, 0.05)), 1.0, 2.5);

// Tuft size in metres (geometry is a unit-height tuft).
float pfLen = (uBaseHeight + aHeightVariance * uHeightVariance) * pfFade;
transformed *= pfLen;
transformed.xz *= aShapeOffset.z * pfWiden;
float pfHp2 = aHeightPercent * aHeightPercent;
transformed.xz += aShapeOffset.xy * pfHp2 * pfLen;

// Wind: gusts travel along the wind direction; each blade bends as a circular arc of constant
// length about its root, so blades lie over instead of stretching sideways.
float pfSeed = aShapeOffset.w * 6.2831853;
float pfAlong = dot(pfOrigin.xz, uWindDir);
float pfJitter = (pfNoise(pfOrigin.xz * 0.03 + 11.7) * 2.0 - 1.0) * 1.45;
float pfGust = pow(sin(pfAlong * 0.5 - uTime * 0.6 + pfJitter) * 0.5 + 0.5, 1.6);
float pfChop = sin(pfAlong * 1.35 - uTime * 1.3 + pfSeed) * 0.5 + 0.5;
float pfIntensity = (0.25 + pfGust * 0.85 + pfChop * 0.18) * (0.65 + fract(aShapeOffset.w * 7.13) * 0.7);
float pfPhi = clamp(uWindStrength * pfIntensity, 0.0, 1.4);
float pfAngle = pfPhi * aHeightPercent;
float pfRadius = pfLen / max(pfPhi, 1e-3);
float pfArc = pfPhi > 1e-3 ? pfRadius * (1.0 - cos(pfAngle)) : 0.0;
float pfDrop = pfPhi > 1e-3 ? pfRadius * sin(pfAngle) - pfLen * aHeightPercent : 0.0;
float pfFlutter = sin(uTime * 5.0 + pfSeed * 3.0 + pfAlong * 0.8) * 0.06 * pfLen * pfPhi
  * smoothstep(0.55, 1.0, aHeightPercent);
// World wind directions into the tuft's rotated frame (instances only rotate about Y).
mat3 pfInstance = mat3(instanceMatrix);
vec3 pfLocalWind = normalize(transpose(pfInstance) * vec3(uWindDir.x, 0.0, uWindDir.y));
vec2 pfLocalSide = vec2(-pfLocalWind.z, pfLocalWind.x);
transformed.xz += pfLocalWind.xz * pfArc + pfLocalSide * pfFlutter;
transformed.y += pfDrop;
`;

const fragmentDeclarations = /* glsl */ `
uniform vec3 uRootColor;
uniform vec3 uTipColor;
uniform vec3 uRootColorB;
uniform vec3 uTipColorB;
uniform float uPatchScale;
uniform float uTranslucency;
varying float vHeightPercent;
varying float vColorJitter;
varying float vBladeTone;
varying vec2 vGrassXZ;
${noise}
`;

export function createGrassMaterial(uniforms: GrassUniforms): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = vertexDeclarations + shader.vertexShader;
    shader.vertexShader = inject(shader.vertexShader, '#include <begin_vertex>', vertexBody);
    // Blend blade normals toward up: the tuft shades as a soft canopy on both faces.
    shader.vertexShader = inject(shader.vertexShader, '#include <beginnormal_vertex>', `
      #include <beginnormal_vertex>
      objectNormal = normalize(objectNormal * 0.45 + vec3(0.0, 1.0, 0.0));
    `);

    shader.fragmentShader = fragmentDeclarations + shader.fragmentShader;
    // Dithered fade instead of alpha blending when the walk camera brushes through grass.
    shader.fragmentShader = inject(shader.fragmentShader, '#include <clipping_planes_fragment>', `
      #include <clipping_planes_fragment>
      float pfNear = smoothstep(0.18, 0.65, length(vViewPosition));
      if (pfNear < fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))) discard;
    `);
    shader.fragmentShader = inject(shader.fragmentShader, '#include <color_fragment>', `
      #include <color_fragment>
      float pfT = pow(vHeightPercent, 1.35);
      float pfPatch = smoothstep(0.3, 0.75, pfNoise(vGrassXZ * uPatchScale));
      vec3 pfBase = mix(mix(uRootColor, uTipColor, pfT), mix(uRootColorB, uTipColorB, pfT), pfPatch);
      float pfMacro = 1.0 + (pfNoise(vGrassXZ * 0.045 + vec2(137.0, 91.0)) - 0.5) * 0.3;
      float pfJit = 1.0 + (vColorJitter - 0.5) * 0.2;
      float pfRootShade = mix(0.62, 1.0, smoothstep(0.0, 0.65, vHeightPercent));
      diffuseColor.rgb *= pfBase * pfMacro * pfJit * vBladeTone * pfRootShade;
    `);
    // Undo the back-face flip: blended normals point up on both faces.
    shader.fragmentShader = inject(shader.fragmentShader, '#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      normal = normalize(vNormal);
    `);
    shader.fragmentShader = inject(shader.fragmentShader, '#include <opaque_fragment>', `
      {
        vec3 pfToCamera = normalize(vViewPosition);
        float pfTip = pow(vHeightPercent, 1.5);
        #if NUM_DIR_LIGHTS > 0
          // Looking toward the sun through the blades. directDiffuse already carries shadows.
          float pfBack = pow(clamp(dot(-pfToCamera, directionalLights[0].direction), 0.0, 1.0), 3.0);
          outgoingLight += reflectedLight.directDiffuse * vec3(0.85, 1.1, 0.45) * (pfBack * pfTip * uTranslucency);
        #endif
        float pfRim = pow(1.0 - abs(dot(normal, pfToCamera)), 4.0);
        outgoingLight += reflectedLight.indirectDiffuse * (pfRim * pfTip * 0.35);
      }
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey = () => 'polyform-grass-v2';
  return material;
}
