import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import { useApp } from '../AppContext';

/** A protractor measurement with its guide line, saved as a 'measurement' shape's args. */
export interface ProtractorArgs {
  kind: 'protractor';
  centre: [number, number, number];
  /** Unit direction of the base line, in the protractor's plane. */
  base: [number, number, number];
  /** Unit direction of the measured line (and the guide). */
  direction: [number, number, number];
  normal: [number, number, number];
  /** Signed angle from base to direction about the normal, degrees. */
  angle: number;
  /** Radius the angle arc is drawn at. */
  radius: number;
  /** Guide line end points (long, through the centre). */
  start: [number, number, number];
  end: [number, number, number];
  distance: number;
}

/** How far a guide line reaches each way from the protractor's centre. */
export const GUIDE_REACH = 40;
const SNAP_STEP = 15;
const SNAP_WITHIN = 2.5;

const tmp = new THREE.Vector3();

/** Signed angle (degrees) from a to b about the normal. */
export function signedAngle(a: THREE.Vector3, b: THREE.Vector3, normal: THREE.Vector3): number {
  const angle = Math.atan2(tmp.crossVectors(a, b).dot(normal), a.dot(b));
  return THREE.MathUtils.radToDeg(angle);
}

/** Snaps an angle to the nearest 15° when it is within 2.5° of it. */
export function snapAngle(degrees: number): number {
  const nearest = Math.round(degrees / SNAP_STEP) * SNAP_STEP;
  return Math.abs(nearest - degrees) <= SNAP_WITHIN ? nearest : degrees;
}

/** Rounds a surface normal onto a world axis when it's within ~10° of one. */
function tidyNormal(n: THREE.Vector3): THREE.Vector3 {
  for (const axis of [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)]) {
    if (Math.abs(n.dot(axis)) > 0.985) return axis.multiplyScalar(Math.sign(n.dot(axis)));
  }
  return n.clone().normalize();
}

/** The arc from `base` swept `angle` degrees about `normal`. */
function arcPoints(centre: THREE.Vector3, base: THREE.Vector3, normal: THREE.Vector3, angle: number, radius: number): THREE.Vector3[] {
  const steps = Math.max(8, Math.ceil(Math.abs(angle) / 3));
  return Array.from({ length: steps + 1 }, (_, i) =>
    base.clone().applyAxisAngle(normal, THREE.MathUtils.degToRad(angle * i / steps)).multiplyScalar(radius).add(centre));
}

type Stage =
  | { step: 'centre' }
  | { step: 'base'; centre: THREE.Vector3; normal: THREE.Vector3 }
  | { step: 'angle'; centre: THREE.Vector3; normal: THREE.Vector3; base: THREE.Vector3 };

/**
 * SketchUp-style protractor: click to place its centre on a surface (it lies flat on that
 * surface), click to set the base line, then move to measure the angle and click to place a
 * guide line through the centre at that angle. Angles snap to 15° steps; type a number and press
 * Enter for an exact angle. Esc starts again.
 */
export function ProtractorTool({ onCommit }: { onCommit: (args: ProtractorArgs) => void }) {
  const { gl, camera, raycaster, scene } = useThree();
  const { setMeasurements } = useApp();
  const [stage, setStage] = useState<Stage>({ step: 'centre' });
  const [cursor, setCursor] = useState<{ point: THREE.Vector3; normal: THREE.Vector3 } | null>(null);
  const [typed, setTyped] = useState('');
  const pointer = useMemo(() => new THREE.Vector2(), []);
  const latest = useRef({ stage, typed, onCommit });
  latest.current = { stage, typed, onCommit };

  useEffect(() => {
    setMeasurements(stage.step === 'centre' ? 'Protractor: click to place the centre (it lies flat on the surface you click).'
      : stage.step === 'base' ? 'Protractor: click to set the base line.'
        : 'Protractor: move to measure the angle (snaps every 15°), type an angle and press Enter, or click to place a guide line. Esc to start again.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.step]);

  useEffect(() => {
    const canvas = gl.domElement;
    /** The surface under the cursor, or the ground plane. */
    const surfaceHit = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(scene.children, true).find(i => {
        if (!(i.object as THREE.Mesh).isMesh || !i.face) return false;
        for (let o: THREE.Object3D | null = i.object; o; o = o.parent) {
          if (o.userData?.isShape || o.userData?.isKernelGeometry) return !o.userData?.isWater;
        }
        return false;
      });
      if (hit?.face) {
        const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
        if (normal.dot(raycaster.ray.direction) > 0) normal.negate();
        return { point: hit.point.clone(), normal: tidyNormal(normal) };
      }
      const point = new THREE.Vector3();
      return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), point)
        ? { point, normal: new THREE.Vector3(0, 1, 0) } : null;
    };
    /** Direction in the protractor's plane from its centre towards the cursor. */
    const inPlane = (event: MouseEvent, centre: THREE.Vector3, normal: THREE.Vector3) => {
      const rect = canvas.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const point = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, centre), point)) return null;
      return point;
    };
    let downAt: { x: number; y: number } | null = null;
    const down = (event: PointerEvent) => { if (event.button === 0) downAt = { x: event.clientX, y: event.clientY }; };
    const move = (event: PointerEvent) => {
      const s = latest.current.stage;
      if (s.step === 'centre') { setCursor(surfaceHit(event)); return; }
      const p = inPlane(event, s.centre, s.normal);
      if (p) setCursor({ point: p, normal: s.normal });
    };
    const up = (event: PointerEvent) => {
      if (event.button !== 0 || !downAt) return;
      // A drag orbits the camera; only a click places a point.
      const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 5;
      downAt = null;
      if (moved) return;
      const s = latest.current.stage;
      if (s.step === 'centre') {
        const hit = surfaceHit(event);
        if (hit) setStage({ step: 'base', centre: hit.point, normal: hit.normal });
        return;
      }
      const p = inPlane(event, s.centre, s.normal);
      if (!p) return;
      const dir = p.clone().sub(s.centre);
      if (dir.lengthSq() < 1e-6) return;
      dir.normalize();
      if (s.step === 'base') { setStage({ step: 'angle', centre: s.centre, normal: s.normal, base: dir }); setTyped(''); return; }
      const angle = snapAngle(signedAngle(s.base, dir, s.normal));
      commit(s, angle, p.distanceTo(s.centre));
    };
    const commit = (s: Extract<Stage, { step: 'angle' }>, angle: number, reach: number) => {
      const direction = s.base.clone().applyAxisAngle(s.normal, THREE.MathUtils.degToRad(angle)).normalize();
      const start = s.centre.clone().addScaledVector(direction, -GUIDE_REACH);
      const end = s.centre.clone().addScaledVector(direction, GUIDE_REACH);
      latest.current.onCommit({
        kind: 'protractor',
        centre: s.centre.toArray() as [number, number, number],
        base: s.base.toArray() as [number, number, number],
        direction: direction.toArray() as [number, number, number],
        normal: s.normal.toArray() as [number, number, number],
        angle,
        radius: THREE.MathUtils.clamp(reach, 0.3, 3),
        start: start.toArray() as [number, number, number],
        end: end.toArray() as [number, number, number],
        distance: GUIDE_REACH * 2,
      });
      setStage({ step: 'centre' });
      setTyped('');
    };
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.tagName === 'INPUT' || (event.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      const s = latest.current.stage;
      if (event.key === 'Escape') { setStage({ step: 'centre' }); setTyped(''); return; }
      if (s.step !== 'angle') return;
      if (/^[0-9.]$/.test(event.key) || (event.key === '-' && !latest.current.typed)) {
        event.preventDefault();
        setTyped(t => t + event.key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        setTyped(t => t.slice(0, -1));
      } else if (event.key === 'Enter') {
        const value = parseFloat(latest.current.typed);
        if (Number.isFinite(value)) commit(s, value, 1.5);
      }
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
    };
  }, [gl, camera, raycaster, scene, pointer]);

  // Protractor disc: sized to stay readable on screen.
  const centre = stage.step === 'centre' ? cursor?.point : stage.centre;
  const normal = stage.step === 'centre' ? cursor?.normal : stage.normal;
  if (!centre || !normal) return null;
  const size = Math.max(0.3, camera.position.distanceTo(centre) * 0.08);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  const lifted = centre.clone().addScaledVector(normal, 0.01);

  let live: { dir: THREE.Vector3; angle: number } | null = null;
  if (stage.step === 'angle' && cursor) {
    const d = cursor.point.clone().sub(stage.centre);
    if (d.lengthSq() > 1e-6) {
      const typedValue = parseFloat(typed);
      const angle = Number.isFinite(typedValue) ? typedValue : snapAngle(signedAngle(stage.base, d.normalize(), stage.normal));
      live = { dir: stage.base.clone().applyAxisAngle(stage.normal, THREE.MathUtils.degToRad(angle)), angle };
    }
  }
  const baseDir = stage.step === 'angle' ? stage.base
    : stage.step === 'base' && cursor ? cursor.point.clone().sub(stage.centre).normalize() : null;

  return (
    <group>
      <group position={lifted} quaternion={quaternion}>
        <mesh renderOrder={40}>
          <ringGeometry args={[size * 0.82, size, 72]} />
          <meshBasicMaterial color="#0ea5e9" transparent opacity={0.28} depthTest={false} side={THREE.DoubleSide} />
        </mesh>
        {Array.from({ length: 24 }, (_, i) => {
          const a = (i / 24) * Math.PI * 2, inner = i % 6 === 0 ? size * 0.7 : size * 0.82;
          return <Line key={i} points={[[Math.cos(a) * inner, Math.sin(a) * inner, 0], [Math.cos(a) * size, Math.sin(a) * size, 0]]}
            color="#0369a1" lineWidth={1} depthTest={false} renderOrder={41} />;
        })}
      </group>
      {baseDir && (
        <Line points={[lifted, lifted.clone().addScaledVector(baseDir, size * 1.6)]} color="#ef4444" lineWidth={2} depthTest={false} renderOrder={42} />
      )}
      {stage.step === 'angle' && live && (
        <>
          <Line points={[lifted.clone().addScaledVector(live.dir, -size * 6), lifted.clone().addScaledVector(live.dir, size * 6)]}
            color="#0ea5e9" lineWidth={1.5} dashed dashSize={size * 0.15} gapSize={size * 0.1} depthTest={false} renderOrder={42} />
          <Line points={arcPoints(lifted, stage.base, stage.normal, live.angle, size * 0.6)} color="#f59e0b" lineWidth={2} depthTest={false} renderOrder={43} />
          <Html position={arcPoints(lifted, stage.base, stage.normal, live.angle / 2, size * 0.95).pop()} center style={{ pointerEvents: 'none' }}>
            <div className="whitespace-nowrap rounded bg-black/80 px-2 py-0.5 text-xs font-semibold text-white shadow">
              {typed ? `${typed}°` : `${Math.abs(live.angle).toFixed(1)}°`}
            </div>
          </Html>
        </>
      )}
    </group>
  );
}

/** A placed protractor: the dashed guide line, the measured arc and its angle. */
export function ProtractorMeasurement({ args, selected, onSelect }: { args: ProtractorArgs; selected: boolean; onSelect: () => void }) {
  const centre = new THREE.Vector3(...args.centre);
  const normal = new THREE.Vector3(...args.normal);
  const base = new THREE.Vector3(...args.base);
  const arc = arcPoints(centre.clone().addScaledVector(normal, 0.01), base, normal, args.angle, args.radius);
  const labelAt = arcPoints(centre, base, normal, args.angle / 2, args.radius * 1.35).pop()!;
  return (
    <group>
      <Line points={[args.start, args.end]} color={selected ? '#ffffff' : '#0ea5e9'} lineWidth={selected ? 2 : 1.2}
        dashed dashSize={0.25} gapSize={0.15} transparent opacity={0.9} />
      <Line points={[centre, centre.clone().addScaledVector(base, args.radius * 1.2)]} color="#ef4444" lineWidth={1.5} />
      <Line points={arc} color="#f59e0b" lineWidth={2} />
      <Html position={labelAt} center occlude={false}>
        <div onClick={(e: any) => { e.stopPropagation(); onSelect(); }}
          className={`cursor-pointer whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium text-white shadow-lg ${selected ? 'border-white bg-trimble-blue' : 'border-sky-400/50 bg-black/80 hover:border-sky-300'}`}>
          {Math.abs(args.angle).toFixed(1)}°
        </div>
      </Html>
    </group>
  );
}
