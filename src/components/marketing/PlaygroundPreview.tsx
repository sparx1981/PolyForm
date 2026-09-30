import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { PlaygroundObject } from '../../lib/playground/runnerCore';

function bounds(objects: PlaygroundObject[]): THREE.Box3 {
  const box = new THREE.Box3();
  for (const o of objects) {
    const [x, y, z] = o.position;
    const half = o.kind === 'cylinder' ? [Math.max(o.size[0], o.size[2]), o.size[1] / 2, Math.max(o.size[0], o.size[2])]
      : o.kind === 'sphere' ? [o.size[0], o.size[0], o.size[0]] : [o.size[0] / 2, o.size[1] / 2, o.size[2] / 2];
    const r = Math.abs(Math.sin(o.rotationY)) * Math.abs(half[0]! - half[2]!) ;
    box.expandByPoint(new THREE.Vector3(x - half[0]! - r, y - half[1]!, z - half[2]! - r));
    box.expandByPoint(new THREE.Vector3(x + half[0]! + r, y + half[1]!, z + half[2]! + r));
  }
  return box.isEmpty() ? new THREE.Box3(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 2, 2)) : box;
}

function FitCamera({ box }: { box: THREE.Box3 }) {
  const camera = useThree(s => s.camera);
  const controls = useThree(s => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  useEffect(() => {
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(1.5, size.length() / 2);
    camera.position.set(centre.x + radius * 1.5, centre.y + radius * 1.1, centre.z + radius * 1.9);
    camera.near = 0.1; camera.far = radius * 40; camera.updateProjectionMatrix();
    if (controls) { controls.target.copy(centre); controls.update(); } else camera.lookAt(centre);
  }, [box, camera, controls]);
  return null;
}

function roofGeometry(o: PlaygroundObject): THREE.BufferGeometry {
  const [w, h, d] = o.size;
  if (o.roofType === 'hip') {
    const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4);
    g.rotateY(Math.PI / 4);
    g.scale(w, h, d);
    return g;
  }
  if (o.roofType === 'parapet') return new THREE.BoxGeometry(w, h, d);
  const shape = new THREE.Shape([new THREE.Vector2(-w / 2, -h / 2), new THREE.Vector2(w / 2, -h / 2), new THREE.Vector2(0, h / 2)]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g;
}

function Item({ o }: { o: PlaygroundObject }) {
  const geometry = useMemo(() => {
    if (o.kind === 'roof') return roofGeometry(o);
    if (o.kind === 'cylinder') return new THREE.CylinderGeometry(o.size[2], o.size[0], o.size[1], 32);
    if (o.kind === 'sphere') return new THREE.SphereGeometry(o.size[0], 32, 20);
    return new THREE.BoxGeometry(o.size[0], o.size[1], o.size[2]);
  }, [o]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const color = useMemo(() => { try { return new THREE.Color(o.color); } catch { return new THREE.Color('#cbd5e1'); } }, [o.color]);
  return (
    <mesh geometry={geometry} position={o.position} rotation={[0, o.rotationY, 0]} castShadow receiveShadow>
      <meshStandardMaterial color={color} roughness={0.75} metalness={0.02} side={o.kind === 'roof' ? THREE.DoubleSide : THREE.FrontSide} />
    </mesh>
  );
}

/** The little 3D view under the Developers page playground. Loaded on demand (three.js is heavy). */
export default function PlaygroundPreview({ objects }: { objects: PlaygroundObject[] }) {
  const box = useMemo(() => bounds(objects), [objects]);
  const gridSize = useMemo(() => Math.max(8, Math.ceil(Math.max(...box.getSize(new THREE.Vector3()).toArray()) * 2)), [box]);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className="absolute inset-0">
      <Canvas shadows dpr={[1, 2]} camera={{ fov: 42, position: [6, 5, 8] }} gl={{ antialias: true }}>
        <color attach="background" args={['#eef3f8']} />
        <hemisphereLight args={['#ffffff', '#cbd5e1', 0.9]} />
        <directionalLight position={[8, 12, 6]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} />
        <gridHelper args={[gridSize, gridSize, '#94a3b8', '#d3dce6']} position={[0, -0.001, 0]} />
        {objects.map(o => <Item key={o.id} o={o} />)}
        <OrbitControls makeDefault enableDamping />
        <FitCamera box={box} />
      </Canvas>
    </div>
  );
}
