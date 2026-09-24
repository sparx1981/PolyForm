import React, { useMemo, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';

interface Props {
  /** World x/z of each corner. */
  points: [number, number][];
  closed: boolean;
  /** Fewest corners the path may have (2 for a fence, 3 for a pond). */
  minPoints: number;
  groundAt: (x: number, z: number) => number;
  onCommit: (points: [number, number][], closed: boolean) => void;
}

/**
 * Corner handles for editing a drawn path on the ground: drag a yellow handle to move a
 * corner, click a small white midpoint handle to add a corner there, right-click a corner to
 * remove it. Each edit commits once (one undo step), when the drag ends.
 */
export function PathEditHandles({ points, closed, minPoints, groundAt, onCommit }: Props) {
  const controls = useThree(state => state.controls) as unknown as { enabled: boolean } | null;
  const [drag, setDrag] = useState<{ index: number; point: [number, number] } | null>(null);
  const plane = useMemo(() => new THREE.Plane(), []);
  const world = points.slice();
  if (drag) world[drag.index] = drag.point;

  const endDrag = () => {
    if (controls) controls.enabled = true;
    if (drag) onCommit(world, closed);
    setDrag(null);
  };

  const segments = closed && world.length > 2 ? world.length : world.length - 1;
  return (
    <group>
      {world.map(([x, z], index) => (
        <mesh key={`corner-${index}`} position={[x, groundAt(x, z) + 0.2, z]} renderOrder={20}
          onPointerDown={event => {
            event.stopPropagation();
            (event.target as Element).setPointerCapture?.(event.pointerId);
            if (controls) controls.enabled = false;
            plane.set(new THREE.Vector3(0, 1, 0), -(groundAt(x, z) + 0.2));
            setDrag({ index, point: [x, z] });
          }}
          onPointerMove={event => {
            if (!drag || drag.index !== index) return;
            event.stopPropagation();
            const hit = new THREE.Vector3();
            if (event.ray.intersectPlane(plane, hit)) setDrag({ index, point: [hit.x, hit.z] });
          }}
          onPointerUp={event => { event.stopPropagation(); endDrag(); }}
          onContextMenu={event => {
            event.stopPropagation();
            event.nativeEvent.preventDefault();
            if (world.length > minPoints) onCommit(world.filter((_, i) => i !== index), closed && world.length - 1 >= 3);
          }}>
          <sphereGeometry args={[0.14, 14, 10]} />
          <meshBasicMaterial color={drag?.index === index ? '#ffffff' : '#ffd02f'} depthTest={false} transparent opacity={0.95} />
        </mesh>
      ))}
      {!drag && Array.from({ length: segments }, (_, index) => {
        const a = world[index], b = world[(index + 1) % world.length];
        const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
        return (
          <mesh key={`mid-${index}`} position={[mx, groundAt(mx, mz) + 0.2, mz]} renderOrder={20}
            onPointerDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation();
              const next = world.slice();
              next.splice(index + 1, 0, [mx, mz]);
              onCommit(next, closed);
            }}>
            <sphereGeometry args={[0.08, 10, 8]} />
            <meshBasicMaterial color="#ffffff" depthTest={false} transparent opacity={0.8} />
          </mesh>
        );
      })}
    </group>
  );
}
