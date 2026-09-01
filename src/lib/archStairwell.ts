import * as THREE from 'three';
import { Shape } from '../types';

export interface StairOpening {
  stairId: string;
  hole2D: [number, number][];
  worldBounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
}

/**
 * Computes the 2D hole coordinates in a slab's local space for a given staircase.
 */
export function computeStairHoleForSlab(staircase: Shape, slab: Shape): [number, number][] | null {
  const stairArgs = Array.isArray(staircase.args) ? staircase.args : [1.0, 2.16, 3.6];
  const stairW = (stairArgs[0] || 1.0);
  const stairH = (stairArgs[1] || 2.16);
  const stairL = (stairArgs[2] || 3.6);

  const stairPos = new THREE.Vector3(...staircase.position);
  const stairQuat = staircase.quaternion
    ? new THREE.Quaternion(...staircase.quaternion)
    : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(staircase.rotation || [0, 0, 0])));

  const stairTopY = stairPos.y + stairH / 2;
  const stairBottomY = stairPos.y - stairH / 2;

  // Slab vertical position & thickness
  const slabPos = new THREE.Vector3(...slab.position);
  let slabThickness = 0.2;
  if (slab.type === 'box' && Array.isArray(slab.args)) {
    slabThickness = slab.args[1] || 0.2;
  } else if (slab.type === 'poly' && slab.args && typeof slab.args.height === 'number') {
    slabThickness = slab.args.height;
  }

  // Check if slab elevation is near the top of the staircase (where people walk off onto the floor)
  const isSlabAboveStairs = Math.abs(slabPos.y - stairTopY) <= Math.max(0.6, slabThickness + 0.3) ||
    (slabPos.y >= stairBottomY + 0.8 && slabPos.y <= stairTopY + 0.8);

  if (!isSlabAboveStairs) return null;

  // 4 corners of stair footprint with 0.08m clearance
  const clearance = 0.08;
  const hw = stairW / 2 + clearance;
  const hl = stairL / 2 + clearance;

  const localCorners: THREE.Vector3[] = [
    new THREE.Vector3(-hw, 0, -hl),
    new THREE.Vector3(hw, 0, -hl),
    new THREE.Vector3(hw, 0, hl),
    new THREE.Vector3(-hw, 0, hl),
  ];

  // Transform to world space, then to slab's 2D local space (X -> u, Z -> v)
  const holePts: [number, number][] = localCorners.map(c => {
    c.applyQuaternion(stairQuat);
    c.add(stairPos);
    return [c.x - slabPos.x, c.z - slabPos.z];
  });

  return holePts;
}

/**
 * Automatically applies stairwell openings to any floor slabs situated immediately above staircases.
 * Converts 'box' floor slabs to 'poly' floor slabs with cutouts where necessary.
 */
export function applyStairwellHolesToSlabs(allShapes: Shape[]): Shape[] {
  const staircases = allShapes.filter(s => s.type === 'staircase' && !s.hidden);
  if (staircases.length === 0) return allShapes;

  let modified = false;

  const updatedShapes = allShapes.map(shape => {
    // Identify floor slabs / ceiling slabs
    const isSlab =
      shape.tags?.includes('floor-slab') ||
      shape.tags?.includes('ceiling-slab') ||
      shape.name?.toLowerCase().includes('floor slab') ||
      shape.name?.toLowerCase().includes('ceiling slab');

    if (!isSlab) return shape;

    const holesToAdd: [number, number][][] = [];

    for (const stair of staircases) {
      const hole = computeStairHoleForSlab(stair, shape);
      if (hole) {
        holesToAdd.push(hole);
      }
    }

    if (holesToAdd.length === 0) return shape;

    modified = true;

    if (shape.type === 'poly') {
      const existingHoles = ((shape.args as any)?.holes || []) as [number, number][][];
      // Filter duplicate holes that match approximately the same center
      const mergedHoles = [...existingHoles];
      for (const newHole of holesToAdd) {
        const newCenter = computeHoleCenter(newHole);
        const alreadyExists = mergedHoles.some(h => {
          const c = computeHoleCenter(h);
          return Math.hypot(c[0] - newCenter[0], c[1] - newCenter[1]) < 0.2;
        });
        if (!alreadyExists) {
          mergedHoles.push(newHole);
        }
      }

      return {
        ...shape,
        args: {
          ...shape.args,
          holes: mergedHoles,
        },
      };
    } else if (shape.type === 'box') {
      // Convert box slab to poly slab with cutouts
      const slabW = shape.args[0] || 6;
      const slabH = shape.args[1] || 0.2;
      const slabD = shape.args[2] || 6;
      const slabPolyQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

      return {
        ...shape,
        type: 'poly' as const,
        rotation: [Math.PI / 2, 0, 0] as [number, number, number],
        quaternion: [slabPolyQuat.x, slabPolyQuat.y, slabPolyQuat.z, slabPolyQuat.w] as [number, number, number, number],
        args: {
          vertices: [
            [-slabW / 2, -slabD / 2],
            [slabW / 2, -slabD / 2],
            [slabW / 2, slabD / 2],
            [-slabW / 2, slabD / 2],
          ],
          height: slabH,
          holes: holesToAdd,
        },
      };
    }

    return shape;
  });

  return updatedShapes;
}

function computeHoleCenter(hole: [number, number][]): [number, number] {
  if (!hole || hole.length === 0) return [0, 0];
  let sumU = 0, sumV = 0;
  for (const [u, v] of hole) {
    sumU += u;
    sumV += v;
  }
  return [sumU / hole.length, sumV / hole.length];
}
