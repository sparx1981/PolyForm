import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import type { Shape } from '../../types';
import { useApp } from '../../AppContext';
import { pointInPolygon, type Vec2 } from '../../lib/patio/patioGeometry';
import { buildingOutlines } from '../../lib/patio/patioClosure';
import { outsideSide, placeBalcony, type BalconyPlacement } from '../../lib/patio/balcony';
import type { BalconyFront } from '../../lib/patio/patioTypes';

/** The shape a scene object belongs to. */
function shapeIdOf(object: THREE.Object3D | null): string | null {
  for (let o = object; o; o = o.parent) {
    if (o.userData?.isShape && typeof o.userData.id === 'string') return o.userData.id;
  }
  return null;
}

/** The door or window nearest a point on a wall (in the wall's plane), if the point is on or near one. */
export function openingNear(wall: Shape, point: THREE.Vector3, shapes: Shape[]): Shape | null {
  const q = new THREE.Quaternion(...(wall.quaternion ?? [0, 0, 0, 1]));
  if (!wall.quaternion && wall.rotation) q.setFromEuler(new THREE.Euler(...wall.rotation));
  const inv = q.clone().invert();
  const toLocal = (p: THREE.Vector3) => p.clone().sub(new THREE.Vector3(...wall.position)).applyQuaternion(inv);
  const hit = toLocal(point);
  let best: Shape | null = null, bestD = Infinity;
  for (const s of shapes) {
    if ((s.type !== 'door' && s.type !== 'window') || s.hidden) continue;
    const local = toLocal(new THREE.Vector3(...s.position));
    const thickness = (Array.isArray(wall.args) ? wall.args[2] : 0.2) || 0.2;
    if (s.hostWallId !== wall.id && Math.abs(local.z) > thickness / 2 + 0.3) continue;
    const [w = 0.9, h = 2.1] = Array.isArray(s.args) ? s.args as number[] : [];
    const dx = Math.max(0, Math.abs(hit.x - local.x) - w / 2), dy = Math.max(0, Math.abs(hit.y - local.y) - h / 2);
    const d = Math.hypot(dx, dy);
    if (d < 0.5 && d < bestD) { bestD = d; best = s; }
  }
  return best;
}

/**
 * Places a balcony: hover a door (or a window) to see where it would go, click to place it.
 * It goes on the outside of the wall, centred on the opening, its floor just below the sill.
 */
export function BalconyPlaceTool({ onCommit, juliet, depth, margin, front }: {
  onCommit: (placement: BalconyPlacement) => void;
  juliet: boolean;
  depth: number;
  margin: number;
  /** On a curved wall: whether the front follows the curve or runs straight across. */
  front: BalconyFront;
}) {
  const { gl, camera, raycaster, scene } = useThree();
  const { shapes, setMeasurements } = useApp();
  const [placement, setPlacement] = useState<BalconyPlacement | null>(null);
  const pointer = useMemo(() => new THREE.Vector2(), []);
  // Every storey's outline: a balcony never goes on the inside.
  const outlines = useMemo(() => buildingOutlines(shapes, () => Infinity), [shapes]);
  const insideBuilding = (p: Vec2) =>
    outlines.some(o => !o.hole && pointInPolygon(p[0], p[1], o.ring)) && !outlines.some(o => o.hole && pointInPolygon(p[0], p[1], o.ring));

  const find = (event: PointerEvent): BalconyPlacement | null => {
    const rect = gl.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const byId = new Map(shapes.map(s => [s.id, s]));
    for (const hit of raycaster.intersectObjects(scene.children, true)) {
      if (!hit.object.visible || !(hit.object as THREE.Mesh).isMesh) continue;
      const id = shapeIdOf(hit.object);
      const shape = id ? byId.get(id) : undefined;
      if (!shape) continue;
      if (shape.type === 'patio') continue; // look past existing balconies and decks
      let opening: Shape | null = null, wall: Shape | undefined;
      if (shape.type === 'door' || shape.type === 'window') {
        opening = shape;
        wall = shape.hostWallId ? byId.get(shape.hostWallId) : undefined;
      } else if (shape.type === 'wall') {
        wall = shape;
        opening = openingNear(shape, hit.point, shapes);
      }
      if (!opening || !wall || wall.type !== 'wall') return null;
      const side = outsideSide(opening, wall, [camera.position.x, camera.position.z], insideBuilding);
      return placeBalcony(opening, wall, side, shapes, { depth, margin, juliet, front });
    }
    return null;
  };
  const latest = useRef({ find, onCommit });
  latest.current = { find, onCommit };

  useEffect(() => {
    setMeasurements('Balcony: hover a door (or a window) and click to put a balcony outside it. On a curved wall it follows the curve. Then set its widths, depth and extra levels in the panel.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = gl.domElement;
    let downAt: { x: number; y: number } | null = null;
    const move = (event: PointerEvent) => setPlacement(latest.current.find(event));
    const down = (event: PointerEvent) => { if (event.button === 0) downAt = { x: event.clientX, y: event.clientY }; };
    const up = (event: PointerEvent) => {
      if (event.button !== 0 || !downAt) return;
      const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y);
      downAt = null;
      if (moved > 6) return; // orbiting
      const found = latest.current.find(event);
      if (found) {
        latest.current.onCommit(found);
        setPlacement(null);
      }
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    return () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
    };
  }, [gl]);

  if (!placement) return null;
  const y = placement.level + 0.02;
  const outline = [...placement.world, placement.world[0]].map(([x, z]) => new THREE.Vector3(x, y, z));
  return (
    <group>
      <Line points={outline} color="#38bdf8" lineWidth={2.5} dashed dashSize={0.2} gapSize={0.12} depthTest={false} renderOrder={30} />
      {/* The guarding height, on the outer edge. */}
      <Line points={placement.front.map(([x, z]) => new THREE.Vector3(x, y + 1.08, z))}
        color="#38bdf8" lineWidth={1.5} dashed dashSize={0.1} gapSize={0.08} depthTest={false} renderOrder={30} />
    </group>
  );
}
