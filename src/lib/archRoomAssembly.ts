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
 * True outward-pointing 2D normal for a room-perimeter edge, regardless of whether the
 * room was drawn clockwise or counter-clockwise. A fixed "rotate the travel direction
 * 90 degrees" rule flips between pointing outward and inward depending on which way the
 * loop was walked - this instead nudges a test point off the edge midpoint and asks the
 * polygon itself which side that landed on, so justification (exterior/interior) offsets
 * always land on the correct physical side of the drawn line, closing corners cleanly
 * instead of leaving a gap on one winding and an overlap on the other.
 */
export function computeOutwardWallNormal2D(
  pA: THREE.Vector3,
  pB: THREE.Vector3,
  roomPolygon2D: Array<[number, number]>
): THREE.Vector3 {
  const dir = new THREE.Vector3().subVectors(pB, pA);
  const edgeLength = dir.length();
  const normal = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  const midX = (pA.x + pB.x) / 2;
  const midZ = (pA.z + pB.z) / 2;
  // Scale the probe distance down for short edges so it can't cross past a nearby
  // concave (reflex) vertex and land on the wrong side of the polygon.
  const testDist = Math.min(0.2, edgeLength * 0.25);
  const testX = midX + normal.x * testDist;
  const testZ = midZ + normal.z * testDist;
  return isPointInPolygon2D(testX, testZ, roomPolygon2D) ? normal.negate() : normal;
}

/**
 * Intersects two infinite 2D lines, each given as a point and a direction vector. Returns
 * null when the lines are parallel (or nearly so) rather than dividing by ~0.
 */
export function intersectLines2D(
  p1: [number, number], d1: [number, number],
  p2: [number, number], d2: [number, number]
): [number, number] | null {
  const denom = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / denom;
  return [p1[0] + d1[0] * t, p1[1] + d1[1] * t];
}

/**
 * Where two adjoining walls actually meet at a shared corner vertex, once each wall's own
 * justification offset has shifted its centerline off the raw drawn point. A fixed
 * "extend both ends by half the thickness" only reproduces this correctly at exactly 90
 * degrees - at any other angle it overshoots (overlap) or undershoots (gap). This instead
 * intersects the two walls' own offset centerlines directly, which is exact at any angle
 * and for any combination of exterior/interior/center justification.
 */
export function computeWallCornerPoint(
  vertex: THREE.Vector3,
  beforeEdge: { offsetPoint: THREE.Vector2; dir: THREE.Vector2 } | null,
  afterEdge: { offsetPoint: THREE.Vector2; dir: THREE.Vector2 } | null
): THREE.Vector2 {
  const raw = new THREE.Vector2(vertex.x, vertex.z);
  if (!beforeEdge || !afterEdge) return beforeEdge?.offsetPoint ?? afterEdge?.offsetPoint ?? raw;
  const hit = intersectLines2D(
    [beforeEdge.offsetPoint.x, beforeEdge.offsetPoint.y], [beforeEdge.dir.x, beforeEdge.dir.y],
    [afterEdge.offsetPoint.x, afterEdge.offsetPoint.y], [afterEdge.dir.x, afterEdge.dir.y]
  );
  // Parallel (a straight-through vertex, or a 180-degree fold): no single miter point exists,
  // so just butt against the incoming wall's own offset line.
  return hit ? new THREE.Vector2(hit[0], hit[1]) : beforeEdge.offsetPoint;
}

/**
 * Where a wall's own OUTER (or INNER) face-line actually meets a neighbor's, for building a
 * true mitered wall polygon instead of approximating the corner with an extended box. A box's
 * flat, perpendicular end cap can only close flush against a neighbor at exactly 90 degrees;
 * at any other angle each end needs its own angled cut. Reuses the same offset-line
 * intersection as computeWallCornerPoint (which does this for the centerline) - the outer
 * corner computed for one wall's end is the exact same point as its neighbor's outer corner at
 * that shared vertex, so two mitered wall polygons share an exact edge with zero gap and zero
 * overlap, at any angle - no extension formula, epsilon clearance, or z-fighting risk needed.
 */
export function computeWallFaceCorner(
  vertex: THREE.Vector3,
  beforeEdge: { linePoint: THREE.Vector2; dir: THREE.Vector2; outwardNormal: THREE.Vector2; thickness: number } | null,
  afterEdge: { linePoint: THREE.Vector2; dir: THREE.Vector2; outwardNormal: THREE.Vector2; thickness: number } | null,
  side: 1 | -1
): THREE.Vector2 {
  const offsetOf = (edge: { linePoint: THREE.Vector2; outwardNormal: THREE.Vector2; thickness: number }) =>
    edge.linePoint.clone().addScaledVector(edge.outwardNormal, side * edge.thickness / 2);
  return computeWallCornerPoint(
    vertex,
    beforeEdge ? { offsetPoint: offsetOf(beforeEdge), dir: beforeEdge.dir } : null,
    afterEdge ? { offsetPoint: offsetOf(afterEdge), dir: afterEdge.dir } : null
  );
}

/**
 * Automatically orients room perimeter walls so their local +Z face (the exterior/cladding face)
 * is guaranteed to point outward towards the exterior, regardless of whether the user drew
 * the room in a clockwise or counter-clockwise fashion.
 */
export function orientRoomWallsToExterior(
  wallShapes: Shape[],
  roomPolygon2D: Array<[number, number]>
): Shape[] {
  return wallShapes.map(wall => {
    if (wall.type !== 'wall') return wall;
    const midX = wall.position[0];
    const midZ = wall.position[2];

    const wallQuat = new THREE.Quaternion(...(wall.quaternion || [0, 0, 0, 1]));
    const localZWorld = new THREE.Vector3(0, 0, 1).applyQuaternion(wallQuat);

    // Test a point slightly offset along the current local +Z normal
    const testDist = 0.20;
    const testX = midX + localZWorld.x * testDist;
    const testZ = midZ + localZWorld.z * testDist;

    const isFacingInside = isPointInPolygon2D(testX, testZ, roomPolygon2D);

    if (isFacingInside) {
      // Local +Z is pointing inside the room; flip 180° around Y so local +Z faces the exterior
      const flipQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
      const correctedQuat = wallQuat.clone().multiply(flipQuat);
      return {
        ...wall,
        quaternion: [correctedQuat.x, correctedQuat.y, correctedQuat.z, correctedQuat.w] as [number, number, number, number],
      };
    }

    return wall;
  });
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
 * Finished ground level is the top of the floor slab (the base of the walls): the slab and
 * foundation skirt are buried. Terrain inside the footprint is cut to just under the slab top.
 * 1m of terrain around the floor slab is graded to ground level.
 * Surrounding terrain beyond 1m is smoothly transitioned with a daylight batter slope.
 */
export function excavateTerrainMesh(
  terrain: Shape,
  roomPolygon2D: Array<[number, number]>,
  datumZ: number,
  apronMargin: number = 1.0,
  slabThickness: number = 0.2
): TerrainData | null {
  if (!terrain.terrainData) return null;
  const { gridX, gridY, width, depth, heights } = terrain.terrainData;
  const posX = terrain.position[0];
  const posY = terrain.position[1];
  const posZ = terrain.position[2];

  const newHeights = [...heights];
  // datumZ is the top of the floor slab, which is also where the walls start. Like a real
  // building, finished ground level meets the base of the walls: the slab and the foundation
  // skirt below it sit inside the ground. The apron is graded a hair below the wall base so the
  // two never z-fight. Inside the footprint:
  //  - within one grid cell of the edge, the terrain is cut to just under the slab's top face, so
  //    terrain triangles straddling the edge stay at ground level outside the walls;
  //  - further in, it is cut well below the slab and foundation, because a ground material with
  //    surface relief (displacement, up to 20 cm) would otherwise push up through the floor.
  const nearEdgeWorld = datumZ - Math.min(0.03, Math.max(0.01, slabThickness / 2));
  const nearEdgeLocal = nearEdgeWorld - posY;
  const deepLocal = datumZ - Math.max(0.05, slabThickness) - 0.3 - posY;
  const cell = Math.max(width / Math.max(1, gridX - 1), depth / Math.max(1, gridY - 1));

  // Perimeter apron around the floor slab is graded to finished ground level (the wall base).
  const apronElevWorld = datumZ - 0.02;
  const apronElevLocal = apronElevWorld - posY;
  let modified = false;

  for (let iy = 0; iy < gridY; iy++) {
    for (let ix = 0; ix < gridX; ix++) {
      const worldX = posX - width / 2 + (ix / Math.max(1, gridX - 1)) * width;
      const worldZ = posZ - depth / 2 + (iy / Math.max(1, gridY - 1)) * depth;

      const idx = iy * gridX + ix;
      const currentH = newHeights[idx];
      const isInside = isPointInPolygon2D(worldX, worldZ, roomPolygon2D);

      if (isInside) {
        const target = distanceToPolygonBoundary2D(worldX, worldZ, roomPolygon2D) <= cell * 1.05 ? nearEdgeLocal : deepLocal;
        if (currentH > target) {
          newHeights[idx] = target;
          modified = true;
        }
      } else {
        // Within the 1m excavation safety apron buffer around floor slab
        const edgeDist = distanceToPolygonBoundary2D(worldX, worldZ, roomPolygon2D);
        if (edgeDist <= apronMargin) {
          // 1m perimeter apron around the floor slab is cleanly graded (both cut & fill)
          if (Math.abs(newHeights[idx] - apronElevLocal) > 1e-4) {
            newHeights[idx] = apronElevLocal;
            modified = true;
          }
        } else if (edgeDist <= apronMargin + 1.8) {
          // Smooth daylight batter transition over next 1.8m to surrounding terrain
          const t = (edgeDist - apronMargin) / 1.8;
          const factor = t * t * (3 - 2 * t);
          const blendedLocal = apronElevLocal + (currentH - apronElevLocal) * factor;
          if (Math.abs(newHeights[idx] - blendedLocal) > 1e-4) {
            newHeights[idx] = blendedLocal;
            modified = true;
          }
        }
      }
    }
  }

  return modified ? {
    ...terrain.terrainData,
    heights: newHeights,
  } : null;
}

/**
 * Automatically flattens terrain for all floor slabs present in the shapes collection.
 * Perimeter and elevation are strictly based on Floor Slabs (not Foundation Skirts, as foundations go underground).
 * Includes a 1m flattened safety apron around each slab with feathered daylight batter slope.
 * Can be applied regardless of whether terrain or floor slab was added first.
 */
export function flattenTerrainForFloorSlabs(
  terrain: Shape,
  allShapes: Shape[],
  apronMargin: number = 1.0
): TerrainData | null {
  if (!terrain.terrainData) return null;

  // STRICT REQUIREMENT: Base perimeter strictly on 'Floor Slab', NOT 'Foundation Skirt'.
  // Foundations of a building typically extend down into the ground.
  // Only the ground floor (story-1, or untagged for older saved projects) should ever
  // shape the terrain - an upper story's slab is several meters above grade, and
  // excavating/flattening the ground at that elevation would deform the terrain to match
  // a level that was never meant to touch it. Any required terrain deformation happens
  // once, when the ground-floor wall loop is closed.
  const isUpperStory = (s: Shape) => s.tags?.some(t => {
    const match = /^story-(\d+)$/.exec(t);
    return match && Number(match[1]) > 1;
  });
  const slabs = allShapes.filter(s =>
    s.id !== terrain.id && !s.hidden && !isUpperStory(s) && (
      s.tags?.includes('floor-slab') ||
      (s.name?.toLowerCase().includes('floor slab') && !s.tags?.includes('foundation-skirt') && !s.name?.toLowerCase().includes('foundation'))
    ) && !s.tags?.includes('foundation-skirt') && !s.name?.toLowerCase().includes('foundation')
  );

  if (slabs.length === 0) return null;

  let currentTerrainData: TerrainData = { ...terrain.terrainData, heights: [...terrain.terrainData.heights] };
  let modified = false;

  for (const slab of slabs) {
    let poly2D: Array<[number, number]> = [];
    if (slab.type === 'poly' && slab.args?.vertices && Array.isArray(slab.args.vertices)) {
      poly2D = slab.args.vertices.map((v: any) => {
        const vx = Array.isArray(v) ? v[0] : (v.x ?? 0);
        const vz = Array.isArray(v) ? v[1] : (v.y ?? v.z ?? 0);
        return [slab.position[0] + vx, slab.position[2] + vz] as [number, number];
      });
    } else if (slab.type === 'circle') {
      const radius = Array.isArray(slab.args) ? (slab.args[0] || 5) : 5;
      const cx = slab.position[0];
      const cz = slab.position[2];
      poly2D = [];
      for (let a = 0; a < 24; a++) {
        const theta = (a / 24) * Math.PI * 2;
        poly2D.push([cx + Math.cos(theta) * radius, cz + Math.sin(theta) * radius]);
      }
    } else if (Array.isArray(slab.args) || slab.type === 'box' || slab.type === 'rect') {
      const w = Array.isArray(slab.args) ? (slab.args[0] || 2) : 2;
      const d = Array.isArray(slab.args) ? (slab.args[2] || slab.args[1] || 2) : 2;
      const cx = slab.position[0];
      const cz = slab.position[2];
      poly2D = [
        [cx - w / 2, cz - d / 2],
        [cx + w / 2, cz - d / 2],
        [cx + w / 2, cz + d / 2],
        [cx - w / 2, cz + d / 2],
      ];
    }

    if (poly2D.length < 3) continue;

    const slabH = slab.type === 'poly' ? ((slab.args as any)?.height || 0.2) : (Array.isArray(slab.args) ? slab.args[1] || 0.2 : 0.2);
    // Top of floor slab:
    const datumZ = slab.position[1] + slabH / 2;

    const res = excavateTerrainMesh({ ...terrain, terrainData: currentTerrainData }, poly2D, datumZ, apronMargin, slabH);
    if (res) {
      currentTerrainData = res;
      modified = true;
    }
  }

  return modified ? currentTerrainData : null;
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
  const apronMargin = settings.terrainExcavationApron ?? 1.0;
  const story = options.story ?? 1;

  // 1. Calculate balanced datum elevation Z0
  const datumZ = calculateBalancedDatumElevation(vertices, activeTerrain);

  // 2D footprint polygon in X-Z plane
  const roomPoly2D: Array<[number, number]> = vertices.map(v => [v.x, v.z]);

  // 2. Excavate underlying terrain if active terrain exists
  let updatedTerrainData: TerrainData | null = null;
  let modifiedTerrainShapeId: string | null = null;

  if (activeTerrain && activeTerrain.terrainData) {
    updatedTerrainData = excavateTerrainMesh(activeTerrain, roomPoly2D, datumZ, apronMargin, slabThickness);
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

    // Each wall box spans only the exact distance between its two corner vertices, so at a
    // shared corner the two adjoining walls only touch along their centerline point - their
    // thickness never overlaps, leaving a thickness-sized gap at every corner. Extending the
    // length by one full thickness (half past each endpoint) fills that gap for the common
    // orthogonal case without needing a true per-angle miter.
    const wallShape: Shape = {
      id: Math.random().toString(36).substr(2, 9),
      name: `Exterior Wall St-${story} (${(i + 1)})`,
      type: 'wall',
      position: [midX, midY, midZ],
      quaternion: [quat.x, quat.y, quat.z, quat.w],
      args: [dist + wallThickness, wallHeight, wallThickness],
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
    wallShapes: orientRoomWallsToExterior(wallShapes, roomPoly2D),
    slabShape,
    foundationShape,
    updatedTerrainData,
    modifiedTerrainShapeId,
  };
}
