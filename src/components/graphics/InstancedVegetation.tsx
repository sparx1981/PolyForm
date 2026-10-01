import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { Shape } from '../../types';
import { useApp } from '../../AppContext';
import { VegetationBatch } from '../../lib/graphics/VegetationBatch';
import { VegetationWind } from '../../lib/graphics/VegetationWind';
import { loadPlantPrimitives, plantTint } from '../../lib/graphics/plantAssets';
import { chooseTreeDetail, hasTreeLod, treeHeight, treeScreenHeight, treeImpostorView, type TreeDetail } from '../../lib/graphics/treeLod';
import { loadTreeAtlas, attachTreeFade, createTreeViewUniforms, updateTreeView, TREE_CARD_START, treeCardRaycast } from '../../lib/graphics/treeImpostor';
interface Props {
    plants: Shape[];
    onSelect: (event: ThreeEvent<MouseEvent>, id: string) => void;
    onContextMenu: (event: ThreeEvent<MouseEvent>, id: string) => void;
}
function VegetationCell({ plants, wind, onSelect, onContextMenu, shadows, detail }: Props & {
    wind: VegetationWind;
    shadows: boolean;
    detail: TreeDetail;
}) {
    const { gl } = useThree();
    const view = useMemo(() => createTreeViewUniforms(), []);
    const transition = useRef<VegetationBatch[]>([]);
    const lastTransition = useRef(-Infinity);
    const transitionHeight = useRef(1);
    // A stable value keeps changes in unrelated cells/controls from rebuilding this cell.
    const placementsKey = JSON.stringify(plants.map(plant => [plant.id, plant.position, plant.rotation, plant.quaternion, plant.scale, plant.color]));
    const placements = useMemo(() => plants.map(plant => ({ id: plant.id, position: new THREE.Vector3(...plant.position), rotation: plant.quaternion ? new THREE.Quaternion(...plant.quaternion) : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(plant.rotation || [0, 0, 0]))), scale: new THREE.Vector3(...(plant.scale || [1, 1, 1])), color: plantTint(plant.plantSpeciesId!, plant.color) })), [placementsKey]);
    const [batches, setBatches] = useState<VegetationBatch[]>([]);
    const [shadowBatches, setShadowBatches] = useState<VegetationBatch[]>([]);
    const species = plants[0].plantSpeciesId!, variation = plants[0].plantVariation;
    const proxyShadows = shadows && detail < 2 && hasTreeLod(species);
    const proxyDetail: TreeDetail = detail === 0 ? 1 : 2;
    useEffect(() => {
        let cancelled = false;
        const owned: VegetationBatch[] = [];
        setBatches([]);
        setShadowBatches([]);
        const install = (primitives: Awaited<ReturnType<typeof loadPlantPrimitives>>, shadowPrimitives: Awaited<ReturnType<typeof loadPlantPrimitives>>, atlas = false, treeHeightValue = 1) => {
            if (cancelled)
                return;
            owned.forEach(b => b.dispose());
            owned.length = 0;
            transition.current = [];
            transitionHeight.current = treeHeightValue;
            const visible: VegetationBatch[] = [], shadowOnly: VegetationBatch[] = [];
            for (const [index, primitive] of primitives.entries()) {
                const batch = new VegetationBatch(primitive.geometry, primitive.material, wind, plants.length);
                batch.mesh.userData.presentationVegetation = true;
                batch.mesh.userData.plantIds = placements.map(p => p.id);
                batch.setInstances(placements);
                owned.push(batch);
                visible.push(batch);
                batch.mesh.castShadow = shadows && !proxyShadows && detail < 2;
                batch.mesh.receiveShadow = shadows;
                if (atlas) {
                    if (index === 0) {
                        batch.mesh.userData.isTreeImpostor = true;
                        treeCardRaycast(batch.mesh);
                    }
                    attachTreeFade(batch.mesh.material, view, treeHeightValue, index === 0);
                    if (index > 0)
                        transition.current.push(batch);
                }
            }
            for (const primitive of shadowPrimitives) {
                const batch = new VegetationBatch(primitive.geometry, primitive.material, wind, plants.length);
                batch.mesh.userData.presentationVegetation = true;
                batch.setInstances(placements);
                batch.mesh.material.colorWrite = false;
                batch.mesh.material.depthWrite = false;
                batch.mesh.raycast = () => { };
                owned.push(batch);
                shadowOnly.push(batch);
            }
            setBatches(visible);
            setShadowBatches(shadowOnly);
        };
        Promise.all([loadPlantPrimitives(species, variation, detail), proxyShadows ? loadPlantPrimitives(species, variation, proxyDetail) : Promise.resolve([])]).then(async ([primitives, shadowPrimitives]) => {
            if (cancelled)
                return;
            install(primitives, shadowPrimitives);
            if (detail === 3) {
                try {
                    const atlas = await loadTreeAtlas(gl, species);
                    install([atlas.primitive, ...primitives], [], true, atlas.height);
                    lastTransition.current = -Infinity;
                }
                catch (error) {
                    if (!cancelled)
                        console.warn('[Vegetation] Keeping distant tree geometry', species, error);
                }
            }
        });
        return () => { cancelled = true; transition.current = []; owned.forEach(batch => batch.dispose()); };
    }, [placementsKey, species, variation, detail, proxyShadows, proxyDetail, wind, gl, view]);
    useEffect(() => {
        for (const batch of batches) {
            batch.mesh.castShadow = shadows && !proxyShadows && detail < 2;
            batch.mesh.receiveShadow = shadows;
        }
        for (const batch of shadowBatches) {
            batch.mesh.castShadow = shadows;
            batch.mesh.receiveShadow = false;
        }
    }, [batches, shadowBatches, shadows, proxyShadows, detail]);
    useFrame(state => {
        if (state.clock.elapsedTime - lastTransition.current < .2)
            return;
        updateTreeView(view, state.camera, state.size.height);
        lastTransition.current = state.clock.elapsedTime;
        if (transition.current.length) {
            const subset = placements.filter(p => treeScreenHeight(state.camera, state.size.height, p.position, transitionHeight.current * Math.abs(p.scale.y)) > TREE_CARD_START);
            transition.current.forEach(batch => { batch.setInstances(subset); batch.mesh.userData.plantIds = subset.map(p => p.id); });
        }
    });
    return <>{batches.map(batch => <primitive key={batch.mesh.uuid} object={batch.mesh} dispose={null} onClick={(event: ThreeEvent<MouseEvent>) => { if (event.instanceId !== undefined)
            onSelect(event, batch.idAt(event.instanceId)); }} onContextMenu={(event: ThreeEvent<MouseEvent>) => { if (event.instanceId !== undefined)
            onContextMenu(event, batch.idAt(event.instanceId)); }}/>)}{shadowBatches.map(batch => <primitive key={batch.mesh.uuid} object={batch.mesh} dispose={null}/>)}</>;
}
export function InstancedVegetation({ plants, onSelect, onContextMenu }: Props) {
    const { graphicsSettings, shadowsEnabled } = useApp();
    const { camera, size } = useThree();
    const wind = useMemo(() => new VegetationWind(), []);
    const [details, setDetails] = useState<Map<string, TreeDetail>>(() => new Map(plants.map(plant => [plant.id,
        hasTreeLod(plant.plantSpeciesId!)
            ? chooseTreeDetail(treeScreenHeight(camera, size.height, new THREE.Vector3(...plant.position), treeHeight(plant.plantSpeciesId!, plant.scale?.[1] ?? 1)), 0, treeImpostorView(camera, new THREE.Vector3(...plant.position)))
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
        if (state.clock.elapsedTime - lastDetailUpdate.current < 0.2)
            return;
        lastDetailUpdate.current = state.clock.elapsedTime;
        const next = new Map<string, TreeDetail>();
        let changed = detailsRef.current.size !== plants.length;
        for (const plant of plants) {
            const previous = detailsRef.current.get(plant.id) ?? 0;
            const detail = hasTreeLod(plant.plantSpeciesId!)
                ? chooseTreeDetail(treeScreenHeight(camera, size.height, new THREE.Vector3(...plant.position), treeHeight(plant.plantSpeciesId!, plant.scale?.[1] ?? 1)), previous, treeImpostorView(camera, new THREE.Vector3(...plant.position)))
                : 0;
            next.set(plant.id, detail);
            if (previous !== detail || !detailsRef.current.has(plant.id))
                changed = true;
        }
        if (changed) {
            detailsRef.current = next;
            setDetails(next);
        }
    });
    const cells = useMemo(() => {
        const result = new Map<string, {
            plants: Shape[];
            detail: TreeDetail;
        }>();
        for (const plant of plants) {
            const detail = details.get(plant.id) ?? 0;
            const key = [plant.plantSpeciesId, plant.plantVariation || '', Math.floor(plant.position[0] / 48), Math.floor(plant.position[2] / 48), detail].join('/');
            const cell = result.get(key) ?? { plants: [], detail };
            cell.plants.push(plant);
            result.set(key, cell);
        }
        return result;
    }, [plants, details]);
    return <>{[...cells].map(([key, cell]) => <VegetationCell key={key} plants={cell.plants} detail={cell.detail} wind={wind} shadows={shadowsEnabled} onSelect={onSelect} onContextMenu={onContextMenu}/>)}</>;
}
