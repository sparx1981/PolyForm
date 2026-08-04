import React, { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useApp } from '../AppContext';

interface ParticleSystemProps {
  type: 'confetti' | 'fire' | 'smoke' | 'sparks' | 'magic_aura';
  position: [number, number, number];
  density: number;
  scale?: number;
  looping: boolean;
  playing: boolean;
}

const ParticleSystem: React.FC<ParticleSystemProps> = ({ type, position, density, scale = 1, looping, playing }) => {
  const pointsRef = useRef<THREE.Points>(null);
  const { clock } = useThree();

  const count = density;
  const [positions, rotations, colors, sizes, velocities, ages] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const rot = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const sz = new Float32Array(count);
    const vel = new Float32Array(count * 3);
    const ag = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      // Position
      pos[i * 3] = 0;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = 0;

      // Color calculation... (omitted for brevity in mental model but included in actual replacement)
      let c = new THREE.Color();
      if (type === 'fire') {
        c.setHSL(0.05 + Math.random() * 0.1, 1.0, 0.5);
      } else if (type === 'confetti') {
        c.setHSL(Math.random(), 0.7, 0.6);
      } else if (type === 'smoke') {
        const grey = 0.4 + Math.random() * 0.3;
        c.setRGB(grey, grey, grey);
      } else if (type === 'sparks') {
        c.setHSL(0.1, 1.0, 0.8);
      } else { // magic_aura
        c.setHSL(0.7 + Math.random() * 0.1, 0.8, 0.6);
      }
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;

      // Velocity - applying scale
      if (type === 'fire') {
        vel[i * 3] = (Math.random() - 0.5) * 0.02 * scale;
        vel[i * 3 + 1] = (0.05 + Math.random() * 0.05) * scale;
        vel[i * 3 + 2] = (Math.random() - 0.5) * 0.02 * scale;
      } else if (type === 'confetti') {
        vel[i * 3] = (Math.random() - 0.5) * 0.1 * scale;
        vel[i * 3 + 1] = (0.1 + Math.random() * 0.1) * scale;
        vel[i * 3 + 2] = (Math.random() - 0.5) * 0.1 * scale;
      } else if (type === 'smoke') {
        vel[i * 3] = (Math.random() - 0.5) * 0.01 * scale;
        vel[i * 3 + 1] = (0.02 + Math.random() * 0.03) * scale;
        vel[i * 3 + 2] = (Math.random() - 0.5) * 0.01 * scale;
      } else if (type === 'sparks') {
        vel[i * 3] = (Math.random() - 0.5) * 0.2 * scale;
        vel[i * 3 + 1] = (Math.random() * 0.2) * scale;
        vel[i * 3 + 2] = (Math.random() - 0.5) * 0.2 * scale;
      } else { // magic_aura
        vel[i * 3] = Math.sin(i) * 0.02 * scale;
        vel[i * 3 + 1] = (0.01 + Math.random() * 0.02) * scale;
        vel[i * 3 + 2] = Math.cos(i) * 0.02 * scale;
      }

      sz[i] = (Math.random() * 5 + 2) * scale;
      ag[i] = Math.random() * 100; // staggered start
    }
    return [pos, rot, col, sz, vel, ag];
  }, [count, type, scale]);

  useFrame((state, delta) => {
    if (!playing || !pointsRef.current) return;

    const points = pointsRef.current;
    const geometry = points.geometry as THREE.BufferGeometry;
    const posAttr = geometry.attributes.position as THREE.BufferAttribute;
    const ageAttr = geometry.attributes.age as THREE.BufferAttribute;

    for (let i = 0; i < count; i++) {
      let age = ageAttr.getX(i);
      age += delta * 50;

      if (age > 100) {
        if (looping) {
          age = 0;
          posAttr.setXYZ(i, 0, 0, 0);
        } else {
          // Stay dead
        }
      } else {
        const x = posAttr.getX(i) + velocities[i * 3];
        const y = posAttr.getY(i) + velocities[i * 3 + 1];
        const z = posAttr.getZ(i) + velocities[i * 3 + 2];
        
        // Add gravity/drag - applying scale to gravity
        if (type === 'confetti') {
          velocities[i * 3 + 1] -= 0.002 * scale; // scale gravity
        } else if (type === 'sparks') {
          velocities[i * 3 + 1] -= 0.005 * scale; // scale heavy gravity
        }
        
        posAttr.setXYZ(i, x, y, z);
      }
      ageAttr.setX(i, age);
    }
    posAttr.needsUpdate = true;
    ageAttr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} position={position}>
      <bufferGeometry>
        <bufferAttribute 
          attach="attributes-position" 
          count={count} 
          array={positions} 
          itemSize={3} 
        />
        <bufferAttribute 
          attach="attributes-color" 
          count={count} 
          array={colors} 
          itemSize={3} 
        />
        <bufferAttribute 
          attach="attributes-size" 
          count={count} 
          array={sizes} 
          itemSize={1} 
        />
        <bufferAttribute 
          attach="attributes-age" 
          count={count} 
          array={ages} 
          itemSize={1} 
        />
      </bufferGeometry>
      <pointsMaterial 
        size={0.1 * scale} 
        vertexColors 
        transparent 
        alphaTest={0.01}
        blending={type === 'smoke' ? THREE.NormalBlending : THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
};

export const Effects: React.FC = () => {
  const { animations } = useApp();

  return (
    <group>
      {animations.map(anim => (
        <ParticleSystem key={anim.id} {...anim} />
      ))}
    </group>
  );
};
