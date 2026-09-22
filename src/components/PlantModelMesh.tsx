import React, { useState, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Shape } from '../types';
import { useApp } from '../AppContext';
import { VegetationWind } from '../lib/graphics/VegetationWind';
import { loadPlantPrimitives, proceduralPlantPrimitives, plantTint, type PlantPrimitive } from '../lib/graphics/plantAssets';
import { PLANT_SPECIES_CATALOG } from '../lib/plantLibrary';

interface PlantModelMeshProps { shape: Shape; selectedId: string | null; meshProps: any; selectionHighlight?: React.ReactNode }

/** Editable plants and instanced plants use identical normalized asset templates. */
export function PlantModelMesh({ shape, selectedId, meshProps, selectionHighlight }: PlantModelMeshProps) {
  const { graphicsSettings } = useApp();
  const speciesId = shape.plantSpeciesId || (shape.type === 'tree' ? 'english_oak' : shape.type === 'rock' ? 'ph_boulder_01' : 'boxwood_hedge_bush');
  // Keyed off the species' own category (not just shape.type === 'rock') so a rock-category
  // model never sways even if it was placed through a non-boulder tool - e.g. a legacy shape
  // saved before the Bushes & Flora picker stopped listing boulders as a bush species.
  const isRigid = shape.type === 'rock' || PLANT_SPECIES_CATALOG.find(s => s.id === speciesId)?.category === 'rock';
  const key = speciesId + '/' + (shape.plantVariation || '');
  const [loaded, setLoaded] = useState<{ key: string; primitives: PlantPrimitive[] } | null>(null);
  const fallback = useMemo(() => proceduralPlantPrimitives(speciesId), [speciesId]);
  const primitives = loaded?.key === key ? loaded.primitives : fallback;
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const wind = useMemo(() => new VegetationWind(), []);
  useEffect(() => {
    let cancelled = false;
    loadPlantPrimitives(speciesId, shape.plantVariation).then(result => { if (!cancelled) setLoaded({ key, primitives: result }); });
    return () => { cancelled = true; };
  }, [speciesId, shape.plantVariation, key]);
  useEffect(() => {
    const settings = graphicsSettings.vegetation, radians = settings.direction * Math.PI / 180;
    wind.configure({ strength: settings.windEnabled ? settings.strength : 0, speed: settings.speed, direction: new THREE.Vector2(Math.cos(radians), Math.sin(radians)) });
  }, [graphicsSettings.vegetation, wind]);
  useEffect(() => {
    const root = new THREE.Group();
    const cleanups: (() => void)[] = [];
    for (const primitive of primitives) {
      const material = primitive.material.clone();
      material.color.multiply(plantTint(speciesId, shape.color));
      material.emissive.set(selectedId === shape.id ? '#0063A3' : '#000000');
      material.emissiveIntensity = selectedId === shape.id ? 0.35 : 0;
      material.opacity = shape.opacity ?? 1; material.transparent = material.opacity < 1;
      const mesh = new THREE.Mesh(primitive.geometry, material);
      mesh.castShadow = mesh.receiveShadow = Boolean(meshProps.castShadow);
      mesh.userData = { isShape: true, id: shape.id };
      if (!isRigid) {
        mesh.geometry.computeBoundingBox(); const box = mesh.geometry.boundingBox!;
        cleanups.push(wind.attachMesh(mesh, box.min.y, Math.max(0.001, box.max.y - box.min.y)));
      }
      root.add(mesh);
    }
    setGroup(root);
    return () => { cleanups.forEach(cleanup => cleanup()); root.children.forEach(child => ((child as THREE.Mesh).material as THREE.Material).dispose()); };
  }, [primitives, selectedId === shape.id, shape.id, shape.opacity, shape.color, speciesId, meshProps.castShadow, wind, isRigid]);
  useFrame(state => wind.setTime(state.clock.elapsedTime));
  return <group {...meshProps}>{group && <primitive object={group} dispose={null} />}{selectionHighlight}</group>;
}
