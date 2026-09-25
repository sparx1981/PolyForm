import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import type { Shape } from '../../types';
import { useApp } from '../../AppContext';
import { groundUnderRay } from '../../lib/terrain/groundRay';
import { arcPoint, bulgeThrough, stepAnchor, type Vec2 } from '../../lib/patio/patioGeometry';
import type { PatioData } from '../../lib/patio/patioTypes';
import { wallFaces, type WallFace } from '../../lib/patio/patioPlacement';

export { wallFaces, patioGroundHelpers } from '../../lib/patio/patioPlacement';

/** How close (m) the cursor must be to a wall face, corner or the first point to snap to it. */
const SNAP = 0.35;

/**
 * Set by an edit handle when it takes a pointer press, so the drawing tool (whose canvas
 * listener sees the same press first) ignores it when the press ends.
 */
const handleBusy = { current: false };

export interface SnappedPoint { p: Vec2; wall?: WallFace }

/** Snaps a ground point onto the nearest wall corner or face within reach. */
export function snapToWalls(p: Vec2, faces: WallFace[]): SnappedPoint {
  let best: SnappedPoint = { p };
  let bestDistance = SNAP;
  for (const face of faces) {
    for (const corner of [face.a, face.b]) {
      const d = Math.hypot(p[0] - corner[0], p[1] - corner[1]);
      // Corners win over faces at the same distance.
      if (d < bestDistance + 0.1 && d < SNAP) { best = { p: [corner[0], corner[1]], wall: face }; bestDistance = d - 0.1; }
    }
    const dx = face.b[0] - face.a[0], dz = face.b[1] - face.a[1], len2 = dx * dx + dz * dz;
    const t = ((p[0] - face.a[0]) * dx + (p[1] - face.a[1]) * dz) / len2;
    if (t < 0 || t > 1) continue;
    const q: Vec2 = [face.a[0] + dx * t, face.a[1] + dz * t];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < bestDistance) { best = { p: q, wall: face }; bestDistance = d; }
  }
  return best;
}

/** Terrain (as drawn) under a world point, or undefined when there is none. */
interface Draft {
  points: SnappedPoint[];
  bulges: number[];
  /** Shift-clicked point the next edge curves through. */
  through: Vec2 | null;
}

/**
 * Draws a new patio or deck: click corners (Shift+click a point for the next edge to curve
 * through it), or drag out a rectangle; click the first point, double-click or press Enter to
 * finish. Points snap to wall faces and corners; an edge along a wall gets no railing or steps,
 * and the surface is set level with that building's floor.
 */
export function PatioDrawTool({ groundAt, onCommit, paused }: {
  /** Ground height at world x/z as drawn (for the cursor). */
  groundAt: (x: number, z: number) => number;
  onCommit: (points: SnappedPoint[], bulges: number[]) => void;
  /** While steps are being placed, clicks belong to that instead. */
  paused: boolean;
}) {
  const { gl, camera, raycaster } = useThree();
  const { shapes, setMeasurements } = useApp();
  const faces = useMemo(() => wallFaces(shapes), [shapes]);
  const [draft, setDraft] = useState<Draft>({ points: [], bulges: [], through: null });
  const [cursor, setCursor] = useState<SnappedPoint | null>(null);
  const [drag, setDrag] = useState<{ from: SnappedPoint; to: Vec2 } | null>(null);
  const draftRef = useRef(draft); draftRef.current = draft;
  const dragRef = useRef(drag); dragRef.current = drag;
  const pointer = useMemo(() => new THREE.Vector2(), []);

  const groundPoint = (event: PointerEvent | MouseEvent): SnappedPoint | null => {
    const rect = gl.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = groundUnderRay(raycaster.ray, groundAt);
    if (!hit) return null;
    return snapToWalls([hit.x, hit.z], faces);
  };

  useEffect(() => {
    setMeasurements('Patio / Decking: click the corners (hold Shift to curve the next edge through a point) or drag a rectangle. Click the first point or press Enter to finish.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The listeners below are attached once. They read everything that changes between renders
  // through this ref: the app's callbacks are recreated on every app render, and re-attaching
  // the listeners between a press and its release used to lose the click entirely.
  const latest = useRef({ groundPoint, onCommit, faces, paused });
  latest.current = { groundPoint, onCommit, faces, paused };

  useEffect(() => {
    const canvas = gl.domElement;
    let downAt: { x: number; y: number; point: SnappedPoint } | null = null;
    const groundPoint = (event: PointerEvent | MouseEvent) => latest.current.groundPoint(event);
    const onCommit = (points: SnappedPoint[], bulges: number[]) => latest.current.onCommit(points, bulges);
    const finish = () => {
      const d = draftRef.current;
      if (d.points.length >= 3) {
        const bulges = d.points.map((_, i) => d.bulges[i] ?? 0);
        onCommit(d.points, bulges);
      }
      setDraft({ points: [], bulges: [], through: null });
    };
    const down = (event: PointerEvent) => {
      handleBusy.current = false;
      if (event.button !== 0 || latest.current.paused) return;
      const point = groundPoint(event);
      if (!point) return;
      downAt = { x: event.clientX, y: event.clientY, point };
    };
    const move = (event: PointerEvent) => {
      const point = groundPoint(event);
      setCursor(point);
      if (downAt && !handleBusy.current && draftRef.current.points.length === 0 && point
        && Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 8) {
        setDrag({ from: downAt.point, to: point.p });
      }
    };
    const up = (event: PointerEvent) => {
      if (event.button !== 0 || !downAt) return;
      const start = downAt;
      downAt = null;
      if (handleBusy.current) { handleBusy.current = false; setDrag(null); return; }
      const currentDrag = dragRef.current;
      if (currentDrag) {
        setDrag(null);
        const corners = dragRectangle(currentDrag.from, currentDrag.to);
        if (corners) onCommit(corners.map(p => snapToWalls(p, latest.current.faces)), [0, 0, 0, 0]);
        return;
      }
      const point = groundPoint(event) ?? start.point;
      const d = draftRef.current;
      // Clicking the first point closes the outline.
      if (d.points.length >= 3 && Math.hypot(point.p[0] - d.points[0].p[0], point.p[1] - d.points[0].p[1]) < SNAP) {
        const bulges = d.bulges.slice();
        if (d.through) bulges[d.points.length - 1] = bulgeThrough(d.points[d.points.length - 1].p, d.points[0].p, d.through);
        draftRef.current = { ...d, bulges, through: null };
        finish();
        return;
      }
      if (event.shiftKey && d.points.length > 0) {
        // A curve: the next edge will bow through this point.
        setDraft({ ...d, through: point.p });
        return;
      }
      // The second click of a double-click lands on the point just placed: don't add it twice.
      const last = d.points[d.points.length - 1];
      if (last && Math.hypot(point.p[0] - last.p[0], point.p[1] - last.p[1]) < 0.05) return;
      const bulges = d.bulges.slice();
      if (d.through && d.points.length) bulges[d.points.length - 1] = bulgeThrough(d.points[d.points.length - 1].p, point.p, d.through);
      setDraft({ points: [...d.points, point], bulges, through: null });
    };
    const dblclick = () => finish();
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.tagName === 'INPUT') return;
      if (event.key === 'Enter') finish();
      else if (event.key === 'Escape') setDraft({ points: [], bulges: [], through: null });
      else if (event.key === 'Backspace' && draftRef.current.points.length) {
        event.preventDefault();
        const d = draftRef.current;
        setDraft({ points: d.points.slice(0, -1), bulges: d.bulges.slice(0, d.points.length - 2), through: null });
      }
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    canvas.addEventListener('dblclick', dblclick);
    window.addEventListener('keydown', key);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      canvas.removeEventListener('dblclick', dblclick);
      window.removeEventListener('keydown', key);
    };
  }, [gl]);

  // Preview: the outline so far, the edge to the cursor (curved through a Shift-clicked point).
  const preview = useMemo(() => {
    const pts = draft.points.map(p => p.p);
    const bulges = draft.bulges.slice();
    if (drag) {
      const corners = dragRectangle(drag.from, drag.to);
      return corners ? { line: [...corners, corners[0]], closed: true } : null;
    }
    if (!pts.length) return null;
    const line: Vec2[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      for (let k = 0; k < 16; k++) line.push(arcPoint(pts[i], pts[i + 1], bulges[i] ?? 0, k / 16));
    }
    const last = pts[pts.length - 1];
    if (cursor) {
      const bulge = draft.through ? bulgeThrough(last, cursor.p, draft.through) : 0;
      for (let k = 0; k <= 16; k++) line.push(arcPoint(last, cursor.p, bulge, k / 16));
    } else line.push(last);
    return { line, closed: false };
  }, [draft, cursor, drag]);

  const lift = (p: Vec2) => new THREE.Vector3(p[0], groundAt(p[0], p[1]) + 0.04, p[1]);
  return (
    <group>
      {preview && preview.line.length > 1 && (
        <Line points={preview.line.map(lift)} color="#f59e0b" lineWidth={2.5} depthTest={false} renderOrder={30} />
      )}
      {draft.points.map((point, i) => (
        <mesh key={i} position={lift(point.p)} renderOrder={31}>
          <sphereGeometry args={[i === 0 ? 0.12 : 0.08, 12, 8]} />
          <meshBasicMaterial color={point.wall ? '#38bdf8' : i === 0 ? '#ffffff' : '#f59e0b'} depthTest={false} />
        </mesh>
      ))}
      {draft.through && (
        <mesh position={lift(draft.through)} renderOrder={31}>
          <octahedronGeometry args={[0.1]} />
          <meshBasicMaterial color="#a78bfa" depthTest={false} />
        </mesh>
      )}
      {cursor && (
        <mesh position={lift(cursor.p)} renderOrder={31}>
          <ringGeometry args={[0.09, 0.14, 20]} />
          <meshBasicMaterial color={cursor.wall ? '#38bdf8' : '#ffffff'} depthTest={false} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

/** Rectangle corners for a drag from one point to another: along a wall if it started on one, else square to the world. */
export function dragRectangle(from: SnappedPoint, to: Vec2): Vec2[] | null {
  let ux = 1, uz = 0;
  if (from.wall) {
    const dx = from.wall.b[0] - from.wall.a[0], dz = from.wall.b[1] - from.wall.a[1], len = Math.hypot(dx, dz) || 1;
    ux = dx / len; uz = dz / len;
  }
  const vx = -uz, vz = ux;
  const ex = to[0] - from.p[0], ez = to[1] - from.p[1];
  const a = ex * ux + ez * uz, b = ex * vx + ez * vz;
  if (Math.abs(a) < 0.3 || Math.abs(b) < 0.3) return null;
  const o = from.p;
  return [o, [o[0] + ux * a, o[1] + uz * a], [o[0] + ux * a + vx * b, o[1] + uz * a + vz * b], [o[0] + vx * b, o[1] + vz * b]];
}

/**
 * Handles for a selected patio or deck: drag a yellow corner to move it, click a white edge
 * dot to add a corner there, Shift-drag an edge dot to bend the edge into a curve (a curved
 * edge's violet dot drags its curve; Shift-click it to straighten), right-click a corner to
 * remove it. With "Add steps" on, click an edge to put a flight of steps there.
 */
export function PatioEditHandles({ shape }: { shape: Shape }) {
  const { setShapes, commitHistory, patioToolSettings, setPatioToolSettings } = useApp();
  const controls = useThree(state => state.controls) as unknown as { enabled: boolean } | null;
  const { gl, camera, raycaster } = useThree();
  const data = shape.patioData!;
  const [px, py, pz] = shape.position;
  const world = data.points.map(([x, z]) => [px + x, pz + z] as Vec2);
  const [drag, setDrag] = useState<{ kind: 'corner' | 'bend'; index: number; point: Vec2 } | null>(null);
  const [stepHover, setStepHover] = useState<{ edge: number; t: number; p: Vec2 } | null>(null);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -(py + 0.06)), [py]);
  const y = py + 0.06;

  const commit = (patch: Partial<PatioData>) => {
    setShapes(prev => prev.map(s => s.id === shape.id ? { ...s, patioData: { ...s.patioData!, ...patch } } : s));
    commitHistory();
  };
  const toLocal = (p: Vec2): Vec2 => [p[0] - px, p[1] - pz];

  // Live preview while dragging.
  const points = world.slice();
  const bulges = data.bulges.slice();
  if (drag?.kind === 'corner') points[drag.index] = drag.point;
  if (drag?.kind === 'bend') {
    const a = world[drag.index], b = world[(drag.index + 1) % world.length];
    bulges[drag.index] = bulgeThrough(a, b, drag.point);
  }
  const n = points.length;

  const endDrag = () => {
    if (controls) controls.enabled = true;
    if (!drag) return;
    if (drag.kind === 'corner') commit({ points: points.map(toLocal) });
    else commit({ bulges });
    setDrag(null);
  };

  const hitPlane = (event: { ray: THREE.Ray }): Vec2 | null => {
    const hit = new THREE.Vector3();
    return event.ray.intersectPlane(plane, hit) ? [hit.x, hit.z] : null;
  };

  // Step placement: nearest edge under the cursor.
  const placing = patioToolSettings.placingSteps;
  useFrame(() => {
    if (!placing) return;
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, hit)) { setStepHover(null); return; }
    const local: Vec2 = [hit.x - px, hit.z - pz];
    // Nearest point on any drawn edge (curves sampled along their arc).
    let best = Infinity, edge = -1, t = 0;
    for (let i = 0; i < data.points.length; i++) {
      const a = data.points[i], b = data.points[(i + 1) % data.points.length];
      for (let k = 0; k <= 64; k++) {
        const q = arcPoint(a, b, data.bulges[i] ?? 0, k / 64);
        const d = Math.hypot(local[0] - q[0], local[1] - q[1]);
        if (d < best) { best = d; edge = i; t = k / 64; }
      }
    }
    const at = edge >= 0 ? arcPoint(data.points[edge], data.points[(edge + 1) % data.points.length], data.bulges[edge] ?? 0, t) : local;
    if (best > 0.8 || edge < 0 || data.wallEdges[edge]) { if (stepHover) setStepHover(null); return; }
    const tt = THREE.MathUtils.clamp(t, 0.05, 0.95);
    if (!stepHover || stepHover.edge !== edge || Math.abs(stepHover.t - tt) > 0.005) setStepHover({ edge, t: tt, p: [at[0] + px, at[1] + pz] });
  });
  useEffect(() => {
    if (!placing) { setStepHover(null); return; }
    const canvas = gl.domElement;
    const click = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const hover = stepHoverRef.current;
      if (!hover) return;
      handleBusy.current = true;
      commit({ steps: [...data.steps, { edge: hover.edge, t: hover.t, width: patioToolSettings.stepWidth }] });
      setPatioToolSettings(prev => ({ ...prev, placingSteps: false }));
    };
    canvas.addEventListener('click', click);
    return () => canvas.removeEventListener('click', click);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placing, gl, camera, data.steps, patioToolSettings.stepWidth]);
  const stepHoverRef = useRef(stepHover); stepHoverRef.current = stepHover;

  const outlinePreview = useMemo(() => {
    const line: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 16; k++) { const p = arcPoint(points[i], points[(i + 1) % n], bulges[i] ?? 0, k / 16); line.push(new THREE.Vector3(p[0], y, p[1])); }
    }
    line.push(line[0]);
    return line;
  }, [points.map(p => p.join()).join(), bulges.join(), y]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <group>
      {drag && <Line points={outlinePreview} color="#f59e0b" lineWidth={2} depthTest={false} renderOrder={19} />}
      {points.map(([x, z], index) => (
        <mesh key={`corner-${index}`} position={[x, y, z]} renderOrder={20}
          onPointerDown={event => {
            event.stopPropagation();
            handleBusy.current = true;
            (event.target as Element).setPointerCapture?.(event.pointerId);
            if (controls) controls.enabled = false;
            setDrag({ kind: 'corner', index, point: [x, z] });
          }}
          onPointerMove={event => {
            if (drag?.kind !== 'corner' || drag.index !== index) return;
            event.stopPropagation();
            const p = hitPlane(event);
            if (p) setDrag({ kind: 'corner', index, point: p });
          }}
          onPointerUp={event => { event.stopPropagation(); endDrag(); }}
          onContextMenu={event => {
            event.stopPropagation();
            event.nativeEvent.preventDefault();
            handleBusy.current = true;
            if (n <= 3) return;
            const keep = (_: unknown, i: number) => i !== index;
            // The edges either side of the corner merge into one straight edge.
            const prev = (index - 1 + n) % n;
            const nextBulges = data.bulges.map((b, i) => i === prev ? 0 : b).filter(keep);
            const nextWalls = data.wallEdges.map((w, i) => i === prev ? w && data.wallEdges[index] : w).filter(keep);
            const steps = data.steps.filter(s => s.edge !== index && s.edge !== prev).map(s => ({ ...s, edge: s.edge > index ? s.edge - 1 : s.edge }));
            commit({ points: data.points.filter(keep), bulges: nextBulges, wallEdges: nextWalls, steps });
          }}>
          <sphereGeometry args={[0.14, 14, 10]} />
          <meshBasicMaterial color={drag?.kind === 'corner' && drag.index === index ? '#ffffff' : '#ffd02f'} depthTest={false} transparent opacity={0.95} />
        </mesh>
      ))}
      {points.map((a, index) => {
        // Edge dots stay mounted through a bend drag: the dot being dragged holds the pointer.
        if (drag?.kind === 'corner') return null;
        const bending = drag?.kind === 'bend' && drag.index === index;
        if (drag && !bending) return null;
        const b = points[(index + 1) % n];
        const curved = Math.abs(bulges[index] ?? 0) > 1e-4;
        const [mx, mz] = bending ? drag!.point : arcPoint(a, b, bulges[index] ?? 0, 0.5);
        return (
          <mesh key={`mid-${index}`} position={[mx, y, mz]} renderOrder={20}
            onPointerDown={event => {
              event.stopPropagation();
              handleBusy.current = true;
              if (!event.shiftKey && !curved) return;
              (event.target as Element).setPointerCapture?.(event.pointerId);
              if (controls) controls.enabled = false;
              setDrag({ kind: 'bend', index, point: [mx, mz] });
            }}
            onPointerMove={event => {
              if (!bending) return;
              event.stopPropagation();
              const p = hitPlane(event);
              if (p) setDrag({ kind: 'bend', index, point: p });
            }}
            onPointerUp={event => { if (!bending) return; event.stopPropagation(); endDrag(); }}
            onClick={event => {
              event.stopPropagation();
              if (event.shiftKey || curved || drag) return;
              // Split the edge: the new corner goes at its middle.
              const insert = (arr: any[], value: any) => { const next = arr.slice(); next.splice(index + 1, 0, value); return next; };
              const steps = data.steps.map(s => s.edge > index ? { ...s, edge: s.edge + 1 }
                : s.edge === index ? (s.t < 0.5 ? { ...s, t: s.t * 2 } : { ...s, edge: index + 1, t: (s.t - 0.5) * 2 }) : s);
              commit({
                points: insert(data.points, toLocal([mx, mz])),
                bulges: insert(data.bulges, 0),
                wallEdges: insert(data.wallEdges, data.wallEdges[index]),
                steps,
              });
            }}>
            <sphereGeometry args={[curved || bending ? 0.12 : 0.1, 10, 8]} />
            <meshBasicMaterial color={curved || bending ? '#a78bfa' : '#ffffff'} depthTest={false} transparent opacity={0.85} />
          </mesh>
        );
      })}
      {placing && stepHover && (
        <StepGhost data={data} hover={stepHover} width={patioToolSettings.stepWidth} y={y} origin={[px, pz]} />
      )}
    </group>
  );
}

/** Outline of where a new flight of steps would go. */
function StepGhost({ data, hover, width, y, origin }: { data: PatioData; hover: { edge: number; t: number }; width: number; y: number; origin: Vec2 }) {
  const { point: p, normal: [nx, nz], tangent: [tx, tz] } = stepAnchor(data, { edge: hover.edge, t: hover.t, width });
  const corner = (s: number, d: number) => new THREE.Vector3(origin[0] + p[0] + tx * s + nx * d, y, origin[1] + p[1] + tz * s + nz * d);
  const h = width / 2;
  return <Line points={[corner(-h, 0), corner(-h, 0.9), corner(h, 0.9), corner(h, 0), corner(-h, 0)]} color="#22c55e" lineWidth={3} depthTest={false} renderOrder={22} />;
}

