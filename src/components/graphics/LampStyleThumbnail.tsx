import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { createLampGeometry } from '../../lib/landscapeGeometry';

function RotatingLamp({ geometry, center }: { geometry: THREE.BufferGeometry; center: THREE.Vector3 }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => { if (ref.current) ref.current.rotation.y += delta * 0.5; });
  return (
    <mesh ref={ref} geometry={geometry} position={[-center.x, -center.y, -center.z]}>
      <meshStandardMaterial vertexColors roughness={0.6} metalness={0.15} />
    </mesh>
  );
}

/** Small live-rendered preview of one lamp style, so a user sees the actual model shape
 * before applying it - the same pattern used for Surface depth's pattern thumbnails.
 * Frames off the geometry's own bounding sphere (as CustomToolbarOverlay's
 * TilePreviewThumbnail does) rather than guessed dimensions, so it works for any style's
 * actual built size - including a bollard's much shorter post or the cobra arm's sideways
 * reach - without per-style camera tuning. */
export function LampStyleThumbnail({ styleId, height = 3.2, size = 96 }: { styleId: string; height?: number; size?: number }) {
  const geometry = useMemo(() => createLampGeometry(height, styleId), [styleId, height]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  geometry.computeBoundingSphere();
  const radius = geometry.boundingSphere?.radius || 1;
  const center = geometry.boundingSphere?.center || new THREE.Vector3();
  const dist = Math.max(radius, 0.01) * 2.6;

  return (
    <Canvas
      className="rounded pointer-events-none"
      style={{ width: size, height: size }}
      gl={{ antialias: true, alpha: true }}
      camera={{ position: [dist * 0.7, dist * 0.7, dist * 0.7], fov: 35 }}
    >
      <ambientLight intensity={0.9} />
      <directionalLight position={[2, 3, 2]} intensity={1} />
      <RotatingLamp geometry={geometry} center={center} />
    </Canvas>
  );
}
