import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { Shape } from '../types';
import { useApp } from '../AppContext';
import { sampleTerrainElevation } from '../lib/archRoomAssembly';
import { WaterSim } from '../lib/water/waterSim';
import { WaterReflection } from '../lib/water/waterReflection';
import { WATER_CLARITY, offsetOutline, waterMargin } from '../lib/water/waterBody';
import { createHeightTexture } from '../lib/terrain/bladeGrass';
import { createWaterSurfaceMaterial, createWaterTransmittanceMaterial, createWaterUniforms } from '../lib/water/waterMaterial';

/** One wave simulation for all water bodies, created on first use and freed with the last one. */
let sharedSim: WaterSim | null = null;
let simUsers = 0;
let lastSimFrame = -1;
const sunDirection = new THREE.Vector3(0.3, 0.8, 0.2).normalize();
let lastSunLookup = -Infinity;

function findSun(scene: THREE.Scene, target: THREE.Vector3) {
  let best: THREE.DirectionalLight | null = null;
  scene.traverseVisible(object => {
    const light = object as THREE.DirectionalLight;
    if (light.isDirectionalLight && light.intensity > 0 && (!best || light.intensity > best.intensity)) best = light;
  });
  const sun = best as THREE.DirectionalLight | null;
  if (!sun) return;
  const from = sun.getWorldPosition(new THREE.Vector3());
  const to = sun.target.getWorldPosition(new THREE.Vector3());
  if (from.distanceToSquared(to) > 1e-8) target.copy(from.sub(to).normalize());
}

interface Props {
  shape: Shape;
  /** The terrain under the water, with water basins already dug. */
  terrain: Shape | undefined;
  meshProps: any;
  selectionHighlight?: React.ReactNode;
}

export function WaterMesh({ shape, terrain, meshProps, selectionHighlight }: Props) {
  const data = shape.waterData!;
  const uniforms = useMemo(() => createWaterUniforms(), []);
  const transmittance = useMemo(() => createWaterTransmittanceMaterial(uniforms), [uniforms]);
  const surface = useMemo(() => createWaterSurfaceMaterial(uniforms), [uniforms]);
  useEffect(() => () => { transmittance.dispose(); surface.dispose(); }, [transmittance, surface]);
  const reflection = useMemo(() => new WaterReflection(), []);
  useEffect(() => () => reflection.dispose(), [reflection]);
  useEffect(() => { uniforms.uReflection.value = reflection.target.texture; }, [uniforms, reflection]);

  useEffect(() => {
    if (!sharedSim) sharedSim = new WaterSim();
    simUsers++;
    uniforms.uSurf.value = sharedSim.surface.texture;
    uniforms.uCaus.value = sharedSim.caustics.texture;
    return () => {
      if (--simUsers === 0) { sharedSim?.dispose(); sharedSim = null; lastSimFrame = -1; }
    };
  }, [uniforms]);

  // Outline in the shape's frame; the surface sits at local y = 0 (the water level).
  // Reaches the basin's dug margin; wherever the ground is above the level it hides the extra.
  const margin = waterMargin(terrain);
  const geometry = useMemo(() => {
    const outline = new THREE.Shape(offsetOutline(data.points, margin).map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ShapeGeometry(outline);
    g.rotateX(-Math.PI / 2);
    g.computeBoundingSphere();
    return g;
  }, [data.points, margin]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const heights = useMemo(() => (terrain?.terrainData ? createHeightTexture(terrain) : null), [terrain?.terrainData?.heights, terrain?.terrainData?.gridX]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => heights?.dispose(), [heights]);

  useEffect(() => {
    const clarity = WATER_CLARITY[data.clarity] ?? WATER_CLARITY.lake;
    uniforms.uAbsorb.value.fromArray(clarity.absorb);
    uniforms.uScatter.value.fromArray(clarity.scatter);
    uniforms.uFallbackDepth.value = data.depth;
    const xs = data.points.map(p => p[0]), zs = data.points.map(p => p[1]);
    const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
    uniforms.uLakeWaves.value = THREE.MathUtils.clamp((extent - 12) / 40, 0, 1);
    uniforms.uHeights.value = heights;
    uniforms.uHasTerrain.value = heights ? 1 : 0;
    if (terrain?.terrainData) {
      const { width, depth } = terrain.terrainData;
      uniforms.uBounds.value.set(terrain.position[0] - width / 2, terrain.position[2] - depth / 2, width, depth);
      uniforms.uBaseY.value = terrain.position[1];
    }
  }, [uniforms, data, heights, terrain]);

  // If the ground at the pond's centre is above the water, the water can't be seen: say why.
  const { diagLog } = useApp();
  useEffect(() => {
    const [cx, level, cz] = shape.position;
    const ground = terrain ? sampleTerrainElevation(cx, cz, terrain) : level - data.depth;
    const values = { shapeId: shape.id, level: +level.toFixed(2), groundAtCentre: +ground.toFixed(2), dig: data.dig !== false, terrain: terrain?.id ?? null };
    if (ground >= level) diagLog('ERROR', `${shape.name}: ground is above the water level, so the water is hidden`, values);
    else diagLog('RENDER', `${shape.name} water shown`, values);
  }, [shape.id, shape.name, shape.position, data.depth, data.dig, terrain?.terrainData?.heights]); // eslint-disable-line react-hooks/exhaustive-deps

  const group = useRef<THREE.Group>(null);
  useFrame(({ gl, scene, clock, camera }) => {
    if (!sharedSim) return;
    const frame = gl.info.render.frame;
    if (clock.elapsedTime - lastSunLookup > 1) { findSun(scene, sunDirection); lastSunLookup = clock.elapsedTime; }
    if (frame !== lastSimFrame) {
      lastSimFrame = frame;
      sharedSim.update(gl, clock.elapsedTime, sunDirection);
    }
    uniforms.uSunDir.value.copy(sunDirection);
    uniforms.uCausShift.value.copy(sharedSim.causticShift);
    // The water level is the shape's height, including while it is being dragged.
    uniforms.uLevel.value = group.current ? group.current.getWorldPosition(new THREE.Vector3()).y : shape.position[1];

    // Mirror the scene for perspective views looking at the water from above it.
    const perspective = (camera as THREE.PerspectiveCamera).isPerspectiveCamera;
    const visible = group.current?.visible !== false && camera.position.y > uniforms.uLevel.value + 0.02;
    const useMirror = perspective && visible;
    uniforms.uUseReflection.value = useMirror ? 1 : 0;
    surface.envMapIntensity = useMirror ? 0 : 1;
    if (useMirror) {
      reflection.render(gl, scene, camera, uniforms.uLevel.value,
        object => object.name === 'procedural-grass-mesh' || object.userData?.isWater === true);
      uniforms.uReflectionMatrix.value.copy(reflection.textureMatrix);
    }
  });

  // Water is placed and levelled, never rotated or scaled.
  const { rotation: _rotation, quaternion: _quaternion, scale: _scale, ...placement } = meshProps;
  return (
    <group {...placement} ref={group}>
      <mesh geometry={geometry} material={transmittance} renderOrder={10} userData={{ isShape: true, id: shape.id, isWater: true }} />
      <mesh geometry={geometry} material={surface} renderOrder={11} receiveShadow userData={{ isShape: true, id: shape.id, isWater: true }} />
      {selectionHighlight}
    </group>
  );
}
