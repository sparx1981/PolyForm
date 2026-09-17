import React, { useEffect, useMemo, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Shape } from '../../types';
import { useApp } from '../../AppContext';
import { VegetationBatch } from '../../lib/graphics/VegetationBatch';
import { VegetationWind } from '../../lib/graphics/VegetationWind';
import { loadPlantPrimitives, plantTint } from '../../lib/graphics/plantAssets';

interface Props {
  plants: Shape[];
  onSelect: (event: ThreeEvent<MouseEvent>, id: string) => void;
  onContextMenu: (event: ThreeEvent<MouseEvent>, id: string) => void;
}
function VegetationCell({ plants, wind, onSelect, onContextMenu, shadows }: Props & { wind: VegetationWind; shadows: boolean }) {
  const [batches, setBatches] = useState<VegetationBatch[]>([]);
  // A stable value keeps changes in unrelated cells/controls from rebuilding this cell.
  const placementsKey = JSON.stringify(plants.map(plant => [plant.id, plant.position, plant.rotation, plant.quaternion, plant.scale, plant.color]));
  const species = plants[0].plantSpeciesId!, variation = plants[0].plantVariation;
  useEffect(() => {
    let cancelled = false;
    const owned: VegetationBatch[] = [];
    setBatches([]);
    loadPlantPrimitives(species, variation).then(primitives => {
      if (cancelled) return;
      const placements = plants.map(plant => ({ id: plant.id, position: new THREE.Vector3(...plant.position),
        rotation: plant.quaternion ? new THREE.Quaternion(...plant.quaternion) : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(plant.rotation || [0, 0, 0]))),
        scale: new THREE.Vector3(...(plant.scale || [1, 1, 1])),
        color: plantTint(species, plant.color),
      }));
      for (const primitive of primitives) {
        const batch = new VegetationBatch(primitive.geometry, primitive.material, wind, plants.length);
        batch.setInstances(placements); owned.push(batch);
      }
      setBatches([...owned]);
    });
    return () => { cancelled = true; owned.forEach(batch => batch.dispose()); };
  }, [placementsKey, species, variation, wind]);
  useEffect(() => { for (const batch of batches) batch.mesh.castShadow = batch.mesh.receiveShadow = shadows; }, [batches, shadows]);
  return <>{batches.map(batch => <primitive key={batch.mesh.uuid} object={batch.mesh} dispose={null}
    onClick={(event: ThreeEvent<MouseEvent>) => { if (event.instanceId !== undefined) onSelect(event, batch.idAt(event.instanceId)); }}
    onContextMenu={(event: ThreeEvent<MouseEvent>) => { if (event.instanceId !== undefined) onContextMenu(event, batch.idAt(event.instanceId)); }}
  />)}</>;
}
export function InstancedVegetation({ plants, onSelect, onContextMenu }: Props) {
  const { graphicsSettings, shadowsEnabled } = useApp();
  const wind = useMemo(() => new VegetationWind(), []);
  const settings = graphicsSettings.vegetation;
  useEffect(() => {
    const radians = settings.direction * Math.PI / 180;
    wind.configure({ strength: settings.windEnabled ? settings.strength : 0, speed: settings.speed, direction: new THREE.Vector2(Math.cos(radians), Math.sin(radians)) });
  }, [wind, settings]);
  useFrame(state => wind.setTime(state.clock.elapsedTime));
  const cells = useMemo(() => {
    const result = new Map<string, Shape[]>();
    for (const plant of plants) {
      const key = [plant.plantSpeciesId, plant.plantVariation || '', Math.floor(plant.position[0] / 48), Math.floor(plant.position[2] / 48)].join('/');
      const cell = result.get(key) ?? []; cell.push(plant); result.set(key, cell);
    }
    return result;
  }, [plants]);
  return <>{[...cells].map(([key, cell]) => <VegetationCell key={key} plants={cell} wind={wind} shadows={shadowsEnabled} onSelect={onSelect} onContextMenu={onContextMenu} />)}</>;
}
