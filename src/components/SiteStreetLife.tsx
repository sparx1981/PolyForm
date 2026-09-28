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

// Moving cars and people on an imported World View site (the plan is lib/worldSite/streetLife.ts).
// People are smooth white figures, like an architect's scale figures; cars are simple shapes in
// muted colours. Everything is instanced (a handful of draw calls however many there are) and
// only moves while shown, so a still editor costs nothing.

/* ---------- Figures ---------- */

// A 1.75 m adult standing on y = 0, facing +z. Limbs hang from their joints (top at the origin).
const HIP_Y = 0.93, HIP_X = 0.1, THIGH = 0.45, SHOULDER_Y = 1.42, SHOULDER_X = 0.235;

function capsuleHanging(radius: number, total: number): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(radius, Math.max(0.01, total - radius * 2), 4, 10);
  g.translate(0, -total / 2, 0);
  return g;
}

function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Small local merge (positions and normals only) so this needs no extra imports.
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
  const head = new THREE.SphereGeometry(0.112, 16, 12);
  head.scale(0.95, 1.15, 1.05);
  head.translate(0, 1.66, 0.01);
  const neck = new THREE.CylinderGeometry(0.055, 0.065, 0.12, 10);
  neck.translate(0, 1.54, 0);
  // Chest broader than the waist: a capsule squashed front to back, with shoulders.
  const torso = new THREE.CapsuleGeometry(0.19, 0.3, 6, 14);
  torso.scale(1, 1, 0.62);
  torso.translate(0, 1.2, 0);
  const shoulders = new THREE.CapsuleGeometry(0.085, 0.3, 4, 10);
  shoulders.rotateZ(Math.PI / 2);
  shoulders.translate(0, 1.42, 0);
  const pelvis = new THREE.SphereGeometry(0.165, 14, 10);
  pelvis.scale(1.02, 0.72, 0.74);
  pelvis.translate(0, 0.95, 0);
  return {
    body: mergeAll([head, neck, torso, shoulders, pelvis]),
    thigh: capsuleHanging(0.095, THIGH + 0.05),
    shin: capsuleHanging(0.072, 0.5),
    arm: capsuleHanging(0.058, 0.66),
  };
}

/** Build variety: [height scale, width scale]. */
const BUILDS: [number, number][] = [[1, 1], [0.95, 0.94], [1.05, 1.08], [0.97, 1.12]];

const figureMaterial = new THREE.MeshStandardMaterial({ color: '#f3f2ee', roughness: 0.82, metalness: 0 });

/* ---------- Cars ---------- */

function carGeometries() {
  // Side profile (forward, up) extruded across the car's width, then turned so forward is +z.
  const side = (pts: [number, number][], width: number) => {
    const shape = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2, curveSegments: 4 });
    g.translate(0, 0, -width / 2);
    g.rotateY(-Math.PI / 2);
    g.computeVertexNormals();
    return g;
  };
  const body = side([[-2.1, 0.3], [2.1, 0.3], [2.18, 0.62], [2.05, 0.82], [1.1, 0.95], [-1.95, 0.98], [-2.16, 0.8]], 1.62);
  const cabin = side([[1.05, 0.95], [0.4, 1.4], [-1.05, 1.44], [-1.75, 0.98]], 1.42);
  const wheels: THREE.BufferGeometry[] = [];
  for (const u of [-1.35, 1.3]) for (const x of [-0.78, 0.78]) {
    const w = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 14);
    w.rotateZ(Math.PI / 2);
    w.translate(x, 0.32, u);
    wheels.push(w);
  }
  return { body, cabin, wheels: mergeAll(wheels) };
}

const CAR_PALETTE = ['#aeb8bb', '#97a5b2', '#b9c2ab', '#d8d2c4', '#a4af9f', '#c7ccd1', '#8a98a3', '#cbbdaf'];
const carBodyMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, metalness: 0.1 });
const carGlassMaterial = new THREE.MeshStandardMaterial({ color: '#6b7680', roughness: 0.3, metalness: 0.2 });
const wheelMaterial = new THREE.MeshStandardMaterial({ color: '#4a4c4f', roughness: 0.9, metalness: 0 });

/* ---------- Placement ---------- */

/** Seats on the model's benches (two per bench if it's long enough), in world space. */
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

export interface SiteStreetLifeProps {
  ground: Shape;
  routes: SiteRoute[];
  level: StreetLifeLevel;
  seats: Seat[];
}

const tmp = {
  base: new THREE.Matrix4(),
  joint: new THREE.Matrix4(),
  rot: new THREE.Matrix4(),
  knee: new THREE.Matrix4(),
  out: new THREE.Matrix4(),
  q: new THREE.Quaternion(),
  e: new THREE.Euler(0, 0, 0, 'YXZ'),
  p: new THREE.Vector3(),
  s: new THREE.Vector3(),
};

export function SiteStreetLife({ ground, routes, level, seats }: SiteStreetLifeProps) {
  const site = ground.terrainData!.site!;
  const plan = useMemo(
    () => planStreetLife(routes, { level, leftHand: drivesOnLeft(site), small: isSmallDevice(), seats, seed: Math.round(site.lat * 1e4 + site.lng * 1e4) }),
    [routes, level, seats, site.lat, site.lng],
  );
  const figure = useMemo(figureGeometries, []);
  const car = useMemo(carGeometries, []);
  useEffect(() => () => { Object.values(figure).forEach(g => g.dispose()); Object.values(car).forEach(g => g.dispose()); }, [figure, car]);

  // Ground height at a world point (the site ground is a terrain, possibly moved or reshaped).
  const t = ground.terrainData!;
  const [gx, gy, gz] = ground.position;
  const heightAt = (x: number, z: number) => gridHeightAt(t, x - gx, z - gz) + gy;

  const people = plan.walkers.length + plan.standers.length + plan.sitters.length;
  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const thighRef = useRef<THREE.InstancedMesh>(null);
  const shinRef = useRef<THREE.InstancedMesh>(null);
  const armRef = useRef<THREE.InstancedMesh>(null);
  const carRef = useRef<THREE.InstancedMesh>(null);
  const cabinRef = useRef<THREE.InstancedMesh>(null);
  const wheelRef = useRef<THREE.InstancedMesh>(null);
  const time = useRef(0);

  useLayoutEffect(() => {
    const m = carRef.current;
    if (!m) return;
    const c = new THREE.Color();
    plan.cars.forEach((k, i) => m.setColorAt(i, c.set(CAR_PALETTE[k.color % CAR_COLOURS]!)));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [plan]);

  /** Puts one limb (two instances per person: left then right). */
  const limb = (mesh: THREE.InstancedMesh, index: number, jx: number, jy: number, angle: number, bend?: number) => {
    tmp.joint.makeTranslation(jx, jy, 0);
    tmp.rot.makeRotationX(-angle);
    tmp.out.multiplyMatrices(tmp.base, tmp.joint).multiply(tmp.rot);
    if (bend !== undefined) {
      tmp.knee.makeTranslation(0, -THIGH, 0);
      tmp.out.multiply(tmp.knee).multiply(tmp.rot.makeRotationX(bend));
    }
    mesh.setMatrixAt(index, tmp.out);
  };

  /** Places a person: body frame at (x, y, z) turned `yaw`, then its limbs. */
  const person = (i: number, x: number, y: number, z: number, yaw: number, child: boolean, body: number,
    legs: [number, number], arms: [number, number], knees: [number, number]) => {
    const [hs, ws] = BUILDS[body % BODY_TYPES]!;
    const k = child ? 0.62 : 1;
    tmp.q.setFromEuler(tmp.e.set(0, yaw, 0));
    tmp.base.compose(tmp.p.set(x, y, z), tmp.q, tmp.s.set(k * ws, k * hs, k * ws));
    bodyRef.current!.setMatrixAt(i, tmp.base);
    limb(thighRef.current!, i * 2, -HIP_X, HIP_Y, legs[0]);
    limb(thighRef.current!, i * 2 + 1, HIP_X, HIP_Y, legs[1]);
    limb(shinRef.current!, i * 2, -HIP_X, HIP_Y, legs[0], knees[0]);
    limb(shinRef.current!, i * 2 + 1, HIP_X, HIP_Y, legs[1], knees[1]);
    limb(armRef.current!, i * 2, -SHOULDER_X, SHOULDER_Y, arms[0]);
    limb(armRef.current!, i * 2 + 1, SHOULDER_X, SHOULDER_Y, arms[1]);
  };

  useFrame((_, delta) => {
    time.current += Math.min(delta, 0.1);
    const now = time.current;
    if (people && bodyRef.current) {
      let i = 0;
      for (const w of plan.walkers) {
        const loop = plan.walkLoops[w.loop]!;
        const dist = w.start + now * w.speed;
        const p = pointOnLoop(loop, dist);
        const g = gait(dist, w.child ? 1.0 : 1.4);
        // The knee bends as the leg swings back.
        const knee = (a: number) => 0.1 + Math.max(0, -a) * 0.9;
        person(i++, p.x, heightAt(p.x, p.z) + g.bob, p.z, Math.atan2(p.dx, p.dz), w.child, w.body,
          [g.leftLeg, g.rightLeg], [g.leftArm, g.rightArm], [knee(g.leftLeg), knee(g.rightLeg)]);
      }
      for (const [n, s] of plan.standers.entries()) {
        const sway = Math.sin(now * 0.8 + n) * 0.04;
        person(i++, s.x, heightAt(s.x, s.z), s.z, s.yaw + sway, s.child, s.body, [0.02, -0.02], [0.08 + sway, -0.05 - sway], [0.03, 0.03]);
      }
      for (const s of plan.sitters) {
        // Hips on the seat, thighs forward, shins down.
        person(i++, s.x, s.y - HIP_Y + 0.07, s.z, s.yaw, false, s.body, [Math.PI / 2, Math.PI / 2], [0.35, 0.35], [Math.PI / 2, Math.PI / 2]);
      }
      for (const m of [bodyRef, thighRef, shinRef, armRef]) m.current!.instanceMatrix.needsUpdate = true;
    }
    if (plan.cars.length && carRef.current) {
      plan.cars.forEach((c, i) => {
        const loop = plan.carLoops[c.loop]!;
        const d = c.start + now * c.speed;
        const p = pointOnLoop(loop, d);
        const front = pointOnLoop(loop, d + 1.4), back = pointOnLoop(loop, d - 1.4);
        const hf = heightAt(front.x, front.z), hb = heightAt(back.x, back.z);
        tmp.q.setFromEuler(tmp.e.set(-Math.atan2(hf - hb, 2.8), Math.atan2(p.dx, p.dz), 0));
        tmp.base.compose(tmp.p.set(p.x, (hf + hb) / 2, p.z), tmp.q, tmp.s.set(1, 1, 1));
        carRef.current!.setMatrixAt(i, tmp.base);
        cabinRef.current!.setMatrixAt(i, tmp.base);
        wheelRef.current!.setMatrixAt(i, tmp.base);
      });
      for (const m of [carRef, cabinRef, wheelRef]) m.current!.instanceMatrix.needsUpdate = true;
    }
  });

  const shared = { frustumCulled: false, castShadow: true, receiveShadow: true, raycast: () => null } as const;
  return (
    <group name="site-street-life" userData={{ isStreetLife: true }}>
      {people > 0 && (
        <>
          <instancedMesh key={`b${people}`} ref={bodyRef} args={[figure.body, figureMaterial, people]} {...shared} />
          <instancedMesh key={`t${people}`} ref={thighRef} args={[figure.thigh, figureMaterial, people * 2]} {...shared} />
          <instancedMesh key={`s${people}`} ref={shinRef} args={[figure.shin, figureMaterial, people * 2]} {...shared} />
          <instancedMesh key={`a${people}`} ref={armRef} args={[figure.arm, figureMaterial, people * 2]} {...shared} />
        </>
      )}
      {plan.cars.length > 0 && (
        <>
          <instancedMesh key={`c${plan.cars.length}`} ref={carRef} args={[car.body, carBodyMaterial, plan.cars.length]} {...shared} />
          <instancedMesh key={`g${plan.cars.length}`} ref={cabinRef} args={[car.cabin, carGlassMaterial, plan.cars.length]} {...shared} />
          <instancedMesh key={`w${plan.cars.length}`} ref={wheelRef} args={[car.wheels, wheelMaterial, plan.cars.length]} {...shared} />
        </>
      )}
    </group>
  );
}

/* ---------- In the scene ---------- */

const fetchingRoutes = new Set<string>();

/**
 * Street life for the model's imported site, if any: shown in presentations (editor panel or
 * client page) and, when the designer turns it on, in the editor too. A site imported before
 * street life existed gets its roads and paths fetched the first time it's needed.
 */
export function SiteStreetLifeLayer({ shapes }: { shapes: Shape[] }) {
  const { setShapes } = useApp();
  const { active } = usePresentation();
  const ground = findSiteGround(shapes);
  const site = ground?.terrainData?.site;
  const level: StreetLifeLevel = site?.streetLife ?? 'normal';
  const show = !!site && level !== 'off' && (active || !!site.streetLifeInEditor);
  const benches = shapes.filter(s => s.type === 'bench');
  const seatsKey = JSON.stringify(benches.map(b => [b.position, b.quaternion, b.rotation, b.args, b.scale, b.hidden]));
  const seats = useMemo(() => benchSeats(benches), [seatsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!show || !site || site.routes) return;
    const key = `${site.lat},${site.lng},${site.size}`;
    if (fetchingRoutes.has(key)) return;
    fetchingRoutes.add(key);
    const origin = { lat: site.lat, lng: site.lng };
    browserSiteIO.overpass(streetsQuery(origin, site.size))
      .then(json => {
        const routes = parseStreets(json, origin, site.size);
        setShapes(prev => prev.map(s => (s.terrainData?.site && s.terrainData.site.lat === site.lat && s.terrainData.site.lng === site.lng && !s.terrainData.site.routes
          ? { ...s, terrainData: { ...s.terrainData, site: { ...s.terrainData.site, routes } } }
          : s)));
      })
      .catch(err => console.warn('[WorldView] Streets for moving cars and people failed:', err))
      .finally(() => fetchingRoutes.delete(key));
  }, [show, site, setShapes]);

  // Routes are kept relative to the site ground; the drawing works in the model.
  const [gx, , gz] = ground?.position ?? [0, 0, 0];
  const routes = useMemo(
    () => (site?.routes ?? []).map(r => (gx || gz ? { ...r, points: r.points.map(([x, z]) => [x + gx, z + gz] as [number, number]) } : r)),
    [site?.routes, gx, gz],
  );
  if (!show || !ground || !routes.length) return null;
  return <SiteStreetLife ground={ground} routes={routes} level={level} seats={seats} />;
}

/** A line along the ground, raised a little and drawn over everything. */
function groundLine(pts: [number, number][], groundAt: (x: number, z: number) => number, lift = 0.15) {
  // Extra points on long stretches, so the line follows the slope instead of cutting through it.
  const out: THREE.Vector3[] = [];
  pts.forEach(([x, z], i) => {
    if (i > 0) {
      const [px, pz] = pts[i - 1]!;
      const steps = Math.floor(Math.hypot(x - px, z - pz) / 3);
      for (let k = 1; k < steps; k++) {
        const t = k / steps, ix = px + (x - px) * t, iz = pz + (z - pz) * t;
        out.push(new THREE.Vector3(ix, groundAt(ix, iz) + lift, iz));
      }
    }
    out.push(new THREE.Vector3(x, groundAt(x, z) + lift, z));
  });
  return out;
}

/**
 * While the route tool is on: the site's routes (map ones grey, drawn ones blue for walking and
 * amber for driving) and the one being drawn.
 */
export function RouteDrawPreview({ shapes, vertices, candidate, groundAt }: {
  shapes: Shape[];
  vertices: THREE.Vector3[];
  candidate: THREE.Vector3 | null;
  groundAt: (x: number, z: number) => number;
}) {
  const ground = findSiteGround(shapes);
  const routes = ground?.terrainData?.site?.routes ?? [];
  const [gx, , gz] = ground?.position ?? [0, 0, 0];
  const lines = useMemo(() => routes.map(r => ({
    id: r.id,
    color: r.source === 'map' ? '#9ca3af' : r.kind === 'road' ? '#d97706' : '#0063A3',
    points: groundLine(r.points.map(([x, z]) => [x + gx, z + gz] as [number, number]), groundAt),
  })), [routes, gx, gz, groundAt]);
  const drawing = useMemo(() => {
    const pts = (candidate ? [...vertices, candidate] : vertices).map(v => [v.x, v.z] as [number, number]);
    return pts.length >= 2 ? groundLine(pts, groundAt, 0.2) : null;
  }, [vertices, candidate, groundAt]);
  const colour = routeTool.kind === 'road' ? '#d97706' : '#0063A3';
  return (
    <group renderOrder={999}>
      {lines.filter(l => l.points.length >= 2).map(l => (
        <Line key={l.id} points={l.points} color={l.color} lineWidth={l.color === '#9ca3af' ? 1.5 : 2.5} dashed={l.color === '#9ca3af'} dashSize={1} gapSize={0.6} depthTest={false} transparent opacity={0.9} />
      ))}
      {drawing && <Line points={drawing} color={colour} lineWidth={3} depthTest={false} />}
      {vertices.map((v, i) => (
        <mesh key={i} position={[v.x, groundAt(v.x, v.z) + 0.2, v.z]} renderOrder={1000}>
          <sphereGeometry args={[0.18, 12, 8]} />
          <meshBasicMaterial color={i === 0 ? '#22c55e' : colour} depthTest={false} />
        </mesh>
      ))}
    </group>
  );
}
