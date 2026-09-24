import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { Shape } from '../../types';
import { useApp } from '../../AppContext';
import { inject } from '../../lib/graphics/shaderHooks';
import { buildPatio, type GroundAt, type PatioPart } from '../../lib/patio/patioGeometry';

/** A resolved library material for the paving or boards (see Viewport's bindingMaterial). */
export interface PatioSurfaceBinding {
  baseColorTexture?: THREE.Texture;
  roughness?: number;
  metalness?: number;
  pbr?: { normalMap?: THREE.Texture | null; normalScale?: THREE.Vector2; roughnessMap?: THREE.Texture | null; aoMap?: THREE.Texture | null };
}

interface Props {
  shape: Shape;
  /** Ground height (world y) at world x/z, before any patio levelling. */
  groundAt: (x: number, z: number) => number;
  meshProps: any;
  selectionHighlight?: React.ReactNode;
  surfaceBinding?: PatioSurfaceBinding;
}

type Finish = 'stone' | 'wood' | 'grooved' | 'plain';

/**
 * Standard lit material with vertex colours, plus a little procedural surface detail: fine
 * speckle for stone; long grain streaks for timber (from the board coordinates in aBoard), with
 * ribbed grooves for anti-slip boards.
 */
function surfaceMaterial(finish: Finish, roughness: number, binding?: PatioSurfaceBinding): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: binding?.roughness ?? roughness, metalness: binding?.metalness ?? 0, side: THREE.DoubleSide,
    map: binding?.baseColorTexture ?? null,
    normalMap: binding?.pbr?.normalMap ?? null,
    roughnessMap: binding?.pbr?.roughnessMap ?? null,
  });
  if (binding?.pbr?.normalScale) material.normalScale.copy(binding.pbr.normalScale);
  for (const texture of [material.map, material.normalMap, material.roughnessMap]) {
    if (texture) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  }
  if (finish === 'plain') return material;
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute vec2 aBoard;\nvarying vec2 vBoard;\nvarying vec3 vPatioWorld;\n' + shader.vertexShader;
    shader.vertexShader = inject(shader.vertexShader, '#include <worldpos_vertex>', `
      #include <worldpos_vertex>
      vBoard = aBoard;
      vPatioWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
    `);
    shader.fragmentShader = `varying vec2 vBoard;\nvarying vec3 vPatioWorld;\n
      // Sine-free hash: sin() of large arguments loses precision on GPUs and draws moire rings.
      float pHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float pNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(pHash(i), pHash(i + vec2(1.0, 0.0)), f.x), mix(pHash(i + vec2(0.0, 1.0)), pHash(i + vec2(1.0)), f.x), f.y); }
    ` + shader.fragmentShader;
    const detail = finish === 'stone' ? `
      // Stone: fine grain and a few darker flecks, faded out once they are smaller than a pixel
      // (otherwise they alias into moire rings in the distance).
      vec2 pAt = vPatioWorld.xz + vPatioWorld.y * 0.37;
      float pPixel = length(fwidth(pAt));
      float pNear = 1.0 - smoothstep(0.004, 0.012, pPixel);
      float pMid = 1.0 - smoothstep(0.015, 0.045, pPixel);
      float pFine = mix(0.5, pNoise(pAt * 90.0), pNear) * 0.6 + mix(0.5, pNoise(pAt * 23.0), pMid) * 0.4;
      diffuseColor.rgb *= 0.9 + 0.16 * pFine;
      diffuseColor.rgb *= 1.0 - 0.18 * pNear * smoothstep(0.82, 0.95, pNoise(pAt * 140.0 + 3.1));
    ` : `
      // Timber: long streaks of grain along the board, wavering slightly, and the odd knot.
      float pWaver = pNoise(vec2(vBoard.x * 0.7, vBoard.y * 3.0)) * 1.6;
      float pFade = 1.0 - smoothstep(0.08, 0.3, length(fwidth(vBoard * vec2(1.0, 9.0))));
      float pGrain = sin((vBoard.y * 9.0 + pWaver) * 6.2831) * 0.5 + 0.5;
      pGrain = mix(0.5, pGrain * 0.6 + pNoise(vec2(vBoard.x * 1.5, vBoard.y * 26.0)) * 0.4, pFade);
      diffuseColor.rgb *= 0.86 + 0.2 * pGrain;
      float pKnot = smoothstep(0.93, 0.99, pNoise(vec2(vBoard.x * 1.1, vBoard.y * 2.0 + 5.0)));
      diffuseColor.rgb *= 1.0 - 0.35 * pKnot;
      ${finish === 'grooved' ? `
      // Anti-slip ribs: five grooves across each board.
      float pRib = abs(fract(vBoard.y * 5.0) - 0.5) * 2.0;
      diffuseColor.rgb *= mix(0.62, 1.0, smoothstep(0.0, 0.35, pRib));
      ` : ''}
    `;
    shader.fragmentShader = inject(shader.fragmentShader, '#include <color_fragment>', `#include <color_fragment>\n${detail}`);
  };
  material.customProgramCacheKey = () => `polyform-patio-v2-${finish}-${binding ? 'pbr' : 'plain'}`;
  return material;
}

export function PatioMesh({ shape, groundAt, meshProps, selectionHighlight, surfaceBinding }: Props) {
  const data = shape.patioData!;
  const { lightPosition, sunIntensity } = useApp();
  const [px, py, pz] = shape.position;

  const build = useMemo(() => {
    const localGround: GroundAt = (x, z) => groundAt(px + x, pz + z) - py;
    // A library material brings its own colour: shade the pieces around white instead.
    const colored = surfaceBinding?.baseColorTexture ? { ...data, color: '#ffffff' } : data;
    return buildPatio(colored, localGround);
  }, [data, px, py, pz, groundAt, surfaceBinding?.baseColorTexture]);
  useEffect(() => () => Object.values(build.parts).forEach(g => g?.dispose()), [build]);

  const isDeck = data.kind === 'deck';
  const materials = useMemo(() => {
    const boardFinish: Finish = data.grooved ? 'grooved' : 'wood';
    const m: Partial<Record<PatioPart, THREE.Material>> = {
      surface: surfaceMaterial(isDeck ? boardFinish : 'stone', isDeck ? (data.board === 'composite' ? 0.65 : 0.8) : data.paving === 'porcelain' ? 0.35 : 0.85, surfaceBinding),
      joints: new THREE.MeshStandardMaterial({ color: data.groutColor, roughness: 0.95 }),
      edge: surfaceMaterial('stone', 0.9),
      kerb: surfaceMaterial('stone', 0.85),
      wall: surfaceMaterial('stone', 0.9),
      steps: surfaceMaterial(isDeck ? boardFinish : 'stone', 0.85),
      frame: surfaceMaterial('wood', 0.9),
      fascia: surfaceMaterial('wood', 0.8),
      skirting: surfaceMaterial('wood', 0.8),
      railTimber: surfaceMaterial('wood', 0.75),
      railMetal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.7, side: THREE.DoubleSide }),
      glass: new THREE.MeshPhysicalMaterial({ color: '#dff3f0', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
      lights: new THREE.MeshBasicMaterial({ color: data.lights.color, toneMapped: false }),
    };
    return m;
    // The binding object is rebuilt every render; depend on what it actually carries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDeck, data.grooved, data.board, data.paving, data.groutColor, data.lights.color,
    surfaceBinding?.baseColorTexture, surfaceBinding?.pbr?.normalMap, surfaceBinding?.pbr?.roughnessMap, surfaceBinding?.roughness]);
  useEffect(() => () => Object.values(materials).forEach(m => m?.dispose()), [materials]);

  // Deck lights: brightest at night; a handful of them light the scene for real.
  const realLights = useMemo(() => {
    if (!isDeck || !data.lights.enabled || !data.lights.castLight || !build.lights.length) return [];
    const count = Math.min(8, build.lights.length);
    return Array.from({ length: count }, (_, i) => build.lights[Math.floor((i * build.lights.length) / count)]);
  }, [isDeck, data.lights.enabled, data.lights.castLight, build.lights]);
  const lightRefs = useRef<(THREE.PointLight | null)[]>([]);
  const lightMaterial = materials.lights as THREE.MeshBasicMaterial;
  const lightColor = useMemo(() => new THREE.Color(data.lights.color), [data.lights.color]);
  useFrame(() => {
    if (!isDeck || !data.lights.enabled) return;
    const length = Math.hypot(...lightPosition) || 1;
    const elevation = lightPosition[1] / length;
    // Night: sun low or dimmed right down.
    const night = data.lights.nightOnly
      ? Math.max(THREE.MathUtils.smoothstep(0.3 - elevation, 0, 0.25), THREE.MathUtils.smoothstep(0.6 - sunIntensity, 0, 0.5))
      : 1;
    lightMaterial.color.copy(lightColor).multiplyScalar(0.25 + 2.2 * night);
    for (const light of lightRefs.current) if (light) light.intensity = 1.6 * night;
  });

  // Patios and decks are placed and levelled, never rotated or scaled.
  const { rotation: _rotation, quaternion: _quaternion, scale: _scale, ...placement } = meshProps;
  return (
    <group {...placement}>
      {(Object.entries(build.parts) as [PatioPart, THREE.BufferGeometry][]).map(([name, geometry]) => (
        <mesh key={name} geometry={geometry} material={materials[name]}
          castShadow={name !== 'glass' && name !== 'lights' && name !== 'joints'}
          receiveShadow={name !== 'lights'}
          renderOrder={name === 'glass' ? 5 : 0}
          userData={{ isShape: true, id: shape.id, patioPart: name }} />
      ))}
      {realLights.map((p, i) => (
        <pointLight key={i} ref={light => { lightRefs.current[i] = light; }} position={[p.x, p.y + 0.06, p.z]}
          color={data.lights.color} distance={3.5} decay={2} intensity={0} />
      ))}
      {selectionHighlight}
    </group>
  );
}
