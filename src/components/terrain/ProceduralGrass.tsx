import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Shape, TerrainModifier, GrassSettings, DEFAULT_GRASS_SETTINGS } from '../../types';
import { useApp } from '../../AppContext';
import { sampleTerrainElevation } from '../../lib/archRoomAssembly';
import { extractExclusionFootprints } from '../../lib/terrain/grassGeometry';
import { groundUnderRay } from '../../lib/terrain/groundRay';
import { createBladeTemplate, createGrassField, grassRings, GrassTrail, TRAIL_RECOVERY_SECONDS } from '../../lib/terrain/bladeGrass';
import {
  bladeWindStrength, createBladeGrassMaterial, createBladeGrassUniforms, createBladeRingUniforms,
  setBladeColors, updateRingUniforms
} from '../../lib/terrain/bladeGrassMaterial';

interface ProceduralGrassProps {
  terrainShape: Shape;
  shapes: Shape[];
  terrainModifiers?: TerrainModifier[];
}

const forward = new THREE.Vector3();
const cameraPosition = new THREE.Vector3();
const focus = new THREE.Vector3();
const centre = new THREE.Vector3();
const nearGround = new THREE.Vector3();
const bottomRay = new THREE.Ray();
const horizontalDistance = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * The closest ground the camera can see: where the ray through the bottom centre of the screen
 * meets the terrain, or straight below when the view looks down far enough to include it.
 */
function nearestVisibleGround(camera: THREE.Camera, terrain: Shape, target: THREE.Vector3) {
  camera.getWorldPosition(cameraPosition);
  const groundBelow = sampleTerrainElevation(cameraPosition.x, cameraPosition.z, terrain);
  camera.getWorldDirection(forward);
  bottomRay.origin.copy(cameraPosition);
  bottomRay.direction.set(0, -1, 0.5).unproject(camera).sub(cameraPosition).normalize();
  const forwardFlat = Math.hypot(forward.x, forward.z);
  const bottomAlong = forwardFlat > 1e-4 ? (bottomRay.direction.x * forward.x + bottomRay.direction.z * forward.z) / forwardFlat : 0;
  // The bottom edge already points past straight down: the ground under the camera is in view.
  if (bottomAlong <= 0 || cameraPosition.y <= groundBelow) return target.set(cameraPosition.x, groundBelow, cameraPosition.z);
  const hit = groundUnderRay(bottomRay, (x, z) => sampleTerrainElevation(x, z, terrain), 400);
  return hit ? target.copy(hit) : target.set(cameraPosition.x, groundBelow, cameraPosition.z);
}

/**
 * Where the grass rings are centred. Walking: under the walker. Editor views: where the view
 * direction meets the terrain (clamped), so an orbiting or plan camera sees grass around what it
 * looks at rather than underneath itself.
 */
function grassFocus(camera: THREE.Camera, terrain: Shape, walking: boolean, target: THREE.Vector3) {
  camera.getWorldPosition(cameraPosition);
  if (walking) return target.copy(cameraPosition);
  camera.getWorldDirection(forward);
  let groundY = sampleTerrainElevation(cameraPosition.x, cameraPosition.z, terrain);
  // Two refinements of the ray/terrain hit are plenty for gently rolling terrain.
  for (let i = 0; i < 2; i++) {
    const drop = cameraPosition.y - groundY;
    if (forward.y > -0.02 || drop <= 0) return target.copy(cameraPosition);
    const distance = Math.min(drop / -forward.y, 150);
    target.copy(cameraPosition).addScaledVector(forward, distance);
    groundY = sampleTerrainElevation(target.x, target.z, terrain);
  }
  return target.setY(groundY);
}

export function ProceduralGrass({
  terrainShape,
  shapes,
  terrainModifiers = []
}: ProceduralGrassProps) {
  const { graphicsSettings, walkModePhase } = useApp();
  const grassSettings: GrassSettings = useMemo(() => ({
    ...DEFAULT_GRASS_SETTINGS,
    ...(terrainShape.terrainData?.grass || {})
  }), [terrainShape.terrainData?.grass]);
  // Hooks below always run; the enabled check happens at render time so toggling is safe.
  const visible = grassSettings.enabled && Boolean(terrainShape.terrainData);
  const walking = walkModePhase === 'walking';

  // Only rebake the presence mask when something that affects it changes, not on every edit.
  const footprintKey = useMemo(() => JSON.stringify(extractExclusionFootprints(shapes, terrainModifiers)),
    [shapes, terrainModifiers]);
  const field = useMemo(() => visible
    ? createGrassField(terrainShape, shapes, terrainModifiers, grassSettings)
    : null,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [visible, footprintKey, terrainShape.terrainData?.heights, terrainShape.terrainData?.width,
    terrainShape.terrainData?.depth, terrainShape.position, grassSettings.maxSlopeAngle]);
  useEffect(() => () => { field?.heights.dispose(); field?.mask.dispose(); }, [field]);

  const rings = useMemo(() => grassRings(grassSettings),
    [grassSettings.density, grassSettings.baseHeight, grassSettings.heightVariance]);
  const shared = useMemo(() => createBladeGrassUniforms(), []);
  const trail = useMemo(() => new GrassTrail(), []);
  useEffect(() => { shared.uTrail.value = trail.points; shared.uTrailRecovery.value = TRAIL_RECOVERY_SECONDS; }, [shared, trail]);

  const meshes = useMemo(() => rings.map(ring => {
    const ringUniforms = createBladeRingUniforms();
    const geometry = createBladeTemplate(ring.segments);
    geometry.instanceCount = ring.cells * ring.cells;
    const mesh = new THREE.Mesh(geometry, createBladeGrassMaterial(shared, ringUniforms));
    // The rings follow the camera and are built in world space in the shader.
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = 'procedural-grass-mesh';
    // Disable raycasting and assign visual-only obstacle flag for Walk Mode
    mesh.raycast = () => {};
    mesh.userData = { isGrass: true, isObstacle: false, ringUniforms };
    return mesh;
  }), [rings, shared]);
  useEffect(() => () => meshes.forEach(mesh => { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }), [meshes]);

  const isAnimated = grassSettings.animate !== false;
  const animationStrength = isAnimated
    ? (grassSettings.animationStrength ?? grassSettings.windStrength ?? DEFAULT_GRASS_SETTINGS.animationStrength ?? 0)
    : 0;
  useEffect(() => {
    shared.uWindStrength.value = bladeWindStrength(animationStrength);
    shared.uBaseHeight.value = grassSettings.baseHeight ?? DEFAULT_GRASS_SETTINGS.baseHeight;
    shared.uHeightVariance.value = grassSettings.heightVariance ?? DEFAULT_GRASS_SETTINGS.heightVariance;
    shared.uClumpSize.value = THREE.MathUtils.clamp((grassSettings.baseHeight + grassSettings.heightVariance) * 3, 0.3, 1.2);
    setBladeColors(shared, grassSettings.rootColor || DEFAULT_GRASS_SETTINGS.rootColor, grassSettings.tipColor || DEFAULT_GRASS_SETTINGS.tipColor);
  }, [shared, animationStrength, grassSettings.baseHeight, grassSettings.heightVariance, grassSettings.rootColor, grassSettings.tipColor]);

  useEffect(() => {
    if (!field) return;
    shared.uBounds.value.copy(field.bounds);
    shared.uHeights.value = field.heights;
    shared.uMask.value = field.mask;
    shared.uBaseY.value = field.baseY;
  }, [shared, field]);

  // Grass follows the same wind direction as trees and bushes.
  const windDirection = graphicsSettings.vegetation.direction;
  useEffect(() => {
    const radians = windDirection * Math.PI / 180;
    shared.uWindDir.value.set(Math.cos(radians), Math.sin(radians));
  }, [shared, windDirection]);

  useEffect(() => { if (!walking) trail.clear(); }, [walking, trail]);

  useFrame(({ camera, clock, size }, delta) => {
    if (!field) return;
    if (isAnimated) shared.uTime.value += delta * (grassSettings.windSpeed ?? 2.0);
    shared.uClock.value = clock.elapsedTime;
    grassFocus(camera, terrainShape, walking, focus);
    if (walking) trail.step(focus.x, focus.z, clock.elapsedTime);

    // Level of detail is measured from the camera in perspective views; plan (orthographic)
    // views measure it around the focus so the viewed area keeps its blades.
    const orthographic = (camera as THREE.OrthographicCamera).isOrthographicCamera;
    // Pixel footprint, so the shader can keep distant blades at least a pixel wide.
    if (orthographic) {
      const ortho = camera as THREE.OrthographicCamera;
      shared.uPixelWorld.value = (ortho.top - ortho.bottom) / ortho.zoom / Math.max(1, size.height);
      shared.uPixelAngle.value = 0;
    } else {
      const fov = (camera as THREE.PerspectiveCamera).fov ?? 50;
      shared.uPixelWorld.value = 0;
      shared.uPixelAngle.value = 2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2) / Math.max(1, size.height);
    }
    const viewDistance = cameraPosition.distanceTo(focus);
    if (walking || !orthographic) {
      // Perspective views: density always falls off with the true distance from the camera, so
      // the ground nearest the viewer is always the densest. Measuring from the look-at point
      // instead left a dense band far away and only coarse, sparse blades at the viewer's feet.
      shared.uLodOrigin.value.copy(cameraPosition);
      shared.uLodVertical.value = 1;
      // From high up, the nearest visible ground still gets the finest ring: distances are
      // counted from there rather than from the camera itself.
      const near = walking ? cameraPosition : nearestVisibleGround(camera, terrainShape, nearGround);
      const nearDistance = cameraPosition.distanceTo(near);
      shared.uLodBias.value = walking ? 0 : -Math.max(0, nearDistance - 2);
      // Centre slightly ahead of the nearest ground: blades behind or below the view are never seen.
      const start = walking || nearDistance < 2 ? cameraPosition : near;
      const ahead = Math.min(horizontalDistance(start, focus), rings[0].radius * 0.3);
      if (ahead > 1e-3) centre.copy(focus).sub(start).setY(0).setLength(ahead).add(start);
      else centre.copy(start);
    } else {
      shared.uLodOrigin.value.copy(focus);
      shared.uLodVertical.value = 0;
      const ortho = camera as THREE.OrthographicCamera;
      const viewSpan = (ortho.top - ortho.bottom) / ortho.zoom;
      shared.uLodBias.value = Math.max(0, viewSpan - 15) * 0.3;
      centre.copy(focus);
    }
    meshes.forEach((mesh, index) => updateRingUniforms(mesh.userData.ringUniforms, rings[index], rings[index - 1], centre.x, centre.z));
  });

  if (!visible || !field) {
    return null;
  }

  return (
    <group name="procedural-grass" key={`grass-${terrainShape.id}`}>
      {meshes.map(mesh => <primitive key={mesh.uuid} object={mesh} dispose={null} />)}
    </group>
  );
}
