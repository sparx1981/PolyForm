import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { Shape } from '../types';
import { useApp } from '../AppContext';
import { sampleTerrainElevation } from '../lib/archRoomAssembly';
import { advanceWaterFlow } from '../lib/water/waterMotion';
import { ShallowWaterWaves } from '../lib/water/shallowWaterWaves';
import { createWaveSurfaceGeometry } from '../lib/water/waveSurfaceGeometry';
import { pointInPolygon } from '../lib/water/waterBody';
import { WaterSim } from '../lib/water/waterSim';
import { WaterReflection } from '../lib/water/waterReflection';
import { WATER_CLARITY, deepestPoint, waterMargin, waterWorldOutline } from '../lib/water/waterBody';
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
  const mirrorElapsed = useRef(0);
  const lastMirrorLevel = useRef(NaN);
  const lastMirrorCamera = useRef(new THREE.Matrix4().makeScale(0,0,0));
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
    return createWaveSurfaceGeometry(data.points, margin);
  }, [data.points, margin]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const waveSim = useMemo(() => {
    const xs=data.points.map(p=>p[0]), zs=data.points.map(p=>p[1]);
    const minX=Math.min(...xs), minZ=Math.min(...zs);
    const width=Math.max(0.2,Math.max(...xs)-minX), depth=Math.max(0.2,Math.max(...zs)-minZ);
    const outline=data.points.map(([x,z])=>({x,z}));
    return new ShallowWaterWaves([minX,minZ,width,depth], (x,z) => {
      if(!pointInPolygon(x,z,outline)) return 0;
      return terrain ? Math.max(0,shape.position[1]-sampleTerrainElevation(x+shape.position[0],z+shape.position[2],terrain)) : data.depth;
    });
  }, [data.points, data.depth, terrain, shape.position]);
  useEffect(() => {
    uniforms.uDynamics.value=waveSim.texture; uniforms.uUseDynamics.value=1;
    return () => { uniforms.uUseDynamics.value=0; waveSim.dispose(); };
  }, [waveSim,uniforms]);

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
    const flow = data.flow;
    if (flow?.mode === 'stream') {
      const [fx, fz] = flow.direction ?? [1, 0];
      const length = Math.hypot(fx, fz) || 1;
      uniforms.uFlowDir.value.set(fx / length, fz / length);
      if (fx === 0 && fz === 0) uniforms.uFlowDir.value.set(1, 0);
      uniforms.uFlowSpeed.value = THREE.MathUtils.clamp(flow.speed ?? 0.45, 0, 4);
      uniforms.uFlowTurbulence.value = THREE.MathUtils.clamp(flow.turbulence ?? 0.35, 0, 1);
    } else {
      uniforms.uFlowSpeed.value = 0;
      uniforms.uFlowTurbulence.value = 0;
    }
    uniforms.uHeights.value = heights;
    uniforms.uHasTerrain.value = heights ? 1 : 0;
    if (terrain?.terrainData) {
      const { width, depth } = terrain.terrainData;
      uniforms.uBounds.value.set(terrain.position[0] - width / 2, terrain.position[2] - depth / 2, width, depth);
      uniforms.uBaseY.value = terrain.position[1];
    }
  }, [uniforms, data, heights, terrain]);

  const { diagLog, graphicsSettings } = useApp();
  // Rain rings the surface with drop ripples; heavier (denser, more opaque) rain rings it more.
  const rainLayer = graphicsSettings.weather.layers.rain;
  const rain = graphicsSettings.weather.enabled && rainLayer.enabled
    ? THREE.MathUtils.clamp(rainLayer.density * (0.4 + rainLayer.opacity) * Math.min(1, rainLayer.count / 12000), 0.15, 1) : 0;
  // If the ground at the pond's deepest point is above the water, it can't be seen: say why.
  // (The shape's position is the points' average, which lies outside C-shaped ponds.)
  useEffect(() => {
    const [, level] = shape.position;
    const inner = deepestPoint(waterWorldOutline(shape));
    const ground = terrain ? sampleTerrainElevation(inner.x, inner.z, terrain) : level - data.depth;
    const values = { shapeId: shape.id, level: +level.toFixed(2), groundAtDeepest: +ground.toFixed(2), at: [+inner.x.toFixed(2), +inner.z.toFixed(2)], dig: data.dig !== false, terrain: terrain?.id ?? null };
    if (ground >= level) diagLog('ERROR', `${shape.name}: ground is above the water level, so the water is hidden`, values);
    else diagLog('RENDER', `${shape.name} water shown`, values);
  }, [shape.id, shape.name, shape.position, data.points, data.depth, data.dig, terrain?.terrainData?.heights]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flicker hunting: log mounts, and once a second how many frames drew this pond's water, how
  // often the waves and mirror updated, and whether the water was hidden when the frame began.
  useEffect(() => {
    diagLog('RENDER', `${shape.name} water mounted`, { shapeId: shape.id, simUsers });
    return () => diagLog('RENDER', `${shape.name} water unmounted`, { shapeId: shape.id });
  }, [shape.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const stats = useRef({ since: 0, frames: 0, drawn: 0, hidden: 0, mirror: 0, simUpdates: 0, reports: 0 });

  const group = useRef<THREE.Group>(null);
  useFrame(({ gl, scene, clock, camera }, delta) => {
    uniforms.uRain.value = rain;
    if (rain > 0) uniforms.uRainTime.value += delta;
    advanceWaterFlow(uniforms, delta);
    waveSim.update(delta,{ speed:uniforms.uFlowSpeed.value, direction:[uniforms.uFlowDir.value.x,uniforms.uFlowDir.value.y], turbulence:uniforms.uFlowTurbulence.value, wind:graphicsSettings.weather.enabled ? [graphicsSettings.weather.windX,graphicsSettings.weather.windZ] : [0,0] });
    uniforms.uDynamicsBounds.value.copy(waveSim.bounds);
    uniforms.uDynamicsBounds.value.x+=shape.position[0]; uniforms.uDynamicsBounds.value.y+=shape.position[2];
    if (!sharedSim) return;
    const frame = gl.info.render.frame;
    if (clock.elapsedTime - lastSunLookup > 1) { findSun(scene, sunDirection); lastSunLookup = clock.elapsedTime; }
    const st = stats.current;
    st.frames++;
    if (group.current && !group.current.visible) st.hidden++;
    if (frame !== lastSimFrame) {
      lastSimFrame = frame;
      sharedSim.update(gl, clock.elapsedTime, sunDirection);
      st.simUpdates++;
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
    mirrorElapsed.current += delta;
    const cameraMoved = !lastMirrorCamera.current.equals(camera.matrixWorld);
    if (useMirror && (cameraMoved || lastMirrorLevel.current !== uniforms.uLevel.value || mirrorElapsed.current >= 1/30)) {
      mirrorElapsed.current = 0;
      lastMirrorCamera.current.copy(camera.matrixWorld);
      lastMirrorLevel.current = uniforms.uLevel.value;
      reflection.render(gl, scene, camera, uniforms.uLevel.value,
        object => object.name === 'procedural-grass-mesh' || object.userData?.isWater === true
          // Falling rain and snow mirrored in the water reads as streaks under the surface.
          || object.name === 'weather-rain' || object.name === 'weather-snow');
      uniforms.uReflectionMatrix.value.copy(reflection.textureMatrix);
      st.mirror++;
    }
    // Only the first few seconds after mounting, so the log stays readable.
    if (clock.elapsedTime - st.since >= 1) {
      if (st.reports < 8 && st.since > 0) {
        st.reports++;
        diagLog('RENDER', `${shape.name} water frames`, { frames: st.frames, drawn: st.drawn, hiddenAtFrameStart: st.hidden,
          mirrorRenders: st.mirror, waveUpdates: st.simUpdates, cameraAboveWater: camera.position.y > uniforms.uLevel.value });
      }
      st.since = clock.elapsedTime; st.frames = st.drawn = st.hidden = st.mirror = st.simUpdates = 0;
    }
  });

  // Water is placed and levelled, never rotated or scaled.
  const { rotation: _rotation, quaternion: _quaternion, scale: _scale, ...placement } = meshProps;
  return (
    <group {...placement} ref={group}>
      <mesh geometry={geometry} material={transmittance} renderOrder={10} userData={{ isShape: true, id: shape.id, isWater: true }} />
      <mesh geometry={geometry} material={surface} renderOrder={11} receiveShadow userData={{ isShape: true, id: shape.id, isWater: true }}
        onAfterRender={() => { stats.current.drawn++; }} />
      {selectionHighlight}
    </group>
  );
}
