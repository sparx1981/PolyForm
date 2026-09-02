import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Shape } from '../types';

export interface StairOpening {
  stairId: string;
  hole2D: [number, number][];
  exitEdgeWorld: [[number, number], [number, number]] | null;
  worldPolygon: [number, number][];
  slabId: string;
  floorY: number;
}

/**
 * Computes the 2D hole coordinates in a slab's local space for a given staircase,
 * accurately aligning with the stair style (straight, L-shape, U-shape, spiral, etc.)
 * and identifying the arrival/exit threshold at the top of the stair.
 */
export function computeStairHoleForSlab(
  staircase: Shape,
  slab: Shape
): { hole2D: [number, number][]; worldPolygon: [number, number][]; exitEdgeWorld: [[number, number], [number, number]] | null; floorY: number } | null {
  const stairArgs = Array.isArray(staircase.args) ? staircase.args : [1.0, 2.7, 3.6];
  const stairW = (stairArgs[0] || 1.0);
  const stairH = (stairArgs[1] || 2.7);
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
  } else if (slab.type === 'poly' && slab.args && typeof (slab.args as any).height === 'number') {
    slabThickness = (slab.args as any).height;
  }

  const floorWalkingY = slabPos.y + slabThickness / 2;

  // Check if slab elevation is near the top of the staircase (where people walk off onto the floor)
  const isSlabAboveStairs =
    Math.abs(floorWalkingY - stairTopY) <= Math.max(1.0, slabThickness + 0.5) ||
    Math.abs(slabPos.y - stairTopY) <= Math.max(1.0, slabThickness + 0.5) ||
    (slabPos.y >= stairBottomY + 0.5 && slabPos.y <= stairTopY + 1.2);

  if (!isSlabAboveStairs) return null;

  const style = (
    (staircase as any).stairStyle ||
    (staircase as any).archStyle ||
    (staircase as any).customData?.stairStyle ||
    staircase.name ||
    'straight'
  ).toLowerCase();
  const clearance = 0.08;

  let localCorners: THREE.Vector3[] = [];
  let exitLocalStart: THREE.Vector3;
  let exitLocalEnd: THREE.Vector3;

  if (style.includes('u-shape') || style.includes('switchback') || style.includes('half-turn')) {
    // U-shaped stair: Flight 1 on left (+Z), half landing at +Z, Flight 2 on right (-Z)
    // Top exit is at -Z on the right half (x >= 0, z = -hl)
    const hw = stairW / 2 + clearance;
    const hl = stairL / 2 + clearance;
    localCorners = [
      new THREE.Vector3(-hw, 0, -hl),
      new THREE.Vector3(hw, 0, -hl),
      new THREE.Vector3(hw, 0, hl),
      new THREE.Vector3(-hw, 0, hl),
    ];
    // Exit edge is along the right half (Flight 2 top) of the front edge
    exitLocalStart = new THREE.Vector3(0, 0, -hl);
    exitLocalEnd = new THREE.Vector3(hw, 0, -hl);
  } else if (style.includes('l-shape') || style.includes('quarter-turn') || style.includes('winder')) {
    // L-shaped stair: Flight 1 along +Z on left side (-X), turns 90° right along +X
    // Top exit is at the +X end of flight 2
    const flightW = stairW * 0.85;
    const landingSize = flightW;
    const landX = -flightW / 2;
    const landZ = -stairL / 2 + stairL * 0.55 + landingSize / 2;
    const run2 = stairL * 0.45;
    const exitX = landX + landingSize / 2 + run2 + clearance;

    localCorners = [
      new THREE.Vector3(-flightW - clearance, 0, -stairL / 2 - clearance),
      new THREE.Vector3(0 + clearance, 0, -stairL / 2 - clearance),
      new THREE.Vector3(exitX, 0, landZ - landingSize / 2 - clearance),
      new THREE.Vector3(exitX, 0, landZ + landingSize / 2 + clearance),
      new THREE.Vector3(-flightW - clearance, 0, landZ + landingSize / 2 + clearance),
    ];
    // Exit edge is at the +X boundary of flight 2
    exitLocalStart = new THREE.Vector3(exitX, 0, landZ - landingSize / 2 - clearance);
    exitLocalEnd = new THREE.Vector3(exitX, 0, landZ + landingSize / 2 + clearance);
  } else if (style.includes('bifurcated') || style.includes('double-return')) {
    // Bifurcated stair: Central lower flight, landing, dual return upper flights
    const hw = stairW / 2 + clearance;
    const hl = stairL / 2 + clearance;
    localCorners = [
      new THREE.Vector3(-hw, 0, -hl),
      new THREE.Vector3(hw, 0, -hl),
      new THREE.Vector3(hw, 0, hl),
      new THREE.Vector3(-hw, 0, hl),
    ];
    exitLocalStart = new THREE.Vector3(-hw, 0, -hl);
    exitLocalEnd = new THREE.Vector3(hw, 0, -hl);
  } else if (style.includes('spiral') || style.includes('helical')) {
    const radius = Math.min(stairW, stairL) / 2 + clearance;
    const segments = 16;
    localCorners = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      localCorners.push(new THREE.Vector3(Math.sin(angle) * radius, 0, Math.cos(angle) * radius));
    }
    exitLocalStart = new THREE.Vector3(-radius * 0.5, 0, radius);
    exitLocalEnd = new THREE.Vector3(radius * 0.5, 0, radius);
  } else if (style.includes('c-shape') || style.includes('curved') || style.includes('circular')) {
    const innerR = 0.9 - clearance;
    const outerR = innerR + stairW + clearance * 2;
    const isFull180 = style.includes('c-shape');
    const totalSweep = isFull180 ? Math.PI : Math.PI * 0.75;
    const segments = 16;
    localCorners = [];
    for (let i = 0; i <= segments; i++) {
      const ang = (i / segments) * totalSweep;
      localCorners.push(new THREE.Vector3(Math.sin(ang) * outerR, 0, -Math.cos(ang) * outerR + (innerR + outerR) / 2));
    }
    for (let i = segments; i >= 0; i--) {
      const ang = (i / segments) * totalSweep;
      localCorners.push(new THREE.Vector3(Math.sin(ang) * innerR, 0, -Math.cos(ang) * innerR + (innerR + outerR) / 2));
    }
    const endAng = totalSweep;
    exitLocalStart = new THREE.Vector3(Math.sin(endAng) * innerR, 0, -Math.cos(endAng) * innerR + (innerR + outerR) / 2);
    exitLocalEnd = new THREE.Vector3(Math.sin(endAng) * outerR, 0, -Math.cos(endAng) * outerR + (innerR + outerR) / 2);
  } else {
    // Straight flight / Floating / Mono-stringer / Open-riser: ascends along +Z, top exit is at +Z
    const hw = stairW / 2 + clearance;
    const hl = stairL / 2 + clearance;
    localCorners = [
      new THREE.Vector3(-hw, 0, -hl),
      new THREE.Vector3(hw, 0, -hl),
      new THREE.Vector3(hw, 0, hl),
      new THREE.Vector3(-hw, 0, hl),
    ];
    // Exit edge is at +Z
    exitLocalStart = new THREE.Vector3(-hw, 0, hl);
    exitLocalEnd = new THREE.Vector3(hw, 0, hl);
  }

  // Slab quaternion and transform
  const slabQuat = slab.quaternion
    ? new THREE.Quaternion(...slab.quaternion)
    : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(slab.rotation || [0, 0, 0])));
  const invSlabQuat = slabQuat.clone().invert();

  // Transform to world space and slab's 2D local space
  const worldPolygon: [number, number][] = localCorners.map(c => {
    const worldPt = c.clone().applyQuaternion(stairQuat).add(stairPos);
    return [worldPt.x, worldPt.z];
  });

  const hole2D: [number, number][] = localCorners.map(c => {
    const worldPt = c.clone().applyQuaternion(stairQuat).add(stairPos);
    const relWorld = worldPt.clone().sub(slabPos);
    const localPt = relWorld.applyQuaternion(invSlabQuat);
    return [localPt.x, localPt.y];
  });

  const worldExitA = exitLocalStart.clone().applyQuaternion(stairQuat).add(stairPos);
  const worldExitB = exitLocalEnd.clone().applyQuaternion(stairQuat).add(stairPos);
  const exitEdgeWorld: [[number, number], [number, number]] = [
    [worldExitA.x, worldExitA.z],
    [worldExitB.x, worldExitB.z],
  ];

  return { hole2D, worldPolygon, exitEdgeWorld, floorY: floorWalkingY };
}

/**
 * Builds a single balustrade guard railing segment along line [pA -> pB]
 */
function createGuardRailingSegmentGeometry(
  pA: [number, number, number],
  pB: [number, number, number],
  railHeight: number = 0.95
): THREE.BufferGeometry[] {
  const geoms: THREE.BufferGeometry[] = [];
  const dx = pB[0] - pA[0];
  const dy = pB[1] - pA[1];
  const dz = pB[2] - pA[2];
  const span = Math.hypot(dx, dz);
  if (span < 0.15) return geoms;

  const yawAngle = Math.atan2(dx, dz);
  const midX = (pA[0] + pB[0]) / 2;
  const midY = (pA[1] + pB[1]) / 2;
  const midZ = (pA[2] + pB[2]) / 2;

  // 1. Newel Corner Post at start (60mm x 60mm)
  const post1 = new THREE.BoxGeometry(0.06, railHeight, 0.06);
  post1.translate(pA[0], pA[1] + railHeight / 2, pA[2]);
  geoms.push(post1);

  // 2. Newel Corner Post at end (60mm x 60mm)
  const post2 = new THREE.BoxGeometry(0.06, railHeight, 0.06);
  post2.translate(pB[0], pB[1] + railHeight / 2, pB[2]);
  geoms.push(post2);

  // 3. Top Handrail Bar (50mm wide x 40mm deep)
  const handrail = new THREE.BoxGeometry(0.05, 0.04, span);
  handrail.rotateY(yawAngle);
  handrail.translate(midX, midY + railHeight - 0.02, midZ);
  geoms.push(handrail);

  // 4. Bottom Base Rail (45mm wide x 25mm deep)
  const baseRail = new THREE.BoxGeometry(0.045, 0.025, span);
  baseRail.rotateY(yawAngle);
  baseRail.translate(midX, midY + 0.035, midZ);
  geoms.push(baseRail);

  // 5. Vertical Spindles / Balusters (spaced ~120mm c/c)
  const numSpindles = Math.max(1, Math.floor(span / 0.12));
  const spindleH = railHeight - 0.08;
  for (let s = 1; s <= numSpindles; s++) {
    const t = s / (numSpindles + 1);
    const sx = pA[0] + dx * t;
    const sy = pA[1] + dy * t + railHeight / 2;
    const sz = pA[2] + dz * t;

    const spindle = new THREE.BoxGeometry(0.022, spindleH, 0.022);
    spindle.translate(sx, sy, sz);
    geoms.push(spindle);
  }

  return geoms;
}

/**
 * Checks if a 2D line segment is adjacent/flush with any existing wall in the model.
 */
function isSegmentAgainstWall(
  p1: [number, number],
  p2: [number, number],
  walls: Shape[],
  wallThreshold: number = 0.35
): boolean {
  const midX = (p1[0] + p2[0]) / 2;
  const midZ = (p1[1] + p2[1]) / 2;

  for (const w of walls) {
    const wPos = new THREE.Vector3(...w.position);
    const wQuat = w.quaternion ? new THREE.Quaternion(...w.quaternion) : new THREE.Quaternion();
    const wL = Array.isArray(w.args) ? w.args[0] || 3.0 : 3.0;

    const vRun = new THREE.Vector3(1, 0, 0).applyQuaternion(wQuat).normalize();
    const pA = wPos.clone().sub(vRun.clone().multiplyScalar(wL / 2));
    const toMid = new THREE.Vector3(midX, wPos.y, midZ).sub(pA);
    const proj = toMid.dot(vRun);
    const clampedProj = Math.max(0, Math.min(wL, proj));
    const closestWallPt = pA.clone().add(vRun.clone().multiplyScalar(clampedProj));

    const dist = Math.hypot(midX - closestWallPt.x, midZ - closestWallPt.z);
    if (dist <= wallThreshold) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if a 2D segment coincides with the stair's top exit/arrival threshold.
 */
function isSegmentExitThreshold(
  p1: [number, number],
  p2: [number, number],
  exitEdge: [[number, number], [number, number]] | null
): boolean {
  if (!exitEdge) return false;
  const eMidX = (exitEdge[0][0] + exitEdge[1][0]) / 2;
  const eMidZ = (exitEdge[0][1] + exitEdge[1][1]) / 2;
  const sMidX = (p1[0] + p2[0]) / 2;
  const sMidZ = (p1[1] + p2[1]) / 2;

  return Math.hypot(sMidX - eMidX, sMidZ - eMidZ) < 0.40;
}

/**
 * Generates the safety guard railing shape surrounding a stairwell opening on an upper floor.
 */
export function generateStairwellGuardRailing(
  staircase: Shape,
  slab: Shape,
  worldPolygon: [number, number][],
  exitEdgeWorld: [[number, number], [number, number]] | null,
  floorY: number,
  allWalls: Shape[]
): Shape | null {
  const n = worldPolygon.length;
  if (n < 3) return null;

  const railingGeoms: THREE.BufferGeometry[] = [];
  const railHeight = 0.95;

  for (let i = 0; i < n; i++) {
    const p1 = worldPolygon[i];
    const p2 = worldPolygon[(i + 1) % n];

    // Skip the side where people walk onto the floor
    if (isSegmentExitThreshold(p1, p2, exitEdgeWorld)) {
      continue;
    }

    // Skip the side if it is flush against a wall (wall blocks fall)
    if (isSegmentAgainstWall(p1, p2, allWalls)) {
      continue;
    }

    const segGeoms = createGuardRailingSegmentGeometry(
      [p1[0], floorY, p1[1]],
      [p2[0], floorY, p2[1]],
      railHeight
    );
    railingGeoms.push(...segGeoms);
  }

  if (railingGeoms.length === 0) return null;

  const merged = BufferGeometryUtils.mergeGeometries(railingGeoms, false);
  if (!merged) return null;

  // Clean compute normals
  merged.computeVertexNormals();

  const railingColor = staircase.color || '#475569';
  const railingId = `stair-railing-${staircase.id}-${slab.id}`;

  const railingShape: Shape = {
    id: railingId,
    name: `Stairwell Guard Railing (${staircase.name || 'Stair'})`,
    type: 'custom',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    args: [1, 1, 1],
    color: railingColor,
    roughness: 0.5,
    metalness: 0.1,
    parentShapeId: staircase.id,
    geometryData: {
      positions: Array.from(merged.attributes.position.array),
      normals: Array.from(merged.attributes.normal.array),
      uvs: merged.attributes.uv ? Array.from(merged.attributes.uv.array) : undefined,
    },
    tags: ['architecture', 'stair-guard-railing', 'stairwell-railing', 'railing'],
  };

  return railingShape;
}

/**
 * Automatically applies stairwell openings to any floor slabs situated immediately above staircases,
 * and generates matching perimeter guard railings around the stairwell openings.
 */
export function applyStairwellHolesToSlabs(allShapes: Shape[]): Shape[] {
  const staircases = allShapes.filter(s => s.type === 'staircase' && !s.hidden);
  const walls = allShapes.filter(s => s.type === 'wall' && !s.hidden);

  // Remove existing auto-generated stair guard railings to rebuild fresh
  const nonRailingShapes = allShapes.filter(
    s => !s.tags?.includes('stair-guard-railing') && !s.id?.startsWith('stair-railing-')
  );

  if (staircases.length === 0) {
    return nonRailingShapes;
  }

  const generatedRailings: Shape[] = [];
  const seenRailingIds = new Set<string>();

  const updatedShapes = nonRailingShapes.map(shape => {
    // Identify floor slabs / ceiling slabs
    const isSlab =
      shape.tags?.includes('floor-slab') ||
      shape.tags?.includes('ceiling-slab') ||
      shape.tags?.includes('slab') ||
      shape.name?.toLowerCase().includes('floor') ||
      shape.name?.toLowerCase().includes('slab') ||
      shape.name?.toLowerCase().includes('ceiling') ||
      (shape.type === 'poly' && typeof (shape.args as any)?.height === 'number' && (shape.args as any).height <= 0.6) ||
      (shape.type === 'box' && Array.isArray(shape.args) && (shape.args[1] || 0) <= 0.6 && (shape.args[0] || 0) >= 1.0 && (shape.args[2] || 0) >= 1.0);

    if (!isSlab) return shape;

    const holesToAdd: [number, number][][] = [];

    for (const stair of staircases) {
      const stairData = computeStairHoleForSlab(stair, shape);
      if (stairData) {
        holesToAdd.push(stairData.hole2D);

        // Generate matching upper floor safety guard railing
        const guardRailing = generateStairwellGuardRailing(
          stair,
          shape,
          stairData.worldPolygon,
          stairData.exitEdgeWorld,
          stairData.floorY,
          walls
        );
        if (guardRailing && !seenRailingIds.has(guardRailing.id)) {
          seenRailingIds.add(guardRailing.id);
          generatedRailings.push(guardRailing);
        }
      }
    }

    if (holesToAdd.length === 0) {
      // If slab had auto-generated holes but no stair is below it anymore, remove stair holes
      if (shape.type === 'poly' && shape.tags?.includes('auto-stair-hole')) {
        const remainingHoles = ((shape.args as any)?.manualHoles || []) as [number, number][][];
        return {
          ...shape,
          tags: (shape.tags || []).filter(t => t !== 'auto-stair-hole'),
          args: {
            ...shape.args,
            holes: remainingHoles.length > 0 ? remainingHoles : undefined,
          }
        };
      }
      return shape;
    }

    if (shape.type === 'poly') {
      const manualHoles = ((shape.args as any)?.manualHoles || []) as [number, number][][];
      const mergedHoles = [...holesToAdd, ...manualHoles];

      return {
        ...shape,
        tags: Array.from(new Set([...(shape.tags || []), 'floor-slab', 'auto-stair-hole'])),
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
        tags: Array.from(new Set([...(shape.tags || []), 'floor-slab', 'auto-stair-hole'])),
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

  return [...updatedShapes, ...generatedRailings];
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

/**
 * Dynamically computes all active stairwell cutouts for a given floor slab,
 * ensuring real-time reactivity whenever any staircase moves or changes style.
 */
export function computeHolesForSlab(slab: Shape, allShapes: Shape[]): [number, number][][] | undefined {
  const isSlab =
    slab.tags?.includes('floor-slab') ||
    slab.tags?.includes('ceiling-slab') ||
    slab.tags?.includes('slab') ||
    slab.name?.toLowerCase().includes('floor') ||
    slab.name?.toLowerCase().includes('slab') ||
    slab.name?.toLowerCase().includes('ceiling') ||
    (slab.type === 'poly' && typeof (slab.args as any)?.height === 'number' && (slab.args as any).height <= 0.6) ||
    (slab.type === 'box' && Array.isArray(slab.args) && (slab.args[1] || 0) <= 0.6);

  if (!isSlab) return (slab.args as any)?.holes;

  const staircases = allShapes.filter(s => s.type === 'staircase' && !s.hidden);
  const holes: [number, number][][] = [];

  for (const stair of staircases) {
    const stairData = computeStairHoleForSlab(stair, slab);
    if (stairData) {
      holes.push(stairData.hole2D);
    }
  }

  const manualHoles = ((slab.args as any)?.manualHoles || []) as [number, number][][];
  const merged = [...holes, ...manualHoles];

  return merged.length > 0 ? merged : undefined;
}
