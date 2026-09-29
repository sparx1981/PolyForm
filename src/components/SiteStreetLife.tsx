import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import type { Shape, SiteRoute, StreetLifeLevel } from '../types';
import { gridHeightAt } from '../lib/worldSite/terrain';
import { useApp } from '../AppContext';
import { usePresentation } from '../lib/presentation/store';
import { browserSiteIO } from '../lib/worldSite/fetchSite';
import { findSiteGround } from '../lib/worldSite/site';
import { drivesOnLeft, parseStreets, routeTool, streetsQuery } from '../lib/worldSite/streets';
import { BODY_TYPES, CAR_COLOURS, type Seat, gait, planStreetLife, pointOnLoop } from '../lib/worldSite/streetLife';
import { createHumanGeometry, createCarGeometry, HUMAN } from '../lib/worldSite/streetLifeGeometry';

const { hipY: HIP_Y, hipX: HIP_X, thighLength: THIGH, shoulderY: SHOULDER_Y, shoulderX: SHOULDER_X } = HUMAN;
const BUILDS: [number, number][] = [[1, 1], [0.95, 0.92], [1.045, 1.06], [0.975, 1.1]];
const PEOPLE_PALETTE = ['#315d7a', '#d08a32', '#58725b', '#b55d4c', '#65758b', '#d0a55b', '#6c6387', '#3f7b79'];
const CAR_PALETTE = ['#e7e4dc', '#315d7a', '#c45545', '#d18a2e', '#607568', '#6a7180', '#b8b4aa', '#416f78'];

const figureMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.78, metalness: 0, flatShading: false });
const carBodyMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.42, metalness: 0.1, flatShading: false });
const carGlassMaterial = new THREE.MeshStandardMaterial({ color: '#172c38', roughness: 0.18, metalness: 0.12, flatShading: false });
const wheelMaterial = new THREE.MeshStandardMaterial({ color: '#202529', roughness: 0.9, metalness: 0 });
const hubMaterial = new THREE.MeshStandardMaterial({ color: '#a3aaad', roughness: 0.42, metalness: 0.28 });
const headlightMaterial = new THREE.MeshStandardMaterial({ color: '#fff8df', emissive: '#ead9a7', emissiveIntensity: 0.32, roughness: 0.28 });
const tailLightMaterial = new THREE.MeshStandardMaterial({ color: '#c33d38', emissive: '#7b1715', emissiveIntensity: 0.16, roughness: 0.35 });
const grilleMaterial = new THREE.MeshStandardMaterial({ color: '#182026', roughness: 0.72, metalness: 0.12 });

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

export interface SiteStreetLifeProps { ground: Shape; routes: SiteRoute[]; level: StreetLifeLevel; seats: Seat[]; }

const tmp = {
  base: new THREE.Matrix4(), joint: new THREE.Matrix4(), rot: new THREE.Matrix4(), knee: new THREE.Matrix4(), out: new THREE.Matrix4(),
  q: new THREE.Quaternion(), e: new THREE.Euler(0, 0, 0, 'YXZ'), p: new THREE.Vector3(), s: new THREE.Vector3(),
};

export function SiteStreetLife({ ground, routes, level, seats }: SiteStreetLifeProps) {
  const site = ground.terrainData!.site!;
  const plan = useMemo(() => planStreetLife(routes, { level, leftHand: drivesOnLeft(site), small: isSmallDevice(), seats, seed: Math.round(site.lat * 1e4 + site.lng * 1e4) }), [routes, level, seats, site.lat, site.lng]);
  const figure = useMemo(createHumanGeometry, []);
  const car = useMemo(createCarGeometry, []);
  useEffect(() => () => { Object.values(figure).forEach(g => g.dispose()); Object.values(car).forEach(g => g.dispose()); }, [figure, car]);

  const t = ground.terrainData!;
  const [gx, gy, gz] = ground.position;
  const heightAt = (x: number, z: number) => gridHeightAt(t, x - gx, z - gz) + gy;
  const people = plan.walkers.length + plan.standers.length + plan.sitters.length;

  const bodyRef = useRef<THREE.InstancedMesh>(null), thighRef = useRef<THREE.InstancedMesh>(null), shinRef = useRef<THREE.InstancedMesh>(null);
  const upperArmRef = useRef<THREE.InstancedMesh>(null), forearmRef = useRef<THREE.InstancedMesh>(null), handRef = useRef<THREE.InstancedMesh>(null), footRef = useRef<THREE.InstancedMesh>(null);
  const carRef = useRef<THREE.InstancedMesh>(null), cabinRef = useRef<THREE.InstancedMesh>(null), roofRef = useRef<THREE.InstancedMesh>(null), windowsRef = useRef<THREE.InstancedMesh>(null), pillarsRef = useRef<THREE.InstancedMesh>(null);
  const wheelRef = useRef<THREE.InstancedMesh>(null), hubRef = useRef<THREE.InstancedMesh>(null), frontLightRef = useRef<THREE.InstancedMesh>(null), rearLightRef = useRef<THREE.InstancedMesh>(null), grilleRef = useRef<THREE.InstancedMesh>(null);
  const time = useRef(0);

  useLayoutEffect(() => {
    const c = new THREE.Color();
    if (carRef.current) {
      plan.cars.forEach((k, i) => carRef.current!.setColorAt(i, c.set(CAR_PALETTE[k.color % CAR_COLOURS]!)));
      if (carRef.current.instanceColor) carRef.current.instanceColor.needsUpdate = true;
    }
    for (const ref of [roofRef, pillarsRef]) if (ref.current) {
      plan.cars.forEach((k, i) => ref.current!.setColorAt(i, c.set(CAR_PALETTE[k.color % CAR_COLOURS]!)));
      if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
    }
    if (bodyRef.current) {
      let i = 0;
      for (const p of [...plan.walkers, ...plan.standers, ...plan.sitters]) bodyRef.current.setColorAt(i++, c.set(PEOPLE_PALETTE[p.body % PEOPLE_PALETTE.length]!));
      if (bodyRef.current.instanceColor) bodyRef.current.instanceColor.needsUpdate = true;
    }
  }, [plan, people]);

  const limb = (mesh: THREE.InstancedMesh, index: number, jx: number, jy: number, angle: number, bend?: number, lowerLength = THIGH) => {
    tmp.joint.makeTranslation(jx, jy, 0); tmp.rot.makeRotationX(-angle); tmp.out.multiplyMatrices(tmp.base, tmp.joint).multiply(tmp.rot);
    if (bend !== undefined) { tmp.knee.makeTranslation(0, -lowerLength, 0); tmp.out.multiply(tmp.knee).multiply(tmp.rot.makeRotationX(bend)); }
    mesh.setMatrixAt(index, tmp.out);
  };

  const person = (i: number, x: number, y: number, z: number, yaw: number, child: boolean, body: number, legs: [number, number], arms: [number, number], knees: [number, number]) => {
    const [hs, ws] = BUILDS[body % BODY_TYPES]!; const k = child ? 0.62 : 1;
    tmp.q.setFromEuler(tmp.e.set(0, yaw, 0)); tmp.base.compose(tmp.p.set(x, y, z), tmp.q, tmp.s.set(k * ws, k * hs, k * ws));
    bodyRef.current!.setMatrixAt(i, tmp.base);
    limb(thighRef.current!, i * 2, -HIP_X, HIP_Y, legs[0]); limb(thighRef.current!, i * 2 + 1, HIP_X, HIP_Y, legs[1]);
    limb(shinRef.current!, i * 2, -HIP_X, HIP_Y, legs[0], knees[0]); limb(shinRef.current!, i * 2 + 1, HIP_X, HIP_Y, legs[1], knees[1]);
    limb(footRef.current!, i * 2, -HIP_X, HIP_Y, legs[0], knees[0]); limb(footRef.current!, i * 2 + 1, HIP_X, HIP_Y, legs[1], knees[1]);
    limb(upperArmRef.current!, i * 2, -SHOULDER_X, SHOULDER_Y, arms[0]); limb(upperArmRef.current!, i * 2 + 1, SHOULDER_X, SHOULDER_Y, arms[1]);
    limb(forearmRef.current!, i * 2, -SHOULDER_X, SHOULDER_Y, arms[0], -arms[0] * 0.16, 0.31); limb(forearmRef.current!, i * 2 + 1, SHOULDER_X, SHOULDER_Y, arms[1], -arms[1] * 0.16, 0.31);
    limb(handRef.current!, i * 2, -SHOULDER_X, SHOULDER_Y, arms[0], -arms[0] * 0.16, 0.61); limb(handRef.current!, i * 2 + 1, SHOULDER_X, SHOULDER_Y, arms[1], -arms[1] * 0.16, 0.61);
  };

  useFrame((_, delta) => {
    time.current += Math.min(delta, 0.1); const now = time.current;
    if (people && bodyRef.current) {
      let i = 0;
      for (const w of plan.walkers) {
        const loop = plan.walkLoops[w.loop]!, dist = w.start + now * w.speed, p = pointOnLoop(loop, dist), g = gait(dist, w.child ? 1.0 : 1.4);
        const knee = (a: number) => 0.08 + Math.max(0, -a) * 0.85;
        person(i++, p.x, heightAt(p.x, p.z) + g.bob, p.z, Math.atan2(p.dx, p.dz), w.child, w.body, [g.leftLeg, g.rightLeg], [g.leftArm, g.rightArm], [knee(g.leftLeg), knee(g.rightLeg)]);
      }
      for (const [n, s] of plan.standers.entries()) { const sway = Math.sin(now * 0.8 + n) * 0.035; person(i++, s.x, heightAt(s.x, s.z), s.z, s.yaw + sway, s.child, s.body, [0.02, -0.02], [0.08 + sway, -0.05 - sway], [0.03, 0.03]); }
      for (const s of plan.sitters) person(i++, s.x, s.y - HIP_Y + 0.07, s.z, s.yaw, false, s.body, [Math.PI / 2, Math.PI / 2], [0.35, 0.35], [Math.PI / 2, Math.PI / 2]);
      for (const m of [bodyRef, thighRef, shinRef, upperArmRef, forearmRef, handRef, footRef]) m.current!.instanceMatrix.needsUpdate = true;
    }
    if (plan.cars.length && carRef.current) {
      plan.cars.forEach((c, i) => {
        const loop = plan.carLoops[c.loop]!, d = c.start + now * c.speed, p = pointOnLoop(loop, d), front = pointOnLoop(loop, d + 1.4), back = pointOnLoop(loop, d - 1.4);
        const hf = heightAt(front.x, front.z), hb = heightAt(back.x, back.z);
        tmp.q.setFromEuler(tmp.e.set(-Math.atan2(hf - hb, 2.8), Math.atan2(p.dx, p.dz), 0)); tmp.base.compose(tmp.p.set(p.x, (hf + hb) / 2, p.z), tmp.q, tmp.s.set(1, 1, 1));
        for (const m of [carRef, cabinRef, roofRef, windowsRef, pillarsRef, wheelRef, hubRef, frontLightRef, rearLightRef, grilleRef]) m.current!.setMatrixAt(i, tmp.base);
      });
      for (const m of [carRef, cabinRef, roofRef, windowsRef, pillarsRef, wheelRef, hubRef, frontLightRef, rearLightRef, grilleRef]) m.current!.instanceMatrix.needsUpdate = true;
    }
  });

  const shared = { frustumCulled: false, castShadow: true, receiveShadow: true, raycast: () => null } as const;
  return <group name="site-street-life" userData={{ isStreetLife: true }}>
    {people > 0 && <>
      <instancedMesh ref={bodyRef} args={[figure.body, figureMaterial, people]} {...shared} />
      <instancedMesh ref={thighRef} args={[figure.thigh, figureMaterial, people * 2]} {...shared} />
      <instancedMesh ref={shinRef} args={[figure.shin, figureMaterial, people * 2]} {...shared} />
      <instancedMesh ref={upperArmRef} args={[figure.upperArm, figureMaterial, people * 2]} {...shared} />
      <instancedMesh ref={forearmRef} args={[figure.forearm, figureMaterial, people * 2]} {...shared} />
      <instancedMesh ref={handRef} args={[figure.hand, figureMaterial, people * 2]} {...shared} />
      <instancedMesh ref={footRef} args={[figure.foot, figureMaterial, people * 2]} {...shared} />
    </>}
    {plan.cars.length > 0 && <>
      <instancedMesh ref={carRef} args={[car.body, carBodyMaterial, plan.cars.length]} {...shared} />
      <instancedMesh ref={cabinRef} args={[car.cabin, carBodyMaterial, plan.cars.length]} {...shared} />
      <instancedMesh ref={roofRef} args={[car.roof, carBodyMaterial, plan.cars.length]} {...shared} />
      <instancedMesh ref={windowsRef} args={[car.windows, carGlassMaterial, plan.cars.length]} {...shared} />
      <instancedMesh ref={pillarsRef} args={[car.pillars, carBodyMaterial, plan.cars.length]} {...shared} />
      <instancedMesh ref={wheelRef} args={[car.wheels, wheelMaterial, plan.cars.length]} {...shared} />
      <instancedMesh ref={hubRef} args={[car.hubs, hubMaterial, plan.cars.length]} {...shared} />
      <instancedMesh ref={frontLightRef} args={[car.frontLights, headlightMaterial, plan.cars.length]} {...shared} />
      <instancedMesh ref={rearLightRef} args={[car.rearLights, tailLightMaterial, plan.cars.length]} {...shared} />
      <instancedMesh ref={grilleRef} args={[car.grille, grilleMaterial, plan.cars.length]} {...shared} />
    </>}
  </group>;
}

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
    if (i > 0) { const [px, pz] = pts[i - 1]!; const steps = Math.floor(Math.hypot(x - px, z - pz) / 3); for (let k = 1; k < steps; k++) { const tt = k / steps, ix = px + (x - px) * tt, iz = pz + (z - pz) * tt; out.push(new THREE.Vector3(ix, groundAt(ix, iz) + lift, iz)); } }
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