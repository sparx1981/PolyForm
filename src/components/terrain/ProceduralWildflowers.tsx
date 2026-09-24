import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Shape, TerrainModifier, WildflowerSettings, DEFAULT_WILDFLOWER_SETTINGS } from '../../types';
import { useApp } from '../../AppContext';
import { inject } from '../../lib/graphics/shaderHooks';
import {
  createFlowerGeometry, generateWildflowerInstances, meadowKinds, FLOWER_KINDS, FLOWER_HEIGHT_SCALE,
  type FlowerKind,
} from '../../lib/terrain/flowerGeometry';

interface ProceduralWildflowersProps {
  terrainShape: Shape;
  shapes: Shape[];
  terrainModifiers?: TerrainModifier[];
}

/** Uniforms every species shares: wind, height settings, foliage colours. */
interface SharedFlowerUniforms {
  uTime: { value: number };
  uWindStrength: { value: number };
  uWindDir: { value: THREE.Vector2 };
  uBaseHeight: { value: number };
  uHeightVariance: { value: number };
  uStem: { value: THREE.Color };
  uLeaf: { value: THREE.Color };
}

/** Per-species colouring. */
interface SpeciesUniforms {
  uKindHeight: { value: number };
  uPetalA: { value: THREE.Color };
  uPetalB: { value: THREE.Color };
  /** 1: each flower is either colour A or B (alpine); 0: B is blended in by up to uPetalBlend. */
  uPetalSplit: { value: number };
  uPetalBlend: { value: number };
  uCentre: { value: THREE.Color };
  uPod: { value: THREE.Color };
  /** Dark blotch at the petal base (poppy). */
  uBlotch: { value: number };
  uPetalRoughness: { value: number };
}

interface Palette {
  a: string; b: string; centre: string; pod?: string; blotch?: number; split?: number; blend?: number; roughness?: number;
}

const mixHex = (a: string, b: string, t: number) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();

/**
 * Colours for a species. A single-species meadow uses the colour pickers (primary = petals,
 * secondary = accent: the daisy's golden disc, the poppy's orange flush, the alpine meadow's
 * second flower colour...). A mixed meadow gives each species its natural colours, with the
 * pickers driving the poppies (primary) and buttercups (secondary).
 */
function speciesPalette(kind: FlowerKind, settings: WildflowerSettings, mixed: boolean): Palette {
  const primary = settings.primaryColor || '#ffffff';
  const secondary = settings.secondaryColor || '#f59e0b';
  switch (kind) {
    case 'daisy':
      return mixed
        ? { a: '#ffffff', b: '#f5d0fe', centre: '#f59e0b', blend: 0.25, roughness: 0.6 }
        : { a: primary, b: mixHex(primary, '#f5d0fe', 0.45), centre: secondary, blend: 0.3, roughness: 0.6 };
    case 'poppy': {
      const petal = primary;
      const flush = mixed ? mixHex(primary, '#f97316', 0.5) : mixHex(primary, secondary, 0.6);
      return { a: petal, b: flush, centre: '#1c1917', pod: '#76805a', blotch: 1, blend: 0.5, roughness: 0.5 };
    }
    case 'buttercup': {
      const petal = mixed ? secondary : primary;
      return { a: petal, b: mixed ? '#fef08a' : secondary, centre: mixHex(petal, '#8a9a1c', 0.55), blend: 0.25, roughness: 0.28 };
    }
    case 'lavender':
      return mixed
        ? { a: '#7c5cc4', b: '#b9a2f0', centre: '#7c5cc4', roughness: 0.75 }
        : { a: primary, b: secondary, centre: primary, roughness: 0.75 };
    case 'alpine':
      return mixed
        ? { a: '#3b6fe0', b: '#f8fafc', centre: '#facc15', split: 1, roughness: 0.6 }
        : { a: primary, b: secondary, centre: '#facc15', split: 1, roughness: 0.6 };
  }
}

const VERTEX_DECLARATIONS = /* glsl */ `
attribute vec4 aShapeOffset;
attribute float aHeightVariance;
attribute float aAttach;
attribute float aPart;
attribute float aShade;
uniform float uTime;
uniform float uWindStrength;
uniform vec2 uWindDir;
uniform float uBaseHeight;
uniform float uHeightVariance;
uniform float uKindHeight;
varying float vPart;
varying float vShade;
varying float vJitter;
`;

// Stretches the stem to this flower's height while flower heads and leaves keep their real
// size, then bends the stem with its lean and the wind (more toward the top).
const VERTEX_BODY = /* glsl */ `
vPart = aPart;
vShade = aShade;
vJitter = aShapeOffset.w;
float fHeight = (uBaseHeight + aHeightVariance * uHeightVariance) * uKindHeight;
vec3 transformed = position;
transformed.y = (position.y - aAttach) + aAttach * fHeight;
float fBend = aAttach * aAttach;
transformed.xz += aShapeOffset.xy * fBend * fHeight;
#ifdef USE_INSTANCING
  vec2 fRoot = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
  mat3 fInstance = mat3(instanceMatrix);
#else
  vec2 fRoot = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
  mat3 fInstance = mat3(1.0);
#endif
float fWave = sin(uTime * 2.0 + fRoot.x * 0.6 + fRoot.y * 0.6) + 0.35 * cos(uTime * 3.2 + fRoot.x * 1.1 + fRoot.y * 0.8);
// Wind blows in world space: bring its direction into the flower's own (rotated, scaled) frame.
vec3 fWind = transpose(fInstance) * vec3(uWindDir.x, 0.0, uWindDir.y);
fWind /= max(dot(fInstance[0], fInstance[0]), 1e-6);
transformed += fWind * fWave * uWindStrength * fBend;
`;

const FRAGMENT_DECLARATIONS = /* glsl */ `
uniform vec3 uStem;
uniform vec3 uLeaf;
uniform vec3 uPetalA;
uniform vec3 uPetalB;
uniform float uPetalSplit;
uniform float uPetalBlend;
uniform vec3 uCentre;
uniform vec3 uPod;
uniform float uBlotch;
uniform float uPetalRoughness;
varying float vPart;
varying float vShade;
varying float vJitter;
`;

const FRAGMENT_COLOR = /* glsl */ `
#include <color_fragment>
float fShade = clamp(vShade, 0.0, 1.0);
vec3 fColor;
if (vPart < 0.5) {
  fColor = uStem * mix(0.95, 1.2, fShade);
} else if (vPart < 1.5) {
  // Leaves: darker at the base, a lighter midrib-ish tip.
  fColor = uLeaf * mix(0.62, 1.02, fShade);
} else if (vPart < 2.5) {
  float pick = uPetalSplit > 0.5 ? step(0.5, vJitter) : vJitter * uPetalBlend;
  vec3 petal = mix(uPetalA, uPetalB, pick);
  // Petals deepen toward their base, where they are shaded by the rest of the flower.
  petal *= mix(0.72, 1.0, smoothstep(0.0, 0.55, fShade));
  petal = mix(petal, vec3(0.035, 0.025, 0.03), uBlotch * (1.0 - smoothstep(0.1, 0.3, fShade)));
  fColor = petal * (0.94 + 0.12 * vJitter);
} else if (vPart < 3.5) {
  fColor = uCentre * mix(0.65, 1.1, fShade);
} else if (vPart < 4.5) {
  fColor = uPod * mix(0.6, 1.0, fShade);
} else {
  // Lavender florets: deeper at the base of the spike, paler toward the tip.
  fColor = mix(uPetalA, uPetalB, clamp(fShade * 0.85 + (vJitter - 0.5) * 0.3, 0.0, 1.0)) * mix(0.75, 1.0, fShade);
}
diffuseColor.rgb *= fColor;
`;

function createFlowerMaterial(shared: SharedFlowerUniforms, species: SpeciesUniforms): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65, metalness: 0, side: THREE.DoubleSide });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, shared, species);
    shader.vertexShader = VERTEX_DECLARATIONS + shader.vertexShader;
    shader.vertexShader = inject(shader.vertexShader, '#include <begin_vertex>', VERTEX_BODY);
    shader.fragmentShader = FRAGMENT_DECLARATIONS + shader.fragmentShader;
    shader.fragmentShader = inject(shader.fragmentShader, '#include <color_fragment>', FRAGMENT_COLOR);
    shader.fragmentShader = inject(shader.fragmentShader, '#include <roughnessmap_fragment>', `
      #include <roughnessmap_fragment>
      if (vPart > 1.5 && vPart < 2.5) roughnessFactor = uPetalRoughness;
    `);
    shader.fragmentShader = inject(shader.fragmentShader, '#include <opaque_fragment>', `
      #if NUM_DIR_LIGHTS > 0
      {
        // Thin petals and leaves glow when the sun is behind them.
        float fThin = vPart > 0.5 && vPart < 2.5 ? 1.0 : 0.0;
        float fBack = pow(clamp(dot(normalize(vViewPosition), -directionalLights[0].direction), 0.0, 1.0), 2.0);
        outgoingLight += diffuseColor.rgb * directionalLights[0].color * fBack * fThin * 0.35;
      }
      #endif
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey = () => 'polyform-wildflower-v2';
  return material;
}

function createSpeciesUniforms(): SpeciesUniforms {
  return {
    uKindHeight: { value: 1 },
    uPetalA: { value: new THREE.Color() }, uPetalB: { value: new THREE.Color() },
    uPetalSplit: { value: 0 }, uPetalBlend: { value: 0 },
    uCentre: { value: new THREE.Color() }, uPod: { value: new THREE.Color('#76805a') },
    uBlotch: { value: 0 }, uPetalRoughness: { value: 0.6 },
  };
}

export function ProceduralWildflowers({
  terrainShape,
  shapes,
  terrainModifiers = []
}: ProceduralWildflowersProps) {
  const { graphicsSettings } = useApp();
  const flowerSettings: WildflowerSettings = useMemo(() => ({
    ...DEFAULT_WILDFLOWER_SETTINGS,
    ...(terrainShape.terrainData?.flowers || {})
  }), [terrainShape.terrainData?.flowers]);
  // Hooks below always run; the enabled check happens at render time so toggling is safe.
  const visible = flowerSettings.enabled && Boolean(terrainShape.terrainData);
  const species = useMemo(() => meadowKinds(flowerSettings.flowerType), [flowerSettings.flowerType]);
  const mixed = species.length > 1;

  const instanceData = useMemo(() => visible
    ? generateWildflowerInstances(terrainShape, shapes, terrainModifiers, flowerSettings)
    : null,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [visible, terrainShape.id, terrainShape.terrainData?.heights, terrainShape.terrainData?.width,
    terrainShape.terrainData?.depth, terrainShape.position, shapes, terrainModifiers,
    flowerSettings.density, flowerSettings.maxSlopeAngle, flowerSettings.flowerType]);

  const shared = useMemo<SharedFlowerUniforms>(() => ({
    uTime: { value: 0 },
    uWindStrength: { value: 0.02 },
    uWindDir: { value: new THREE.Vector2(Math.SQRT1_2, Math.SQRT1_2) },
    uBaseHeight: { value: 0.05 },
    uHeightVariance: { value: 0.3 },
    uStem: { value: new THREE.Color() },
    uLeaf: { value: new THREE.Color() },
  }), []);
  const speciesUniforms = useMemo(() => Object.fromEntries(FLOWER_KINDS.map(kind => [kind, createSpeciesUniforms()])) as Record<FlowerKind, SpeciesUniforms>, []);

  const isAnimated = flowerSettings.animate !== false;
  useEffect(() => {
    shared.uWindStrength.value = isAnimated ? (flowerSettings.animationStrength ?? 0.02) : 0;
    shared.uBaseHeight.value = flowerSettings.baseHeight ?? 0.05;
    shared.uHeightVariance.value = flowerSettings.heightVariance ?? 0.3;
    const stem = flowerSettings.stemColor || '#2e6128';
    shared.uStem.value.set(stem);
    shared.uLeaf.value.set(stem).offsetHSL(0.01, -0.05, -0.03);
  }, [shared, isAnimated, flowerSettings.animationStrength, flowerSettings.baseHeight, flowerSettings.heightVariance, flowerSettings.stemColor]);

  useEffect(() => {
    for (const kind of FLOWER_KINDS) {
      const palette = speciesPalette(kind, flowerSettings, mixed);
      const u = speciesUniforms[kind];
      u.uKindHeight.value = FLOWER_HEIGHT_SCALE[kind];
      u.uPetalA.value.set(palette.a);
      u.uPetalB.value.set(palette.b);
      u.uPetalSplit.value = palette.split ?? 0;
      u.uPetalBlend.value = palette.blend ?? 0;
      u.uCentre.value.set(palette.centre);
      u.uPod.value.set(palette.pod ?? '#76805a');
      u.uBlotch.value = palette.blotch ?? 0;
      u.uPetalRoughness.value = palette.roughness ?? 0.6;
    }
  }, [speciesUniforms, flowerSettings, mixed]);

  // Flowers sway with the same wind direction as the grass, trees and bushes.
  const windDirection = graphicsSettings.vegetation.direction;
  useEffect(() => {
    const radians = windDirection * Math.PI / 180;
    shared.uWindDir.value.set(Math.cos(radians), Math.sin(radians));
  }, [shared, windDirection]);

  // One instanced mesh per species that grows in this meadow.
  const meshes = useMemo(() => {
    if (!instanceData || instanceData.instanceCount === 0) return [];
    const matrix = new THREE.Matrix4();
    return species.flatMap(kind => {
      const kindIndex = FLOWER_KINDS.indexOf(kind);
      const picked: number[] = [];
      for (let i = 0; i < instanceData.instanceCount; i++) if (instanceData.kinds[i] === kindIndex) picked.push(i);
      if (picked.length === 0) return [];
      const geometry = createFlowerGeometry(kind);
      const offsets = new Float32Array(picked.length * 4);
      const variances = new Float32Array(picked.length);
      picked.forEach((source, i) => {
        offsets.set(instanceData.shapeOffsets.subarray(source * 4, source * 4 + 4), i * 4);
        variances[i] = instanceData.heightVariances[source];
      });
      geometry.setAttribute('aShapeOffset', new THREE.InstancedBufferAttribute(offsets, 4));
      geometry.setAttribute('aHeightVariance', new THREE.InstancedBufferAttribute(variances, 1));
      const mesh = new THREE.InstancedMesh(geometry, createFlowerMaterial(shared, speciesUniforms[kind]), picked.length);
      picked.forEach((source, i) => mesh.setMatrixAt(i, matrix.fromArray(instanceData.matrices, source * 16)));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.name = 'procedural-wildflowers-mesh';
      // Flowers are spread over the whole terrain and bent in the shader.
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.raycast = () => {};
      mesh.userData = { isFlowers: true, isObstacle: false };
      return [mesh];
    });
  }, [instanceData, species, shared, speciesUniforms]);
  useEffect(() => () => meshes.forEach(mesh => { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); mesh.dispose(); }), [meshes]);

  useFrame((_, delta) => {
    if (isAnimated) shared.uTime.value += delta * (flowerSettings.windSpeed ?? 2.0);
  });

  if (!visible || meshes.length === 0) return null;

  return (
    <group name="procedural-wildflowers" key={`wildflowers-${terrainShape.id}`}>
      {meshes.map(mesh => <primitive key={mesh.uuid} object={mesh} dispose={null} />)}
    </group>
  );
}
