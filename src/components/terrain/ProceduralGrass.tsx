import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Shape, TerrainModifier, GrassSettings, DEFAULT_GRASS_SETTINGS } from '../../types';
import { createGrassBladeGeometry, generateGrassInstances } from '../../lib/terrain/grassGeometry';

interface ProceduralGrassProps {
  terrainShape: Shape;
  shapes: Shape[];
  terrainModifiers?: TerrainModifier[];
}

const GRASS_VERTEX_SHADER = /* glsl */ `
attribute vec4 aShapeOffset;
attribute float aHeightVariance;
attribute float aHeightPercent;
attribute float aBladeTone;

varying float vHeightPercent;
varying vec3 vWorldPos;
varying float vColorJitter;
varying float vBladeTone;
varying float vLight;

uniform float uTime;
uniform float uWindStrength;
uniform vec2 uWindDir;
uniform float uBaseHeight;
uniform float uHeightVariance;

void main() {
  vHeightPercent = aHeightPercent;
  vColorJitter = aShapeOffset.w;
  vBladeTone = aBladeTone;

  // 1. Local vertex position
  vec3 pos = position;

  // Scale the whole tuft in metres; scaling Y alone makes short lawn grass broad and flat.
  float hScale = uBaseHeight + aHeightVariance * uHeightVariance;
  pos *= hScale;

  // Width & profile shape offsets (individual lean, taper, and width)
  pos.xz *= aShapeOffset.z;
  pos.x += aShapeOffset.x * (aHeightPercent * aHeightPercent) * hScale;
  pos.z += aShapeOffset.y * (aHeightPercent * aHeightPercent) * hScale;

  // Radial blades have volume from every viewing angle without billboarding.
  mat4 plantMatrix = modelMatrix * instanceMatrix;
  vec3 worldNormal = normalize(mat3(plantMatrix) * normal);
  vLight = 0.88 + 0.18 * abs(dot(worldNormal, vec3(0.31, 0.82, 0.48)));

  // World position before wind
  vec4 worldPos4 = plantMatrix * vec4(pos, 1.0);
  vec3 worldPos = worldPos4.xyz;

  // Wind Animation:
  // Horizontal displacement proportional to (aHeightPercent)^2
  float windWave = sin(uTime * 2.2 + worldPos.x * 0.45 + worldPos.z * 0.45) * uWindStrength;
  windWave += cos(uTime * 3.4 + worldPos.x * 0.85 + worldPos.z * 0.65) * (uWindStrength * 0.35);

  vec2 windDisp = uWindDir * (windWave * aHeightPercent * aHeightPercent);
  worldPos.x += windDisp.x;
  worldPos.z += windDisp.y;

  vWorldPos = worldPos;

  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
`;

const GRASS_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying float vHeightPercent;
varying vec3 vWorldPos;
varying float vColorJitter;
varying float vBladeTone;
varying float vLight;

uniform vec3 uRootColor;
uniform vec3 uTipColor;

void main() {
  // Two-Tone Gradient: interpolate mix(uRootColor, uTipColor, vHeightPercent)
  vec3 gradColor = mix(uRootColor, uTipColor, vHeightPercent);

  // Subtle per-instance hue/lightness jitter (±12% lightness shift)
  float jitter = (vColorJitter - 0.5) * 0.24;
  vec3 finalColor = gradColor * (1.0 + jitter);

  // Vertical light factor (roots darker for ambient depth, tips brighter)
  float verticalShading = mix(0.92, 1.12, vHeightPercent);
  finalColor *= verticalShading * vBladeTone * vLight;

  // Near-plane fading when walk camera gets close
  float distToCamera = length(vWorldPos - cameraPosition);
  float nearAlpha = smoothstep(0.18, 0.65, distToCamera);

  if (nearAlpha < 0.05) discard;

  gl_FragColor = vec4(finalColor, nearAlpha);
}
`;

export function ProceduralGrass({
  terrainShape,
  shapes,
  terrainModifiers = []
}: ProceduralGrassProps) {
  const grassSettings: GrassSettings = useMemo(() => {
    return {
      ...DEFAULT_GRASS_SETTINGS,
      ...(terrainShape.terrainData?.grass || {})
    };
  }, [terrainShape.terrainData?.grass]);

  // Don't render anything if grass is toggled off
  if (!grassSettings.enabled || !terrainShape.terrainData) {
    return null;
  }

  // Generate low-poly card geometry
  const baseGeometry = useMemo(() => {
    return createGrassBladeGeometry();
  }, []);
  useEffect(() => () => baseGeometry.dispose(), [baseGeometry]);

  // Compute instances based on density, terrain geometry, slope culling, and slab exclusion
  const instanceData = useMemo(() => {
    return generateGrassInstances(terrainShape, shapes, terrainModifiers, grassSettings);
  }, [
    terrainShape.id,
    terrainShape.terrainData?.heights,
    terrainShape.terrainData?.width,
    terrainShape.terrainData?.depth,
    terrainShape.position,
    shapes,
    terrainModifiers,
    grassSettings.density,
    grassSettings.maxSlopeAngle,
    grassSettings.enabled
  ]);

  const isAnimated = grassSettings.animate !== false;
  const effectiveWindStrength = isAnimated
    ? (grassSettings.animationStrength ?? grassSettings.windStrength ?? DEFAULT_GRASS_SETTINGS.animationStrength)
    : 0.0;

  const uniforms = useMemo(() => {
    return {
      uTime: { value: 0.0 },
      uWindStrength: { value: effectiveWindStrength },
      uWindDir: { value: new THREE.Vector2(0.707, 0.707) },
      uBaseHeight: { value: grassSettings.baseHeight ?? DEFAULT_GRASS_SETTINGS.baseHeight },
      uHeightVariance: { value: grassSettings.heightVariance ?? DEFAULT_GRASS_SETTINGS.heightVariance },
      uRootColor: { value: new THREE.Color(grassSettings.rootColor || '#1e3f20') },
      uTipColor: { value: new THREE.Color(grassSettings.tipColor || '#88bb44') }
    };
  }, [
    effectiveWindStrength,
    grassSettings.baseHeight,
    grassSettings.heightVariance,
    grassSettings.rootColor,
    grassSettings.tipColor
  ]);

  const material = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: GRASS_VERTEX_SHADER,
      fragmentShader: GRASS_FRAGMENT_SHADER,
      uniforms,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: true,
      depthTest: true
    });
    return mat;
  }, [uniforms]);
  useEffect(() => () => material.dispose(), [material]);

  // Keep wind strength uniform instantly synced when user drags slider or toggles animation
  useEffect(() => {
    if (material.uniforms.uWindStrength) {
      material.uniforms.uWindStrength.value = effectiveWindStrength;
    }
  }, [material, effectiveWindStrength]);

  // Dynamic animation loop
  useFrame((_, delta) => {
    if (material.uniforms.uTime && isAnimated) {
      material.uniforms.uTime.value += delta * (grassSettings.windSpeed ?? 2.0);
    }
  });

  const meshRef = useRef<THREE.InstancedMesh | null>(null);

  // Populate instances
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || instanceData.instanceCount === 0) return;

    // Set instance matrices
    const mat4 = new THREE.Matrix4();
    for (let i = 0; i < instanceData.instanceCount; i++) {
      mat4.fromArray(instanceData.matrices, i * 16);
      mesh.setMatrixAt(i, mat4);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    // Shader growth and wind extend beyond the static tuft. Keep culling conservative.
    if (mesh.boundingSphere) mesh.boundingSphere.radius += Math.max(0, (grassSettings.baseHeight + grassSettings.heightVariance) * 1.2 - 1) + effectiveWindStrength + 0.2;

    // Attach instanced attributes to base geometry
    const geo = mesh.geometry;
    geo.setAttribute('aShapeOffset', new THREE.InstancedBufferAttribute(instanceData.shapeOffsets, 4));
    geo.setAttribute('aHeightVariance', new THREE.InstancedBufferAttribute(instanceData.heightVariances, 1));
    geo.attributes.aShapeOffset.needsUpdate = true;
    geo.attributes.aHeightVariance.needsUpdate = true;

    // Disable raycasting and assign visual-only obstacle flag for Walk Mode
    mesh.raycast = () => {};
    mesh.userData = { isGrass: true, isObstacle: false };
  }, [instanceData, grassSettings.baseHeight, grassSettings.heightVariance, effectiveWindStrength]);

  if (instanceData.instanceCount === 0) {
    return null;
  }

  return (
    <instancedMesh
      key={`grass-${terrainShape.id}-${instanceData.instanceCount}`}
      ref={meshRef}
      name="procedural-grass-mesh"
      args={[baseGeometry, material, instanceData.instanceCount]}
      frustumCulled
      dispose={null}
      raycast={() => {}}
      userData={{ isGrass: true, isObstacle: false }}
    />
  );
}
