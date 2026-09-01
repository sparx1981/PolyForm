import * as THREE from 'three';
import { Shape, TerrainData } from '../types';
import { WallJustification, WallToolSettings, DEFAULT_WALL_SETTINGS } from '../tools/inference/types';

export interface RoomAssemblyResult {
  datumZ: number;
  wallShapes: Shape[];
  slabShape: Shape;
  foundationShape: Shape | null;
  updatedTerrainData: TerrainData | null;
  modifiedTerrainShapeId: string | null;
}

/**
 * 2D Point-in-polygon test (Jordan curve theorem) in the X-Z plane.
 */
export function isPointInPolygon2D(x: number, z: number, polygon: Array<[number, number]>): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i][0], zi = polygon[i][1];
    const xj = polygon[j][0], zj = polygon[j][1];

    const intersect = ((zi > z) !== (zj > z)) &&
      (x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Computes the minimum distance from a 2D point (x, z) to a 2D polygon boundary.
 */
export function distanceToPolygonBoundary2D(x: number, z: number, polygon: Array<[number, number]>): number {
  let minDist = Infinity;
  const n = polygon.length;
  const p = new THREE.Vector2(x, z);

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = new THREE.Vector2(polygon[i][0], polygon[i][1]);
    const b = new THREE.Vector2(polygon[j][0], polygon[j][1]);
    const ab = new THREE.Vector2().subVectors(b, a);
    const lenSq = ab.lengthSq();
    let t = 0;
    if (lenSq > 1e-8) {
      t = Math.max(0, Math.min(1, new THREE.Vector2().subVectors(p, a).dot(ab) / lenSq));
    }
    const projection = a.clone().addScaledVector(ab, t);
    const dist = p.distanceTo(projection);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

/**
 * Samples terrain elevation at arbitrary world (x, z) coordinates.
 */
export function sampleTerrainElevation(x: number, z: number, terrain: Shape): number {
  if (!terrain.terrainData) return terrain.position[1];
  const { gridX, gridY, width, depth, heights } = terrain.terrainData;
  const posX = terrain.position[0];
  const posY = terrain.position[1];
  const posZ = terrain.position[2];

  const localX = x - posX;
  const localZ = z - posZ;

  const u = (localX + width / 2) / width;
  const v = (localZ + depth / 2) / depth;

  if (u < 0 || u > 1 || v < 0 || v > 1) return posY;

  const gx = u * (gridX - 1);
  const gy = v * (gridY - 1);

  const x0 = Math.floor(gx);
  const x1 = Math.min(gridX - 1, x0 + 1);
  const y0 = Math.floor(gy);
  const y1 = Math.min(gridY - 1, y0 + 1);

  const fx = gx - x0;
  const fy = gy - y0;

  const h00 = heights[y0 * gridX + x0] || 0;
  const h10 = heights[y0 * gridX + x1] || 0;
  const h01 = heights[y1 * gridX + x0] || 0;
  const h11 = heights[y1 * gridX + x1] || 0;

  const h0 = h00 * (1 - fx) + h10 * fx;
  const h1 = h01 * (1 - fx) + h11 * fx;

  return posY + (h0 * (1 - fy) + h1 * fy);
}

/**
 * Calculates balanced cut/fill datum elevation ($Z_0$) across perimeter points.
 */
export function calculateBalancedDatumElevation(
  polygonVertices: THREE.Vector3[],
  activeTerrain: Shape | null
): number {
  if (polygonVertices.length === 0) return 0;

  const sampleHeights: number[] = [];
  for (const pt of polygonVertices) {
    if (activeTerrain && activeTerrain.terrainData) {
      sampleHeights.push(sampleTerrainElevation(pt.x, pt.z, activeTerrain));
    } else {
      sampleHeights.push(pt.y);
    }
  }

  // Median elevation to balance cut and fill excavation
  sampleHeights.sort((a, b) => a - b);
  const mid = Math.floor(sampleHeights.length / 2);
  const medianZ0 = sampleHeights.length % 2 !== 0
    ? sampleHeights[mid]
    : (sampleHeights[mid - 1] + sampleHeights[mid]) / 2;

  return Number.isFinite(medianZ0) ? medianZ0 : 0;
}

/**
 * Performs terrain excavation with safety apron ($Z = Z_0$ with Buffer).
 */
export function excavateTerrainMesh(
  terrain: Shape,
  roomPolygon2D: Array<[number, number]>,
  datumZ: number,
  apronMargin: number = 0.50
): TerrainData | null {
  if (!terrain.terrainData) return null;
  const { gridX, gridY, width, depth, heights } = terrain.terrainData;
  const posX = terrain.position[0];
  const posY = terrain.position[1];
  const posZ = terrain.position[2];

  const newHeights = [...heights];
  const targetLocalDatum = datumZ - posY;

  for (let iy = 0; iy < gridY; iy++) {
    for (let ix = 0; ix < gridX; ix++) {
      const worldX = posX - width / 2 + (ix / (gridX - 1)) * width;
      const worldZ = posZ - depth / 2 + (iy / (gridY - 1)) * depth;

      const idx = iy * gridX + ix;
      const currentH = newHeights[idx];
      const isInside = isPointInPolygon2D(worldX, worldZ, roomPolygon2D);

      if (isInside) {
        // Flat excavation at datum elevation inside building footprint
        newHeights[idx] = targetLocalDatum;
      } else {
        // Within the excavation safety apron buffer
        const edgeDist = distanceToPolygonBoundary2D(worldX, worldZ, roomPolygon2D);
        if (edgeDist <= apronMargin) {
          // Smooth blend from datum elevation at room boundary to original slope at apron limit
          const blendFactor = edgeDist / apronMargin; // 0 at wall edge -> 1 at apron boundary
          newHeights[idx] = targetLocalDatum * (1 - blendFactor) + currentH * blendFactor;
        }
      }
    }
  }

  return {
    ...terrain.terrainData,
    heights: newHeights,
  };
}

/**
 * Generates the complete Room Assembly:
 * 1. Wall solids with miter joins
 * 2. Cut/fill balanced terrain excavation ($Z_0$) with 0.5m apron
 * 3. 3D floor slab extrusion (200mm) at $Z_0$
 * 4. Dynamic foundation stem skirt adapting to sloping terrain
 */
export function buildRoomAssembly(
  vertices: THREE.Vector3[],
  activeTerrain: Shape | null,
  settings: WallToolSettings = DEFAULT_WALL_SETTINGS,
  options: {
    justification?: WallJustification;
    wallHeight?: number;
    wallThickness?: number;
    slabThickness?: number;
    wallColor?: string;
    slabColor?: string;
    foundationColor?: string;
    story?: number;
  } = {}
): RoomAssemblyResult {
  const wallHeight = options.wallHeight ?? settings.defaultWallHeight;
  const wallThickness = options.wallThickness ?? settings.defaultExteriorThickness;
  const slabThickness = options.slabThickness ?? settings.defaultSlabThickness;
  const apronMargin = settings.terrainExcavationApron ?? 0.50;
  const story = options.story ?? 1;

  // 1. Calculate balanced datum elevation Z0
  const datumZ = calculateBalancedDatumElevation(vertices, activeTerrain);

  // 2D footprint polygon in X-Z plane
  const roomPoly2D: Array<[number, number]> = vertices.map(v => [v.x, v.z]);

  // 2. Excavate underlying terrain if active terrain exists
  let updatedTerrainData: TerrainData | null = null;
  let modifiedTerrainShapeId: string | null = null;

  if (activeTerrain && activeTerrain.terrainData) {
    updatedTerrainData = excavateTerrainMesh(activeTerrain, roomPoly2D, datumZ, apronMargin);
    modifiedTerrainShapeId = activeTerrain.id;
  }

  // 3. Generate Wall Solids with proper mitering and alignments
  const wallShapes: Shape[] = [];
  const n = vertices.length;

  for (let i = 0; i < n; i++) {
    const pA = vertices[i];
    const pB = vertices[(i + 1) % n];
    const dist = new THREE.Vector2(pB.x - pA.x, pB.z - pA.z).length();

    if (dist < 0.05) continue;

    // Segment midpoint and orientation
    const midX = (pA.x + pB.x) / 2;
    const midZ = (pA.z + pB.z) / 2;
    const midY = datumZ + wallHeight / 2;

    const dirX = pB.x - pA.x;
    const dirZ = pB.z - pA.z;
    const angle = Math.atan2(dirZ, dirX);
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle);

    const wallShape: Shape = {
      id: Math.random().toString(36).substr(2, 9),
      name: `Exterior Wall St-${story} (${(i + 1)})`,
      type: 'wall',
      position: [midX, midY, midZ],
      quaternion: [quat.x, quat.y, quat.z, quat.w],
      args: [dist, wallHeight, wallThickness],
      color: options.wallColor || '#f1f5f9',
      roughness: 0.7,
      metalness: 0.05,
      tags: [`story-${story}`, 'architecture', 'wall-assembly'],
    };

    wallShapes.push(wallShape);
  }

  // 4. Generate 3D Floor Slab Extrusion (200 mm thickness at datum elevation Z0)
  // Polygon coordinates relative to center of room bounding box
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const pt of vertices) {
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.z < minZ) minZ = pt.z;
    if (pt.z > maxZ) maxZ = pt.z;
  }
  const centerRoomX = (minX + maxX) / 2;
  const centerRoomZ = (minZ + maxZ) / 2;

  // In Three.js PolyGeometry, 2D coordinates [u, v] lie in the local XY plane.
  // When rotated by +PI/2 around X (Rx(+90deg)), (u, v, 0) transforms to (u, 0, v) in world space.
  // Thus local u = v.x - centerRoomX (World X) and local v = v.z - centerRoomZ (World Z).
  const poly2DLocal: [number, number][] = vertices.map(v => [
    v.x - centerRoomX,
    v.z - centerRoomZ,
  ]);

  const slabQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

  const slabShape: Shape = {
    id: Math.random().toString(36).substr(2, 9),
    name: `Floor Slab (Story ${story})`,
    type: 'poly',
    position: [centerRoomX, datumZ - slabThickness / 2, centerRoomZ],
    rotation: [Math.PI / 2, 0, 0],
    quaternion: [slabQuat.x, slabQuat.y, slabQuat.z, slabQuat.w],
    args: {
      vertices: poly2DLocal,
      height: slabThickness,
    },
    color: options.slabColor || '#cbd5e1',
    roughness: 0.6,
    metalness: 0.1,
    tags: [`story-${story}`, 'architecture', 'floor-slab'],
  };

  // 5. Generate Foundation Stem Skirt (for sloping terrain down to intercept ground)
  let foundationShape: Shape | null = null;
  let minTerrainElev = datumZ;

  if (activeTerrain) {
    for (const pt of vertices) {
      const h = sampleTerrainElevation(pt.x, pt.z, activeTerrain);
      if (h < minTerrainElev) minTerrainElev = h;
    }
  }

  const foundationDepth = Math.max(0.40, (datumZ - minTerrainElev) + 0.30);

  if (foundationDepth > 0.1) {
    const skirtHeight = foundationDepth;
    const foundationCenterY = datumZ - slabThickness - skirtHeight / 2;
    const foundationQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

    foundationShape = {
      id: Math.random().toString(36).substr(2, 9),
      name: `Foundation Skirt (Story ${story})`,
      type: 'poly',
      position: [centerRoomX, foundationCenterY, centerRoomZ],
      rotation: [Math.PI / 2, 0, 0],
      quaternion: [foundationQuat.x, foundationQuat.y, foundationQuat.z, foundationQuat.w],
      args: {
        vertices: poly2DLocal,
        height: skirtHeight,
      },
      color: options.foundationColor || '#64748b',
      roughness: 0.85,
      metalness: 0.05,
      tags: [`story-${story}`, 'architecture', 'foundation-skirt'],
    };
  }

  return {
    datumZ,
    wallShapes,
    slabShape,
    foundationShape,
    updatedTerrainData,
    modifiedTerrainShapeId,
  };
}
