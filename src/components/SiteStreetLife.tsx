import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Line, useGLTF } from '@react-three/drei';
import type { Shape, SiteRoute, StreetLifeLevel } from '../types';
import { gridHeightAt } from '../lib/worldSite/terrain';
import { useApp } from '../AppContext';
import { usePresentation } from '../lib/presentation/store';
import { browserSiteIO } from '../lib/worldSite/fetchSite';
import { findSiteGround } from '../lib/worldSite/site';
import { drivesOnLeft, parseStreets, routeTool, streetsQuery } from '../lib/worldSite/streets';
import { type Seat, planStreetLife, pointOnLoop } from '../lib/worldSite/streetLife';
import { startSims, stepStreet } from '../lib/worldSite/streetSim';
import { flockSizes, gooseFlock, wheelingFlock, type Bird } from '../lib/worldSite/birds';

// WorldView street life uses real, lightweight CC0 entourage models rather than assembled
// primitives. The models are intentionally stylised enough to sit behind the architecture, while
// preserving recognisable human anatomy, clothing, glazing, lamps, wheels and vehicle proportions.

const HUMAN_SCALE = 0.46;
const HUMAN_FORWARD_YAW = 0;
const PERSON_COLOURS = ['#315d7a', '#b75b4c', '#6b7659', '#c38a37', '#59697e', '#7b6486', '#397a78', '#b69762'];
const CAR_PALETTE = ['#e8e5dd', '#315d7a', '#b64d43', '#c7832d', '#5d7568', '#67717d', '#b8b4aa', '#39717b'];

const HUMAN_URLS = {
  maleWalk: '/assets/streetlife/people/male-walking.glb',
  femaleWalk: '/assets/streetlife/people/female-walking.glb',
  maleStand: '/assets/streetlife/people/male-standing.glb',
  femaleStand: '/assets/streetlife/people/female-standing.glb',
  sit: '/assets/streetlife/people/female-sitting.glb',
} as const;

const CAR_URLS = [
  '/assets/streetlife/cars/family-sedan.glb',
  '/assets/streetlife/cars/compact-wagon.glb',
  '/assets/streetlife/cars/sport-coupe.glb',
  '/assets/streetlife/cars/suv.glb',
] as const;

type StreetAssetKind = 'person' | 'car';

function collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse(child => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) meshes.push(mesh);
  });
  return meshes;
}

function styleStreetObject(source: THREE.Object3D, tint: string | undefined, kind: StreetAssetKind) {
  const clone = source.clone(true);
  clone.traverse(child => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    mesh.raycast = () => {};

    const original = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const materials = original.filter(Boolean).map(material => {
      const m = material.clone() as THREE.MeshStandardMaterial;
      const name = (m.name || '').toLowerCase();

      if (m.color && tint) {
        if (kind === 'person' && name.includes('shirt')) m.color.set(tint);
        if (kind === 'car' && !/(window|black|grey|gray|headlight|taillight|tail light|tyre|tire|wheel)/.test(name)) m.color.set(tint);
      }

      if (kind === 'car' && /window/.test(name)) {
        // Real glass rather than opaque painted panels. Keep enough tint to read the glazing at
        // architectural viewing distances while allowing the opposite side/background through.
        m.color.set('#20333d');
        m.transparent = true;
        m.opacity = 0.46;
        m.depthWrite = false;
        m.side = THREE.DoubleSide;
        m.roughness = 0.12;
        m.metalness = 0.08;
      } else if (kind === 'car' && /headlight/.test(name)) {
        m.color.set('#fff5d6');
        m.emissive = new THREE.Color('#fff0bd');
        m.emissiveIntensity = 2.2;
        m.roughness = 0.2;
      } else if (kind === 'car' && /(taillight|tail light)/.test(name)) {
        m.color.set('#d9362b');
        m.emissive = new THREE.Color('#b91c1c');
        m.emissiveIntensity = 1.3;
        m.roughness = 0.25;
      } else if ('roughness' in m) {
        m.roughness = Math.max(0.5, m.roughness ?? 0.7);
      }
      return m;
    });
    mesh.material = Array.isArray(mesh.material) ? materials : materials[0]!;
  });
  return clone;
}

function disposeStreetMaterials(object: THREE.Object3D) {
  object.traverse(child => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach(m => m?.dispose());
  });
}

/**
 * The supplied posed humans are authored from the same source topology. Build two morph targets
 * from the hand-authored walking pose: the original stride and a left/right mirrored stride.
 * This gives the static entourage real hip/knee/elbow/shoulder deformation without falling back to
 * capsule limbs or requiring a heavyweight skeletal character per pedestrian.
 */
function buildWalkTemplate(standing: THREE.Object3D, walking: THREE.Object3D) {
  const template = standing.clone(true);
  const baseMeshes = collectMeshes(template);
  const walkMeshes = collectMeshes(walking);

  baseMeshes.forEach((mesh, meshIndex) => {
    const walkMesh = walkMeshes[meshIndex];
    if (!walkMesh) return;
    const basePosition = mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    const walkPosition = walkMesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!basePosition || !walkPosition || basePosition.count !== walkPosition.count) return;

    const geometry = mesh.geometry.clone();
    const walkTarget = walkPosition.clone();
    const mirrored = new Float32Array(basePosition.count * 3);

    // Match each vertex to the closest vertex on the opposite side of the neutral standing pose.
    // The models are small enough that doing this once per gender is inexpensive, while avoiding
    // the crossed-limb artefact produced by simply negating X coordinates.
    for (let i = 0; i < basePosition.count; i++) {
      const x = basePosition.getX(i), y = basePosition.getY(i), z = basePosition.getZ(i);
      let best = i, bestD = Infinity;
      for (let j = 0; j < basePosition.count; j++) {
        const dx = basePosition.getX(j) + x;
        const dy = basePosition.getY(j) - y;
        const dz = basePosition.getZ(j) - z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) { bestD = d; best = j; }
      }
      mirrored[i * 3] = -walkPosition.getX(best);
      mirrored[i * 3 + 1] = walkPosition.getY(best);
      mirrored[i * 3 + 2] = walkPosition.getZ(best);
    }

    geometry.morphAttributes.position = [
      walkTarget,
      new THREE.Float32BufferAttribute(mirrored, 3),
    ];
    geometry.morphTargetsRelative = false;
    mesh.geometry = geometry;
    mesh.updateMorphTargets();
  });

  return template;
}

function StreetAsset({ source, scale, tint, kind }: { source: THREE.Object3D; scale: number; tint?: string; kind: StreetAssetKind }) {
  const object = useMemo(() => styleStreetObject(source, tint, kind), [source, tint, kind]);
  useEffect(() => () => disposeStreetMaterials(object), [object]);
  return <primitive object={object} scale={scale} dispose={null} />;
}

function WalkingStreetAsset({
  template,
  scale,
  tint,
  registerMorphs,
}: {
  template: THREE.Object3D;
  scale: number;
  tint?: string;
  registerMorphs: (meshes: THREE.Mesh[]) => void;
}) {
  const object = useMemo(() => styleStreetObject(template, tint, 'person'), [template, tint]);
  const morphMeshes = useMemo(
    () => collectMeshes(object).filter(mesh => !!mesh.morphTargetInfluences?.length),
    [object],
  );

  useEffect(() => {
    registerMorphs(morphMeshes);
    return () => registerMorphs([]);
  }, [morphMeshes, registerMorphs]);
  useEffect(() => () => disposeStreetMaterials(object), [object]);

  return <primitive object={object} scale={scale} dispose={null} />;
}

function CarHeadlightBeam({ register }: { register: (lights: THREE.SpotLight[]) => void }) {
  const left = useRef<THREE.SpotLight | null>(null);
  const right = useRef<THREE.SpotLight | null>(null);
  const leftTarget = useRef<THREE.Object3D | null>(null);
  const rightTarget = useRef<THREE.Object3D | null>(null);

  useEffect(() => {
    if (left.current && leftTarget.current) {
      left.current.target = leftTarget.current;
      leftTarget.current.updateMatrixWorld();
    }
    if (right.current && rightTarget.current) {
      right.current.target = rightTarget.current;
      rightTarget.current.updateMatrixWorld();
    }
    register([left.current, right.current].filter((light): light is THREE.SpotLight => !!light));
    return () => register([]);
  }, [register]);

  const common = {
    color: '#fff1c2',
    intensity: 24,
    distance: 14,
    angle: 0.28,
    penumbra: 0.78,
    decay: 2,
    castShadow: false,
  } as const;

  return <>
    <spotLight ref={left} position={[-0.58, 0.55, 1.92]} {...common} />
    <spotLight ref={right} position={[0.58, 0.55, 1.92]} {...common} />
    <object3D ref={leftTarget} position={[-0.42, -0.7, 9]} />
    <object3D ref={rightTarget} position={[0.42, -0.7, 9]} />
  </>;
}

/** Amber indicator lamps at the four corners; the frame loop shows the side the car is turning to, flashing. */
function CarIndicators({ register }: { register: (lamps: { left: THREE.Object3D[]; right: THREE.Object3D[] }) => void }) {
  const left = useRef<THREE.Object3D[]>([]);
  const right = useRef<THREE.Object3D[]>([]);
  useEffect(() => {
    register({ left: left.current.filter(Boolean), right: right.current.filter(Boolean) });
    return () => register({ left: [], right: [] });
  }, [register]);
  // A car faces +z, so its left is +x.
  const lamps: { side: 'left' | 'right'; x: number; z: number }[] = [
    { side: 'left', x: 0.82, z: 1.98 }, { side: 'right', x: -0.82, z: 1.98 },
    { side: 'left', x: 0.78, z: -2.02 }, { side: 'right', x: -0.78, z: -2.02 },
  ];
  return <>
    {lamps.map((l, i) => (
      <mesh key={i} position={[l.x, 0.62, l.z]} visible={false} ref={node => { if (node) (l.side === 'left' ? left : right).current[i] = node; }}>
        <boxGeometry args={[0.2, 0.11, 0.06]} />
        <meshBasicMaterial color="#ffb020" toneMapped={false} />
      </mesh>
    ))}
  </>;
}

/* ---------- Placement ---------- */

export function benchSeats(shapes: Shape[]): Seat[] {
  const seats: Seat[] = [];
  for (const s of shapes) {
    if (s.type !== 'bench' || s.hidden) continue;
    const len = Array.isArray(s.args) ? Number(s.args[0]) || 1.8 : 1.8;
    const q = s.quaternion ? new THREE.Quaternion(...s.quaternion) : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(s.rotation ?? [0, 0, 0])));
    const scale = new THREE.Vector3(...(s.scale ?? [1, 1, 1]));
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const yaw = Math.atan2(fwd.x, fwd.z);
    for (const x of len >= 1.4 ? [-len / 4, len / 4] : [0]) {
      const p = new THREE.Vector3(x, 0.48, -0.02).multiply(scale).applyQuaternion(q).add(new THREE.Vector3(...s.position));
      seats.push({ x: p.x, y: p.y, z: p.z, yaw });
    }
  }
  return seats;
}

function isSmallDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const short = Math.min(window.screen?.width ?? 1920, window.screen?.height ?? 1080);
  return short < 820 || (navigator.hardwareConcurrency ?? 8) <= 4;
}

/* ---------- Drawing ---------- */

export interface SiteStreetLifeProps { ground: Shape; routes: SiteRoute[]; level: StreetLifeLevel; seats: Seat[]; }

export function SiteStreetLife({ ground, routes, level, seats }: SiteStreetLifeProps) {
  const site = ground.terrainData!.site!;
  const small = isSmallDevice();
  const plan = useMemo(
    () => planStreetLife(routes, { level, leftHand: drivesOnLeft(site), small, seats, seed: Math.round(site.lat * 1e4 + site.lng * 1e4) }),
    [routes, level, seats, site.lat, site.lng, small],
  );

  const maleWalk = useGLTF(HUMAN_URLS.maleWalk).scene;
  const femaleWalk = useGLTF(HUMAN_URLS.femaleWalk).scene;
  const maleStand = useGLTF(HUMAN_URLS.maleStand).scene;
  const femaleStand = useGLTF(HUMAN_URLS.femaleStand).scene;
  const sitting = useGLTF(HUMAN_URLS.sit).scene;
  const car0 = useGLTF(CAR_URLS[0]).scene;
  const car1 = useGLTF(CAR_URLS[1]).scene;
  const car2 = useGLTF(CAR_URLS[2]).scene;
  const car3 = useGLTF(CAR_URLS[3]).scene;
  const cars = [car0, car1, car2, car3];
  const maleWalkTemplate = useMemo(() => buildWalkTemplate(maleStand, maleWalk), [maleStand, maleWalk]);
  const femaleWalkTemplate = useMemo(() => buildWalkTemplate(femaleStand, femaleWalk), [femaleStand, femaleWalk]);

  const t = ground.terrainData!;
  const [gx, gy, gz] = ground.position;
  const heightAt = (x: number, z: number) => gridHeightAt(t, x - gx, z - gz) + gy;

  // Where every car and person is now: they slow for bends, queue, stop for people and wait for cars.
  const sims = useMemo(() => startSims(plan), [plan]);
  const carLampRefs = useRef<{ left: THREE.Object3D[]; right: THREE.Object3D[] }[]>([]);
  const walkerRefs = useRef<(THREE.Group | null)[]>([]);
  const standerRefs = useRef<(THREE.Group | null)[]>([]);
  const sitterRefs = useRef<(THREE.Group | null)[]>([]);
  const carRefs = useRef<(THREE.Group | null)[]>([]);
  const walkerMorphRefs = useRef<THREE.Mesh[][]>([]);
  const carLightRefs = useRef<THREE.SpotLight[][]>([]);
  const time = useRef(0);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const e = useMemo(() => new THREE.Euler(0, 0, 0, 'YXZ'), []);

  useFrame(({ camera }, delta) => {
    time.current += Math.min(delta, 0.1);
    const now = time.current;

    stepStreet(plan, sims.cars, sims.walkers, delta);

    plan.walkers.forEach((w, i) => {
      const group = walkerRefs.current[i];
      const sim = sims.walkers[i];
      if (!group || !sim) return;
      const dist = sim.s;
      const stride = w.child ? 1.0 : 1.4;
      group.position.set(sim.x, heightAt(sim.x, sim.z) + 0.04, sim.z);
      group.rotation.set(0, Math.atan2(sim.dx, sim.dz) + HUMAN_FORWARD_YAW, 0);

      // Alternate between the authored walking pose and its mirrored counterpart. At the middle of
      // each step both influences fall back to the neutral standing mesh, so knees, hips, elbows
      // and shoulders pass through a believable weight-transfer position rather than sliding.
      // Someone waiting for a car stands in the neutral pose.
      const phase = (dist / stride) * Math.PI * 2;
      const swing = sim.waiting ? 0 : Math.sin(phase);
      const amount = Math.pow(Math.abs(swing), 0.82) * 0.92;
      const a = swing >= 0 ? amount : 0;
      const b = swing < 0 ? amount : 0;
      for (const mesh of walkerMorphRefs.current[i] ?? []) {
        if (!mesh.morphTargetInfluences) continue;
        mesh.morphTargetInfluences[0] = a;
        mesh.morphTargetInfluences[1] = b;
      }
    });

    plan.standers.forEach((s, i) => {
      const group = standerRefs.current[i];
      if (!group) return;
      group.position.set(s.x, heightAt(s.x, s.z) + 0.04, s.z);
      group.rotation.set(0, s.yaw + HUMAN_FORWARD_YAW + Math.sin(now * 0.7 + i) * 0.025, 0);
    });

    plan.sitters.forEach((s, i) => {
      const group = sitterRefs.current[i];
      if (!group) return;
      group.position.set(s.x, s.y - 0.48, s.z);
      group.rotation.set(0, s.yaw + HUMAN_FORWARD_YAW, 0);
    });

    let projectedLights = small ? 6 : 12;
    const blink = Math.floor(now * 3) % 2 === 0;
    plan.cars.forEach((_car, i) => {
      const group = carRefs.current[i];
      const sim = sims.cars[i];
      if (!group || !sim) return;
      const loop = plan.carLoops[plan.cars[i]!.loop]!;
      const front = pointOnLoop(loop, sim.s + 1.4);
      const back = pointOnLoop(loop, sim.s - 1.4);
      const hf = heightAt(front.x, front.z);
      const hb = heightAt(back.x, back.z);
      const pitch = -Math.atan2(hf - hb, 2.8);
      // Point along the road a little ahead, so the car eases round bends instead of snapping to each segment.
      const aim = pointOnLoop(loop, sim.s + 2.5);
      q.setFromEuler(e.set(pitch, Math.atan2(aim.dx + sim.dx, aim.dz + sim.dz), 0));
      group.position.set(sim.x, (hf + hb) / 2 + 0.01, sim.z);
      group.quaternion.copy(q);

      const lamps = carLampRefs.current[i];
      if (lamps) {
        for (const lamp of lamps.left) lamp.visible = sim.signal === -1 && blink;
        for (const lamp of lamps.right) lamp.visible = sim.signal === 1 && blink;
      }

      // Keep real projected headlights affordable on mobile: every car has emissive lamp geometry,
      // while the nearest cars receive a live spotlight cone that illuminates the road ahead.
      const lights = carLightRefs.current[i] ?? [];
      if (lights.length) {
        const close = group.position.distanceToSquared(camera.position) < 35 * 35;
        const enable = close && projectedLights >= lights.length;
        for (const light of lights) light.visible = enable;
        if (enable) projectedLights -= lights.length;
      }
    });
  });

  return <group name="site-street-life" userData={{ isStreetLife: true }}>
    {plan.walkers.map((w, i) => {
      const template = w.body % 2 ? femaleWalkTemplate : maleWalkTemplate;
      const scale = HUMAN_SCALE * (w.child ? 0.68 : 1);
      return <group key={`walker-${i}`} ref={node => { walkerRefs.current[i] = node; }}>
        <WalkingStreetAsset
          template={template}
          scale={scale}
          tint={PERSON_COLOURS[w.body % PERSON_COLOURS.length]}
          registerMorphs={meshes => { walkerMorphRefs.current[i] = meshes; }}
        />
      </group>;
    })}
    {plan.standers.map((s, i) => {
      const source = s.body % 2 ? femaleStand : maleStand;
      const scale = HUMAN_SCALE * (s.child ? 0.68 : 1);
      return <group key={`stander-${i}`} ref={node => { standerRefs.current[i] = node; }}>
        <StreetAsset source={source} scale={scale} tint={PERSON_COLOURS[(s.body + 2) % PERSON_COLOURS.length]} kind="person" />
      </group>;
    })}
    {plan.sitters.map((s, i) => <group key={`sitter-${i}`} ref={node => { sitterRefs.current[i] = node; }}>
      <StreetAsset source={sitting} scale={HUMAN_SCALE} tint={PERSON_COLOURS[(s.body + 4) % PERSON_COLOURS.length]} kind="person" />
    </group>)}
    {plan.cars.map((car, i) => <group key={`car-${i}`} ref={node => { carRefs.current[i] = node; }}>
      <StreetAsset source={cars[car.color % cars.length]!} scale={1} tint={CAR_PALETTE[car.color % CAR_PALETTE.length]} kind="car" />
      <CarHeadlightBeam register={lights => { carLightRefs.current[i] = lights; }} />
      <CarIndicators register={lamps => { carLampRefs.current[i] = lamps; }} />
    </group>)}
  </group>;
}


/* ---------- Birds ---------- */

/** One bird: a body and two wings that flap (the wing tips lift and drop in the shader, out of phase per bird). */
function birdGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const wing: number[] = [];
  const tri = (a: number[], b: number[], c: number[], w: [number, number, number]) => { positions.push(...a, ...b, ...c); wing.push(...w); };
  tri([0, 0, 0.5], [-0.09, 0, -0.32], [0.09, 0, -0.32], [0, 0, 0]);
  tri([0, 0, 0.16], [0, 0, -0.22], [-1, 0, -0.12], [0, 0, 1]);
  tri([0, 0, 0.16], [1, 0, -0.12], [0, 0, -0.22], [0, 1, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
  return g;
}

function BirdFlock({ birdsAt, count, wingspan, colour, flapRate }: { birdsAt: (t: number) => Bird[]; count: number; wingspan: number; colour: string; flapRate: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uFlap: { value: flapRate } }), [flapRate]);
  const geometry = useMemo(() => {
    const g = birdGeometry();
    g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
    return g;
  }, [count]);
  const material = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({ color: colour, side: THREE.DoubleSide });
    m.onBeforeCompile = shader => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.uniforms.uFlap = uniforms.uFlap;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aWing;\nattribute float aPhase;\nuniform float uTime;\nuniform float uFlap;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += aWing * sin(uTime * uFlap + aPhase) * 0.5 * abs(position.x) + aWing * 0.05;');
    };
    m.customProgramCacheKey = () => 'pf-bird';
    return m;
  }, [colour, uniforms]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  const clock = useRef(0);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const euler = useMemo(() => new THREE.Euler(0, 0, 0, 'YXZ'), []);
  useFrame((_, delta) => {
    const m = mesh.current;
    if (!m) return;
    clock.current += Math.min(delta, 0.1);
    uniforms.uTime.value = clock.current;
    const phase = geometry.getAttribute('aPhase') as THREE.InstancedBufferAttribute;
    birdsAt(clock.current).forEach((b, i) => {
      if (i >= count) return;
      dummy.position.set(b.x, b.y, b.z);
      dummy.rotation.copy(euler.set(b.pitch, b.yaw, b.bank));
      dummy.scale.setScalar(b.visible ? wingspan : 0);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      phase.setX(i, b.phase);
    });
    m.instanceMatrix.needsUpdate = true;
    phase.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geometry, material, count]} frustumCulled={false} raycast={() => null} />;
}

/** Two flocks over the site: birds wheeling about, and geese crossing in a V. They are not part of the model (nothing to select). */
export function SiteBirds({ ground, level }: { ground: Shape; level: Exclude<StreetLifeLevel, 'off'> }) {
  const site = ground.terrainData!.site!;
  const small = isSmallDevice();
  const sizes = useMemo(() => flockSizes(level, small), [level, small]);
  const [gx, gy, gz] = ground.position;
  const size = site.size;
  // Higher on a hilly site than the ground's own base.
  const lift = gy;
  const wheel = useMemo(() => (t: number) => wheelingFlock(t, size, sizes.wheeling).map(b => ({ ...b, x: b.x + gx, y: b.y + lift, z: b.z + gz })), [size, sizes.wheeling, gx, gz, lift]);
  const geese = useMemo(() => (t: number) => gooseFlock(t, size, sizes.geese).map(b => ({ ...b, x: b.x + gx, y: b.y + lift, z: b.z + gz })), [size, sizes.geese, gx, gz, lift]);
  return <group name="site-birds" userData={{ isStreetLife: true }}>
    <BirdFlock birdsAt={wheel} count={sizes.wheeling} wingspan={1.3} colour="#2a2e33" flapRate={16} />
    <BirdFlock birdsAt={geese} count={sizes.geese} wingspan={2.4} colour="#4a4f57" flapRate={7} />
  </group>;
}

/* ---------- In the scene ---------- */

const fetchingRoutes = new Set<string>();

export function SiteStreetLifeLayer({ shapes }: { shapes: Shape[] }) {
  const { setShapes } = useApp(); const { active } = usePresentation(); const ground = findSiteGround(shapes); const site = ground?.terrainData?.site;
  const level: StreetLifeLevel = site?.streetLife ?? 'normal'; const show = !!site && level !== 'off' && (active || !!site.streetLifeInEditor);
  const benches = shapes.filter(s => s.type === 'bench'); const seatsKey = JSON.stringify(benches.map(b => [b.position, b.quaternion, b.rotation, b.args, b.scale, b.hidden]));
  const seats = useMemo(() => benchSeats(benches), [seatsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!show || !site || site.routes) return; const key = `${site.lat},${site.lng},${site.size}`; if (fetchingRoutes.has(key)) return; fetchingRoutes.add(key);
    const origin = { lat: site.lat, lng: site.lng };
    browserSiteIO.overpass(streetsQuery(origin, site.size)).then(json => {
      const routes = parseStreets(json, origin, site.size);
      setShapes(prev => prev.map(s => (s.terrainData?.site && s.terrainData.site.lat === site.lat && s.terrainData.site.lng === site.lng && !s.terrainData.site.routes ? { ...s, terrainData: { ...s.terrainData, site: { ...s.terrainData.site, routes } } } : s)));
    }).catch(err => console.warn('[WorldView] Streets for moving cars and people failed:', err)).finally(() => fetchingRoutes.delete(key));
  }, [show, site, setShapes]);

  const [gx, , gz] = ground?.position ?? [0, 0, 0];
  const routes = useMemo(() => (site?.routes ?? []).map(r => (gx || gz ? { ...r, points: r.points.map(([x, z]) => [x + gx, z + gz] as [number, number]) } : r)), [site?.routes, gx, gz]);
  if (!show || !ground) return null;
  return <>
    {routes.length > 0 && <SiteStreetLife ground={ground} routes={routes} level={level} seats={seats} />}
    <SiteBirds ground={ground} level={level} />
  </>;
}

function groundLine(pts: [number, number][], groundAt: (x: number, z: number) => number, lift = 0.15) {
  const out: THREE.Vector3[] = [];
  pts.forEach(([x, z], i) => {
    if (i > 0) { const [px, pz] = pts[i - 1]!; const steps = Math.floor(Math.hypot(x - px, z - pz) / 3); for (let k = 1; k < steps; k++) { const t = k / steps, ix = px + (x - px) * t, iz = pz + (z - pz) * t; out.push(new THREE.Vector3(ix, groundAt(ix, iz) + lift, iz)); } }
    out.push(new THREE.Vector3(x, groundAt(x, z) + lift, z));
  });
  return out;
}

export function RouteDrawPreview({ shapes, vertices, candidate, groundAt }: { shapes: Shape[]; vertices: THREE.Vector3[]; candidate: THREE.Vector3 | null; groundAt: (x: number, z: number) => number; }) {
  const ground = findSiteGround(shapes), routes = ground?.terrainData?.site?.routes ?? []; const [gx, , gz] = ground?.position ?? [0, 0, 0];
  const lines = useMemo(() => routes.map(r => ({ id: r.id, color: r.source === 'map' ? '#9ca3af' : r.kind === 'road' ? '#d97706' : '#0063A3', points: groundLine(r.points.map(([x, z]) => [x + gx, z + gz] as [number, number]), groundAt) })), [routes, gx, gz, groundAt]);
  const drawing = useMemo(() => { const pts = (candidate ? [...vertices, candidate] : vertices).map(v => [v.x, v.z] as [number, number]); return pts.length >= 2 ? groundLine(pts, groundAt, 0.2) : null; }, [vertices, candidate, groundAt]);
  const colour = routeTool.kind === 'road' ? '#d97706' : '#0063A3';
  return <group renderOrder={999}>
    {lines.filter(l => l.points.length >= 2).map(l => <Line key={l.id} points={l.points} color={l.color} lineWidth={l.color === '#9ca3af' ? 1.5 : 2.5} dashed={l.color === '#9ca3af'} dashSize={1} gapSize={0.6} depthTest={false} transparent opacity={0.9} />)}
    {drawing && <Line points={drawing} color={colour} lineWidth={3} depthTest={false} />}
    {vertices.map((v, i) => <mesh key={i} position={[v.x, groundAt(v.x, v.z) + 0.2, v.z]} renderOrder={1000}><sphereGeometry args={[0.18, 12, 8]} /><meshBasicMaterial color={i === 0 ? '#22c55e' : colour} depthTest={false} /></mesh>)}
  </group>;
}
