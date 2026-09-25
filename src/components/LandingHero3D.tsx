import React, { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/** A small house-and-garden scene for the landing page, turning slowly (still when motion is reduced). */

const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function Gable({ width, depth, rise, color }: { width: number; depth: number; rise: number; color: string }) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2, 0);
    shape.lineTo(width / 2, 0);
    shape.lineTo(0, rise);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    g.translate(0, 0, -depth / 2);
    return g;
  }, [width, depth, rise]);
  return <mesh geometry={geometry} castShadow><meshStandardMaterial color={color} roughness={0.8} /></mesh>;
}

function Wing({ position, width, depth, height, rotate = 0 }: { position: [number, number, number]; width: number; depth: number; height: number; rotate?: number }) {
  const windows = [-1, 1].flatMap(side => [-width / 4, width / 4].map(x => ({ x, side })));
  return (
    <group position={position} rotation={[0, rotate, 0]}>
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color="#f3efe7" roughness={0.9} />
      </mesh>
      {windows.map(({ x, side }, i) => (
        <group key={i}>
          <mesh position={[x, height * 0.3, side * (depth / 2 + 0.01)]}>
            <boxGeometry args={[0.9, 0.9, 0.04]} />
            <meshStandardMaterial color="#9cc3dd" roughness={0.15} metalness={0.2} />
          </mesh>
          <mesh position={[x, height * 0.74, side * (depth / 2 + 0.01)]}>
            <boxGeometry args={[0.9, 0.9, 0.04]} />
            <meshStandardMaterial color="#9cc3dd" roughness={0.15} metalness={0.2} />
          </mesh>
        </group>
      ))}
      <group position={[0, height, 0]}>
        <Gable width={width + 0.5} depth={depth + 0.5} rise={1.9} color="#334155" />
      </group>
    </group>
  );
}

function Tree({ position, scale = 1, blossom = false }: { position: [number, number, number]; scale?: number; blossom?: boolean }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.8, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.18, 1.6, 8]} />
        <meshStandardMaterial color="#6b4f3a" roughness={1} />
      </mesh>
      <mesh position={[0, 2.2, 0]} castShadow>
        <icosahedronGeometry args={[1.1, 0]} />
        <meshStandardMaterial color={blossom ? '#f2c4d0' : '#4f8f5b'} roughness={0.9} flatShading />
      </mesh>
    </group>
  );
}

function Fence({ from, to }: { from: [number, number]; to: [number, number] }) {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const posts = Math.round(length / 1.8);
  return (
    <group position={[from[0], 0, from[1]]} rotation={[0, -angle, 0]}>
      <mesh position={[length / 2, 0.55, 0]} castShadow>
        <boxGeometry args={[length, 0.9, 0.05]} />
        <meshStandardMaterial color="#8a5a3b" roughness={0.9} />
      </mesh>
      {Array.from({ length: posts + 1 }, (_, i) => (
        <mesh key={i} position={[(i * length) / posts, 0.6, 0]}>
          <boxGeometry args={[0.12, 1.2, 0.12]} />
          <meshStandardMaterial color="#6f4630" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function Scene() {
  const group = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (!reduceMotion && group.current) group.current.rotation.y += delta * 0.08;
  });
  return (
    <group ref={group} rotation={[0, -0.6, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[13, 64]} />
        <meshStandardMaterial color="#6fa35c" roughness={1} />
      </mesh>
      {/* Patio and path */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[1.5, 0.02, 3.4]} receiveShadow>
        <planeGeometry args={[5, 2.2]} />
        <meshStandardMaterial color="#cfc6b8" roughness={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-1.2, 0.02, 7]} receiveShadow>
        <planeGeometry args={[1.1, 6]} />
        <meshStandardMaterial color="#bdb4a6" roughness={0.9} />
      </mesh>
      {/* Pond */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[5.5, 0.03, 5.5]}>
        <circleGeometry args={[1.5, 40]} />
        <meshStandardMaterial color="#3b82a6" roughness={0.1} metalness={0.3} />
      </mesh>

      <Wing position={[0.5, 0, 0]} width={7} depth={4.4} height={5.2} />
      <Wing position={[-1.8, 0, -4.4]} width={5.4} depth={4} height={5.2} rotate={Math.PI / 2} />
      <mesh position={[-1.2, 1.05, 2.21]}>
        <boxGeometry args={[1, 2.1, 0.05]} />
        <meshStandardMaterial color="#1e3a5f" roughness={0.5} />
      </mesh>

      <Tree position={[6.5, 0, -3]} scale={1.3} />
      <Tree position={[-7.5, 0, 3]} scale={1.1} />
      <Tree position={[3.5, 0, 8]} blossom />
      <Tree position={[-6, 0, -6.5]} scale={0.9} />
      <Fence from={[-9, 10]} to={[9, 10]} />
      <Fence from={[9, 10]} to={[9, -6]} />
    </group>
  );
}

export default function LandingHero3D() {
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [15, 11, 17], fov: 38 }}
      onCreated={({ camera }) => camera.lookAt(0, 1.5, 0)}
      aria-label="A 3D house and garden, the kind of design PolyForm makes"
      role="img"
    >
      <color attach="background" args={['#e7eef3']} />
      <hemisphereLight args={['#ffffff', '#7b8f6a', 0.9]} />
      <directionalLight
        position={[10, 16, 8]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
      />
      <Scene />
    </Canvas>
  );
}
