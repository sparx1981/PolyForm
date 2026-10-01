import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Shape } from '../../types';
import { useApp } from '../../AppContext';
import { createCurtainPanels, CurtainCloth, relaxCurtainPositions } from '../../lib/interiors/curtainCloth';
import { curtainTerrain, curtainWind } from '../../lib/interiors/curtainWind';

export function CurtainMesh({ shape, meshProps, selectionHighlight }: {
  shape: Shape; meshProps: any; selectionHighlight?: React.ReactNode;
}) {
  const { graphicsSettings, walkModePhase, shapes } = useApp();
  const group = useRef<THREE.Group>(null);
  const previousCamera = useRef<THREE.Vector3 | null>(null);
  const params = shape.customData?.semanticComponent?.params;
  const width = Number(params?.width ?? shape.args?.[0] ?? 2);
  const height = Number(params?.height ?? shape.args?.[1] ?? 2.2);
  const openAmount = Number(params?.openAmount ?? 0.15);
  const fullness = Number(params?.fullness ?? 1.8);
  const foldDepth = Number(params?.foldDepth ?? 0.065);
  const bakedStrength = Number(shape.customData?.simulationBake?.strength ?? 0);
  // Native parametric curtains are rebuilt from their saved dimensions, upgrading older folds too.
  const panels = useMemo(() => {
    const result = createCurtainPanels({ width, height, openAmount, fullness, foldDepth });
    if (bakedStrength) for (const panel of result) {
      relaxCurtainPositions(panel.getAttribute('position').array as Float32Array, width, height, bakedStrength);
      panel.computeVertexNormals();
    }
    return result;
  }, [width, height, openAmount, fullness, foldDepth, bakedStrength]);
  const cloth = useMemo(() => panels.map(panel => new CurtainCloth(panel)), [panels]);
  useEffect(() => () => panels.forEach(panel => panel.dispose()), [panels]);
  const terrain = useMemo(() => curtainTerrain(shapes, shape.position), [shapes, shape.position]);
  const vectors = useMemo(() => ({ camera: new THREE.Vector3(), wind: new THREE.Vector3(), rotation: new THREE.Quaternion() }), []);
  useFrame(({ camera }, delta) => {
    if (!group.current) return;
    vectors.camera.copy(camera.position); group.current.worldToLocal(vectors.camera);
    const speed = walkModePhase === 'walking' && previousCamera.current
      ? Math.min(3, camera.position.distanceTo(previousCamera.current) / Math.max(delta, 0.001)) : 0;
    if (!previousCamera.current) previousCamera.current = camera.position.clone();
    previousCamera.current.copy(camera.position);
    const wind = curtainWind(graphicsSettings, terrain);
    group.current.getWorldQuaternion(vectors.rotation).invert();
    vectors.wind.set(wind.x, 0, wind.z).applyQuaternion(vectors.rotation);
    const localWind = { x: vectors.wind.x, z: vectors.wind.z, speed: wind.speed };
    const walker = { x: vectors.camera.x, y: vectors.camera.y, z: vectors.camera.z, speed };
    for (const panel of cloth) panel.update(delta, localWind, walker);
  });
  return <group {...meshProps} ref={group}>
    {panels.map((geometry, index) => <mesh key={index} geometry={geometry} castShadow={meshProps.castShadow} receiveShadow={meshProps.receiveShadow} userData={{ isShape: true, id: shape.id }}>
      <meshPhysicalMaterial color={shape.color} roughness={0.96} sheen={0.65} sheenRoughness={0.85} sheenColor={shape.color} side={THREE.DoubleSide} />
    </mesh>)}
    <mesh position={[0, height + 0.055, -0.01]} userData={{ isShape: true, id: shape.id }}>
      <boxGeometry args={[width + 0.12, 0.035, 0.035]} />
      <meshStandardMaterial color="#615c54" metalness={0.65} roughness={0.35} />
    </mesh>
    {selectionHighlight}
  </group>;
}
