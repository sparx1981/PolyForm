import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Shape } from '../../types';
import { useApp } from '../../AppContext';
import { curtainBillow, stepCurtainMotion } from '../../lib/interiors/curtainMotion';

/** Damped cloth response: pinned heading, progressively freer hem, wind and walk-by impulses. */
export function CurtainMesh({ shape, meshProps, selectionHighlight }: {
  shape: Shape; meshProps: any; selectionHighlight?: React.ReactNode;
}) {
  const { graphicsSettings, walkModePhase } = useApp();
  const mesh = useRef<THREE.Mesh>(null);
  const previousCamera = useRef<THREE.Vector3 | null>(null);
  const motion = useRef({ displacement: 0, velocity: 0, time: 0 });
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(shape.geometryData!.positions!, 3));
    if (shape.geometryData?.uvs) g.setAttribute('uv', new THREE.Float32BufferAttribute(shape.geometryData.uvs, 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    if (g.boundingSphere) g.boundingSphere.radius += 0.35;
    return g;
  }, [shape.geometryData]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const local = useMemo(() => new THREE.Vector3(), []);
  const height = Number(shape.customData?.semanticComponent?.params?.height ?? shape.args?.[1] ?? 2.2);
  useFrame(({ camera }, delta) => {
    if (!mesh.current) return;
    const state = motion.current;
    local.copy(camera.position); mesh.current.worldToLocal(local);
    const speed = walkModePhase === 'walking' && previousCamera.current ? Math.min(3, camera.position.distanceTo(previousCamera.current) / Math.max(delta, 0.001)) : 0;
    if (!previousCamera.current) previousCamera.current = camera.position.clone();
    previousCamera.current.copy(camera.position);
    const near = Math.max(0, 1 - Math.hypot(local.x, local.z) / 1.8) * (local.y > -0.2 && local.y < height + 0.6 ? 1 : 0);
    const wind = graphicsSettings.vegetation.windEnabled ? graphicsSettings.vegetation.strength : 0;
    stepCurtainMotion(state, delta, wind, graphicsSettings.vegetation.speed, near, speed);
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    const rest = shape.geometryData!.positions!;
    for (let i = 0; i < positions.count; i++) {
      const x = rest[i*3], y = rest[i*3+1], z = rest[i*3+2];
      // Rod and heading never move. Cloth billows into the room, away from the glass.
      const billow = curtainBillow(x, y, height, state);
      positions.setXYZ(i, x, y + Math.abs(billow) * 0.04, z + billow);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
  });
  return <group {...meshProps}>
    <mesh ref={mesh} geometry={geometry} castShadow={meshProps.castShadow} receiveShadow={meshProps.receiveShadow} userData={{ isShape: true, id: shape.id }}>
      <meshStandardMaterial color={shape.color} roughness={0.95} side={THREE.DoubleSide} />
    </mesh>
    {selectionHighlight}
  </group>;
}
