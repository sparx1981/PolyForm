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

// Lightweight architectural entourage: deliberately simple, but with soft silhouettes and enough
// detail to read as people and vehicles at normal WorldView distances. Everything remains instanced.

/* ---------- Figures ---------- */

const HIP_Y = 0.91, HIP_X = 0.105, THIGH = 0.43, SHOULDER_Y = 1.39, SHOULDER_X = 0.225;

function capsuleHanging(radius: number, total: number): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(radius, Math.max(0.01, total - radius * 2), 7, 14);
  g.translate(0, -total / 2, 0);
  return g;
}

function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const nonIndexed = parts.map(p => (p.index ? p.toNonIndexed() : p));
  let count = 0;
  for (const p of nonIndexed) count += p.attributes.position!.count;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
  let o = 0;
  for (const p of nonIndexed) {
    pos.set(p.attributes.position!.array as Float32Array, o * 3);
    nor.set(p.attributes.normal!.array as Float32Array, o * 3);
    o += p.attributes.position!.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

function figureGeometries() {
  // Rounded anatomical masses follow the supplied silhouette: defined shoulders, narrower waist,
  // natural pelvis and tapered limbs, while deliberately omitting facial/clothing micro-detail.
  const head = new THREE.SphereGeometry(0.116, 18, 14);
  head.scale(0.91, 1.08, 0.96);
  head.translate(0, 1.665, 0.004);
  const neck = new THREE.CylinderGeometry(0.052, 0.064, 0.115, 14);
  neck.translate(0, 1.535, 0);
  const chest = new THREE.SphereGeometry(0.25, 18, 12);
  chest.scale(1.0, 1.12, 0.58);
  chest.translate(0, 1.34, 0);
  const waist = new THREE.SphereGeometry(0.175, 16, 12);
  waist.scale(0.82, 1.18, 0.62);
  waist.translate(0, 1.12, 0);
  const pelvis = new THREE.SphereGeometry(0.19, 16, 12);
  pelvis.scale(0.9, 0.78, 0.68);
  pelvis.translate(0, 0.965, 0);
  return {
    body: mergeAll([head, neck, chest, waist, pelvis]),
    thigh: capsuleHanging(0.086, THIGH + 0.045),
    shin: capsuleHanging(0.067, 0.47),
    arm: capsuleHanging(0.056, 0.62),
  };
}

/** Build variety: [height scale, width scale]. */
const BUILDS: [number, number][] = [[1, 1], [0.95, 0.92], [1.045, 1.06], [0.975, 1.1]];
const PEOPLE_PALETTE = ['#315d7a', '#d08a32', '#58725b', '#b55d4c', '#65758b', '#d0a55b', '#6c6387', '#3f7b79'];
const figureMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.82, metalness: 0, flatShading: false });

/* ---------- Cars ---------- */

function carGeometries() {
  const side = (pts: [number, number][], width: number, bevel = 0.055) => {
    const shape = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 4 });
    g.translate(0, 0, -width / 2);
    g.rotateY(-Math.PI / 2);
    g.computeVertexNormals();
    return g;
  };
  // Soft contemporary crossover proportions. The glasshouse is inset so the body keeps a clear
  // shoulder line and the windows read independently rather than as a dark upper body block.
  const body = side([[-2.08, 0.31], [2.03, 0.31], [2.15, 0.49], [2.11, 0.7], [1.62, 0.82], [0.98, 0.91], [-1.5, 0.91], [-2.04, 0.75], [-2.13, 0.55]], 1.74, 0.065);
  const cabin = side([[0.91, 0.94], [0.4, 1.39], [-0.91, 1.41], [-1.45, 0.94]], 1.48, 0.04);
  const roof = new THREE.BoxGeometry(1.5, 0.065, 1.82, 2, 1, 3);
  roof.translate(0, 1.405, -0.22);
  const wheels: THREE.BufferGeometry[] = [];
  const hubs: THREE.BufferGeometry[] = [];
  for (const z of [-1.35, 1.32]) for (const x of [-0.84, 0.84]) {
    const w = new THREE.CylinderGeometry(0.335, 0.335, 0.2, 20);
    w.rotateZ(Math.PI / 2); w.translate(x, 0.34, z); wheels.push(w);
    const h = new THREE.CylinderGeometry(0.17, 0.17, 0.212, 16);
    h.rotateZ(Math.PI / 2); h.translate(x, 0.34, z); hubs.push(h);
  }
  const frontLights = new THREE.BoxGeometry(1.18, 0.1, 0.045, 3, 1, 1); frontLights.translate(0, 0.665, 2.115);
  const rearLights = new THREE.BoxGeometry(1.2, 0.105, 0.045, 3, 1, 1); rearLights.translate(0, 0.675, -2.095);
  return { body, cabin, roof, wheels: mergeAll(wheels), hubs: mergeAll(hubs), frontLights, rearLights };
}

const CAR_PALETTE = ['#e7e4dc', '#315d7a', '#c45545', '#d18a2e', '#607568', '#6a7180', '#b8b4aa', '#416f78'];
const carBodyMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, metalness: 0.08, flatShading: false });
const carGlassMaterial = new THREE.MeshStandardMaterial({ color: '#213746', roughness: 0.24, metalness: 0.08, flatShading: false });
const wheelMaterial = new THREE.MeshStandardMaterial({ color: '#252a2d', roughness: 0.92, metalness: 0 });
const hubMaterial = new THREE.MeshStandardMaterial({ color: '#969da0', roughness: 0.55, metalness: 0.2 });
const headlightMaterial = new THREE.MeshStandardMaterial({ color: '#fff5d8', emissive: '#d7c58e', emissiveIntensity: 0.28, roughness: 0.35 });
const tailLightMaterial = new THREE.MeshStandardMaterial({ color: '#b63f3b', emissive: '#6b1616', emissiveIntensity: 0.12, roughness: 0.42 });

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
  const plan = useMemo(() => planStreetLife(routes, { level, leftHand: drivesOnLeft(site), small: isSmallDevice(), seats, seed: Math.round(site.lat * 1e4 + site.lng * 1e4) }), [routes, level, seats, site.lat, site.lng]);
  const figure = useMemo(figureGeometries, []);
  const car = useMemo(carGeometries, []);
  useEffect(() => () => { Object.values(figure).forEach(g => g.dispose()); Object.values(car).forEach(g => g.dispose()); }, [figure, car]);

  const t = ground.terrainData!;
  const [gx, gy, gz] = ground.position;
  const heightAt = (x: number, z: number) => gridHeightAt(t, x - gx, z - gz) + gy;

  const people = plan.walkers.length + plan.standers.length + plan.sitters.length;
  const bodyRef = useRef<THREE.InstancedMesh>(null), thighRef = useRef<THREE.InstancedMesh>(null), shinRef = useRef<THREE.InstancedMesh>(null), armRef = useRef<THREE.InstancedMesh>(null);
  const carRef = useRef<THREE.InstancedMesh>(null), cabinRef = useRef<THREE.InstancedMesh>(null), roofRef = useRef<THREE.InstancedMesh>(null), wheelRef = useRef<THREE.InstancedMesh>(null), hubRef = useRef<THREE.InstancedMesh>(null), frontLightRef = useRef<THREE.InstancedMesh>(null), rearLightRef = useRef<THREE.InstancedMesh>(null);
  const time = useRef(0);

  useLayoutEffect(() => {
    const carMesh = carRef.current, personMesh = bodyRef.current;
    const c = new THREE.Color();
    if (carMesh) {
      plan.cars.forEach((k, i) => carMesh.setColorAt(i, c.set(CAR_PALETTE[k.color % CAR_COLOURS]!)));
      if (carMesh.instanceColor) carMesh.instanceColor.needsUpdate = true;
    }
    if (roofRef.current) {
      plan.cars.forEach((k, i) => roofRef.current!.setColorAt(i, c.set(CAR_PALETTE[k.color % CAR_COLOURS]!)));
      if (roofRef.current.instanceColor) roofRef.current.instanceColor.needsUpdate = true;
    }
    if (personMesh) {
      let i = 0;
      for (const p of [...plan.walkers, ...plan.standers, ...plan.sitters]) personMesh.setColorAt(i++, c.set(PEOPLE_PALETTE[p.body % PEOPLE_PALETTE.length]!));
      if (personMesh.instanceColor) personMesh.instanceColor.needsUpdate = true;
    }
  }, [plan, people]);

  const limb = (mesh: THREE.InstancedMesh, index: number, jx: number, jy: number, angle: number, bend?: number) => {
    tmp.joint.makeTranslation(jx, jy, 0); tmp.rot.makeRotationX(-angle); tmp.out.multiplyMatrices(tmp.base, tmp.joint).multiply(tmp.rot);
    if (bend !== undefined) { tmp.knee.makeTranslation(0, -THIGH, 0); tmp.out.multiply(tmp.knee).multiply(tmp.rot.makeRotationX(bend)); }
    mesh.setMatrixAt(index, tmp.out);
  };

  const person = (i: number, x: number, y: number, z: number, yaw: number, child: boolean, body: number, legs: [number, number], arms: [number, number], knees: [number, number]) => {
    const [hs, ws] = BUILDS[body % BODY_TYPES]!; const k = child ? 0.62 : 1;
    tmp.q.setFromEuler(tmp.e.set(0, yaw, 0)); tmp.base.compose(tmp.p.set(x, y, z), tmp.q, tmp.s.set(k * ws, k * hs, k * ws));
    bodyRef.current!.setMatrixAt(i, tmp.base);
    limb(thighRef.current!, i * 2, -HIP_X, HIP_Y, legs[0]); limb(thighRef.current!, i * 2 + 1, HIP_X, HIP_Y, legs[1]);
    limb(shinRef.current!, i * 2, -HIP_X, HIP_Y, legs[0], knees[0]); limb(shinRef.current!, i * 2 + 1, HIP_X, HIP_Y, legs[1], knees[1]);
    limb(armRef.current!, i * 2, -SHOULDER_X, SHOULDER_Y, arms[0]); limb(armRef.current!, i * 2 + 1, SHOULDER_X, SHOULDER_Y, arms[1]);
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
      for (const m of [bodyRef, thighRef, shinRef, armRef]) m.current!.instanceMatrix.needsUpdate = true;
    }
    if (plan.cars.length && carRef.current) {
      plan.cars.forEach((c, i) => {
        const loop = plan.carLoops[c.loop]!, d = c.start + now * c.speed, p = pointOnLoop(loop, d), front = pointOnLoop(loop, d + 1.4), back = pointOnLoop(loop, d - 1.4);
        const hf = heightAt(front.x, front.z), hb = heightAt(back.x, back.z);
        tmp.q.setFromEuler(tmp.e.set(-Math.atan2(hf - hb, 2.8), Math.atan2(p.dx, p.dz), 0)); tmp.base.compose(tmp.p.set(p.x, (hf + hb) / 2, p.z), tmp.q, tmp.s.set(1, 1, 1));
        for (const m of [carRef, cabinRef, roofRef, wheelRef, hubRef, frontLightRef, rearLightRef]) m.current!.setMatrixAt(i, tmp.base);
      });
      for (const m of [carRef, cabinRef, roofRef, wheelRef, hubRef, frontLightRef, rearLightRef]) m.current!.instanceMatrix.needsUpdate = true;
    }
  });

  // All entourage meshes explicitly participate in the existing WorldView shadow system.
  const shared = { frustumCulled: false, castShadow: true, receiveShadow: true, raycast: () => null } as const;
  return <group name="site-street-life" userData={{ isStreetLife: true }}>
    {people > 0 && <>
      <instancedMesh key={`b${people}`} ref={bodyRef} args={[figure.body, figureMaterial, people]} {...shared} />
      <instancedMesh key={`t${people}`} ref={thighRef} args={[figure.thigh, figureMaterial, people * 2]} {...shared} />
      <instancedMesh key={`s${people}`} ref={shinRef} args={[figure.shin, figureMaterial, people * 2]} {...shared} />
      <instancedMesh key={`a${people}`} ref={armRef} args={[figure.arm, figureMaterial, people * 2]} {...shared} />
    </>}
    {plan.cars.length > 0 && <>
      <instancedMesh key={`c${plan.cars.length}`} ref={carRef} args={[car.body, carBodyMaterial, plan.cars.length]} {...shared} />
      <instancedMesh key={`g${plan.cars.length}`} ref={cabinRef} args={[car.cabin, carGlassMaterial, plan.cars.length]} {...shared} />
      <instancedMesh key={`r${plan.cars.length}`} ref={roofRef} args={[car.roof, carBodyMaterial, plan.cars.length]} {...shared} />
      <instancedMesh key={`w${plan.cars.length}`} ref={wheelRef} args={[car.wheels, wheelMaterial, plan.cars.length]} {...shared} />
      <instancedMesh key={`h${plan.cars.length}`} ref={hubRef} args={[car.hubs, hubMaterial, plan.cars.length]} {...shared} />
      <instancedMesh key={`fl${plan.cars.length}`} ref={frontLightRef} args={[car.frontLights, headlightMaterial, plan.cars.length]} {...shared} />
      <instancedMesh key={`rl${plan.cars.length}`} ref={rearLightRef} args={[car.rearLights, tailLightMaterial, plan.cars.length]} {...shared} />
    </>}
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
