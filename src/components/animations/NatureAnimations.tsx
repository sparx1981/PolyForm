import React, { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

interface BirdSystemProps {
  position: [number, number, number];
  density?: number; // count of birds (1 to 5)
  scale?: number;
  speed?: number;
  looping?: boolean;
  playing?: boolean;
  bodyColor?: string;
  breastColor?: string;
  beakColor?: string;
}

/**
 * BirdSystem: Realistic animated birds that take off from a tree perch
 * and fly smoothly up and out of the screen.
 */
export const BirdSystem: React.FC<BirdSystemProps> = ({
  position,
  density = 1,
  scale = 1,
  speed = 1,
  looping = true,
  playing = true,
  bodyColor = '#1e3a8a',
  breastColor = '#ea580c',
  beakColor = '#f59e0b',
}) => {
  const groupRef = useRef<THREE.Group>(null);
  // Head and tail shade off the body color instead of their own pickers, so the whole
  // bird stays coherent when only "body colour" is changed.
  const headColor = useMemo(() => new THREE.Color(bodyColor).offsetHSL(0, 0, 0.08).getStyle(), [bodyColor]);
  const tailColor = useMemo(() => new THREE.Color(bodyColor).offsetHSL(0, 0, -0.18).getStyle(), [bodyColor]);
  const birdCount = Math.max(1, Math.min(6, Math.round(density <= 10 ? density : Math.max(1, density / 250))));

  // Pre-generate bird instances with slightly staggered offsets and unique trajectories
  const birdData = useMemo(() => {
    return Array.from({ length: birdCount }, (_, i) => ({
      delay: i * 1.8,
      headingAngle: (i * 0.35) - 0.2, // flight direction
      climbRate: 0.35 + (i % 3) * 0.1,
      swayFreq: 1.2 + (i % 4) * 0.3,
      speedMult: 0.9 + (i % 3) * 0.2,
      wingPhase: i * 1.5,
      birdScale: (0.35 + (i % 2) * 0.08) * scale,
    }));
  }, [birdCount, scale]);

  const birdRefs = useRef<(THREE.Group | null)[]>([]);
  const leftWingRefs = useRef<(THREE.Group | null)[]>([]);
  const rightWingRefs = useRef<(THREE.Group | null)[]>([]);

  useFrame((state) => {
    if (!playing) return;
    const time = state.clock.getElapsedTime() * (speed || 1);

    birdData.forEach((data, i) => {
      const bird = birdRefs.current[i];
      const leftWing = leftWingRefs.current[i];
      const rightWing = rightWingRefs.current[i];
      if (!bird || !leftWing || !rightWing) return;

      const cycleDuration = 14.0; // 14 seconds per flight cycle
      let t = (time - data.delay) % cycleDuration;
      if (t < 0) t += cycleDuration;

      // Phase 0: Perched on tree (t < 1.0s)
      // Phase 1: Takeoff burst & steep climb (1.0s <= t < 4.0s)
      // Phase 2: Soaring forward and out of screen (4.0s <= t < 12.0s)
      // Phase 3: Out of screen (12.0s <= t < 14.0s)

      if (!looping && (time - data.delay) > 12.0) {
        bird.visible = false;
        return;
      }

      bird.visible = true;

      let localX = 0;
      let localY = 0;
      let localZ = 0;
      let pitch = 0;
      let yaw = data.headingAngle;
      let roll = 0;
      let flap = 0;

      if (t < 1.2) {
        // Perched on branch, gentle breathing/bobbing
        localX = Math.sin(t * 2.0) * 0.02;
        localY = Math.sin(t * 3.5) * 0.02;
        localZ = 0;
        pitch = 0.1;
        yaw = data.headingAngle + Math.sin(t * 1.5) * 0.1;
        roll = 0;
        flap = 0.05; // wings folded
      } else {
        const flightTime = t - 1.2;
        const forwardDist = Math.pow(flightTime, 1.25) * 4.2 * data.speedMult;
        const climbDist = Math.pow(flightTime, 0.95) * 2.8 * data.climbRate;
        const lateralSway = Math.sin(flightTime * data.swayFreq) * 1.5;

        // Calculate world flight vector
        const cosYaw = Math.cos(data.headingAngle);
        const sinYaw = Math.sin(data.headingAngle);

        localX = sinYaw * forwardDist + cosYaw * lateralSway;
        localZ = cosYaw * forwardDist - sinYaw * lateralSway;
        localY = climbDist;

        // Dynamics: pitch up during climb, roll into lateral turns
        pitch = Math.max(-0.2, 0.45 - flightTime * 0.06);
        roll = Math.cos(flightTime * data.swayFreq) * -0.35;
        yaw = data.headingAngle + Math.cos(flightTime * data.swayFreq) * 0.2;

        // Rapid flapping during takeoff, gliding intervals later
        const isGliding = flightTime > 4.0 && (Math.sin(flightTime * 1.8) > 0.4);
        if (isGliding) {
          flap = Math.sin(flightTime * 2.0) * 0.15 + 0.1;
        } else {
          flap = Math.sin(flightTime * 18.0 + data.wingPhase) * 0.75;
        }
      }

      bird.position.set(position[0] + localX, position[1] + localY, position[2] + localZ);
      bird.rotation.set(pitch, yaw, roll, 'YXZ');

      // Animate wings flapping up/down
      leftWing.rotation.z = flap;
      rightWing.rotation.z = -flap;
    });
  });

  return (
    <group ref={groupRef}>
      {birdData.map((data, i) => (
        <group
          key={i}
          ref={(el) => (birdRefs.current[i] = el)}
          position={position}
          scale={[data.birdScale, data.birdScale, data.birdScale]}
        >
          {/* Bird Body: Aerodynamic fuselage */}
          <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <coneGeometry args={[0.18, 0.65, 8]} />
            <meshStandardMaterial color={bodyColor} roughness={0.6} />
          </mesh>

          {/* Bird Breast / Belly */}
          <mesh position={[0, -0.06, 0.08]} scale={[0.85, 0.75, 1.1]}>
            <sphereGeometry args={[0.16, 8, 8]} />
            <meshStandardMaterial color={breastColor} roughness={0.8} />
          </mesh>

          {/* Bird Head */}
          <mesh position={[0, 0.14, 0.28]} castShadow>
            <sphereGeometry args={[0.13, 8, 8]} />
            <meshStandardMaterial color={headColor} roughness={0.6} />
          </mesh>

          {/* Bird Beak */}
          <mesh position={[0, 0.12, 0.44]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.04, 0.14, 4]} />
            <meshStandardMaterial color={beakColor} roughness={0.4} />
          </mesh>

          {/* Tail Feathers */}
          <mesh position={[0, 0.04, -0.42]} rotation={[-0.2, 0, 0]}>
            <boxGeometry args={[0.16, 0.02, 0.35]} />
            <meshStandardMaterial color={tailColor} roughness={0.7} />
          </mesh>

          {/* Left Wing with Pivot */}
          <group position={[-0.12, 0.05, 0.06]} ref={(el) => (leftWingRefs.current[i] = el)}>
            <mesh position={[-0.32, 0, 0]} rotation={[0, -0.15, 0]}>
              <boxGeometry args={[0.55, 0.02, 0.26]} />
              <meshStandardMaterial color={bodyColor} roughness={0.7} />
            </mesh>
          </group>

          {/* Right Wing with Pivot */}
          <group position={[0.12, 0.05, 0.06]} ref={(el) => (rightWingRefs.current[i] = el)}>
            <mesh position={[0.32, 0, 0]} rotation={[0, 0.15, 0]}>
              <boxGeometry args={[0.55, 0.02, 0.26]} />
              <meshStandardMaterial color={bodyColor} roughness={0.7} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
};

interface BeeSystemProps {
  position: [number, number, number];
  density?: number; // count of bees (3 to 30)
  scale?: number;
  speed?: number;
  playing?: boolean;
}

/**
 * BeeSystem: A lively group of bees buzzing and hovering realistically
 * around flowers or garden foliage.
 */
export const BeeSystem: React.FC<BeeSystemProps> = ({
  position,
  density = 8,
  scale = 1,
  speed = 1,
  playing = true,
}) => {
  const beeCount = Math.max(3, Math.min(35, Math.round(density <= 50 ? density : Math.max(3, density / 100))));

  const beesData = useMemo(() => {
    return Array.from({ length: beeCount }, (_, i) => ({
      baseRadius: 0.35 + (i % 5) * 0.18,
      speed: (1.4 + (i % 4) * 0.4) * (speed || 1),
      orbitPhase: (i / beeCount) * Math.PI * 2,
      heightOffset: -0.15 + (i % 6) * 0.12,
      flutterOffset: i * 2.3,
      size: (0.07 + (i % 3) * 0.015) * scale,
    }));
  }, [beeCount, scale, speed]);

  const beeRefs = useRef<(THREE.Group | null)[]>([]);
  const wingLeftRefs = useRef<(THREE.Mesh | null)[]>([]);
  const wingRightRefs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame((state) => {
    if (!playing) return;
    const time = state.clock.getElapsedTime();

    beesData.forEach((b, i) => {
      const bee = beeRefs.current[i];
      const wL = wingLeftRefs.current[i];
      const wR = wingRightRefs.current[i];
      if (!bee || !wL || !wR) return;

      const t = time * b.speed + b.orbitPhase;

      // Realistic Lissajous / pseudo-Brownian wandering around plant flowers
      const x = Math.cos(t * 0.8) * b.baseRadius + Math.sin(t * 2.3) * 0.15;
      const z = Math.sin(t * 0.7) * b.baseRadius + Math.cos(t * 1.9) * 0.15;
      const y = b.heightOffset + Math.sin(t * 3.2 + b.flutterOffset) * 0.22 + Math.cos(t * 1.5) * 0.08;

      // Velocity estimation for heading orientation
      const dt = 0.05;
      const tNext = t + dt * b.speed;
      const xNext = Math.cos(tNext * 0.8) * b.baseRadius + Math.sin(tNext * 2.3) * 0.15;
      const zNext = Math.sin(tNext * 0.7) * b.baseRadius + Math.cos(tNext * 1.9) * 0.15;
      const yNext = b.heightOffset + Math.sin(tNext * 3.2 + b.flutterOffset) * 0.22 + Math.cos(tNext * 1.5) * 0.08;

      const heading = Math.atan2(xNext - x, zNext - z);
      const pitch = -Math.atan2(yNext - y, Math.hypot(xNext - x, zNext - z));

      bee.position.set(position[0] + x, position[1] + y, position[2] + z);
      bee.rotation.set(pitch, heading, Math.sin(t * 5.0) * 0.2, 'YXZ');

      // Ultra-fast wing vibration (50Hz+)
      const wingVibe = Math.sin(time * 65.0 + b.flutterOffset) * 0.85;
      wL.rotation.z = wingVibe;
      wR.rotation.z = -wingVibe;
    });
  });

  return (
    <group position={[0, 0, 0]}>
      {beesData.map((b, i) => (
        <group
          key={i}
          ref={(el) => (beeRefs.current[i] = el)}
          position={position}
          scale={[b.size, b.size, b.size]}
        >
          {/* Yellow & Black Striped Bee Abdomen */}
          <mesh position={[0, 0, -0.06]}>
            <sphereGeometry args={[0.42, 8, 8]} />
            <meshStandardMaterial color="#eab308" roughness={0.7} />
          </mesh>

          {/* Black Stripes */}
          <mesh position={[0, 0, -0.04]} scale={[1.02, 1.02, 0.35]}>
            <sphereGeometry args={[0.42, 8, 8]} />
            <meshStandardMaterial color="#171717" roughness={0.8} />
          </mesh>
          <mesh position={[0, 0, -0.16]} scale={[0.95, 0.95, 0.3]}>
            <sphereGeometry args={[0.42, 8, 8]} />
            <meshStandardMaterial color="#171717" roughness={0.8} />
          </mesh>

          {/* Thorax (Fuzzy Dark Honey Brown) */}
          <mesh position={[0, 0.04, 0.16]}>
            <sphereGeometry args={[0.36, 8, 8]} />
            <meshStandardMaterial color="#78350f" roughness={0.9} />
          </mesh>

          {/* Head & Eyes */}
          <mesh position={[0, 0.06, 0.38]}>
            <sphereGeometry args={[0.24, 8, 8]} />
            <meshStandardMaterial color="#0a0a0a" roughness={0.5} />
          </mesh>

          {/* Left Wing (Translucent shimmering gossamer) */}
          <mesh
            ref={(el) => (wingLeftRefs.current[i] = el)}
            position={[-0.26, 0.28, 0.12]}
            rotation={[0.2, -0.3, 0]}
          >
            <boxGeometry args={[0.65, 0.02, 0.32]} />
            <meshStandardMaterial
              color="#e0f2fe"
              transparent
              opacity={0.65}
              roughness={0.1}
              metalness={0.1}
              side={THREE.DoubleSide}
            />
          </mesh>

          {/* Right Wing */}
          <mesh
            ref={(el) => (wingRightRefs.current[i] = el)}
            position={[0.26, 0.28, 0.12]}
            rotation={[0.2, 0.3, 0]}
          >
            <boxGeometry args={[0.65, 0.02, 0.32]} />
            <meshStandardMaterial
              color="#e0f2fe"
              transparent
              opacity={0.65}
              roughness={0.1}
              metalness={0.1}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
};
