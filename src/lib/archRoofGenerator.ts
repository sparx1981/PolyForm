import * as THREE from 'three';
import { Shape } from '../types';
import { computeStairHoleForSlab } from './archStairwell';

export type RoofType = 'gable' | 'hip';

export interface RoofParams {
  roofType: RoofType;
  ridgeHeight?: number;      // Height in meters above wall top
  pitchAngleDeg?: number;    // e.g. 35°
  usePitchAngle?: boolean;
  eaveOverhang?: number;     // e.g. 0.30 m
  roofThickness?: number;    // e.g. 0.12 m
  fasciaHeight?: number;     // e.g. 0.18 m
  color?: string;
  ridgeCapColor?: string;
  fasciaColor?: string;
  pedimentColor?: string;
  soffitColor?: string;
}

export interface BuildingEnvelope {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  width: number;
  depth: number;
  centerX: number;
  centerZ: number;
  topY: number;
  wallThickness: number;
}

export interface RoomFootprint {
  polygon: [number, number][]; // 2D vertices in world coordinates (X, Z) in CCW order
  topY: number;
  centerX: number;
  centerZ: number;
  isRectangular: boolean;
  isLShape: boolean;
  bounds: BuildingEnvelope;
  reflexIndex?: number;
}

/**
 * Offsets a 2D closed polygon outward by a given distance along corner bisectors.
 * Correctly handles both convex and reflex corners.
 */
export function offsetPolygon2D(polygon: [number, number][], offset: number): [number, number][] {
  const n = polygon.length;
  const offsetPoly: [number, number][] = [];

  for (let i = 0; i < n; i++) {
    const pPrev = polygon[(i - 1 + n) % n];
    const pCurr = polygon[i];
    const pNext = polygon[(i + 1) % n];

    const e1x = pCurr[0] - pPrev[0], e1z = pCurr[1] - pPrev[1];
    const len1 = Math.hypot(e1x, e1z) || 1e-6;
    const n1x = e1z / len1, n1z = -e1x / len1; // Outward normal for CCW

    const e2x = pNext[0] - pCurr[0], e2z = pNext[1] - pCurr[1];
    const len2 = Math.hypot(e2x, e2z) || 1e-6;
    const n2x = e2z / len2, n2z = -e2x / len2; // Outward normal for CCW

    const bisectorX = n1x + n2x;
    const bisectorZ = n1z + n2z;
    const bisectorLen = Math.hypot(bisectorX, bisectorZ);

    if (bisectorLen < 1e-4) {
      offsetPoly.push([pCurr[0] + n1x * offset, pCurr[1] + n1z * offset]);
    } else {
      const cosHalf = Math.max(0.15, (n1x * n2x + n1z * n2z + 1) / 2);
      const dist = Math.min(offset * 2.5, offset / Math.sqrt(cosHalf));
      const uX = bisectorX / bisectorLen;
      const uZ = bisectorZ / bisectorLen;
      offsetPoly.push([pCurr[0] + uX * dist, pCurr[1] + uZ * dist]);
    }
  }

  return offsetPoly;
}

/**
 * Extracts the accurate outer bounding box and top elevation of a room or building from wall shapes.
 * Uses exact 3D corner transformations of every wall taking into account length, thickness, and rotation quaternion.
 */
export function getRoomBoundingEnvelope(roomWalls: Shape[]): BuildingEnvelope | null {
  if (!roomWalls || roomWalls.length === 0) return null;

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let maxTopY = -Infinity;
  let avgThickness = 0.2;
  let wallCount = 0;

  for (const wall of roomWalls) {
    if (wall.hidden) continue;

    const wallL = Array.isArray(wall.args) ? wall.args[0] || 3.0 : 3.0;
    const wallH = Array.isArray(wall.args) ? wall.args[1] || 2.8 : 2.8;
    const wallT = Array.isArray(wall.args) ? wall.args[2] || 0.2 : 0.2;

    avgThickness += wallT;
    wallCount++;

    const halfL = wallL / 2;
    const halfT = wallT / 2;

    const topY = wall.position[1] + (wallH / 2);
    if (topY > maxTopY) maxTopY = topY;

    // Get wall orientation
    const quat = wall.quaternion
      ? new THREE.Quaternion(...wall.quaternion)
      : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(wall.rotation || [0, 0, 0])));

    // 4 local horizontal corner offsets
    const localCorners = [
      new THREE.Vector3(-halfL, 0, -halfT),
      new THREE.Vector3(halfL, 0, -halfT),
      new THREE.Vector3(halfL, 0, halfT),
      new THREE.Vector3(-halfL, 0, halfT),
    ];

    const wallCenter = new THREE.Vector3(wall.position[0], wall.position[1], wall.position[2]);

    for (const c of localCorners) {
      c.applyQuaternion(quat);
      c.add(wallCenter);
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minZ = Math.min(minZ, c.z);
      maxZ = Math.max(maxZ, c.z);
    }
  }

  if (minX === Infinity || maxX === -Infinity) return null;

  const width = Math.max(0.5, maxX - minX);
  const depth = Math.max(0.5, maxZ - minZ);
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;

  return {
    minX,
    maxX,
    minZ,
    maxZ,
    width,
    depth,
    centerX,
    centerZ,
    topY: maxTopY > -Infinity ? maxTopY : 2.8,
    wallThickness: wallCount > 0 ? avgThickness / wallCount : 0.2,
  };
}

/**
 * Extracts the 2D polygon footprint from room walls or matching floor slab.
 * Identifies whether the building is rectangular, L-shaped, or a general polygon.
 */
export function extractRoomFootprintPolygon(
  roomWalls: Shape[],
  existingShapes: Shape[] = []
): RoomFootprint | null {
  const envelope = getRoomBoundingEnvelope(roomWalls);
  if (!envelope) return null;

  let worldPoly: [number, number][] | null = null;

  // 1. Try finding an existing floor slab that matches this room
  const candidateSlabs = existingShapes.filter(s => 
    s.type === 'poly' && 
    (s.tags?.includes('floor-slab') || s.name?.toLowerCase().includes('slab') || s.name?.toLowerCase().includes('floor')) &&
    !s.hidden
  );

  for (const slab of candidateSlabs) {
    const sPos = slab.position;
    if (
      sPos[0] >= envelope.minX - 0.75 && sPos[0] <= envelope.maxX + 0.75 &&
      sPos[2] >= envelope.minZ - 0.75 && sPos[2] <= envelope.maxZ + 0.75 &&
      Array.isArray(slab.args?.vertices) && slab.args.vertices.length >= 3
    ) {
      const verts: [number, number][] = slab.args.vertices.map((pt: [number, number]) => [
        pt[0] + sPos[0],
        pt[1] + sPos[2],
      ]);
      if (verts.length >= 3) {
        worldPoly = verts;
        break;
      }
    }
  }

  // 2. If no floor slab found, chain the wall segment centerlines
  if (!worldPoly || worldPoly.length < 3) {
    const segments: { pA: THREE.Vector2; pB: THREE.Vector2 }[] = [];
    for (const w of roomWalls) {
      if (w.hidden) continue;
      const wallL = Array.isArray(w.args) ? w.args[0] || 3.0 : 3.0;
      const halfL = wallL / 2;
      const quat = w.quaternion
        ? new THREE.Quaternion(...w.quaternion)
        : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(w.rotation || [0, 0, 0])));
      const dir3D = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
      const dir2D = new THREE.Vector2(dir3D.x, dir3D.z).normalize();
      
      const pA = new THREE.Vector2(w.position[0] - dir2D.x * halfL, w.position[2] - dir2D.y * halfL);
      const pB = new THREE.Vector2(w.position[0] + dir2D.x * halfL, w.position[2] + dir2D.y * halfL);
      segments.push({ pA, pB });
    }

    if (segments.length >= 3) {
      const chained: THREE.Vector2[] = [segments[0].pA, segments[0].pB];
      const used = new Set<number>([0]);
      let cur = segments[0].pB;

      while (used.size < segments.length) {
        let bestIdx = -1;
        let bestDist = Infinity;
        let connectAtA = true;

        for (let i = 0; i < segments.length; i++) {
          if (used.has(i)) continue;
          const dA = cur.distanceTo(segments[i].pA);
          const dB = cur.distanceTo(segments[i].pB);
          const minD = Math.min(dA, dB);
          if (minD < bestDist) {
            bestDist = minD;
            bestIdx = i;
            connectAtA = dA <= dB;
          }
        }

        if (bestIdx !== -1) {
          used.add(bestIdx);
          const nextSeg = segments[bestIdx];
          if (connectAtA) {
            chained.push(nextSeg.pB);
            cur = nextSeg.pB;
          } else {
            chained.push(nextSeg.pA);
            cur = nextSeg.pA;
          }
        } else {
          break;
        }
      }

      if (chained.length >= 3) {
        if (chained[chained.length - 1].distanceTo(chained[0]) < 0.6) {
          chained.pop();
        }
        worldPoly = chained.map(v => [v.x, v.y]);
      }
    }
  }

  // Fallback to bounding box 4-corners if polygon extraction produced nothing
  if (!worldPoly || worldPoly.length < 3) {
    worldPoly = [
      [envelope.minX, envelope.minZ],
      [envelope.maxX, envelope.minZ],
      [envelope.maxX, envelope.maxZ],
      [envelope.minX, envelope.maxZ],
    ];
  }

  // Ensure Counter-Clockwise (CCW) winding in X-Z plane
  let signedArea = 0;
  const n = worldPoly.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    signedArea += (worldPoly[i][0] * worldPoly[j][1] - worldPoly[j][0] * worldPoly[i][1]);
  }
  if (signedArea < 0) {
    worldPoly.reverse();
  }

  const polyArea = Math.abs(signedArea) / 2;
  const bboxArea = envelope.width * envelope.depth;

  // Check if rectangular
  const isRectangular = n === 4 && polyArea >= 0.92 * bboxArea;

  // Check if L-shape (6 vertices, 5 convex corners, 1 reflex corner)
  let reflexIndex = -1;
  let reflexCount = 0;
  for (let i = 0; i < n; i++) {
    const pPrev = worldPoly[(i - 1 + n) % n];
    const pCurr = worldPoly[i];
    const pNext = worldPoly[(i + 1) % n];

    const v1x = pCurr[0] - pPrev[0], v1z = pCurr[1] - pPrev[1];
    const v2x = pNext[0] - pCurr[0], v2z = pNext[1] - pCurr[1];
    // 2D cross product: in CCW polygon, convex is > 0, reflex is < 0
    const cross = v1x * v2z - v1z * v2x;
    if (cross < -1e-3) {
      reflexIndex = i;
      reflexCount++;
    }
  }

  const isLShape = n === 6 && reflexCount === 1 && polyArea < 0.92 * bboxArea;

  return {
    polygon: worldPoly,
    topY: envelope.topY,
    centerX: envelope.centerX,
    centerZ: envelope.centerZ,
    isRectangular,
    isLShape,
    bounds: envelope,
    reflexIndex: isLShape ? reflexIndex : undefined,
  };
}

/**
 * Helper to build BufferGeometry with positions, normals, and UVs.
 * Generates both primary outward faces and backfaces so roof surfaces are visible from all angles.
 */
function createGeometryFromBuilder(
  builder: (
    addTriangle: (p1: [number, number, number], p2: [number, number, number], p3: [number, number, number], normal?: [number, number, number]) => void,
    addQuad: (p1: [number, number, number], p2: [number, number, number], p3: [number, number, number], p4: [number, number, number], normal?: [number, number, number]) => void
  ) => void,
  doubleSided: boolean = true
): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  const addTriangle = (
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    normal?: [number, number, number]
  ) => {
    // 1. Front face
    positions.push(...p1, ...p2, ...p3);

    let n: THREE.Vector3;
    if (normal) {
      n = new THREE.Vector3(...normal).normalize();
    } else {
      const vA = new THREE.Vector3(...p1);
      const vB = new THREE.Vector3(...p2);
      const vC = new THREE.Vector3(...p3);
      const edge1 = new THREE.Vector3().subVectors(vB, vA);
      const edge2 = new THREE.Vector3().subVectors(vC, vA);
      n = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
      if (n.lengthSq() < 0.0001) n = new THREE.Vector3(0, 1, 0);
    }

    normals.push(n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z);
    uvs.push(p1[0] * 0.5, p1[2] * 0.5, p2[0] * 0.5, p2[2] * 0.5, p3[0] * 0.5, p3[2] * 0.5);

    // 2. Back face (if doubleSided is true)
    if (doubleSided) {
      positions.push(...p1, ...p3, ...p2);
      normals.push(-n.x, -n.y, -n.z, -n.x, -n.y, -n.z, -n.x, -n.y, -n.z);
      uvs.push(p1[0] * 0.5, p1[2] * 0.5, p3[0] * 0.5, p3[2] * 0.5, p2[0] * 0.5, p2[2] * 0.5);
    }
  };

  const addQuad = (
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    p4: [number, number, number],
    normal?: [number, number, number]
  ) => {
    // Quad specified in CCW order: p1 -> p2 -> p3 -> p4
    addTriangle(p1, p2, p3, normal);
    addTriangle(p1, p3, p4, normal);
  };

  builder(addTriangle, addQuad);

  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

  return geom;
}

// -------------------------------------------------------------
// GABLE ROOF SUBCOMPONENT GEOMETRIES (STRICT CCW ORIENTATION)
// -------------------------------------------------------------

/**
 * 1. Gable Roof Pitch Slopes (The 2 sloping tile planes)
 */
export function createGableRoofSlopesGeometry(
  buildingWidth: number,
  buildingDepth: number,
  ridgeHeight: number,
  eaveOverhang: number = 0.30
): THREE.BufferGeometry {
  return createGeometryFromBuilder((_addTriangle, addQuad) => {
    const hw_wall = buildingWidth / 2;
    const hd_wall = buildingDepth / 2;
    const hw_eave = hw_wall + eaveOverhang;
    const hd_eave = hd_wall + eaveOverhang;
    const isWidthLonger = buildingWidth >= buildingDepth;
    const ridgeY = ridgeHeight;
    const eaveY = 0;

    if (isWidthLonger) {
      // Ridge runs along X axis
      const rL: [number, number, number] = [-hw_eave, ridgeY, 0];
      const rR: [number, number, number] = [hw_eave, ridgeY, 0];
      const eFL: [number, number, number] = [-hw_eave, eaveY, hd_eave];
      const eFR: [number, number, number] = [hw_eave, eaveY, hd_eave];
      const eBL: [number, number, number] = [-hw_eave, eaveY, -hd_eave];
      const eBR: [number, number, number] = [hw_eave, eaveY, -hd_eave];

      // Front slope (+Z) - CCW: eFL -> eFR -> rR -> rL
      addQuad(eFL, eFR, rR, rL);
      // Back slope (-Z) - CCW: eBR -> eBL -> rL -> rR
      addQuad(eBR, eBL, rL, rR);
    } else {
      // Ridge runs along Z axis
      const rB: [number, number, number] = [0, ridgeY, -hd_eave];
      const rF: [number, number, number] = [0, ridgeY, hd_eave];
      const eLF: [number, number, number] = [-hw_eave, eaveY, hd_eave];
      const eRF: [number, number, number] = [hw_eave, eaveY, hd_eave];
      const eLB: [number, number, number] = [-hw_eave, eaveY, -hd_eave];
      const eRB: [number, number, number] = [hw_eave, eaveY, -hd_eave];

      // Left slope (-X) - CCW: eLF -> eLB -> rB -> rF
      addQuad(eLF, eLB, rB, rF);
      // Right slope (+X) - CCW: eRB -> eRF -> rF -> rB
      addQuad(eRB, eRF, rF, rB);
    }
  });
}

/**
 * 2. Gable Pediment Infill Walls (Triangular vertical infill flush with building wall perimeter)
 */
export function createGablePedimentWallsGeometry(
  buildingWidth: number,
  buildingDepth: number,
  ridgeHeight: number
): THREE.BufferGeometry {
  return createGeometryFromBuilder((addTriangle) => {
    const hw_wall = buildingWidth / 2;
    const hd_wall = buildingDepth / 2;
    const isWidthLonger = buildingWidth >= buildingDepth;
    const ridgeY = ridgeHeight;
    const eaveY = 0;

    if (isWidthLonger) {
      // Left gable wall (-X) - CCW: eFL -> eBL -> rL
      const rL_wall: [number, number, number] = [-hw_wall, ridgeY, 0];
      const eFL_wall: [number, number, number] = [-hw_wall, eaveY, hd_wall];
      const eBL_wall: [number, number, number] = [-hw_wall, eaveY, -hd_wall];
      addTriangle(eFL_wall, eBL_wall, rL_wall, [-1, 0, 0]);

      // Right gable wall (+X) - CCW: eBR -> eFR -> rR
      const rR_wall: [number, number, number] = [hw_wall, ridgeY, 0];
      const eFR_wall: [number, number, number] = [hw_wall, eaveY, hd_wall];
      const eBR_wall: [number, number, number] = [hw_wall, eaveY, -hd_wall];
      addTriangle(eBR_wall, eFR_wall, rR_wall, [1, 0, 0]);
    } else {
      // Front gable wall (+Z) - CCW: eRF -> eLF -> rF
      const rF_wall: [number, number, number] = [0, ridgeY, hd_wall];
      const eLF_wall: [number, number, number] = [-hw_wall, eaveY, hd_wall];
      const eRF_wall: [number, number, number] = [hw_wall, eaveY, hd_wall];
      addTriangle(eRF_wall, eLF_wall, rF_wall, [0, 0, 1]);

      // Back gable wall (-Z) - CCW: eLB -> eRB -> rB
      const rB_wall: [number, number, number] = [0, ridgeY, -hd_wall];
      const eLB_wall: [number, number, number] = [-hw_wall, eaveY, -hd_wall];
      const eRB_wall: [number, number, number] = [hw_wall, eaveY, -hd_wall];
      addTriangle(eLB_wall, eRB_wall, rB_wall, [0, 0, -1]);
    }
  });
}

/**
 * 3. Gable Apex Ridge Capping Beam
 */
export function createGableRidgeCapGeometry(
  buildingWidth: number,
  buildingDepth: number,
  ridgeHeight: number,
  eaveOverhang: number = 0.30,
  ridgeCapRadius: number = 0.08
): THREE.BufferGeometry {
  return createGeometryFromBuilder((_addTriangle, addQuad) => {
    const hw_wall = buildingWidth / 2;
    const hd_wall = buildingDepth / 2;
    const hw_eave = hw_wall + eaveOverhang;
    const hd_eave = hd_wall + eaveOverhang;
    const isWidthLonger = buildingWidth >= buildingDepth;
    const ridgeY = ridgeHeight;

    if (isWidthLonger) {
      const capW = hw_eave + 0.04;
      const capH = ridgeCapRadius;
      const capZ = 0.12;

      // Top quad (+Y)
      addQuad([-capW, ridgeY + capH, -capZ], [capW, ridgeY + capH, -capZ], [capW, ridgeY + capH, capZ], [-capW, ridgeY + capH, capZ], [0, 1, 0]);
      // Front quad (+Z)
      addQuad([-capW, ridgeY, capZ], [capW, ridgeY, capZ], [capW, ridgeY + capH, capZ], [-capW, ridgeY + capH, capZ], [0, 0, 1]);
      // Back quad (-Z)
      addQuad([capW, ridgeY, -capZ], [-capW, ridgeY, -capZ], [-capW, ridgeY + capH, -capZ], [capW, ridgeY + capH, -capZ], [0, 0, -1]);
    } else {
      const capD = hd_eave + 0.04;
      const capH = ridgeCapRadius;
      const capX = 0.12;

      // Top quad (+Y)
      addQuad([-capX, ridgeY + capH, -capD], [capX, ridgeY + capH, -capD], [capX, ridgeY + capH, capD], [-capX, ridgeY + capH, capD], [0, 1, 0]);
      // Right quad (+X)
      addQuad([capX, ridgeY, -capD], [capX, ridgeY, capD], [capX, ridgeY + capH, capD], [capX, ridgeY + capH, -capD], [1, 0, 0]);
      // Left quad (-X)
      addQuad([-capX, ridgeY, capD], [-capX, ridgeY, -capD], [-capX, ridgeY + capH, -capD], [-capX, ridgeY + capH, capD], [-1, 0, 0]);
    }
  });
}

/**
 * 4. Gable Fascias & Bargeboards (Vertical fascia faces, rake boards, and corner returns)
 */
export function createGableFasciaGeometry(
  buildingWidth: number,
  buildingDepth: number,
  ridgeHeight: number,
  eaveOverhang: number = 0.30,
  fasciaHeight: number = 0.18
): THREE.BufferGeometry {
  return createGeometryFromBuilder((_addTriangle, addQuad) => {
    const hw_wall = buildingWidth / 2;
    const hd_wall = buildingDepth / 2;
    const hw_eave = hw_wall + eaveOverhang;
    const hd_eave = hd_wall + eaveOverhang;
    const isWidthLonger = buildingWidth >= buildingDepth;

    const eaveY = 0;
    const fB_Y = -fasciaHeight;

    if (isWidthLonger) {
      const ridgeY = ridgeHeight;

      const eFL: [number, number, number] = [-hw_eave, eaveY, hd_eave];
      const eFR: [number, number, number] = [hw_eave, eaveY, hd_eave];
      const eBL: [number, number, number] = [-hw_eave, eaveY, -hd_eave];
      const eBR: [number, number, number] = [hw_eave, eaveY, -hd_eave];

      const fB_FL: [number, number, number] = [-hw_eave, fB_Y, hd_eave];
      const fB_FR: [number, number, number] = [hw_eave, fB_Y, hd_eave];
      const fB_BL: [number, number, number] = [-hw_eave, fB_Y, -hd_eave];
      const fB_BR: [number, number, number] = [hw_eave, fB_Y, -hd_eave];

      // 1. Front & Back Vertical Eave Fascias (CCW)
      addQuad(fB_FL, fB_FR, eFR, eFL, [0, 0, 1]);  // Front
      addQuad(fB_BR, fB_BL, eBL, eBR, [0, 0, -1]); // Back

      // 2. Gable Rake Bargeboards (Sloping side fascia strips)
      const rL_top: [number, number, number] = [-hw_eave, ridgeY, 0];
      const rL_bot: [number, number, number] = [-hw_eave, ridgeY - fasciaHeight, 0];
      const rR_top: [number, number, number] = [hw_eave, ridgeY, 0];
      const rR_bot: [number, number, number] = [hw_eave, ridgeY - fasciaHeight, 0];

      // Left Gable Rake (-X) - CCW
      addQuad(fB_FL, eFL, rL_top, rL_bot, [-1, 0, 0]);
      addQuad(rL_bot, rL_top, eBL, fB_BL, [-1, 0, 0]);

      // Right Gable Rake (+X) - CCW
      addQuad(rR_bot, rR_top, eFR, fB_FR, [1, 0, 0]);
      addQuad(fB_BR, eBR, rR_top, rR_bot, [1, 0, 0]);

      // 3. Corner Returns & Side Enclosures
      addQuad([-hw_eave, fB_Y, hd_eave], [-hw_eave, fB_Y, hd_wall], [-hw_eave, eaveY, hd_wall], [-hw_eave, eaveY, hd_eave], [-1, 0, 0]);
      addQuad([hw_eave, fB_Y, hd_wall], [hw_eave, fB_Y, hd_eave], [hw_eave, eaveY, hd_eave], [hw_eave, eaveY, hd_wall], [1, 0, 0]);
      addQuad([-hw_eave, fB_Y, -hd_wall], [-hw_eave, fB_Y, -hd_eave], [-hw_eave, eaveY, -hd_eave], [-hw_eave, eaveY, -hd_wall], [-1, 0, 0]);
      addQuad([hw_eave, fB_Y, -hd_eave], [hw_eave, fB_Y, -hd_wall], [hw_eave, eaveY, -hd_wall], [hw_eave, eaveY, -hd_eave], [1, 0, 0]);
    } else {
      const ridgeY = ridgeHeight;

      const eLF: [number, number, number] = [-hw_eave, eaveY, hd_eave];
      const eRF: [number, number, number] = [hw_eave, eaveY, hd_eave];
      const eLB: [number, number, number] = [-hw_eave, eaveY, -hd_eave];
      const eRB: [number, number, number] = [hw_eave, eaveY, -hd_eave];

      const fB_LF: [number, number, number] = [-hw_eave, fB_Y, hd_eave];
      const fB_RF: [number, number, number] = [hw_eave, fB_Y, hd_eave];
      const fB_LB: [number, number, number] = [-hw_eave, fB_Y, -hd_eave];
      const fB_RB: [number, number, number] = [hw_eave, fB_Y, -hd_eave];

      // 1. Left & Right Vertical Eave Fascias (CCW)
      addQuad(fB_LF, fB_LB, eLB, eLF, [-1, 0, 0]); // Left
      addQuad(fB_RB, fB_RF, eRF, eRB, [1, 0, 0]);  // Right

      // 2. Gable Rake Bargeboards (Front & Back ends)
      const rF_top: [number, number, number] = [0, ridgeY, hd_eave];
      const rF_bot: [number, number, number] = [0, ridgeY - fasciaHeight, hd_eave];
      const rB_top: [number, number, number] = [0, ridgeY, -hd_eave];
      const rB_bot: [number, number, number] = [0, ridgeY - fasciaHeight, -hd_eave];

      // Front Gable Rake (+Z) - CCW
      addQuad(fB_RF, eRF, rF_top, rF_bot, [0, 0, 1]);
      addQuad(rF_bot, rF_top, eLF, fB_LF, [0, 0, 1]);

      // Back Gable Rake (-Z) - CCW
      addQuad(rB_bot, rB_top, eRB, fB_RB, [0, 0, -1]);
      addQuad(fB_LB, eLB, rB_top, rB_bot, [0, 0, -1]);

      // 3. Corner Returns
      addQuad([-hw_eave, fB_Y, hd_eave], [-hw_wall, fB_Y, hd_eave], [-hw_wall, eaveY, hd_eave], [-hw_eave, eaveY, hd_eave], [0, 0, 1]);
      addQuad([hw_wall, fB_Y, hd_eave], [hw_eave, fB_Y, hd_eave], [hw_eave, eaveY, hd_eave], [hw_wall, eaveY, hd_eave], [0, 0, 1]);
      addQuad([-hw_wall, fB_Y, -hd_eave], [-hw_eave, fB_Y, -hd_eave], [-hw_eave, eaveY, -hd_eave], [-hw_wall, eaveY, -hd_eave], [0, 0, -1]);
      addQuad([hw_eave, fB_Y, -hd_eave], [hw_wall, fB_Y, -hd_eave], [hw_wall, eaveY, -hd_eave], [hw_eave, eaveY, -hd_eave], [0, 0, -1]);
    }
  });
}

/**
 * 5. Gable Soffits (Underside ceiling panels closing all eave voids)
 */
export function createGableSoffitsGeometry(
  buildingWidth: number,
  buildingDepth: number,
  eaveOverhang: number = 0.30,
  fasciaHeight: number = 0.18
): THREE.BufferGeometry {
  return createGeometryFromBuilder((_addTriangle, addQuad) => {
    const hw_wall = buildingWidth / 2;
    const hd_wall = buildingDepth / 2;
    const hw_eave = hw_wall + eaveOverhang;
    const hd_eave = hd_wall + eaveOverhang;
    const isWidthLonger = buildingWidth >= buildingDepth;
    const fB_Y = -fasciaHeight;

    if (isWidthLonger) {
      const fB_FL: [number, number, number] = [-hw_eave, fB_Y, hd_eave];
      const fB_FR: [number, number, number] = [hw_eave, fB_Y, hd_eave];
      const fB_BL: [number, number, number] = [-hw_eave, fB_Y, -hd_eave];
      const fB_BR: [number, number, number] = [hw_eave, fB_Y, -hd_eave];

      const wFL: [number, number, number] = [-hw_wall, fB_Y, hd_wall];
      const wFR: [number, number, number] = [hw_wall, fB_Y, hd_wall];
      const wBL: [number, number, number] = [-hw_wall, fB_Y, -hd_wall];
      const wBR: [number, number, number] = [hw_wall, fB_Y, -hd_wall];

      // CCW looking from below (-Y)
      addQuad(wFL, wFR, fB_FR, fB_FL, [0, -1, 0]); // Front
      addQuad(wBR, wBL, fB_BL, fB_BR, [0, -1, 0]); // Back
      addQuad(wBL, wFL, [-hw_eave, fB_Y, hd_wall], [-hw_eave, fB_Y, -hd_wall], [0, -1, 0]); // Left
      addQuad(wFR, wBR, [hw_eave, fB_Y, -hd_wall], [hw_eave, fB_Y, hd_wall], [0, -1, 0]);  // Right
    } else {
      const fB_LF: [number, number, number] = [-hw_eave, fB_Y, hd_eave];
      const fB_RF: [number, number, number] = [hw_eave, fB_Y, hd_eave];
      const fB_LB: [number, number, number] = [-hw_eave, fB_Y, -hd_eave];
      const fB_RB: [number, number, number] = [hw_eave, fB_Y, -hd_eave];

      const wLF: [number, number, number] = [-hw_wall, fB_Y, hd_wall];
      const wRF: [number, number, number] = [hw_wall, fB_Y, hd_wall];
      const wLB: [number, number, number] = [-hw_wall, fB_Y, -hd_wall];
      const wRB: [number, number, number] = [hw_wall, fB_Y, -hd_wall];

      // CCW looking from below (-Y)
      addQuad(wLB, wLF, fB_LF, fB_LB, [0, -1, 0]); // Left
      addQuad(wRF, wRB, fB_RB, fB_RF, [0, -1, 0]); // Right
      addQuad(wLF, wRF, [hw_wall, fB_Y, hd_eave], [-hw_wall, fB_Y, hd_eave], [0, -1, 0]); // Front
      addQuad(wRB, wLB, [-hw_wall, fB_Y, -hd_eave], [hw_wall, fB_Y, -hd_eave], [0, -1, 0]); // Back
    }
  });
}

/**
 * Composite Gable Roof Geometry (All solid parts combined)
 */
export function createDetailedGableRoofGeometry(
  buildingWidth: number,
  buildingDepth: number,
  ridgeHeight: number,
  eaveOverhang: number = 0.30,
  fasciaHeight: number = 0.18,
  ridgeCapRadius: number = 0.08
): THREE.BufferGeometry {
  return createGeometryFromBuilder((addTriangle, addQuad) => {
    const hw_wall = buildingWidth / 2;
    const hd_wall = buildingDepth / 2;
    const hw_eave = hw_wall + eaveOverhang;
    const hd_eave = hd_wall + eaveOverhang;
    const isWidthLonger = buildingWidth >= buildingDepth;
    const ridgeY = ridgeHeight;
    const eaveY = 0;

    if (isWidthLonger) {
      const rL: [number, number, number] = [-hw_eave, ridgeY, 0];
      const rR: [number, number, number] = [hw_eave, ridgeY, 0];
      const eFL: [number, number, number] = [-hw_eave, eaveY, hd_eave];
      const eFR: [number, number, number] = [hw_eave, eaveY, hd_eave];
      const eBL: [number, number, number] = [-hw_eave, eaveY, -hd_eave];
      const eBR: [number, number, number] = [hw_eave, eaveY, -hd_eave];

      // Slopes (CCW)
      addQuad(eFL, eFR, rR, rL);
      addQuad(eBR, eBL, rL, rR);

      // Infill walls (CCW)
      const rL_wall: [number, number, number] = [-hw_wall, ridgeY, 0];
      const eFL_wall: [number, number, number] = [-hw_wall, eaveY, hd_wall];
      const eBL_wall: [number, number, number] = [-hw_wall, eaveY, -hd_wall];
      addTriangle(eFL_wall, eBL_wall, rL_wall, [-1, 0, 0]);

      const rR_wall: [number, number, number] = [hw_wall, ridgeY, 0];
      const eFR_wall: [number, number, number] = [hw_wall, eaveY, hd_wall];
      const eBR_wall: [number, number, number] = [hw_wall, eaveY, -hd_wall];
      addTriangle(eBR_wall, eFR_wall, rR_wall, [1, 0, 0]);

      // Ridge cap
      const capW = hw_eave + 0.04;
      const capH = ridgeCapRadius;
      const capZ = 0.12;
      addQuad([-capW, ridgeY + capH, -capZ], [capW, ridgeY + capH, -capZ], [capW, ridgeY + capH, capZ], [-capW, ridgeY + capH, capZ], [0, 1, 0]);
    } else {
      const rB: [number, number, number] = [0, ridgeY, -hd_eave];
      const rF: [number, number, number] = [0, ridgeY, hd_eave];
      const eLF: [number, number, number] = [-hw_eave, eaveY, hd_eave];
      const eRF: [number, number, number] = [hw_eave, eaveY, hd_eave];
      const eLB: [number, number, number] = [-hw_eave, eaveY, -hd_eave];
      const eRB: [number, number, number] = [hw_eave, eaveY, -hd_eave];

      // Slopes (CCW)
      addQuad(eLF, eLB, rB, rF);
      addQuad(eRB, eRF, rF, rB);

      // Infill walls (CCW)
      const rF_wall: [number, number, number] = [0, ridgeY, hd_wall];
      const eLF_wall: [number, number, number] = [-hw_wall, eaveY, hd_wall];
      const eRF_wall: [number, number, number] = [hw_wall, eaveY, hd_wall];
      addTriangle(eRF_wall, eLF_wall, rF_wall, [0, 0, 1]);

      const rB_wall: [number, number, number] = [0, ridgeY, -hd_wall];
      const eLB_wall: [number, number, number] = [-hw_wall, eaveY, -hd_wall];
      const eRB_wall: [number, number, number] = [hw_wall, eaveY, -hd_wall];
      addTriangle(eLB_wall, eRB_wall, rB_wall, [0, 0, -1]);

      // Ridge cap
      const capD = hd_eave + 0.04;
      const capH = ridgeCapRadius;
      const capX = 0.12;
      addQuad([-capX, ridgeY + capH, -capD], [capX, ridgeY + capH, -capD], [capX, ridgeY + capH, capD], [-capX, ridgeY + capH, capD], [0, 1, 0]);
    }
  });
}

// -------------------------------------------------------------
// HIP ROOF SUBCOMPONENT GEOMETRIES (STRICT CCW ORIENTATION)
// -------------------------------------------------------------

/**
 * 1. Hip Roof Slopes (The 4 sloping pitch planes)
 */
export function createHipRoofSlopesGeometry(
  buildingWidth: number,
  buildingDepth: number,
  ridgeHeight: number,
  eaveOverhang: number = 0.30
): THREE.BufferGeometry {
  return createGeometryFromBuilder((addTriangle, addQuad) => {
    const hw_wall = buildingWidth / 2;
    const hd_wall = buildingDepth / 2;
    const hw_eave = hw_wall + eaveOverhang;
    const hd_eave = hd_wall + eaveOverhang;

    const ridgeY = ridgeHeight;
    const eaveY = 0;

    const eFL: [number, number, number] = [-hw_eave, eaveY, hd_eave];
    const eFR: [number, number, number] = [hw_eave, eaveY, hd_eave];
    const eBR: [number, number, number] = [hw_eave, eaveY, -hd_eave];
    const eBL: [number, number, number] = [-hw_eave, eaveY, -hd_eave];

    const isWidthLonger = buildingWidth >= buildingDepth;

    if (isWidthLonger) {
      const hipOffset = hd_eave;
      const ridgeHalfLen = Math.max(0.2, hw_eave - hipOffset);
      const rStart: [number, number, number] = [-ridgeHalfLen, ridgeY, 0];
      const rEnd: [number, number, number] = [ridgeHalfLen, ridgeY, 0];

      // CCW Slopes
      addQuad(eFL, eFR, rEnd, rStart); // Front (+Z)
      addQuad(eBR, eBL, rStart, rEnd); // Back (-Z)
      addTriangle(eBL, eFL, rStart);    // Left hip (-X)
      addTriangle(eFR, eBR, rEnd);      // Right hip (+X)
    } else {
      const hipOffset = hw_eave;
      const ridgeHalfLen = Math.max(0.2, hd_eave - hipOffset);
      const rStart: [number, number, number] = [0, ridgeY, -ridgeHalfLen];
      const rEnd: [number, number, number] = [0, ridgeY, ridgeHalfLen];

      // CCW Slopes
      addQuad(eBL, eFL, rEnd, rStart); // Left (-X)
      addQuad(eFR, eBR, rStart, rEnd); // Right (+X)
      addTriangle(eFL, eFR, rEnd);     // Front hip (+Z)
      addTriangle(eBR, eBL, rStart);   // Back hip (-Z)
    }
  });
}

/**
 * 2. Hip Ridge Capping
 */
export function createHipRidgeCapGeometry(
  buildingWidth: number,
  buildingDepth: number,
  ridgeHeight: number,
  eaveOverhang: number = 0.30
): THREE.BufferGeometry {
  return createGeometryFromBuilder((_addTriangle, addQuad) => {
    const hw_wall = buildingWidth / 2;
    const hd_wall = buildingDepth / 2;
    const hw_eave = hw_wall + eaveOverhang;
    const hd_eave = hd_wall + eaveOverhang;
    const isWidthLonger = buildingWidth >= buildingDepth;
    const ridgeY = ridgeHeight;

    if (isWidthLonger) {
      const hipOffset = hd_eave;
      const ridgeHalfLen = Math.max(0.2, hw_eave - hipOffset);
      const capZ = 0.12;
      addQuad(
        [-ridgeHalfLen - 0.05, ridgeY + 0.06, -capZ],
        [ridgeHalfLen + 0.05, ridgeY + 0.06, -capZ],
        [ridgeHalfLen + 0.05, ridgeY + 0.06, capZ],
        [-ridgeHalfLen - 0.05, ridgeY + 0.06, capZ],
        [0, 1, 0]
      );
    } else {
      const hipOffset = hw_eave;
      const ridgeHalfLen = Math.max(0.2, hd_eave - hipOffset);
      const capX = 0.12;
      addQuad(
        [-capX, ridgeY + 0.06, -ridgeHalfLen - 0.05],
        [capX, ridgeY + 0.06, -ridgeHalfLen - 0.05],
        [capX, ridgeY + 0.06, ridgeHalfLen + 0.05],
        [-capX, ridgeY + 0.06, ridgeHalfLen + 0.05],
        [0, 1, 0]
      );
    }
  });
}

/**
 * 3. Hip Fascia (360° perimeter vertical faces)
 */
export function createHipFasciaGeometry(
  buildingWidth: number,
  buildingDepth: number,
  _ridgeHeight: number,
  eaveOverhang: number = 0.30,
  fasciaHeight: number = 0.18
): THREE.BufferGeometry {
  return createGeometryFromBuilder((_addTriangle, addQuad) => {
    const hw_wall = buildingWidth / 2;
    const hd_wall = buildingDepth / 2;
    const hw_eave = hw_wall + eaveOverhang;
    const hd_eave = hd_wall + eaveOverhang;

    const eaveY = 0;
    const fB_Y = -fasciaHeight;

    const eFL: [number, number, number] = [-hw_eave, eaveY, hd_eave];
    const eFR: [number, number, number] = [hw_eave, eaveY, hd_eave];
    const eBR: [number, number, number] = [hw_eave, eaveY, -hd_eave];
    const eBL: [number, number, number] = [-hw_eave, eaveY, -hd_eave];

    const fB_FL: [number, number, number] = [-hw_eave, fB_Y, hd_eave];
    const fB_FR: [number, number, number] = [hw_eave, fB_Y, hd_eave];
    const fB_BR: [number, number, number] = [hw_eave, fB_Y, -hd_eave];
    const fB_BL: [number, number, number] = [-hw_eave, fB_Y, -hd_eave];

    // 360° vertical fascia perimeter (CCW)
    addQuad(fB_FL, fB_FR, eFR, eFL, [0, 0, 1]);  // Front
    addQuad(fB_FR, fB_BR, eBR, eFR, [1, 0, 0]);  // Right
    addQuad(fB_BR, fB_BL, eBL, eBR, [0, 0, -1]); // Back
    addQuad(fB_BL, fB_FL, eFL, eBL, [-1, 0, 0]); // Left
  });
}

/**
 * 4. Hip Soffits (360° perimeter underside ceiling)
 */
export function createHipSoffitsGeometry(
  buildingWidth: number,
  buildingDepth: number,
  eaveOverhang: number = 0.30,
  fasciaHeight: number = 0.18
): THREE.BufferGeometry {
  return createGeometryFromBuilder((_addTriangle, addQuad) => {
    const hw_wall = buildingWidth / 2;
    const hd_wall = buildingDepth / 2;
    const hw_eave = hw_wall + eaveOverhang;
    const hd_eave = hd_wall + eaveOverhang;
    const fB_Y = -fasciaHeight;

    const fB_FL: [number, number, number] = [-hw_eave, fB_Y, hd_eave];
    const fB_FR: [number, number, number] = [hw_eave, fB_Y, hd_eave];
    const fB_BR: [number, number, number] = [hw_eave, fB_Y, -hd_eave];
    const fB_BL: [number, number, number] = [-hw_eave, fB_Y, -hd_eave];

    const wFL: [number, number, number] = [-hw_wall, fB_Y, hd_wall];
    const wFR: [number, number, number] = [hw_wall, fB_Y, hd_wall];
    const wBR: [number, number, number] = [hw_wall, fB_Y, -hd_wall];
    const wBL: [number, number, number] = [-hw_wall, fB_Y, -hd_wall];

    // CCW looking from below (-Y)
    addQuad(wFL, wFR, fB_FR, fB_FL, [0, -1, 0]); // Front
    addQuad(wFR, wBR, fB_BR, fB_FR, [0, -1, 0]); // Right
    addQuad(wBR, wBL, fB_BL, fB_BR, [0, -1, 0]); // Back
    addQuad(wBL, wFL, fB_FL, fB_BL, [0, -1, 0]); // Left
  });
}

/**
 * Composite Hip Roof Geometry
 */
export function createDetailedHipRoofGeometry(
  buildingWidth: number,
  buildingDepth: number,
  ridgeHeight: number,
  eaveOverhang: number = 0.30,
  _fasciaHeight: number = 0.18
): THREE.BufferGeometry {
  return createGeometryFromBuilder((addTriangle, addQuad) => {
    const hw_wall = buildingWidth / 2;
    const hd_wall = buildingDepth / 2;
    const hw_eave = hw_wall + eaveOverhang;
    const hd_eave = hd_wall + eaveOverhang;

    const ridgeY = ridgeHeight;
    const eaveY = 0;

    const eFL: [number, number, number] = [-hw_eave, eaveY, hd_eave];
    const eFR: [number, number, number] = [hw_eave, eaveY, hd_eave];
    const eBR: [number, number, number] = [hw_eave, eaveY, -hd_eave];
    const eBL: [number, number, number] = [-hw_eave, eaveY, -hd_eave];

    const isWidthLonger = buildingWidth >= buildingDepth;

    if (isWidthLonger) {
      const hipOffset = hd_eave;
      const ridgeHalfLen = Math.max(0.2, hw_eave - hipOffset);
      const rStart: [number, number, number] = [-ridgeHalfLen, ridgeY, 0];
      const rEnd: [number, number, number] = [ridgeHalfLen, ridgeY, 0];

      // Slopes (CCW)
      addQuad(eFL, eFR, rEnd, rStart);
      addQuad(eBR, eBL, rStart, rEnd);
      addTriangle(eBL, eFL, rStart);
      addTriangle(eFR, eBR, rEnd);

      // Ridge cap
      const capZ = 0.12;
      addQuad(
        [-ridgeHalfLen - 0.05, ridgeY + 0.06, -capZ],
        [ridgeHalfLen + 0.05, ridgeY + 0.06, -capZ],
        [ridgeHalfLen + 0.05, ridgeY + 0.06, capZ],
        [-ridgeHalfLen - 0.05, ridgeY + 0.06, capZ],
        [0, 1, 0]
      );
    } else {
      const hipOffset = hw_eave;
      const ridgeHalfLen = Math.max(0.2, hd_eave - hipOffset);
      const rStart: [number, number, number] = [0, ridgeY, -ridgeHalfLen];
      const rEnd: [number, number, number] = [0, ridgeY, ridgeHalfLen];

      // Slopes (CCW)
      addQuad(eBL, eFL, rEnd, rStart);
      addQuad(eFR, eBR, rStart, rEnd);
      addTriangle(eFL, eFR, rEnd);
      addTriangle(eBR, eBL, rStart);

      // Ridge cap
      const capX = 0.12;
      addQuad(
        [-capX, ridgeY + 0.06, -ridgeHalfLen - 0.05],
        [capX, ridgeY + 0.06, -ridgeHalfLen - 0.05],
        [capX, ridgeY + 0.06, ridgeHalfLen + 0.05],
        [-capX, ridgeY + 0.06, ridgeHalfLen + 0.05],
        [0, 1, 0]
      );
    }
  });
}

// =========================================================================
// L-SHAPED & NON-RECTANGULAR ROOF GEOMETRIES (CROSS-GABLE & CROSS-HIP)
// =========================================================================

function distToSegment2D(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-6) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
  const projX = ax + t * dx;
  const projZ = az + t * dz;
  return Math.hypot(px - projX, pz - projZ);
}

function distToPolygonBoundary2D(px: number, pz: number, polygon: [number, number][]): number {
  let minD = Infinity;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % n];
    const d = distToSegment2D(px, pz, p1[0], p1[1], p2[0], p2[1]);
    if (d < minD) minD = d;
  }
  return minD;
}

/**
 * Extracts the 6 canonical ordered vertices of an L-shape starting at the reflex corner.
 */
function getCanonicalLPolygon(poly: [number, number][], reflexIdx: number): [number, number][] {
  const n = poly.length;
  const canon: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    canon.push(poly[(reflexIdx + i) % n]);
  }
  return canon;
}

/**
 * Computes canonical roof ridge & junction points for an L-shape.
 */
function computeLRidgeNodes(
  wallPolyCanon: [number, number][],
  eavePolyCanon: [number, number][],
  ridgeHeight: number,
  isHip: boolean
) {
  const E = eavePolyCanon;
  const V = wallPolyCanon;

  // E[0] is the reflex inside corner
  // E[3] is the outer corner opposite reflex corner
  const isWing1AlongX = Math.abs(E[1][0] - E[0][0]) > Math.abs(E[1][1] - E[0][1]);

  let xRidge: number;
  let zRidge: number;

  if (isWing1AlongX) {
    zRidge = (E[0][1] + E[3][1]) / 2;
    xRidge = (E[0][0] + E[3][0]) / 2;
  } else {
    xRidge = (E[0][0] + E[3][0]) / 2;
    zRidge = (E[0][1] + E[3][1]) / 2;
  }

  const rJunc: [number, number, number] = [xRidge, ridgeHeight, zRidge];

  // Wing 1 far end (between E[1] and E[2])
  const c1x = (E[1][0] + E[2][0]) / 2;
  const c1z = (E[1][1] + E[2][1]) / 2;
  const span1 = Math.hypot(E[2][0] - E[1][0], E[2][1] - E[1][1]);

  let rEnd1: [number, number, number];
  if (!isHip) {
    rEnd1 = [c1x, ridgeHeight, c1z];
  } else {
    // Inset ridge end for 45° hip
    const dirX = rJunc[0] - c1x;
    const dirZ = rJunc[2] - c1z;
    const len = Math.hypot(dirX, dirZ) || 1e-6;
    const inset = Math.min(len * 0.7, span1 / 2);
    rEnd1 = [c1x + (dirX / len) * inset, ridgeHeight, c1z + (dirZ / len) * inset];
  }

  // Wing 2 far end (between E[4] and E[5])
  const c2x = (E[4][0] + E[5][0]) / 2;
  const c2z = (E[4][1] + E[5][1]) / 2;
  const span2 = Math.hypot(E[5][0] - E[4][0], E[5][1] - E[4][1]);

  let rEnd2: [number, number, number];
  if (!isHip) {
    rEnd2 = [c2x, ridgeHeight, c2z];
  } else {
    const dirX = rJunc[0] - c2x;
    const dirZ = rJunc[2] - c2z;
    const len = Math.hypot(dirX, dirZ) || 1e-6;
    const inset = Math.min(len * 0.7, span2 / 2);
    rEnd2 = [c2x + (dirX / len) * inset, ridgeHeight, c2z + (dirZ / len) * inset];
  }

  // Wall-flush pediment apex nodes (for gable pediment infills)
  const rWall1: [number, number, number] = [(V[1][0] + V[2][0]) / 2, ridgeHeight, (V[1][1] + V[2][1]) / 2];
  const rWall2: [number, number, number] = [(V[4][0] + V[5][0]) / 2, ridgeHeight, (V[4][1] + V[5][1]) / 2];

  return { rJunc, rEnd1, rEnd2, rWall1, rWall2 };
}

/**
 * 1. L-Shaped Hip Roof Slopes (Cross-Hip with Inside Valley & Corner Hips)
 */
export function createLShapedHipRoofSlopesGeometry(
  wallPoly: [number, number][],
  eavePoly: [number, number][],
  reflexIdx: number,
  ridgeHeight: number
): THREE.BufferGeometry {
  return createGeometryFromBuilder((addTriangle, addQuad) => {
    const V = getCanonicalLPolygon(wallPoly, reflexIdx);
    const E = getCanonicalLPolygon(eavePoly, reflexIdx);
    const { rJunc, rEnd1, rEnd2 } = computeLRidgeNodes(V, E, ridgeHeight, true);

    const e0: [number, number, number] = [E[0][0], 0, E[0][1]];
    const e1: [number, number, number] = [E[1][0], 0, E[1][1]];
    const e2: [number, number, number] = [E[2][0], 0, E[2][1]];
    const e3: [number, number, number] = [E[3][0], 0, E[3][1]];
    const e4: [number, number, number] = [E[4][0], 0, E[4][1]];
    const e5: [number, number, number] = [E[5][0], 0, E[5][1]];

    // 1. Wing 1 Valley Slope (Outward/Upward facing)
    addQuad(e1, e0, rJunc, rEnd1);
    // 2. Wing 1 Far End Hip (Outward facing)
    addTriangle(e2, e1, rEnd1);
    // 3. Wing 1 Outer Slope (Outward/Upward facing)
    addQuad(e3, e2, rEnd1, rJunc);
    // 4. Wing 2 Outer Slope (Outward/Upward facing)
    addQuad(e4, e3, rJunc, rEnd2);
    // 5. Wing 2 Far End Hip (Outward facing)
    addTriangle(e5, e4, rEnd2);
    // 6. Wing 2 Valley Slope (Outward/Upward facing)
    addQuad(e0, e5, rEnd2, rJunc);
  }, true);
}

/**
 * 2. L-Shaped Gable Roof Slopes (Cross-Gable with Inside Valley)
 */
export function createLShapedGableRoofSlopesGeometry(
  wallPoly: [number, number][],
  eavePoly: [number, number][],
  reflexIdx: number,
  ridgeHeight: number
): THREE.BufferGeometry {
  return createGeometryFromBuilder((_addTriangle, addQuad) => {
    const V = getCanonicalLPolygon(wallPoly, reflexIdx);
    const E = getCanonicalLPolygon(eavePoly, reflexIdx);
    const { rJunc, rEnd1, rEnd2 } = computeLRidgeNodes(V, E, ridgeHeight, false);

    const e0: [number, number, number] = [E[0][0], 0, E[0][1]];
    const e1: [number, number, number] = [E[1][0], 0, E[1][1]];
    const e2: [number, number, number] = [E[2][0], 0, E[2][1]];
    const e3: [number, number, number] = [E[3][0], 0, E[3][1]];
    const e4: [number, number, number] = [E[4][0], 0, E[4][1]];
    const e5: [number, number, number] = [E[5][0], 0, E[5][1]];

    // Slopes (Outward/Upward facing)
    addQuad(e1, e0, rJunc, rEnd1);
    addQuad(e3, e2, rEnd1, rJunc);
    addQuad(e4, e3, rJunc, rEnd2);
    addQuad(e0, e5, rEnd2, rJunc);
  }, true);
}

/**
 * 3. L-Shaped Gable Infill Pediment Walls (At exposed outer ends of both wings)
 */
export function createLShapedPedimentWallsGeometry(
  wallPoly: [number, number][],
  eavePoly: [number, number][],
  reflexIdx: number,
  ridgeHeight: number
): THREE.BufferGeometry {
  return createGeometryFromBuilder((addTriangle) => {
    const V = getCanonicalLPolygon(wallPoly, reflexIdx);
    const E = getCanonicalLPolygon(eavePoly, reflexIdx);
    const { rWall1, rWall2 } = computeLRidgeNodes(V, E, ridgeHeight, false);

    const v1: [number, number, number] = [V[1][0], 0, V[1][1]];
    const v2: [number, number, number] = [V[2][0], 0, V[2][1]];
    const v4: [number, number, number] = [V[4][0], 0, V[4][1]];
    const v5: [number, number, number] = [V[5][0], 0, V[5][1]];

    // Wing 1 far end pediment (Outward facing)
    addTriangle(v2, v1, rWall1);
    // Wing 2 far end pediment (Outward facing)
    addTriangle(v5, v4, rWall2);
  }, true);
}

/**
 * 4. L-Shaped Ridge Cap Geometry (Intersection of ridges at junction)
 */
export function createLShapedRidgeCapGeometry(
  wallPoly: [number, number][],
  eavePoly: [number, number][],
  reflexIdx: number,
  ridgeHeight: number,
  isHip: boolean
): THREE.BufferGeometry {
  return createGeometryFromBuilder((_addTriangle, addQuad) => {
    const V = getCanonicalLPolygon(wallPoly, reflexIdx);
    const E = getCanonicalLPolygon(eavePoly, reflexIdx);
    const { rJunc, rEnd1, rEnd2 } = computeLRidgeNodes(V, E, ridgeHeight, isHip);

    const capR = 0.08;
    const rY = ridgeHeight + 0.04;

    const buildCapSegment = (pA: [number, number, number], pB: [number, number, number]) => {
      const dx = pB[0] - pA[0];
      const dz = pB[2] - pA[2];
      const len = Math.hypot(dx, dz) || 1e-6;
      const nx = -dz / len * capR;
      const nz = dx / len * capR;

      const p1: [number, number, number] = [pA[0] + nx, rY, pA[2] + nz];
      const p2: [number, number, number] = [pB[0] + nx, rY, pB[2] + nz];
      const p3: [number, number, number] = [pB[0] - nx, rY, pB[2] - nz];
      const p4: [number, number, number] = [pA[0] - nx, rY, pA[2] - nz];

      addQuad(p1, p2, p3, p4, [0, 1, 0]);
    };

    buildCapSegment(rJunc, rEnd1);
    buildCapSegment(rJunc, rEnd2);
  });
}

/**
 * 5. Polygonal Fascia & Bargeboards Geometry (Wraps all perimeter edges + gable rakes)
 */
export function createPolygonalFasciaGeometry(
  wallPoly: [number, number][],
  eavePoly: [number, number][],
  fasciaHeight: number = 0.18,
  isGable: boolean = false,
  reflexIdx?: number,
  ridgeHeight?: number
): THREE.BufferGeometry {
  return createGeometryFromBuilder((_addTriangle, addQuad) => {
    const n = eavePoly.length;
    const fB_Y = -fasciaHeight;
    const eaveY = 0;

    // 1. Horizontal vertical fascia along all eave edges
    for (let i = 0; i < n; i++) {
      const p1 = eavePoly[i];
      const p2 = eavePoly[(i + 1) % n];

      const p1_bot: [number, number, number] = [p1[0], fB_Y, p1[1]];
      const p2_bot: [number, number, number] = [p2[0], fB_Y, p2[1]];
      const p2_top: [number, number, number] = [p2[0], eaveY, p2[1]];
      const p1_top: [number, number, number] = [p1[0], eaveY, p1[1]];

      addQuad(p1_bot, p2_bot, p2_top, p1_top);
    }

    // 2. If Gable, add rake bargeboards along exposed gable ends
    if (isGable && reflexIdx !== undefined && ridgeHeight !== undefined && n === 6) {
      const V = getCanonicalLPolygon(wallPoly, reflexIdx);
      const E = getCanonicalLPolygon(eavePoly, reflexIdx);
      const { rEnd1, rEnd2 } = computeLRidgeNodes(V, E, ridgeHeight, false);

      const e1_bot: [number, number, number] = [E[1][0], fB_Y, E[1][1]];
      const e1_top: [number, number, number] = [E[1][0], eaveY, E[1][1]];
      const e2_bot: [number, number, number] = [E[2][0], fB_Y, E[2][1]];
      const e2_top: [number, number, number] = [E[2][0], eaveY, E[2][1]];
      const r1_top: [number, number, number] = [rEnd1[0], rEnd1[1], rEnd1[2]];
      const r1_bot: [number, number, number] = [rEnd1[0], rEnd1[1] - fasciaHeight, rEnd1[2]];

      addQuad(e1_bot, e1_top, r1_top, r1_bot);
      addQuad(r1_bot, r1_top, e2_top, e2_bot);

      const e4_bot: [number, number, number] = [E[4][0], fB_Y, E[4][1]];
      const e4_top: [number, number, number] = [E[4][0], eaveY, E[4][1]];
      const e5_bot: [number, number, number] = [E[5][0], fB_Y, E[5][1]];
      const e5_top: [number, number, number] = [E[5][0], eaveY, E[5][1]];
      const r2_top: [number, number, number] = [rEnd2[0], rEnd2[1], rEnd2[2]];
      const r2_bot: [number, number, number] = [rEnd2[0], rEnd2[1] - fasciaHeight, rEnd2[2]];

      addQuad(e4_bot, e4_top, r2_top, r2_bot);
      addQuad(r2_bot, r2_top, e5_top, e5_bot);
    }
  });
}

/**
 * 6. Polygonal Soffits Geometry (Under-eave panels between wall and eave perimeter)
 */
export function createPolygonalSoffitsGeometry(
  wallPoly: [number, number][],
  eavePoly: [number, number][],
  fasciaHeight: number = 0.18
): THREE.BufferGeometry {
  return createGeometryFromBuilder((_addTriangle, addQuad) => {
    const n = Math.min(wallPoly.length, eavePoly.length);
    const fB_Y = -fasciaHeight;

    for (let i = 0; i < n; i++) {
      const w1 = wallPoly[i];
      const w2 = wallPoly[(i + 1) % n];
      const e1 = eavePoly[i];
      const e2 = eavePoly[(i + 1) % n];

      const w1_3d: [number, number, number] = [w1[0], fB_Y, w1[1]];
      const w2_3d: [number, number, number] = [w2[0], fB_Y, w2[1]];
      const e2_3d: [number, number, number] = [e2[0], fB_Y, e2[1]];
      const e1_3d: [number, number, number] = [e1[0], fB_Y, e1[1]];

      // CCW looking up from beneath (-Y)
      addQuad(w1_3d, w2_3d, e2_3d, e1_3d, [0, -1, 0]);
    }
  });
}

/**
 * 7. General Polygonal Height-Field Straight-Skeleton Roof (For arbitrary N-sided complex polygons)
 */
export function createGeneralPolygonalRoofSlopesGeometry(
  _wallPoly: [number, number][],
  eavePoly: [number, number][],
  ridgeHeight: number,
  pitchAngleDeg: number = 35
): THREE.BufferGeometry {
  return createGeometryFromBuilder((addTriangle) => {
    const rad = THREE.MathUtils.degToRad(pitchAngleDeg);
    const slope = Math.tan(rad);
    const n = eavePoly.length;

    // Find center/mean of polygon
    let cx = 0, cz = 0;
    for (const p of eavePoly) {
      cx += p[0];
      cz += p[1];
    }
    cx /= n;
    cz /= n;

    const centerDist = distToPolygonBoundary2D(cx, cz, eavePoly);
    const centerH = Math.min(ridgeHeight, Math.max(0.6, centerDist * slope));
    const center3D: [number, number, number] = [cx, centerH, cz];

    // Fan triangles from perimeter edges up to skeleton center (outward/upward facing)
    for (let i = 0; i < n; i++) {
      const p1 = eavePoly[i];
      const p2 = eavePoly[(i + 1) % n];
      const p1_3d: [number, number, number] = [p1[0], 0, p1[1]];
      const p2_3d: [number, number, number] = [p2[0], 0, p2[1]];

      addTriangle(p2_3d, p1_3d, center3D);
    }
  }, true);
}

/** Legacy aliases for backwards compatibility with tests */
export const createGableRoofGeometry = createDetailedGableRoofGeometry;
export const createHipRoofGeometry = createDetailedHipRoofGeometry;

export interface RoofAssemblyResult {
  roofShape: Shape;
  fasciaShape: Shape;
  pedimentShape?: Shape;
  ridgeCapShape?: Shape;
  soffitShape?: Shape;
  allShapes: Shape[];
}

/**
 * Builds the complete Roof Assembly with individual, identifiable subcomponents:
 * - Roof Covering & Pitched Tiles (Roof Slopes)
 * - Gable Infill Pediment Walls (for Gable roofs)
 * - Apex Ridge Capping Beam
 * - Fascias & Bargeboards Trim
 * - Soffit Under-eaves Panels
 * Supports Rectangular, L-Shaped, and arbitrary non-rectangular buildings.
 */
export function buildRoofAssemblyForRoom(
  roomWalls: Shape[],
  params: RoofParams,
  existingShapes: Shape[] = []
): RoofAssemblyResult | null {
  const footprint = extractRoomFootprintPolygon(roomWalls, existingShapes);
  if (!footprint) return null;

  const { polygon: worldPoly, isRectangular, isLShape, reflexIndex, centerX, centerZ, topY, bounds } = footprint;
  const { width, depth } = bounds;
  const span = Math.min(width, depth);
  const eaveOverhang = params.eaveOverhang ?? 0.30;
  const fasciaHeight = params.fasciaHeight ?? 0.18;

  let ridgeH = params.ridgeHeight ?? 2.0;
  if (params.usePitchAngle && params.pitchAngleDeg) {
    const rad = THREE.MathUtils.degToRad(params.pitchAngleDeg);
    ridgeH = Math.max(0.6, (span / 2 + eaveOverhang) * Math.tan(rad));
  }

  const isHip = params.roofType === 'hip';
  const roofId = `roof_${Math.random().toString(36).substr(2, 9)}`;

  // Convert world polygon to local coordinates centered at (centerX, centerZ)
  const localWallPoly: [number, number][] = worldPoly.map(([x, z]) => [x - centerX, z - centerZ]);
  const localEavePoly: [number, number][] = offsetPolygon2D(localWallPoly, eaveOverhang);

  let slopesGeom: THREE.BufferGeometry;
  let pedimentGeom: THREE.BufferGeometry | null = null;
  let ridgeCapGeom: THREE.BufferGeometry;
  let fasciaGeom: THREE.BufferGeometry;
  let soffitGeom: THREE.BufferGeometry;

  if (isRectangular) {
    // Optimized standard rectangular roof
    slopesGeom = isHip
      ? createHipRoofSlopesGeometry(width, depth, ridgeH, eaveOverhang)
      : createGableRoofSlopesGeometry(width, depth, ridgeH, eaveOverhang);

    if (!isHip) {
      pedimentGeom = createGablePedimentWallsGeometry(width, depth, ridgeH);
    }
    ridgeCapGeom = isHip
      ? createHipRidgeCapGeometry(width, depth, ridgeH, eaveOverhang)
      : createGableRidgeCapGeometry(width, depth, ridgeH, eaveOverhang);

    fasciaGeom = isHip
      ? createHipFasciaGeometry(width, depth, ridgeH, eaveOverhang, fasciaHeight)
      : createGableFasciaGeometry(width, depth, ridgeH, eaveOverhang, fasciaHeight);

    soffitGeom = isHip
      ? createHipSoffitsGeometry(width, depth, eaveOverhang, fasciaHeight)
      : createGableSoffitsGeometry(width, depth, eaveOverhang, fasciaHeight);

  } else if (isLShape && reflexIndex !== undefined) {
    // Specialized L-Shaped Cross-Gable / Cross-Hip roof with valley rafters
    slopesGeom = isHip
      ? createLShapedHipRoofSlopesGeometry(localWallPoly, localEavePoly, reflexIndex, ridgeH)
      : createLShapedGableRoofSlopesGeometry(localWallPoly, localEavePoly, reflexIndex, ridgeH);

    if (!isHip) {
      pedimentGeom = createLShapedPedimentWallsGeometry(localWallPoly, localEavePoly, reflexIndex, ridgeH);
    }

    ridgeCapGeom = createLShapedRidgeCapGeometry(localWallPoly, localEavePoly, reflexIndex, ridgeH, isHip);
    fasciaGeom = createPolygonalFasciaGeometry(localWallPoly, localEavePoly, fasciaHeight, !isHip, reflexIndex, ridgeH);
    soffitGeom = createPolygonalSoffitsGeometry(localWallPoly, localEavePoly, fasciaHeight);

  } else {
    // General N-sided polygonal roof
    slopesGeom = createGeneralPolygonalRoofSlopesGeometry(localWallPoly, localEavePoly, ridgeH, params.pitchAngleDeg || 35);
    ridgeCapGeom = createHipRidgeCapGeometry(width, depth, ridgeH, eaveOverhang);
    fasciaGeom = createPolygonalFasciaGeometry(localWallPoly, localEavePoly, fasciaHeight, false);
    soffitGeom = createPolygonalSoffitsGeometry(localWallPoly, localEavePoly, fasciaHeight);
  }

  // 1. Main Roof Slopes Shape
  const roofShape: Shape = {
    id: roofId,
    name: `${isHip ? 'Hip' : 'Gable'} Roof (${width.toFixed(1)}m × ${depth.toFixed(1)}m)`,
    type: 'custom',
    position: [centerX, topY, centerZ],
    rotation: [0, 0, 0],
    args: [width, ridgeH, depth],
    color: params.color || '#991b1b', // Terracotta roof red
    roughness: 0.75,
    metalness: 0.05,
    geometryData: {
      positions: Array.from(slopesGeom.attributes.position.array),
      normals: Array.from(slopesGeom.attributes.normal.array),
      uvs: slopesGeom.attributes.uv ? Array.from(slopesGeom.attributes.uv.array) : undefined,
    },
    tags: ['architecture', 'roof-structure', 'roof-assembly', 'roof-slopes'],
  };

  const childShapes: Shape[] = [];

  // 2. Gable Infill Pediment Walls (only for Gable roofs)
  let pedimentShape: Shape | undefined;
  if (!isHip && pedimentGeom) {
    pedimentShape = {
      id: `pediment_${Math.random().toString(36).substr(2, 9)}`,
      name: `Gable Pediment Infill Walls`,
      type: 'custom',
      position: [centerX, topY, centerZ],
      rotation: [0, 0, 0],
      args: [width, ridgeH, depth],
      parentShapeId: roofId,
      color: params.pedimentColor || '#f1f5f9', // Clean matching wall exterior
      roughness: 0.7,
      metalness: 0.05,
      geometryData: {
        positions: Array.from(pedimentGeom.attributes.position.array),
        normals: Array.from(pedimentGeom.attributes.normal.array),
        uvs: pedimentGeom.attributes.uv ? Array.from(pedimentGeom.attributes.uv.array) : undefined,
      },
      tags: ['architecture', 'roof-pediment', 'roof-part'],
    };
    childShapes.push(pedimentShape);
  }

  // 3. Apex Ridge Capping
  const ridgeCapShape: Shape = {
    id: `ridgecap_${Math.random().toString(36).substr(2, 9)}`,
    name: `Apex Ridge Capping`,
    type: 'custom',
    position: [centerX, topY, centerZ],
    rotation: [0, 0, 0],
    args: [width, 0.1, depth],
    parentShapeId: roofId,
    color: params.ridgeCapColor || '#334155', // Slate/anthracite ridge trim
    roughness: 0.6,
    metalness: 0.1,
    geometryData: {
      positions: Array.from(ridgeCapGeom.attributes.position.array),
      normals: Array.from(ridgeCapGeom.attributes.normal.array),
      uvs: ridgeCapGeom.attributes.uv ? Array.from(ridgeCapGeom.attributes.uv.array) : undefined,
    },
    tags: ['architecture', 'roof-ridge-cap', 'roof-part'],
  };
  childShapes.push(ridgeCapShape);

  // 4. Fascias & Bargeboards
  const fasciaShape: Shape = {
    id: `fascia_${Math.random().toString(36).substr(2, 9)}`,
    name: `Fascias & Bargeboards`,
    type: 'custom',
    position: [centerX, topY, centerZ],
    rotation: [0, 0, 0],
    args: [width, fasciaHeight, depth],
    parentShapeId: roofId,
    color: params.fasciaColor || '#f8fafc', // Architectural white trim
    roughness: 0.45,
    metalness: 0.05,
    geometryData: {
      positions: Array.from(fasciaGeom.attributes.position.array),
      normals: Array.from(fasciaGeom.attributes.normal.array),
      uvs: fasciaGeom.attributes.uv ? Array.from(fasciaGeom.attributes.uv.array) : undefined,
    },
    tags: ['architecture', 'roof-fascia', 'roof-part'],
  };
  childShapes.push(fasciaShape);

  // 5. Soffit Under-Eaves Panels
  const soffitShape: Shape = {
    id: `soffit_${Math.random().toString(36).substr(2, 9)}`,
    name: `Soffits & Eaves Panels`,
    type: 'custom',
    position: [centerX, topY, centerZ],
    rotation: [0, 0, 0],
    args: [width, 0.05, depth],
    parentShapeId: roofId,
    color: params.soffitColor || '#e2e8f0', // Soft off-white soffit finish
    roughness: 0.7,
    metalness: 0.05,
    geometryData: {
      positions: Array.from(soffitGeom.attributes.position.array),
      normals: Array.from(soffitGeom.attributes.normal.array),
      uvs: soffitGeom.attributes.uv ? Array.from(soffitGeom.attributes.uv.array) : undefined,
    },
    tags: ['architecture', 'roof-soffit', 'roof-part'],
  };
  childShapes.push(soffitShape);

  const allShapes = [roofShape, ...childShapes];

  return {
    roofShape,
    fasciaShape,
    pedimentShape,
    ridgeCapShape,
    soffitShape,
    allShapes,
  };
}

/**
 * Creates a parametric 3D Roof Shape matching the wall sizes and highest floor elevation.
 */
export function buildRoofShapeForRoom(
  roomWalls: Shape[],
  params: RoofParams,
  existingShapes: Shape[] = []
): Shape | null {
  const assembly = buildRoofAssemblyForRoom(roomWalls, params, existingShapes);
  return assembly ? assembly.roofShape : null;
}

/**
 * Insets a 2D closed polygon inward by a specified distance.
 * Preserves counter-clockwise orientation and handles mitered corners.
 */
export function insetPolygon2D(polygon: [number, number][], insetAmount: number): [number, number][] {
  const n = polygon.length;
  if (n < 3 || insetAmount <= 0) return polygon.map(p => [...p]);

  // 1. Ensure Counter-Clockwise (CCW) winding for consistent inward normal direction
  let signedArea = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    signedArea += (polygon[i][0] * polygon[j][1] - polygon[j][0] * polygon[i][1]);
  }
  const isCCW = signedArea > 0;
  const poly: [number, number][] = isCCW 
    ? polygon.map(p => [...p] as [number, number]) 
    : [...polygon].reverse().map(p => [...p] as [number, number]);

  // 2. Compute edge offset lines (inward normal is (-dy, dx) / len for CCW)
  const offsetEdges: { p1: [number, number]; p2: [number, number]; dir: [number, number] }[] = [];

  for (let i = 0; i < n; i++) {
    const pA = poly[i];
    const pB = poly[(i + 1) % n];
    const dx = pB[0] - pA[0];
    const dy = pB[1] - pA[1];
    const len = Math.hypot(dx, dy);

    if (len < 1e-5) {
      offsetEdges.push({ p1: [pA[0], pA[1]], p2: [pB[0], pB[1]], dir: [1, 0] });
      continue;
    }

    const nx = -dy / len;
    const ny = dx / len;

    const offA: [number, number] = [pA[0] + nx * insetAmount, pA[1] + ny * insetAmount];
    const offB: [number, number] = [pB[0] + nx * insetAmount, pB[1] + ny * insetAmount];
    const dir: [number, number] = [dx / len, dy / len];

    offsetEdges.push({ p1: offA, p2: offB, dir });
  }

  // 3. Intersect consecutive offset edges
  const insetPoly: [number, number][] = [];
  const maxMiterDist = insetAmount * 2.5;

  for (let i = 0; i < n; i++) {
    const prevIdx = (i - 1 + n) % n;
    const e1 = offsetEdges[prevIdx];
    const e2 = offsetEdges[i];

    const d1x = e1.dir[0], d1y = e1.dir[1];
    const d2x = e2.dir[0], d2y = e2.dir[1];
    const det = d1x * d2y - d1y * d2x;

    if (Math.abs(det) < 1e-4) {
      insetPoly.push(e2.p1);
    } else {
      const px = e2.p1[0] - e1.p1[0];
      const py = e2.p1[1] - e1.p1[1];
      const t = (px * d2y - py * d2x) / det;
      const interX = e1.p1[0] + t * d1x;
      const interY = e1.p1[1] + t * d1y;

      const origV = poly[i];
      const distFromOrig = Math.hypot(interX - origV[0], interY - origV[1]);

      if (distFromOrig > maxMiterDist) {
        const bisectorX = (e1.p2[0] + e2.p1[0]) / 2;
        const bisectorY = (e1.p2[1] + e2.p1[1]) / 2;
        insetPoly.push([bisectorX, bisectorY]);
      } else {
        insetPoly.push([interX, interY]);
      }
    }
  }

  // 4. Validate resulting polygon area. If it collapsed, fallback to proportional shrinkage
  let newArea = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    newArea += (insetPoly[i][0] * insetPoly[j][1] - insetPoly[j][0] * insetPoly[i][1]);
  }

  if (newArea <= 0.1 || isNaN(newArea)) {
    let cx = 0, cz = 0;
    for (const p of poly) { cx += p[0]; cz += p[1]; }
    cx /= n; cz /= n;
    const scale = Math.max(0.7, 1 - (insetAmount / 3.0));
    return (isCCW ? poly : poly.reverse()).map(([x, z]) => [
      cx + (x - cx) * scale,
      cz + (z - cz) * scale
    ]);
  }

  return isCCW ? insetPoly : insetPoly.reverse();
}

/**
 * Creates a 3D Ceiling Slab / Floor Slab matching the room footprint polygon.
 * Automatically insets the slab to sit strictly within the internal faces of the walls on subsequent floors.
 * Also checks for any staircases located beneath the slab to cut out stairwell openings.
 */
export function buildCeilingSlabForRoom(
  roomWalls: Shape[],
  slabThickness: number = 0.20,
  color: string = '#cbd5e1',
  existingShapes: Shape[] = [],
  options: {
    insetForInternalWalls?: boolean;
    wallThickness?: number;
  } = {}
): Shape | null {
  const footprint = extractRoomFootprintPolygon(roomWalls, existingShapes);
  if (!footprint) return null;

  const { polygon: rawWorldPoly, centerX, centerZ, topY, bounds } = footprint;

  // Compute wall thickness to calculate exact internal face inset
  let avgThickness = options.wallThickness ?? 0.20;
  if (!options.wallThickness && roomWalls.length > 0) {
    let totalT = 0;
    for (const w of roomWalls) {
      totalT += Array.isArray(w.args) ? w.args[2] || 0.20 : 0.20;
    }
    avgThickness = totalT / roomWalls.length;
  }

  // Inset the slab polygon by wall thickness so it does not exceed the internal side of the walls on subsequent floors
  const shouldInset = options.insetForInternalWalls !== false;
  const insetDist = shouldInset ? Math.max(avgThickness, 0.20) : 0;
  const worldPoly = insetDist > 0 ? insetPolygon2D(rawWorldPoly, insetDist) : rawWorldPoly;

  const slabQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

  // Local polygon vertices relative to slab position [centerX, topY, centerZ]
  const localPoly: [number, number][] = worldPoly.map(([x, z]) => [x - centerX, z - centerZ]);

  const slabShape: Shape = {
    id: Math.random().toString(36).substr(2, 9),
    name: `Floor Slab (${bounds.width.toFixed(1)}m × ${bounds.depth.toFixed(1)}m)`,
    type: 'poly',
    position: [centerX, topY + slabThickness / 2, centerZ],
    rotation: [Math.PI / 2, 0, 0],
    quaternion: [slabQuat.x, slabQuat.y, slabQuat.z, slabQuat.w],
    args: {
      vertices: localPoly,
      height: slabThickness,
      holes: [],
    },
    color: color,
    roughness: 0.6,
    metalness: 0.05,
    tags: ['architecture', 'floor-slab'],
  };

  // If there are staircases, punch holes in the new slab
  const staircases = existingShapes.filter(s => s.type === 'staircase' && !s.hidden);
  if (staircases.length > 0) {
    const holes: [number, number][][] = [];
    for (const stair of staircases) {
      const hole = computeStairHoleForSlab(stair, slabShape);
      if (hole) {
        holes.push(hole);
      }
    }
    if (holes.length > 0) {
      slabShape.args.holes = holes;
    }
  }

  return slabShape;
}

/**
 * Clones a floor level upward to create Story N+1, replicating walls, openings, and floor slabs.
 */
export function buildNextFloorLevel(
  sourceWalls: Shape[],
  allShapes: Shape[],
  propagateOpenings: boolean = true
): { newWalls: Shape[]; newOpenings: Shape[]; newSlab: Shape | null; newSlabs: Shape[] } {
  if (sourceWalls.length === 0) {
    return { newWalls: [], newOpenings: [], newSlab: null, newSlabs: [] };
  }

  // Find max story tag
  let maxStoryFound = 1;
  for (const s of allShapes) {
    for (const t of (s.tags || [])) {
      if (t.startsWith('story-')) {
        const num = parseInt(t.replace('story-', ''), 10);
        if (!isNaN(num) && num > maxStoryFound) maxStoryFound = num;
      }
    }
  }

  const nextStory = maxStoryFound + 1;

  // Average wall height
  let totalH = 0;
  for (const w of sourceWalls) {
    const h = Array.isArray(w.args) ? w.args[1] || 2.8 : 2.8;
    totalH += h;
  }
  const wallH = sourceWalls.length > 0 ? totalH / sourceWalls.length : 2.8;

  const newWalls: Shape[] = [];
  const oldToNewWallIdMap = new Map<string, string>();

  for (const w of sourceWalls) {
    const newId = Math.random().toString(36).substr(2, 9);
    oldToNewWallIdMap.set(w.id, newId);

    const newWall: Shape = {
      ...w,
      id: newId,
      name: `Wall St-${nextStory}`,
      position: [w.position[0], w.position[1] + wallH, w.position[2]],
      tags: [...(w.tags || []).filter(t => !t.startsWith('story-')), `story-${nextStory}`],
    };
    newWalls.push(newWall);
  }

  const newOpenings: Shape[] = [];
  if (propagateOpenings) {
    const sourceOpenings = allShapes.filter(s =>
      (s.type === 'door' || s.type === 'window') &&
      s.hostWallId &&
      oldToNewWallIdMap.has(s.hostWallId)
    );

    for (const op of sourceOpenings) {
      const targetWallId = oldToNewWallIdMap.get(op.hostWallId!)!;
      const newOp: Shape = {
        ...op,
        id: Math.random().toString(36).substr(2, 9),
        name: `${op.type === 'door' ? 'Door' : 'Window'} St-${nextStory}`,
        position: [op.position[0], op.position[1] + wallH, op.position[2]],
        hostWallId: targetWallId,
        tags: [...(op.tags || []).filter(t => !t.startsWith('story-')), `story-${nextStory}`],
      };
      newOpenings.push(newOp);
    }
  }

  const generatedSlab = buildCeilingSlabForRoom(sourceWalls, 0.20, '#cbd5e1', allShapes);
  const newSlabs: Shape[] = [];
  if (generatedSlab) {
    generatedSlab.name = `Floor Slab (Story ${nextStory})`;
    generatedSlab.tags = ['architecture', `story-${nextStory}`, 'floor-slab'];
    newSlabs.push(generatedSlab);
  }

  const newSlab = newSlabs[0] || null;

  return { newWalls, newOpenings, newSlab, newSlabs };
}
