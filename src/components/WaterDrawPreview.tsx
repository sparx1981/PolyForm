import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';

interface Props {
  vertices: THREE.Vector3[];
  candidate: THREE.Vector3 | null;
  /** True when the cursor is snapped to the first point (the click will close the outline). */
  closing: boolean;
  groundAt: (x: number, z: number) => number;
}

const OUTLINE = '#0ea5e9';
const CLOSE = '#22c55e';

/**
 * Pond outline while drawing: drawn over everything (grass and terrain never hide it), sitting
 * on the ground rather than the drawing plane, with the water area shown as a translucent
 * sheet at the level it will fill to.
 */
export function WaterDrawPreview({ vertices, candidate, closing, groundAt }: Props) {
  const outline = useMemo(() => {
    const points = candidate && !closing ? [...vertices, candidate] : vertices;
    return points.map(p => new THREE.Vector3(p.x, groundAt(p.x, p.z) + 0.12, p.z));
  }, [vertices, candidate, closing, groundAt]);

  // Water fills to just below the lowest ground on the outline (as the tool will set it).
  const fill = useMemo(() => {
    if (outline.length < 3) return null;
    const level = Math.min(...outline.map(p => p.y)) - 0.1;
    const shape = new THREE.Shape(outline.map(p => new THREE.Vector2(p.x, -p.z)));
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, level, 0);
    return geometry;
  }, [outline]);
  React.useEffect(() => () => fill?.dispose(), [fill]);

  if (!vertices.length) return null;
  const start = outline[0];
  return (
    <group renderOrder={1000}>
      {fill && (
        <mesh geometry={fill} renderOrder={1000}>
          <meshBasicMaterial color={OUTLINE} transparent opacity={0.28} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      {outline.length >= 2 && (
        <Line points={outline} color={OUTLINE} lineWidth={4} depthTest={false} renderOrder={1001} />
      )}
      {/* Closing edge: dashed until the cursor snaps to the first point. */}
      {outline.length >= 3 && (
        <Line points={[outline[outline.length - 1], start]} color={closing ? CLOSE : OUTLINE}
          lineWidth={closing ? 4 : 2} dashed={!closing} dashSize={0.3} gapSize={0.15} depthTest={false} renderOrder={1001} />
      )}
      {outline.slice(0, vertices.length).map((p, i) => (
        <mesh key={i} position={p} renderOrder={1002}>
          <sphereGeometry args={[i === 0 ? 0.18 : 0.12, 16, 12]} />
          <meshBasicMaterial color={i === 0 ? (closing ? CLOSE : '#0369a1') : OUTLINE} depthTest={false} />
        </mesh>
      ))}
      {vertices.length >= 3 && (
        <mesh position={[start.x, start.y - 0.08, start.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1002}>
          <ringGeometry args={[0.3, 0.5, 32]} />
          <meshBasicMaterial color={closing ? CLOSE : '#0284c7'} transparent opacity={closing ? 0.95 : 0.5} depthTest={false} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}
