import { useMemo } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import type { SectionArgs } from '../tools/sectionPlanes';

const SECTION_COLOR = '#f97316';

/** An in-plane frame for a section: two directions square to its normal. */
function frame(normal: THREE.Vector3) {
  const n = normal.clone().normalize();
  const seed = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(seed, n).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  return { n, u, v };
}

/**
 * A section plane in the model: an orange square (solid-ish while it's cutting), with arrows
 * at its corners pointing into the part of the model that stays. The square is what the
 * Section tool grabs to move the plane, and what the Select tool clicks to select it.
 */
export function SectionPlaneMesh({
  id, args, selected, preview = false, pickable = false, onSelect,
}: {
  id?: string;
  args: SectionArgs;
  selected?: boolean;
  preview?: boolean;
  /** Only the Section and Select tools can grab the square; others draw straight through it. */
  pickable?: boolean;
  onSelect?: () => void;
}) {
  const { corners, quaternion, arrows, center } = useMemo(() => {
    const { n, u, v } = frame(new THREE.Vector3(...args.normal));
    const c = new THREE.Vector3(...args.point);
    const h = args.size / 2;
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([a, b]) =>
      c.clone().addScaledVector(u, a! * h).addScaledVector(v, b! * h));
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    const arrowLen = Math.max(0.2, args.size * 0.08);
    const arrowPoints = pts.slice(0, 4).map(p => [p.toArray(), p.clone().addScaledVector(n, arrowLen).toArray()] as [number, number, number][]);
    return { corners: pts.map(p => p.toArray() as [number, number, number]), quaternion: q, arrows: arrowPoints, center: c };
  }, [args.point, args.normal, args.size]);

  const active = args.active && !preview;
  return (
    <group>
      <mesh
        position={center}
        quaternion={quaternion}
        userData={{ isSectionPlaneQuad: !preview, sectionId: id }}
        onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(); } : undefined}
        raycast={preview || !pickable ? () => {} : THREE.Mesh.prototype.raycast}
      >
        <planeGeometry args={[args.size, args.size]} />
        <meshBasicMaterial color={SECTION_COLOR} transparent opacity={active ? 0.08 : preview ? 0.12 : 0.03} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <Line points={corners} color={selected ? '#ffffff' : SECTION_COLOR} lineWidth={selected ? 3 : active ? 2 : 1.5}
        dashed={!active && !preview} dashSize={0.25} gapSize={0.15} raycast={() => null} />
      {arrows.map((seg, i) => (
        <Line key={i} points={seg} color={SECTION_COLOR} lineWidth={2} raycast={() => null} />
      ))}
    </group>
  );
}
