import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Shape } from '../../types';
import { useApp } from '../../AppContext';
import { VegetationBatch } from '../../lib/graphics/VegetationBatch';
import { VegetationWind } from '../../lib/graphics/VegetationWind';
import { loadPlantPrimitives, plantTint } from '../../lib/graphics/plantAssets';
import { chooseTreeDetail, hasTreeLod, treeHeight, treeScreenHeight, type TreeDetail } from '../../lib/graphics/treeLod';

interface Props {
  plants: Shape[];
  onSelect: (event: ThreeEvent<MouseEvent>, id: string) => void;
  onContextMenu: (event: ThreeEvent<MouseEvent>, id: string) => void;
}
function VegetationCell({ plants, wind, onSelect, onContextMenu, shadows, detail }: Props & { wind: VegetationWind; shadows: boolean; detail: TreeDetail }) {
  const [batches, setBatches] = useState<VegetationBatch[]>([]);
  const [shadowBatches, setShadowBatches] = useState<VegetationBatch[]>([]);
  // A stable value keeps changes in unrelated cells/controls from rebuilding this cell.
  const placementsKey = JSON.stringify(plants.map(plant => [plant.id, plant.position, plant.rotation, plant.quaternion, plant.scale, plant.color]));
  const species = plants[0].plantSpeciesId!, variation = plants[0].plantVariation;
  const proxyShadows = shadows && detail < 2 && hasTreeLod(species);
  const proxyDetail: TreeDetail = detail === 0 ? 1 : 2;
  useEffect(() => {
    let cancelled = false;
    const owned: VegetationBatch[] = [];
    setBatches([]); setShadowBatches([]);
    Promise.all([loadPlantPrimitives(species, variation, detail),
      proxyShadows ? loadPlantPrimitives(species, variation, proxyDetail) : Promise.resolve([])]).then(([primitives, shadowPrimitives]) => {
      if (cancelled) return;
      const placements = plants.map(plant => ({ id: plant.id, position: new THREE.Vector3(...plant.position),
        rotation: plant.quaternion ? new THREE.Quaternion(...plant.quaternion) : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(plant.rotation || [0, 0, 0]))),
        scale: new THREE.Vector3(...(plant.scale || [1, 1, 1])),
        color: plantTint(species, plant.color),
      }));
      const visible: VegetationBatch[] = [], shadowOnly: VegetationBatch[] = [];
      for (const primitive of primitives) {
        const batch = new VegetationBatch(primitive.geometry, primitive.material, wind, plants.length);
        batch.setInstances(placements); owned.push(batch); visible.push(batch);
      }
      for (const primitive of shadowPrimitives) {
        const batch = new VegetationBatch(primitive.geometry, primitive.material, wind, plants.length);
        batch.setInstances(placements);
        batch.mesh.material.colorWrite = false;
        batch.mesh.material.depthWrite = false;
        batch.mesh.raycast = () => {};
        owned.push(batch); shadowOnly.push(batch);
      }
      setBatches(visible); setShadowBatches(shadowOnly);
    });
    return () => { cancelled = true; owned.forEach(batch => batch.dispose()); };
  }, [placementsKey, species, variation, detail, proxyShadows, proxyDetail, wind]);
  useEffect(() => {
    for (const batch of batches) { batch.mesh.castShadow = shadows && !proxyShadows && detail < 2; batch.mesh.receiveShadow = shadows; }
    for (const batch of shadowBatches) { batch.mesh.castShadow = shadows; batch.mesh.receiveShadow = false; }
  }, [batches, shadowBatches, shadows, proxyShadows, detail]);
  return <>{batches.map(batch => <primitive key={batch.mesh.uuid} object={batch.mesh} dispose={null}
    onClick={(event: ThreeEvent<MouseEvent>) => { if (event.instanceId !== undefined) onSelect(event, batch.idAt(event.instanceId)); }}
    onContextMenu={(event: ThreeEvent<MouseEvent>) => { if (event.instanceId !== undefined) onContextMenu(event, batch.idAt(event.instanceId)); }}
  />)}{shadowBatches.map(batch => <primitive key={batch.mesh.uuid} object={batch.mesh} dispose={null} />)}</>;
}
export function InstancedVegetation({ plants, onSelect, onContextMenu }: Props) {
  const { graphicsSettings, shadowsEnabled } = useApp();
  const { camera, size } = useThree();
  const wind = useMemo(() => new VegetationWind(), []);
  const [details, setDetails] = useState<Map<string, TreeDetail>>(() => new Map(plants.map(plant => [plant.id,
    hasTreeLod(plant.plantSpeciesId!)
      ? chooseTreeDetail(treeScreenHeight(camera, size.height, new THREE.Vector3(...plant.position), treeHeight(plant.plantSpeciesId!, plant.scale?.[1] ?? 1)))
      : 0,
  ])));
  const detailsRef = useRef(details);
  const lastDetailUpdate = useRef(-Infinity);
  const settings = graphicsSettings.vegetation;
  useEffect(() => {
    const radians = settings.direction * Math.PI / 180;
    wind.configure({ strength: settings.windEnabled ? settings.strength : 0, speed: settings.speed, direction: new THREE.Vector2(Math.cos(radians), Math.sin(radians)) });
  }, [wind, settings]);
  useFrame(state => {
    wind.setTime(state.clock.elapsedTime);
    if (state.clock.elapsedTime - lastDetailUpdate.current < 0.2) return;
    lastDetailUpdate.current = state.clock.elapsedTime;
    const next = new Map<string, TreeDetail>();
    let changed = detailsRef.current.size !== plants.length;
    for (const plant of plants) {
      const previous = detailsRef.current.get(plant.id) ?? 0;
      const detail = hasTreeLod(plant.plantSpeciesId!)
        ? chooseTreeDetail(treeScreenHeight(camera, size.height, new THREE.Vector3(...plant.position), treeHeight(plant.plantSpeciesId!, plant.scale?.[1] ?? 1)), previous)
        : 0;
      next.set(plant.id, detail);
      if (previous !== detail || !detailsRef.current.has(plant.id)) changed = true;
    }
    if (changed) { detailsRef.current = next; setDetails(next); }
  });
  const cells = useMemo(() => {
    const result = new Map<string, { plants: Shape[]; detail: TreeDetail }>();
    for (const plant of plants) {
      const detail = details.get(plant.id) ?? 0;
      const key = [plant.plantSpeciesId, plant.plantVariation || '', Math.floor(plant.position[0] / 48), Math.floor(plant.position[2] / 48), detail].join('/');
      const cell = result.get(key) ?? { plants: [], detail }; cell.plants.push(plant); result.set(key, cell);
    }
    return result;
  }, [plants, details]);
  return <>{[...cells].map(([key, cell]) => <VegetationCell key={key} plants={cell.plants} detail={cell.detail} wind={wind} shadows={shadowsEnabled} onSelect={onSelect} onContextMenu={onContextMenu} />)}</>;
}
