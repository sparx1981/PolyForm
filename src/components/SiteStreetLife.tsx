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
import { type Seat, gait, planStreetLife, pointOnLoop } from '../lib/worldSite/streetLife';

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

function StreetAsset({ source, scale, tint, kind }: { source: THREE.Object3D; scale: number; tint?: string; kind: StreetAssetKind }) {
  const object = useMemo(() => {
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
          m.roughness = 0.24;
          m.metalness = 0.08;
        } else if ('roughness' in m) {
          m.roughness = Math.max(0.5, m.roughness ?? 0.7);
        }
        return m;
      });
      mesh.material = Array.isArray(mesh.material) ? materials : materials[0]!;
    });
    return clone;
  }, [source, tint, kind]);

  useEffect(() => () => {
    object.traverse(child => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach(m => m?.dispose());
    });
  }, [object]);

  return <primitive object={object} scale={scale} dispose={null} />;
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

const tmp = {
  base: new THREE.Matrix4(), joint: new THREE.Matrix4(), rot: new THREE.Matrix4(), knee: new THREE.Matrix4(), out: new THREE.Matrix4(),
  q: new THREE.Quaternion(), e: new THREE.Euler(0, 0, 0, 'YXZ'), p: new THREE.Vector3(), s: new THREE.Vector3(),
};

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

  const t = ground.terrainData!;
  const [gx, gy, gz] = ground.position;
  const heightAt = (x: number, z: number) => gridHeightAt(t, x - gx, z - gz) + gy;

  const walkerRefs = useRef<(THREE.Group | null)[]>([]);
  const standerRefs = useRef<(THREE.Group | null)[]>([]);
  const sitterRefs = useRef<(THREE.Group | null)[]>([]);
  const carRefs = useRef<(THREE.Group | null)[]>([]);
  const time = useRef(0);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const e = useMemo(() => new THREE.Euler(0, 0, 0, 'YXZ'), [ ]);

  useFrame((_, delta) => {
    time.current += Math.min(delta, 0.1);
    const now = time.current;

    plan.walkers.forEach((w, i) => {
      const group = walkerRefs.current[i];
      if (!group) return;
      const loop = plan.walkLoops[w.loop]!;
      const dist = w.start + now * w.speed;
      const p = pointOnLoop(loop, dist);
      const g = gait(dist, w.child ? 1.0 : 1.4);
      group.position.set(p.x, heightAt(p.x, p.z) + 0.04 + g.bob * 0.35, p.z);
      group.rotation.set(0, Math.atan2(p.dx, p.dz) + HUMAN_FORWARD_YAW, Math.sin(dist * 3.2) * 0.012);
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

    plan.cars.forEach((car, i) => {
      const group = carRefs.current[i];
      if (!group) return;
      const loop = plan.carLoops[car.loop]!;
      const dist = car.start + now * car.speed;
      const p = pointOnLoop(loop, dist);
      const front = pointOnLoop(loop, dist + 1.4);
      const back = pointOnLoop(loop, dist - 1.4);
      const hf = heightAt(front.x, front.z);
      const hb = heightAt(back.x, back.z);
      const pitch = -Math.atan2(hf - hb, 2.8);
      q.setFromEuler(e.set(pitch, Math.atan2(p.dx, p.dz), 0));
      group.position.set(p.x, (hf + hb) / 2 + 0.01, p.z);
      group.quaternion.copy(q);
    });
  });

  return <group name="site-street-life" userData={{ isStreetLife: true }}>
    {plan.walkers.map((w, i) => {
      const source = w.body % 2 ? femaleWalk : maleWalk;
      const scale = HUMAN_SCALE * (w.child ? 0.68 : 1);
      return <group key={`walker-${i}`} ref={node => { walkerRefs.current[i] = node; }}>
        <StreetAsset source={source} scale={scale} tint={PERSON_COLOURS[w.body % PERSON_COLOURS.length]} kind="person" />
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
    </group>)}
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
  if (!show || !ground || !routes.length) return null;
  return <SiteStreetLife ground={ground} routes={routes} level={level} seats={seats} />;
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
