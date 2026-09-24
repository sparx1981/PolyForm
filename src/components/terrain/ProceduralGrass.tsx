import React, { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Shape, TerrainModifier, GrassSettings, DEFAULT_GRASS_SETTINGS } from '../../types';
import { useApp } from '../../AppContext';
import {
  createGrassBladeGeometry, generateGrassInstances, partitionGrassChunks,
  grassKeepFraction, grassLodRange
} from '../../lib/terrain/grassGeometry';
import { createGrassMaterial, createGrassUniforms, grassBendStrength, setGrassColors } from '../../lib/terrain/grassMaterial';

interface ProceduralGrassProps {
  terrainShape: Shape;
  shapes: Shape[];
  terrainModifiers?: TerrainModifier[];
}

/** Tile edge in metres. Each tile is one draw call with its own bounds for frustum culling. */
const CHUNK_SIZE = 16;

export function ProceduralGrass({
  terrainShape,
  shapes,
  terrainModifiers = []
}: ProceduralGrassProps) {
  const { graphicsSettings } = useApp();
  const grassSettings: GrassSettings = useMemo(() => {
    return {
      ...DEFAULT_GRASS_SETTINGS,
      ...(terrainShape.terrainData?.grass || {})
    };
  }, [terrainShape.terrainData?.grass]);
  // Hooks below always run; the enabled check happens at render time so toggling is safe.
  const visible = grassSettings.enabled && Boolean(terrainShape.terrainData);

  // Generate low-poly tuft geometry
  const baseGeometry = useMemo(() => createGrassBladeGeometry(), []);
  useEffect(() => () => baseGeometry.dispose(), [baseGeometry]);

  // Compute instances based on density, terrain geometry, slope culling, and slab exclusion
  const instanceData = useMemo(() => {
    return generateGrassInstances(terrainShape, shapes, terrainModifiers, { ...grassSettings, enabled: visible });
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
    grassSettings.baseHeight,
    grassSettings.heightVariance,
    visible
  ]);

  const isAnimated = grassSettings.animate !== false;
  const effectiveWindStrength = isAnimated
    ? (grassSettings.animationStrength ?? grassSettings.windStrength ?? DEFAULT_GRASS_SETTINGS.animationStrength ?? 0)
    : 0.0;
  const lod = grassLodRange(grassSettings);

  const uniforms = useMemo(() => createGrassUniforms(), []);
  const material = useMemo(() => createGrassMaterial(uniforms), [uniforms]);
  useEffect(() => () => material.dispose(), [material]);

  // Settings only change uniform values, never the compiled program.
  useEffect(() => {
    uniforms.uWindStrength.value = grassBendStrength(effectiveWindStrength);
    uniforms.uBaseHeight.value = grassSettings.baseHeight ?? DEFAULT_GRASS_SETTINGS.baseHeight;
    uniforms.uHeightVariance.value = grassSettings.heightVariance ?? DEFAULT_GRASS_SETTINGS.heightVariance;
    setGrassColors(uniforms, grassSettings.rootColor || DEFAULT_GRASS_SETTINGS.rootColor, grassSettings.tipColor || DEFAULT_GRASS_SETTINGS.tipColor);
    uniforms.uLod.value.set(lod.near, lod.far, lod.minKeep);
  }, [uniforms, effectiveWindStrength, grassSettings.baseHeight, grassSettings.heightVariance,
    grassSettings.rootColor, grassSettings.tipColor, lod.near, lod.far, lod.minKeep]);

  // Grass follows the same wind direction as trees and bushes.
  const windDirection = graphicsSettings.vegetation.direction;
  useEffect(() => {
    const radians = windDirection * Math.PI / 180;
    uniforms.uWindDir.value.set(Math.cos(radians), Math.sin(radians));
  }, [uniforms, windDirection]);

  // One InstancedMesh per tile. Tiles share the tuft's vertex attributes; only the per-instance
  // attributes differ.
  const meshes = useMemo(() => {
    if (!visible) return [];
    const height = (grassSettings.baseHeight + grassSettings.heightVariance) * 1.2;
    return partitionGrassChunks(instanceData, CHUNK_SIZE).map(chunk => {
      const geometry = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(baseGeometry.attributes)) geometry.setAttribute(name, attribute);
      geometry.setIndex(baseGeometry.index);
      geometry.setAttribute('aShapeOffset', new THREE.InstancedBufferAttribute(chunk.shapeOffsets, 4));
      geometry.setAttribute('aHeightVariance', new THREE.InstancedBufferAttribute(chunk.heightVariances, 1));
      geometry.setAttribute('aRank', new THREE.InstancedBufferAttribute(chunk.ranks, 1));
      const mesh = new THREE.InstancedMesh(geometry, material, chunk.instanceCount);
      mesh.instanceMatrix.array.set(chunk.matrices);
      mesh.instanceMatrix.needsUpdate = true;
      // Shader growth, lean, distance widening and wind extend beyond the roots. Keep culling
      // conservative with explicit bounds rather than the unit-height template's.
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(...chunk.center), chunk.radius + height * 2.5 + 0.2);
      mesh.frustumCulled = true;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.name = 'procedural-grass-mesh';
      // Disable raycasting and assign visual-only obstacle flag for Walk Mode
      mesh.raycast = () => {};
      mesh.userData = { isGrass: true, isObstacle: false, total: chunk.instanceCount };
      return mesh;
    });
  }, [visible, instanceData, baseGeometry, material, grassSettings.baseHeight, grassSettings.heightVariance]);
  // Only the per-tile geometry is disposed: the shared tuft attributes are re-uploaded on demand.
  useEffect(() => () => meshes.forEach(mesh => mesh.geometry.dispose()), [meshes]);

  const cameraPosition = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }, delta) => {
    if (isAnimated) uniforms.uTime.value += delta * (grassSettings.windSpeed ?? 2.0);
    // Orthographic plan views sit far away but show grass at full size: never thin them.
    const thin = !(camera as THREE.OrthographicCamera).isOrthographicCamera;
    uniforms.uLodEnabled.value = thin ? 1 : 0;
    camera.getWorldPosition(cameraPosition);
    for (const mesh of meshes) {
      const total = mesh.userData.total as number;
      if (!thin) { mesh.count = total; continue; }
      const sphere = mesh.boundingSphere!;
      // Nearest root in the tile decides how many tufts the shader may still want to draw.
      const nearest = Math.max(0, cameraPosition.distanceTo(sphere.center) - sphere.radius);
      mesh.count = Math.min(total, Math.ceil(total * grassKeepFraction(nearest, lod) * 1.08));
    }
  });

  if (!visible || meshes.length === 0) {
    return null;
  }

  return (
    <group name="procedural-grass" key={`grass-${terrainShape.id}`}>
      {meshes.map(mesh => <primitive key={mesh.uuid} object={mesh} dispose={null} />)}
    </group>
  );
}
