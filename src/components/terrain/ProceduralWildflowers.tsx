import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Shape, TerrainModifier, WildflowerSettings, DEFAULT_WILDFLOWER_SETTINGS } from '../../types';
import { createWildflowerGeometry, generateWildflowerInstances } from '../../lib/terrain/flowerGeometry';

interface ProceduralWildflowersProps {
  terrainShape: Shape;
  shapes: Shape[];
  terrainModifiers?: TerrainModifier[];
}

const FLOWER_VERTEX_SHADER = /* glsl */ `
attribute vec4 aShapeOffset;
attribute float aHeightVariance;
attribute float aHeightPercent;
attribute float aIsPetal;
attribute float aCenterDist;

varying float vHeightPercent;
varying float vIsPetal;
varying float vCenterDist;
varying float vColorJitter;
varying vec3 vWorldPos;
varying vec3 vNormal;

uniform float uTime;
uniform float uWindStrength;
uniform vec2 uWindDir;
uniform float uBaseHeight;
uniform float uHeightVariance;

void main() {
  vHeightPercent = aHeightPercent;
  vIsPetal = aIsPetal;
  vCenterDist = aCenterDist;
  vColorJitter = aShapeOffset.w;

  // 1. Local vertex position
  vec3 pos = position;

  // Scale low-lying height: baseHeight + randomVariance * heightVariance
  float hScale = uBaseHeight + aHeightVariance * uHeightVariance;
  pos.y *= hScale;

  // Horizontal width scale
  pos.x *= aShapeOffset.z;
  pos.z *= aShapeOffset.z;

  // Lean offset
  pos.x += aShapeOffset.x * (aHeightPercent * aHeightPercent) * hScale;
  pos.z += aShapeOffset.y * (aHeightPercent * aHeightPercent) * hScale;

  // 2. Transform into world space
  vec4 worldPos4 = modelMatrix * instanceMatrix * vec4(pos, 1.0);
  vec3 worldPos = worldPos4.xyz;

  // 3. Wind Animation:
  // Gentle harmonic wave displacement on flower heads
  float windWave = sin(uTime * 2.0 + worldPos.x * 0.6 + worldPos.z * 0.6) * uWindStrength;
  windWave += cos(uTime * 3.2 + worldPos.x * 1.1 + worldPos.z * 0.8) * (uWindStrength * 0.35);

  vec2 windDisp = uWindDir * (windWave * aHeightPercent * aHeightPercent);
  worldPos.x += windDisp.x;
  worldPos.z += windDisp.y;

  vWorldPos = worldPos;
  vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);

  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
`;

const FLOWER_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying float vHeightPercent;
varying float vIsPetal;
varying float vCenterDist;
varying float vColorJitter;
varying vec3 vWorldPos;
varying vec3 vNormal;

uniform vec3 uPrimaryColor;
uniform vec3 uSecondaryColor;
uniform vec3 uStemColor;

void main() {
  vec3 finalColor;

  if (vIsPetal < 0.5) {
    // Green foliage stem and base leaves
    vec3 stemShade = mix(uStemColor * 0.82, uStemColor * 1.15, vHeightPercent);
    finalColor = stemShade;
  } else {
    // Petal blossom:
    // Natural variety: mix between primary and secondary petal colors based on jitter
    vec3 basePetal = mix(uPrimaryColor, uSecondaryColor, step(0.45, vColorJitter) * (vColorJitter * 0.85));

    // Per-instance hue/lightness shimmer (±10%)
    float shimmer = (vColorJitter - 0.5) * 0.20;
    basePetal = clamp(basePetal * (1.0 + shimmer), 0.0, 1.0);

    // Warm golden/orange center stamen disc
    vec3 stamenColor = vec3(0.98, 0.78, 0.12);
    float centerBlend = smoothstep(0.35, 0.05, vCenterDist);
    finalColor = mix(basePetal, stamenColor, centerBlend);
  }

  // Subtle directional top lighting
  float diffuse = max(dot(vNormal, vec3(0.3, 0.9, 0.3)), 0.25);
  finalColor *= mix(0.85, 1.12, diffuse);

  // Near-plane fading when walk camera gets very close
  float distToCamera = length(vWorldPos - cameraPosition);
  float nearAlpha = smoothstep(0.18, 0.65, distToCamera);

  if (nearAlpha < 0.05) discard;

  gl_FragColor = vec4(finalColor, nearAlpha);
}
`;

export function ProceduralWildflowers({
  terrainShape,
  shapes,
  terrainModifiers = []
}: ProceduralWildflowersProps) {
  const flowerSettings: WildflowerSettings = useMemo(() => {
    return {
      ...DEFAULT_WILDFLOWER_SETTINGS,
      ...(terrainShape.terrainData?.flowers || {})
    };
  }, [terrainShape.terrainData?.flowers]);

  if (!flowerSettings.enabled || !terrainShape.terrainData) {
    return null;
  }

  // Base wildflower geometry (stem + crossed petal blossom + stamen disk)
  const baseGeometry = useMemo(() => {
    return createWildflowerGeometry();
  }, []);

  // Compute instances based on density, terrain geometry, and slab/road exclusion
  const instanceData = useMemo(() => {
    return generateWildflowerInstances(terrainShape, shapes, terrainModifiers, flowerSettings);
  }, [
    terrainShape.id,
    terrainShape.terrainData?.heights,
    terrainShape.terrainData?.width,
    terrainShape.terrainData?.depth,
    terrainShape.position,
    shapes,
    terrainModifiers,
    flowerSettings.density,
    flowerSettings.maxSlopeAngle,
    flowerSettings.enabled
  ]);

  const isAnimated = flowerSettings.animate !== false;
  const effectiveWindStrength = isAnimated
    ? (flowerSettings.animationStrength ?? 0.02)
    : 0.0;

  const uniforms = useMemo(() => {
    return {
      uTime: { value: 0.0 },
      uWindStrength: { value: effectiveWindStrength },
      uWindDir: { value: new THREE.Vector2(0.707, 0.707) },
      uBaseHeight: { value: flowerSettings.baseHeight ?? 0.05 },
      uHeightVariance: { value: flowerSettings.heightVariance ?? 0.30 },
      uPrimaryColor: { value: new THREE.Color(flowerSettings.primaryColor || '#ffffff') },
      uSecondaryColor: { value: new THREE.Color(flowerSettings.secondaryColor || '#f59e0b') },
      uStemColor: { value: new THREE.Color(flowerSettings.stemColor || '#2e6128') }
    };
  }, [
    effectiveWindStrength,
    flowerSettings.baseHeight,
    flowerSettings.heightVariance,
    flowerSettings.primaryColor,
    flowerSettings.secondaryColor,
    flowerSettings.stemColor
  ]);

  const material = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: FLOWER_VERTEX_SHADER,
      fragmentShader: FLOWER_FRAGMENT_SHADER,
      uniforms,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: true,
      depthTest: true
    });
    return mat;
  }, [uniforms]);

  // Sync wind strength immediately when slider adjusts
  useEffect(() => {
    if (material.uniforms.uWindStrength) {
      material.uniforms.uWindStrength.value = effectiveWindStrength;
    }
  }, [material, effectiveWindStrength]);

  // Animation frame loop
  useFrame((_, delta) => {
    if (material.uniforms.uTime && isAnimated) {
      material.uniforms.uTime.value += delta * (flowerSettings.windSpeed ?? 2.0);
    }
  });

  const meshRef = useRef<THREE.InstancedMesh | null>(null);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || instanceData.instanceCount === 0) return;

    const mat4 = new THREE.Matrix4();
    for (let i = 0; i < instanceData.instanceCount; i++) {
      mat4.fromArray(instanceData.matrices, i * 16);
      mesh.setMatrixAt(i, mat4);
    }
    mesh.instanceMatrix.needsUpdate = true;

    const geo = mesh.geometry;
    geo.setAttribute('aShapeOffset', new THREE.InstancedBufferAttribute(instanceData.shapeOffsets, 4));
    geo.setAttribute('aHeightVariance', new THREE.InstancedBufferAttribute(instanceData.heightVariances, 1));
    geo.attributes.aShapeOffset.needsUpdate = true;
    geo.attributes.aHeightVariance.needsUpdate = true;

    mesh.raycast = () => {};
    mesh.userData = { isFlowers: true, isObstacle: false };
  }, [instanceData]);

  if (instanceData.instanceCount === 0) {
    return null;
  }

  return (
    <instancedMesh
      key={`wildflowers-${terrainShape.id}-${instanceData.instanceCount}`}
      ref={meshRef}
      name="procedural-wildflowers-mesh"
      args={[baseGeometry, material, instanceData.instanceCount]}
      frustumCulled={false}
      raycast={() => {}}
      userData={{ isFlowers: true, isObstacle: false }}
    />
  );
}
