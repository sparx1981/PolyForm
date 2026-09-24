import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { inject } from '../../lib/graphics/shaderHooks';

export type FlockBirdType = 'starling' | 'geese' | 'seagull';

export const FLOCK_DEFAULTS: Record<FlockBirdType, { count: number; altitude: number; maxCount: number }> = {
  starling: { count: 120, altitude: 45, maxCount: 400 },
  geese: { count: 15, altitude: 70, maxCount: 60 },
  seagull: { count: 12, altitude: 35, maxCount: 60 },
};

interface FlockSystemProps {
  id: string;
  position: [number, number, number];
  count: number;
  altitude: number;
  birdType: FlockBirdType;
  scale?: number;
  speed?: number;
  looping?: boolean;
  playing?: boolean;
}

/** How each kind of bird looks and flies. */
interface BirdSpec {
  /** Wingspan in metres at scale 1. */
  span: number;
  /** Cruising ground speed, m/s. */
  cruise: number;
  /** Wing beats per second and flap amplitude (radians). */
  beatRate: number;
  beatAmplitude: number;
  body: string; wing: string; accent: string;
}

const SPECS: Record<FlockBirdType, BirdSpec> = {
  // Small, dark, fast wing beats.
  starling: { span: 0.45, cruise: 13, beatRate: 11, beatAmplitude: 0.55, body: '#16161b', wing: '#1f1f26', accent: '#34343e' },
  // Large, slow deep beats; dark neck and head (Canada goose).
  geese: { span: 1.6, cruise: 16, beatRate: 3.2, beatAmplitude: 0.5, body: '#8a7f72', wing: '#6e645a', accent: '#1c1917' },
  // Long narrow crooked wings, white body, grey mantle, black tips; mostly gliding.
  seagull: { span: 1.3, cruise: 8, beatRate: 3.6, beatAmplitude: 0.45, body: '#f5f5f4', wing: '#b5b0aa', accent: '#1c1917' },
};

/** The pass across the sky: the flock enters this far from its placed point and leaves as far beyond. */
const PASS_HALF_LENGTH = 260;

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

function seeded(seed: number) {
  let state = Math.floor(seed * 4294967296) >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * A low-poly bird facing +z with wings along x. Each wing vertex carries its side (aWing = -1 or
 * 1, 0 on the body) and how far out along the wing it is (aSpan), so the shader can flap it.
 */
function createBirdGeometry(type: FlockBirdType): THREE.BufferGeometry {
  const spec = SPECS[type];
  const positions: number[] = [];
  const colors: number[] = [];
  const wing: number[] = [];
  const spanAttr: number[] = [];
  const body = new THREE.Color(spec.body), wingColor = new THREE.Color(spec.wing), accent = new THREE.Color(spec.accent);
  const tri = (a: number[], b: number[], c: number[], color: THREE.Color, side = 0, spans: number[] = [0, 0, 0]) => {
    for (const [i, p] of [a, b, c].entries()) {
      positions.push(p[0], p[1], p[2]);
      colors.push(color.r, color.g, color.b);
      wing.push(side);
      spanAttr.push(spans[i]);
    }
  };
  const half = spec.span / 2;
  const L = spec.span * (type === 'geese' ? 0.62 : type === 'seagull' ? 0.36 : 0.42); // body length
  const W = spec.span * 0.07; // body half width
  // Body: a stretched diamond.
  const nose = [0, 0, L * 0.5], tail = [0, 0, -L * 0.5], top = [0, W * 0.8, 0], bottom = [0, -W, 0], left = [-W, 0, 0], right = [W, 0, 0];
  for (const [a, b] of [[left, top], [top, right], [right, bottom], [bottom, left]]) {
    tri(nose, a, b, body);
    tri(tail, b, a, body);
  }
  if (type === 'geese') {
    // Long dark neck and head reaching forward.
    const neckBase = [0, W * 0.3, L * 0.45], head = [0, W * 0.9, L * 0.95];
    tri([-W * 0.4, 0, L * 0.4], neckBase, head, accent);
    tri([W * 0.4, 0, L * 0.4], head, neckBase, accent);
  }
  // Tail fan.
  tri([-W * 1.4, 0, -L * 0.75], [0, 0, -L * 0.35], [W * 1.4, 0, -L * 0.75], type === 'geese' ? accent : body);

  // Wings: inner and outer panels, with a crook (dihedral) for gulls.
  const chordRoot = spec.span * (type === 'geese' ? 0.24 : type === 'seagull' ? 0.17 : 0.2);
  const chordTip = chordRoot * (type === 'starling' ? 0.25 : 0.45);
  const elbow = 0.45;
  const innerRise = type === 'seagull' ? 0.12 : 0.03, outerRise = type === 'seagull' ? -0.08 : 0.0;
  for (const side of [-1, 1]) {
    const ex = side * half * elbow, tx = side * half;
    const ey = half * elbow * innerRise, ty = ey + half * (1 - elbow) * outerRise;
    const rootFront = [side * W * 0.5, 0, chordRoot * 0.45], rootBack = [side * W * 0.5, 0, -chordRoot * 0.55];
    const elbowFront = [ex, ey, chordRoot * 0.5], elbowBack = [ex, ey, -chordRoot * 0.5];
    // Swept, pointed tip.
    const tipFront = [tx, ty, -chordRoot * 0.1], tipBack = [tx * 0.97, ty, -chordRoot * 0.1 - chordTip];
    const outer = type === 'seagull' ? accent : wingColor;
    tri(rootFront, elbowFront, elbowBack, wingColor, side, [0, elbow, elbow]);
    tri(rootFront, elbowBack, rootBack, wingColor, side, [0, elbow, 0]);
    tri(elbowFront, tipFront, tipBack, outer, side, [elbow, 1, 1]);
    tri(elbowFront, tipBack, elbowBack, type === 'seagull' ? wingColor : outer, side, [elbow, 1, elbow]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
  geometry.setAttribute('aSpan', new THREE.Float32BufferAttribute(spanAttr, 1));
  geometry.computeVertexNormals();
  return geometry;
}

function createBirdMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, flatShading: true });
  material.onBeforeCompile = shader => {
    shader.vertexShader = `attribute float aWing;\nattribute float aSpan;\nattribute float aFlap;\n` + shader.vertexShader;
    // Each wing rotates up and down about the body's long axis; the outer panel swings further,
    // so the wing bends through the beat instead of flapping like a board.
    shader.vertexShader = inject(shader.vertexShader, '#include <begin_vertex>', `
      vec3 transformed = vec3(position);
      if (abs(aWing) > 0.5) {
        float a = aFlap * aWing * (1.0 + 0.7 * aSpan * aSpan);
        float c = cos(a), s = sin(a);
        transformed.xy = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
      }
    `);
  };
  material.customProgramCacheKey = () => 'polyform-flock-bird-v1';
  return material;
}

interface BirdState {
  seed: number;
  /** Starlings: home offset in the cloud. Geese: slot in the V. Gulls: circling radius/phase. */
  a: THREE.Vector3;
  b: number;
  c: number;
  beatPhase: number;
  prev: THREE.Vector3;
  yaw: number;
  roll: number;
  glide: number;
}

const _pos = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _obj = new THREE.Object3D();
const _right = new THREE.Vector3();
const _dir = new THREE.Vector3();

/**
 * A flock crossing the sky high above the scene: starlings swirl in a shape-shifting
 * murmuration, geese hold a V formation with steady deep wing beats, seagulls drift across in
 * loose soaring circles, mostly gliding with the odd burst of flaps.
 */
export const FlockSystem: React.FC<FlockSystemProps> = ({
  id, position, count, altitude, birdType, scale = 1, speed = 1, looping = true, playing = true,
}) => {
  const spec = SPECS[birdType];
  const birdCount = Math.max(1, Math.min(FLOCK_DEFAULTS[birdType].maxCount, Math.round(count)));
  const heading = useMemo(() => hashString(id) * Math.PI * 2, [id]);
  const geometry = useMemo(() => {
    const g = createBirdGeometry(birdType);
    g.setAttribute('aFlap', new THREE.InstancedBufferAttribute(new Float32Array(birdCount), 1));
    return g;
  }, [birdType, birdCount]);
  const material = useMemo(() => createBirdMaterial(), []);
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geometry, material, birdCount);
    m.frustumCulled = false;
    m.castShadow = false;
    m.raycast = () => {};
    m.name = 'flock-birds';
    return m;
  }, [geometry, material, birdCount]);
  useEffect(() => () => { geometry.dispose(); mesh.dispose(); }, [geometry, mesh]);
  useEffect(() => () => material.dispose(), [material]);

  const birds = useMemo<BirdState[]>(() => {
    const rand = seeded(hashString(id + birdType));
    return Array.from({ length: birdCount }, (_, i) => {
      const a = new THREE.Vector3();
      let b = 0, c = 0;
      if (birdType === 'starling') {
        // A flattened ellipsoidal cloud.
        const u = rand() * Math.PI * 2, v = Math.acos(2 * rand() - 1), r = Math.cbrt(rand());
        a.set(Math.sin(v) * Math.cos(u) * r * 22, Math.cos(v) * r * 7, Math.sin(v) * Math.sin(u) * r * 14);
      } else if (birdType === 'geese') {
        // V slots: several Vs for big skeins, each led by one bird.
        const perV = 15;
        const group = Math.floor(i / perV), k = i % perV;
        const rank = Math.ceil(k / 2), side = k === 0 ? 0 : k % 2 ? 1 : -1;
        const spacing = spec.span * scale * 1.6;
        a.set(side * rank * spacing * 0.9 + group * spacing * 6, (rand() - 0.5) * 0.6, -rank * spacing * 1.1 - group * spacing * 9);
      } else {
        // Each gull circles its own thermal within the loose group.
        a.set((rand() - 0.5) * 70, (rand() - 0.5) * 14, (rand() - 0.5) * 50);
        b = 8 + rand() * 16; // circling radius
        c = (rand() < 0.5 ? -1 : 1) * (0.12 + rand() * 0.12); // angular speed, rad/s
      }
      return { seed: rand(), a, b, c, beatPhase: rand() * Math.PI * 2, prev: new THREE.Vector3(NaN, 0, 0), yaw: NaN, roll: 0, glide: 0 };
    });
  }, [id, birdType, birdCount, spec.span, scale]);

  const timeRef = useRef(0);
  useFrame((_, rawDelta) => {
    if (!playing) return;
    const delta = Math.min(rawDelta, 0.1);
    timeRef.current += delta * (speed || 1);
    const t = timeRef.current;
    const passLength = PASS_HALF_LENGTH * 2;
    const travelled = t * spec.cruise;
    if (!looping && travelled > passLength) { mesh.visible = false; return; }
    mesh.visible = true;
    const along = (travelled % passLength) - PASS_HALF_LENGTH;
    const dirX = Math.sin(heading), dirZ = Math.cos(heading);
    // Right-hand side of the flight direction.
    _right.set(dirZ, 0, -dirX);
    const cx = position[0] + dirX * along, cz = position[2] + dirZ * along;
    const cy = position[1] + altitude;
    const flap = geometry.getAttribute('aFlap') as THREE.InstancedBufferAttribute;
    const size = scale;
    const wrapped = along < -PASS_HALF_LENGTH + spec.cruise * delta * 2;

    birds.forEach((bird, i) => {
      let beat = spec.beatAmplitude * Math.sin(bird.beatPhase + t * spec.beatRate * Math.PI * 2 * (0.92 + bird.seed * 0.16));
      if (birdType === 'starling') {
        // The cloud keeps folding and rolling: offsets flow through slow travelling waves.
        const o = bird.a;
        const wx = o.x + 9 * Math.sin(t * 0.35 + o.z * 0.09 + o.y * 0.05) + 5 * Math.sin(t * 0.61 + o.y * 0.2);
        const wy = o.y + 4 * Math.sin(t * 0.47 + o.x * 0.07) + 2 * Math.cos(t * 0.9 + o.z * 0.1);
        const wz = o.z + 7 * Math.cos(t * 0.29 + o.x * 0.06) + 3 * Math.sin(t * 0.73 + o.y * 0.15);
        const spin = t * 0.12;
        const rx = wx * Math.cos(spin) - wz * Math.sin(spin), rz = wx * Math.sin(spin) + wz * Math.cos(spin);
        _pos.set(cx + _right.x * rx + dirX * rz, cy + wy, cz + _right.z * rx + dirZ * rz);
      } else if (birdType === 'geese') {
        const o = bird.a;
        const bob = Math.sin(t * 0.8 + bird.seed * 6) * 0.35;
        const sway = Math.sin(t * 0.25 + bird.seed * 3) * 0.6;
        _pos.set(cx + _right.x * (o.x + sway) + dirX * o.z, cy + o.y + bob, cz + _right.z * (o.x + sway) + dirZ * o.z);
      } else {
        const o = bird.a;
        const angle = bird.seed * Math.PI * 2 + t * bird.c;
        const lx = o.x + Math.cos(angle) * bird.b, lz = o.z + Math.sin(angle) * bird.b;
        _pos.set(cx + _right.x * lx + dirX * lz, cy + o.y + Math.sin(angle * 2) * 1.5, cz + _right.z * lx + dirZ * lz);
        // Mostly gliding with wings held in a shallow crook; occasional bursts of flaps.
        const burst = Math.sin(t * 0.35 + bird.seed * 20) > 0.75 ? 1 : 0;
        bird.glide += ((1 - burst) - bird.glide) * Math.min(1, delta * 3);
        beat = beat * (1 - bird.glide) + 0.08 * bird.glide;
      }

      // Face the direction of travel; bank into turns.
      if (Number.isNaN(bird.prev.x) || wrapped) bird.prev.copy(_pos).addScaledVector(_dir.set(dirX, 0, dirZ), -0.1);
      _vel.copy(_pos).sub(bird.prev);
      if (_vel.lengthSq() < 1e-8) _vel.set(dirX, 0, dirZ);
      const yaw = Math.atan2(_vel.x, _vel.z);
      const horizontal = Math.hypot(_vel.x, _vel.z);
      const pitch = -Math.atan2(_vel.y, Math.max(horizontal, 1e-6));
      const prevYaw = Number.isNaN(bird.yaw) || wrapped ? yaw : bird.yaw;
      let turn = yaw - prevYaw;
      if (turn > Math.PI) turn -= Math.PI * 2;
      if (turn < -Math.PI) turn += Math.PI * 2;
      const targetRoll = THREE.MathUtils.clamp(-turn / Math.max(delta, 1e-3) * 0.6, -0.9, 0.9);
      bird.roll += (targetRoll - bird.roll) * Math.min(1, delta * 4);
      bird.yaw = yaw;
      bird.prev.copy(_pos);

      _obj.position.copy(_pos);
      _obj.rotation.set(pitch, yaw, bird.roll, 'YXZ');
      _obj.scale.setScalar(size * (0.9 + bird.seed * 0.2));
      _obj.updateMatrix();
      mesh.setMatrixAt(i, _obj.matrix);
      flap.setX(i, beat);
    });
    mesh.instanceMatrix.needsUpdate = true;
    flap.needsUpdate = true;
  });

  return <primitive object={mesh} dispose={null} />;
};
