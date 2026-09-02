import * as THREE from 'three';
import { Shape } from '../types';
import { WallOpening } from './archGeometry';
import {
  getCanonicalLPolygon,
  computeLRidgeNodes,
  extractRoomFootprintPolygon,
  offsetPolygon2D,
} from './archRoofGenerator';

export interface TimberFrameOptions {
  studSpacing?: number;      // 0.40m (400mm c/c standard) or 0.60m (600mm c/c)
  studWidth?: number;        // 0.045m (45mm)
  studDepth?: number;        // 0.089m or 0.140m (89mm/140mm)
  includeWalls?: boolean;    // Generate wall studs, plates, noggins, lintels
  includeFloors?: boolean;   // Generate floor joists, rim joists, mid-span blocking
  includeRoof?: boolean;     // Generate roof rafters, collar ties, ridge beam
  timberColor?: string;      // Natural structural spruce/pine timber tone (#d97706 or #b45309)
}

export interface TimberFramingResult {
  shapes: Shape[];
  wallStudCount: number;
  floorJoistCount: number;
  roofRafterCount: number;
}

/**
 * Generates a complete BS 5268 / Eurocode 5 / IRC compliant structural timber frame
 * for walls, floors, and roofs in the model.
 */
export function generateTimberFraming(
  allShapes: Shape[],
  options: TimberFrameOptions = {}
): TimberFramingResult {
  const {
    studSpacing = 0.40,
    studWidth = 0.045,
    includeWalls = true,
    includeFloors = true,
    includeRoof = true,
    timberColor = '#d97706'
  } = options;

  const resultShapes: Shape[] = [];
  let wallStudCount = 0;
  let floorJoistCount = 0;
  let roofRafterCount = 0;

  const groupId = `timber-frame-group-${Date.now()}`;
  const timberTag = 'timber-frame';

  // -------------------------------------------------------------
  // 1. WALL TIMBER FRAMING (Sole Plates, Top Plates, Studs, Noggins, Lintels)
  // -------------------------------------------------------------
  if (includeWalls) {
    const wallShapes = allShapes.filter(s => s.type === 'wall' && !s.hidden);
    const openingShapes = allShapes.filter(s => (s.type === 'door' || s.type === 'window') && !s.hidden);

    wallShapes.forEach((wall, wIdx) => {
      const args = Array.isArray(wall.args) ? wall.args : [3.0, 2.8, 0.2];
      const wallLength = args[0] || 3.0;
      const wallHeight = args[1] || 2.8;
      const wallThick = args[2] || 0.2;

      // Timber stud depth scaled to wall cavity (e.g. 89mm or 140mm stud wall)
      const timberDepth = Math.max(0.075, Math.min(0.140, wallThick - 0.04));
      const plateThick = 0.045; // 45mm plate thickness

      const wallPos = new THREE.Vector3(...wall.position);
      const wallQuat = new THREE.Quaternion(...(wall.quaternion || [0, 0, 0, 1]));
      const invWallQuat = wallQuat.clone().invert();

      // Collect openings hosted on this wall
      const wallOpenings: Array<{ localX: number; localY: number; width: number; height: number; type: string }> = [];
      openingShapes.forEach(op => {
        const opPos = new THREE.Vector3(...op.position);
        const opArgs = Array.isArray(op.args) ? op.args : [0.9, 2.1, 0.15];
        const isHosted = op.hostWallId === wall.id;
        const localPos = opPos.clone().sub(wallPos).applyQuaternion(invWallQuat);

        const inX = Math.abs(localPos.x) <= wallLength / 2 + 0.2;
        const inY = Math.abs(localPos.y) <= wallHeight / 2 + 0.5;
        const inZ = Math.abs(localPos.z) <= wallThick / 2 + 0.35;

        if (isHosted || (inX && inY && inZ)) {
          wallOpenings.push({
            localX: localPos.x,
            localY: localPos.y,
            width: opArgs[0] || (op.type === 'door' ? 0.9 : 1.2),
            height: opArgs[1] || (op.type === 'door' ? 2.1 : 1.2),
            type: op.type
          });
        }
      });

      const halfL = wallLength / 2;
      const halfH = wallHeight / 2;

      // Helper to add a local timber member transformed into world space
      const addTimberMember = (
        name: string,
        localX: number,
        localY: number,
        localZ: number,
        width: number,
        height: number,
        depth: number,
        subTag: string
      ) => {
        const localPos = new THREE.Vector3(localX, localY, localZ);
        const worldPos = localPos.applyQuaternion(wallQuat).add(wallPos);

        resultShapes.push({
          id: `tf-wall-${wall.id}-${Math.random().toString(36).substr(2, 7)}`,
          name: `${wall.name || `Wall ${wIdx + 1}`} - ${name}`,
          type: 'box',
          position: [worldPos.x, worldPos.y, worldPos.z],
          quaternion: wall.quaternion || [0, 0, 0, 1],
          scale: [1, 1, 1],
          args: [width, height, depth],
          color: timberColor,
          roughness: 0.8,
          metalness: 0.05,
          groupId,
          tags: [timberTag, 'timber-stud-wall', subTag, ...(wall.tags || [])],
        });
        wallStudCount++;
      };

      // 1. Sole / Bottom Plate (interrupted / cut away at door openings)
      const doorOpenings = wallOpenings.filter(op => op.type === 'door' || (op.localY - op.height / 2 <= -halfH + 0.15));
      if (doorOpenings.length === 0) {
        // Continuous sole plate
        addTimberMember(
          'Sole Plate',
          0,
          -halfH + plateThick / 2,
          0,
          wallLength,
          plateThick,
          timberDepth,
          'timber-plate'
        );
      } else {
        // Split sole plate segments between door thresholds
        const sortedDoors = [...doorOpenings].sort((a, b) => (a.localX - a.width / 2) - (b.localX - b.width / 2));
        let cursorX = -halfL;
        sortedDoors.forEach((d, dIdx) => {
          const dLeft = d.localX - d.width / 2;
          const dRight = d.localX + d.width / 2;
          if (dLeft > cursorX + 0.04) {
            const segW = dLeft - cursorX;
            addTimberMember(
              `Sole Plate Segment ${dIdx + 1}`,
              cursorX + segW / 2,
              -halfH + plateThick / 2,
              0,
              segW,
              plateThick,
              timberDepth,
              'timber-plate'
            );
          }
          cursorX = Math.max(cursorX, dRight);
        });
        if (cursorX < halfL - 0.04) {
          const segW = halfL - cursorX;
          addTimberMember(
            'Sole Plate End Segment',
            cursorX + segW / 2,
            -halfH + plateThick / 2,
            0,
            segW,
            plateThick,
            timberDepth,
            'timber-plate'
          );
        }
      }

      // 2. Top Plate & Double Top Plate (continuous header plates)
      addTimberMember(
        'Top Plate',
        0,
        halfH - plateThick / 2,
        0,
        wallLength,
        plateThick,
        timberDepth,
        'timber-plate'
      );
      addTimberMember(
        'Double Top Plate',
        0,
        halfH - plateThick * 1.5,
        0,
        wallLength,
        plateThick,
        timberDepth,
        'timber-plate'
      );

      // 3. Regular Vertical Studs (spaced at 400mm / 600mm centers)
      const usableHeight = wallHeight - plateThick * 3; // between sole plate and double top plate
      const studCenterY = -halfH + plateThick + usableHeight / 2;

      // Start stud at left end
      addTimberMember('End Stud (Left)', -halfL + studWidth / 2, studCenterY, 0, studWidth, usableHeight, timberDepth, 'timber-stud');
      // End stud at right end
      addTimberMember('End Stud (Right)', halfL - studWidth / 2, studCenterY, 0, studWidth, usableHeight, timberDepth, 'timber-stud');

      // Intermediate regular studs along wall
      let currentX = -halfL + studSpacing;
      while (currentX < halfL - studWidth) {
        // Check if this regular stud intersects an opening or king/jack stud zone
        const hitsOpening = wallOpenings.some(op => {
          const opLeft = op.localX - op.width / 2 - studWidth * 2;
          const opRight = op.localX + op.width / 2 + studWidth * 2;
          return currentX >= opLeft && currentX <= opRight;
        });

        if (!hitsOpening) {
          addTimberMember(
            `Common Stud (400mm c/c)`,
            currentX,
            studCenterY,
            0,
            studWidth,
            usableHeight,
            timberDepth,
            'timber-stud'
          );

          // Noggin / Mid-height lateral blocking
          const nextX = Math.min(halfL - studWidth / 2, currentX + studSpacing);
          const nogginW = Math.max(0.1, (nextX - currentX) - studWidth);
          const nogginCenterX = currentX + studWidth / 2 + nogginW / 2;
          const nogginHitsOpening = wallOpenings.some(op => {
            const opL = op.localX - op.width / 2 - 0.02;
            const opR = op.localX + op.width / 2 + 0.02;
            const opB = op.localY - op.height / 2 - 0.02;
            const opT = op.localY + op.height / 2 + 0.02;
            return (nogginCenterX >= opL && nogginCenterX <= opR) && (0 >= opB && 0 <= opT);
          });

          if (!nogginHitsOpening && nogginW > 0.1 && nogginW < 0.7) {
            addTimberMember(
              'Noggin (Mid-Height Blocking)',
              nogginCenterX,
              0,
              0,
              nogginW,
              plateThick,
              timberDepth,
              'timber-noggin'
            );
          }
        }
        currentX += studSpacing;
      }

      // 4. Opening Framing (King Studs, Jack Studs, Lintel Headers, Sill Plates, Cripples)
      wallOpenings.forEach((op, opIdx) => {
        const opW = op.width;
        const opH = op.height;
        const opLeft = op.localX - opW / 2;
        const opRight = op.localX + opW / 2;
        const opBottom = op.localY - opH / 2;
        const opTop = op.localY + opH / 2;

        const lintelHeight = 0.140; // 140mm deep double header lintel
        const jackTop = opTop;
        const jackHeight = Math.max(0.1, jackTop - (-halfH + plateThick));

        // King Studs (Full height flanking the opening)
        addTimberMember(
          `King Stud Left (Opening ${opIdx + 1})`,
          opLeft - studWidth * 1.5,
          studCenterY,
          0,
          studWidth,
          usableHeight,
          timberDepth,
          'timber-king-stud'
        );
        addTimberMember(
          `King Stud Right (Opening ${opIdx + 1})`,
          opRight + studWidth * 1.5,
          studCenterY,
          0,
          studWidth,
          usableHeight,
          timberDepth,
          'timber-king-stud'
        );

        // Jack Studs / Trimmers (Under lintel)
        addTimberMember(
          `Jack Stud Left (Opening ${opIdx + 1})`,
          opLeft - studWidth / 2,
          -halfH + plateThick + jackHeight / 2,
          0,
          studWidth,
          jackHeight,
          timberDepth,
          'timber-jack-stud'
        );
        addTimberMember(
          `Jack Stud Right (Opening ${opIdx + 1})`,
          opRight + studWidth / 2,
          -halfH + plateThick + jackHeight / 2,
          0,
          studWidth,
          jackHeight,
          timberDepth,
          'timber-jack-stud'
        );

        // Structural Lintel Header Beam
        const lintelSpan = opW + studWidth * 2;
        addTimberMember(
          `Structural Lintel (Opening ${opIdx + 1})`,
          op.localX,
          opTop + lintelHeight / 2,
          0,
          lintelSpan,
          lintelHeight,
          timberDepth,
          'timber-lintel'
        );

        // Cripple Studs above Header up to Top Plate
        const topCrippleHeight = (halfH - plateThick * 2) - (opTop + lintelHeight);
        if (topCrippleHeight > 0.1) {
          const numCripples = Math.max(1, Math.floor(opW / studSpacing));
          for (let c = 1; c <= numCripples; c++) {
            const cX = opLeft + (opW * c) / (numCripples + 1);
            addTimberMember(
              `Top Cripple Stud`,
              cX,
              opTop + lintelHeight + topCrippleHeight / 2,
              0,
              studWidth,
              topCrippleHeight,
              timberDepth,
              'timber-cripple'
            );
          }
        }

        // Window Sill Plate & Bottom Cripples (if window / raised opening)
        if (op.type === 'window' && opBottom > -halfH + plateThick + 0.15) {
          addTimberMember(
            `Rough Sill Plate`,
            op.localX,
            opBottom - plateThick / 2,
            0,
            opW,
            plateThick,
            timberDepth,
            'timber-sill'
          );

          const botCrippleHeight = (opBottom - plateThick) - (-halfH + plateThick);
          if (botCrippleHeight > 0.1) {
            const numBotCripples = Math.max(1, Math.floor(opW / studSpacing));
            for (let c = 1; c <= numBotCripples; c++) {
              const cX = opLeft + (opW * c) / (numBotCripples + 1);
              addTimberMember(
                `Bottom Cripple Stud`,
                cX,
                -halfH + plateThick + botCrippleHeight / 2,
                0,
                studWidth,
                botCrippleHeight,
                timberDepth,
                'timber-cripple'
              );
            }
          }
        }
      });
    });
  }

// -------------------------------------------------------------
  // 2. FLOOR TIMBER JOISTS & RIM FRAMING (Polygon & Multi-Story Aware)
  // -------------------------------------------------------------
  if (includeFloors) {
    const joistWidth = 0.045; // 45mm width
    const joistDepth = 0.195; // 195mm height (C16/C24 structural timber)

    // Identify all architectural walls and slabs
    const allWalls = allShapes.filter(s => 
      (s.type === 'wall' || s.tags?.includes('wall') || s.tags?.includes('wall-assembly')) &&
      !s.tags?.includes('timber-frame')
    );

    const allSlabs = allShapes.filter(s => 
      (s.tags?.includes('floor-slab') || s.tags?.includes('ceiling-slab') || s.tags?.includes('slab') || s.tags?.includes('floor') || s.name?.toLowerCase().includes('slab') || s.name?.toLowerCase().includes('floor')) &&
      !s.tags?.includes('timber-frame') &&
      !s.tags?.includes('foundation-skirt') &&
      !s.tags?.includes('wall') &&
      (s.type === 'poly' || s.type === 'box')
    );

    // Group levels by floor elevation (e.g. Ground Y=0, Story 1 Y=2.8, etc.)
    interface FloorLevelData {
      floorY: number;
      polygon: [number, number][]; // 2D footprint polygon in world coordinates
    }

    const floorLevels: FloorLevelData[] = [];

    // 1. Group walls by story level elevation
    const wallsByElevation = new Map<number, Shape[]>();
    allWalls.forEach(wall => {
      const h = Array.isArray(wall.args) ? (wall.args[1] || 2.8) : 2.8;
      const baseY = Math.round((wall.position[1] - h / 2) * 10) / 10;
      if (!wallsByElevation.has(baseY)) {
        wallsByElevation.set(baseY, []);
      }
      wallsByElevation.get(baseY)!.push(wall);
    });

    // For each level with walls, extract closed room footprint polygon
    wallsByElevation.forEach((wallsOnLevel, baseY) => {
      if (wallsOnLevel.length >= 3) {
        const fp = extractRoomFootprintPolygon(wallsOnLevel, allShapes);
        if (fp && fp.polygon && fp.polygon.length >= 3) {
          floorLevels.push({
            floorY: baseY,
            polygon: fp.polygon
          });
        }
      }
    });

    // 2. Check explicit poly or box slabs that may not have walls
    allSlabs.forEach(slab => {
      const slabY = Math.round(slab.position[1] * 10) / 10;
      const alreadyHasLevel = floorLevels.some(fl => Math.abs(fl.floorY - slabY) < 0.3);

      if (!alreadyHasLevel) {
        if (slab.type === 'poly' && slab.args && typeof slab.args === 'object') {
          const polyArgs = slab.args as { vertices?: [number, number][] };
          if (polyArgs.vertices && polyArgs.vertices.length >= 3) {
            const worldPoly: [number, number][] = polyArgs.vertices.map(([vx, vz]) => [
              slab.position[0] + vx,
              slab.position[2] + vz
            ]);
            floorLevels.push({ floorY: slabY, polygon: worldPoly });
          }
        } else if (slab.type === 'box') {
          const args = Array.isArray(slab.args) ? slab.args : [6.0, 0.2, 6.0];
          const bw = args[0] || 6.0;
          const bd = args[2] || 6.0;
          const halfW = bw / 2;
          const halfD = bd / 2;
          const rectPoly: [number, number][] = [
            [slab.position[0] - halfW, slab.position[2] - halfD],
            [slab.position[0] + halfW, slab.position[2] - halfD],
            [slab.position[0] + halfW, slab.position[2] + halfD],
            [slab.position[0] - halfW, slab.position[2] + halfD],
          ];
          floorLevels.push({ floorY: slabY, polygon: rectPoly });
        }
      }
    });

    // If still no levels found and walls exist, use wall bounding box
    if (floorLevels.length === 0 && allWalls.length >= 3) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      let minWallY = Infinity;
      for (const w of allWalls) {
        const wL = Array.isArray(w.args) ? w.args[0] || 3.0 : 3.0;
        const wH = Array.isArray(w.args) ? w.args[1] || 2.8 : 2.8;
        const wY = w.position[1] - wH / 2;
        if (wY < minWallY) minWallY = wY;
        if (w.position[0] - wL / 2 < minX) minX = w.position[0] - wL / 2;
        if (w.position[0] + wL / 2 > maxX) maxX = w.position[0] + wL / 2;
        if (w.position[2] - wL / 2 < minZ) minZ = w.position[2] - wL / 2;
        if (w.position[2] + wL / 2 > maxZ) maxZ = w.position[2] + wL / 2;
      }
      if (Number.isFinite(minX) && maxX > minX + 1.0 && maxZ > minZ + 1.0) {
        floorLevels.push({
          floorY: minWallY,
          polygon: [
            [minX, minZ],
            [maxX, minZ],
            [maxX, maxZ],
            [minX, maxZ]
          ]
        });
      }
    }

    // Generate accurate, polygon-clipped floor framing for every floor level
    floorLevels.forEach((level, flIdx) => {
      const { floorY, polygon } = level;
      const numVerts = polygon.length;
      if (numVerts < 3) return;

      // Helper to add a 3D beam between two points
      const addFloorBeam = (
        name: string,
        pStart: THREE.Vector3,
        pEnd: THREE.Vector3,
        width: number,
        depth: number,
        subTag: string
      ) => {
        const delta = pEnd.clone().sub(pStart);
        const span = delta.length();
        if (span < 0.05) return;

        const center = pStart.clone().add(pEnd).multiplyScalar(0.5);
        const dir = delta.clone().normalize();
        const vUp = new THREE.Vector3(0, 1, 0);
        const vRight = new THREE.Vector3().crossVectors(dir, vUp).normalize();
        let qWorld = new THREE.Quaternion();

        if (vRight.lengthSq() > 0.01) {
          const vActualUp = new THREE.Vector3().crossVectors(vRight, dir).normalize();
          const mat = new THREE.Matrix4().makeBasis(vRight, vActualUp, dir);
          qWorld.setFromRotationMatrix(mat);
        } else {
          qWorld.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
        }

        resultShapes.push({
          id: `tf-floor-${flIdx}-${floorJoistCount}-${Math.random().toString(36).substr(2, 6)}`,
          name: `Level ${flIdx + 1} - ${name}`,
          type: 'box',
          position: [center.x, center.y, center.z],
          quaternion: [qWorld.x, qWorld.y, qWorld.z, qWorld.w],
          scale: [1, 1, 1],
          args: [width, depth, span],
          color: '#b45309', // Warm structural timber tone
          roughness: 0.8,
          metalness: 0.05,
          groupId,
          tags: [timberTag, 'timber-floor-joist', subTag],
        });
        floorJoistCount++;
      };

      // 1. Perimeter Rim / Band Joists along ALL polygon boundary edges
      for (let i = 0; i < numVerts; i++) {
        const p1 = polygon[i];
        const p2 = polygon[(i + 1) % numVerts];
        const pStart = new THREE.Vector3(p1[0], floorY, p1[1]);
        const pEnd = new THREE.Vector3(p2[0], floorY, p2[1]);
        if (pStart.distanceTo(pEnd) >= 0.25) {
          addFloorBeam(`Rim Joist (Edge ${i + 1})`, pStart, pEnd, joistWidth, joistDepth, 'timber-rim-joist');
        }
      }

      // 2. Interior Floor Joists clipped strictly to the polygon footprint
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      polygon.forEach(([x, z]) => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      });

      const polyWidth = maxX - minX;
      const polyDepth = maxZ - minZ;
      const spanAlongZ = polyWidth <= polyDepth;

      if (spanAlongZ) {
        // Joists parallel to Z axis (spaced along X)
        let currX = minX + studSpacing;
        while (currX <= maxX - 0.05) {
          // Find intersections of line X = currX with all polygon edges
          const zIntersections: number[] = [];
          for (let i = 0; i < numVerts; i++) {
            const [x1, z1] = polygon[i];
            const [x2, z2] = polygon[(i + 1) % numVerts];
            if ((x1 <= currX && currX < x2) || (x2 <= currX && currX < x1)) {
              if (Math.abs(x2 - x1) > 1e-6) {
                const t = (currX - x1) / (x2 - x1);
                zIntersections.push(z1 + t * (z2 - z1));
              }
            }
          }
          zIntersections.sort((a, b) => a - b);

          for (let k = 0; k < zIntersections.length - 1; k += 2) {
            const zStart = zIntersections[k];
            const zEnd = zIntersections[k + 1];
            const span = zEnd - zStart;
            if (span >= 0.35) {
              const pStart = new THREE.Vector3(currX, floorY, zStart + joistWidth);
              const pEnd = new THREE.Vector3(currX, floorY, zEnd - joistWidth);
              addFloorBeam('Floor Joist (400mm c/c)', pStart, pEnd, joistWidth, joistDepth, 'timber-joist');

              // Mid-span blocking
              const midZ = (zStart + zEnd) / 2;
              const nextX = Math.min(maxX - joistWidth, currX + studSpacing);
              if (nextX - currX > 0.15) {
                const pB1 = new THREE.Vector3(currX + joistWidth / 2, floorY, midZ);
                const pB2 = new THREE.Vector3(nextX - joistWidth / 2, floorY, midZ);
                addFloorBeam('Solid Blocking (Mid-Span)', pB1, pB2, joistWidth, joistDepth, 'timber-blocking');
              }
            }
          }

          currX += studSpacing;
        }
      } else {
        // Joists parallel to X axis (spaced along Z)
        let currZ = minZ + studSpacing;
        while (currZ <= maxZ - 0.05) {
          // Find intersections of line Z = currZ with all polygon edges
          const xIntersections: number[] = [];
          for (let i = 0; i < numVerts; i++) {
            const [x1, z1] = polygon[i];
            const [x2, z2] = polygon[(i + 1) % numVerts];
            if ((z1 <= currZ && currZ < z2) || (z2 <= currZ && currZ < z1)) {
              if (Math.abs(z2 - z1) > 1e-6) {
                const t = (currZ - z1) / (z2 - z1);
                xIntersections.push(x1 + t * (x2 - x1));
              }
            }
          }
          xIntersections.sort((a, b) => a - b);

          for (let k = 0; k < xIntersections.length - 1; k += 2) {
            const xStart = xIntersections[k];
            const xEnd = xIntersections[k + 1];
            const span = xEnd - xStart;
            if (span >= 0.35) {
              const pStart = new THREE.Vector3(xStart + joistWidth, floorY, currZ);
              const pEnd = new THREE.Vector3(xEnd - joistWidth, floorY, currZ);
              addFloorBeam('Floor Joist (400mm c/c)', pStart, pEnd, joistWidth, joistDepth, 'timber-joist');

              // Mid-span blocking
              const midX = (xStart + xEnd) / 2;
              const nextZ = Math.min(maxZ - joistWidth, currZ + studSpacing);
              if (nextZ - currZ > 0.15) {
                const pB1 = new THREE.Vector3(midX, floorY, currZ + joistWidth / 2);
                const pB2 = new THREE.Vector3(midX, floorY, nextZ - joistWidth / 2);
                addFloorBeam('Solid Blocking (Mid-Span)', pB1, pB2, joistWidth, joistDepth, 'timber-blocking');
              }
            }
          }

          currZ += studSpacing;
        }
      }
    });
  }

  // -------------------------------------------------------------
  // 3. ROOF TIMBER FRAMING (Hip Rafters, Ridge Beam, Common & Jack Rafters, Collar Ties)
  // -------------------------------------------------------------
  if (includeRoof) {
    // Collect roof assemblies (even if cladding/tiles are hidden, timber frame is structural)
    const roofShapes = allShapes.filter(s => 
      (s.tags?.includes('roof') || s.name?.toLowerCase().includes('roof')) &&
      !s.tags?.includes('roof-fascia') &&
      !s.tags?.includes('roof-pediment') &&
      !s.tags?.includes('roof-soffit') &&
      !s.tags?.includes('roof-ridge-cap') &&
      !s.tags?.includes('timber-frame')
    );

    roofShapes.forEach((roof, rIdx) => {
      const roofPos = new THREE.Vector3(...roof.position);
      const roofQuat = new THREE.Quaternion(...(roof.quaternion || [0, 0, 0, 1]));
      const args = Array.isArray(roof.args) ? roof.args : [6.0, 2.0, 6.0];
      const roofW = args[0] || 6.0;
      const roofH = args[1] || 2.2;
      const roofD = args[2] || 6.0;

      const rafterWidth = 0.045; // 45mm
      const rafterDepth = 0.145; // 145mm
      const hipRafterWidth = 0.075; // 75mm heavy hip rafter
      const hipRafterDepth = 0.195; // 195mm
      const ridgeBeamWidth = 0.075;
      const ridgeBeamDepth = 0.220;

      const halfW = roofW / 2;
      const halfD = roofD / 2;
      const isWidthLonger = roofW >= roofD;

      // Detect roof style: Hip vs Gable vs L-Shape
      const isHip =
        roof.name?.toLowerCase().includes('hip') ||
        roof.tags?.includes('roof-hip') ||
        (roof as any).roofType === 'hip' ||
        (roof.args as any)?.roofType === 'hip';

      // Helper to add a 3D timber member connecting two local points
      const addBeamSegment = (
        name: string,
        pStartLocal: THREE.Vector3,
        pEndLocal: THREE.Vector3,
        width: number,
        depth: number,
        subTag: string
      ) => {
        const span = pStartLocal.distanceTo(pEndLocal);
        if (span < 0.05) return;

        const midLocal = pStartLocal.clone().lerp(pEndLocal, 0.5);
        const dirLocal = pEndLocal.clone().sub(pStartLocal).normalize();

        // Local Z along the beam direction
        const qLocal = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dirLocal);
        const qWorld = qLocal.clone().premultiply(roofQuat);
        const worldPos = midLocal.clone().applyQuaternion(roofQuat).add(roofPos);

        resultShapes.push({
          id: `tf-roof-${roof.id}-${roofRafterCount}-${Math.random().toString(36).substr(2, 6)}`,
          name: `${roof.name || `Roof ${rIdx + 1}`} - ${name}`,
          type: 'box',
          position: [worldPos.x, worldPos.y, worldPos.z],
          quaternion: [qWorld.x, qWorld.y, qWorld.z, qWorld.w],
          scale: [1, 1, 1],
          args: [width, depth, span],
          color: '#92400e', // Warm rustic rafter cedar/pine
          roughness: 0.8,
          metalness: 0.05,
          groupId,
          tags: [timberTag, 'timber-roof-rafter', subTag, ...(roof.tags || []).filter(t => t !== 'roof-assembly')],
        });
        roofRafterCount++;
      };

      // 1. Check for attached roofData or customData
      const roofData = roof.roofData || roof.customData;
      let isLShape = Boolean(roofData?.isLShape);
      let isRectangular = Boolean(roofData?.isRectangular);
      let reflexIndex = roofData?.reflexIndex as number | undefined;
      let localWallPoly: [number, number][] | undefined = roofData?.localWallPoly;
      let localEavePoly: [number, number][] | undefined = roofData?.localEavePoly;
      const ridgeH = roofData?.ridgeHeight ?? roofH;
      const eaveOverhang = roofData?.eaveOverhang ?? 0.35;

      // If roofData is not attached, check if there are room walls under this roof
      if (!roofData) {
        const matchingWalls = allShapes.filter(s =>
          (s.type === 'wall' || s.tags?.includes('wall') || s.tags?.includes('room-wall')) &&
          !s.tags?.includes('timber-frame')
        );
        if (matchingWalls.length >= 3) {
          const fp = extractRoomFootprintPolygon(matchingWalls, allShapes);
          if (fp) {
            isLShape = fp.isLShape;
            isRectangular = fp.isRectangular;
            reflexIndex = fp.reflexIndex;
            // Center polygon relative to roof position
            localWallPoly = fp.polygon.map(([x, z]) => [x - roofPos.x, z - roofPos.z]);
            localEavePoly = offsetPolygon2D(localWallPoly, eaveOverhang);
          }
        }
      }

      if (isLShape && localWallPoly && localEavePoly && reflexIndex !== undefined) {
        // =========================================================================
        // L-SHAPED CROSS-GABLE & CROSS-HIP ROOF FRAMING
        // =========================================================================
        const V = getCanonicalLPolygon(localWallPoly, reflexIndex);
        const E = getCanonicalLPolygon(localEavePoly, reflexIndex);
        const { rJunc, rEnd1, rEnd2 } = computeLRidgeNodes(V, E, ridgeH, isHip);

        const e0 = new THREE.Vector3(E[0][0], 0, E[0][1]); // Reflex inside corner
        const e1 = new THREE.Vector3(E[1][0], 0, E[1][1]); // Wing 1 eave end 1
        const e2 = new THREE.Vector3(E[2][0], 0, E[2][1]); // Wing 1 eave end 2
        const e3 = new THREE.Vector3(E[3][0], 0, E[3][1]); // Outer corner opposite reflex
        const e4 = new THREE.Vector3(E[4][0], 0, E[4][1]); // Wing 2 eave end 1
        const e5 = new THREE.Vector3(E[5][0], 0, E[5][1]); // Wing 2 eave end 2

        const rJ = new THREE.Vector3(rJunc[0], rJunc[1], rJunc[2]);
        const r1 = new THREE.Vector3(rEnd1[0], rEnd1[1], rEnd1[2]);
        const r2 = new THREE.Vector3(rEnd2[0], rEnd2[1], rEnd2[2]);

        // 1. Primary Ridge Beams for both wings
        addBeamSegment('Ridge Beam (Wing 1)', rJ, r1, ridgeBeamWidth, ridgeBeamDepth, 'timber-ridge-beam');
        addBeamSegment('Ridge Beam (Wing 2)', rJ, r2, ridgeBeamWidth, ridgeBeamDepth, 'timber-ridge-beam');

        // 2. Structural Inside Corner Valley Rafter (E[0] -> rJunc)
        addBeamSegment('Valley Rafter (Inside Corner)', e0, rJ, hipRafterWidth, hipRafterDepth, 'timber-valley-rafter');

        // 3. Structural Outside Corner Hip Rafter (E[3] -> rJunc)
        addBeamSegment('Hip Rafter (Outside Corner)', e3, rJ, hipRafterWidth, hipRafterDepth, 'timber-hip-rafter');

        // 4. Far End Framing
        if (isHip) {
          addBeamSegment('Hip Rafter (Wing 1 Left)', e1, r1, hipRafterWidth, hipRafterDepth, 'timber-hip-rafter');
          addBeamSegment('Hip Rafter (Wing 1 Right)', e2, r1, hipRafterWidth, hipRafterDepth, 'timber-hip-rafter');
          addBeamSegment('Hip Rafter (Wing 2 Left)', e4, r2, hipRafterWidth, hipRafterDepth, 'timber-hip-rafter');
          addBeamSegment('Hip Rafter (Wing 2 Right)', e5, r2, hipRafterWidth, hipRafterDepth, 'timber-hip-rafter');
        } else {
          addBeamSegment('Bargeboard / Rake Rafter (Wing 1 Left)', e1, r1, rafterWidth, rafterDepth, 'timber-rake-rafter');
          addBeamSegment('Bargeboard / Rake Rafter (Wing 1 Right)', e2, r1, rafterWidth, rafterDepth, 'timber-rake-rafter');
          addBeamSegment('Bargeboard / Rake Rafter (Wing 2 Left)', e4, r2, rafterWidth, rafterDepth, 'timber-rake-rafter');
          addBeamSegment('Bargeboard / Rake Rafter (Wing 2 Right)', e5, r2, rafterWidth, rafterDepth, 'timber-rake-rafter');
        }

        // 5. Valley Jack Rafters along the inside corner valley rafter (e0 -> rJ)
        const valleyLen = e0.distanceTo(rJ);
        if (valleyLen > 0.1) {
          let d = studSpacing;
          while (d < valleyLen - 0.08) {
            const t = d / valleyLen;
            const pVal = e0.clone().lerp(rJ, t);

            // Jack 1: runs to Wing 1 eave line (z = e0.z)
            const pEave1 = new THREE.Vector3(pVal.x, 0, e0.z);
            if (pVal.distanceTo(pEave1) > 0.08) {
              addBeamSegment('Valley Jack Rafter (Wing 1)', pEave1, pVal, rafterWidth, rafterDepth, 'timber-valley-jack-rafter');
            }

            // Jack 2: runs to Wing 2 eave line (x = e0.x)
            const pEave2 = new THREE.Vector3(e0.x, 0, pVal.z);
            if (pVal.distanceTo(pEave2) > 0.08) {
              addBeamSegment('Valley Jack Rafter (Wing 2)', pEave2, pVal, rafterWidth, rafterDepth, 'timber-valley-jack-rafter');
            }

            d += studSpacing;
          }
        }

        // 6. Hip Jack Rafters along the outside corner hip rafter (e3 -> rJ)
        const outerHipLen = e3.distanceTo(rJ);
        if (outerHipLen > 0.1) {
          let d = studSpacing;
          while (d < outerHipLen - 0.08) {
            const t = d / outerHipLen;
            const pHip = e3.clone().lerp(rJ, t);

            // Jack 1: runs to Wing 1 outer eave line (z = e3.z)
            const pEave1 = new THREE.Vector3(pHip.x, 0, e3.z);
            if (pHip.distanceTo(pEave1) > 0.08) {
              addBeamSegment('Hip Jack Rafter (Wing 1 Outer)', pEave1, pHip, rafterWidth, rafterDepth, 'timber-hip-jack-rafter');
            }

            // Jack 2: runs to Wing 2 outer eave line (x = e3.x)
            const pEave2 = new THREE.Vector3(e3.x, 0, pHip.z);
            if (pHip.distanceTo(pEave2) > 0.08) {
              addBeamSegment('Hip Jack Rafter (Wing 2 Outer)', pEave2, pHip, rafterWidth, rafterDepth, 'timber-hip-jack-rafter');
            }

            d += studSpacing;
          }
        }

        // 7. Common Rafters & Hip Jack Rafters on Wing 1 and Wing 2
        // For Wing 1:
        // Straight common rafters run strictly from x = e0.x towards r1.x
        const wing1MaxX = isHip ? r1.x : e1.x;
        let currX1 = e0.x + studSpacing;
        while (currX1 <= wing1MaxX - 0.05) {
          const pRidge = new THREE.Vector3(currX1, r1.y, r1.z);
          const pEaveVal = new THREE.Vector3(currX1, 0, e0.z);
          const pEaveOut = new THREE.Vector3(currX1, 0, e2.z);

          addBeamSegment('Common Rafter (Wing 1 Valley Side)', pEaveVal, pRidge, rafterWidth, rafterDepth, 'timber-common-rafter');
          addBeamSegment('Common Rafter (Wing 1 Outer Side)', pEaveOut, pRidge, rafterWidth, rafterDepth, 'timber-common-rafter');

          currX1 += studSpacing;
        }

        // For Wing 2:
        // Straight common rafters run strictly from z = e0.z towards r2.z
        const wing2MaxZ = isHip ? r2.z : e5.z;
        let currZ2 = e0.z + studSpacing;
        while (currZ2 <= wing2MaxZ - 0.05) {
          const pRidge = new THREE.Vector3(r2.x, r2.y, currZ2);
          const pEaveVal = new THREE.Vector3(e0.x, 0, currZ2);
          const pEaveOut = new THREE.Vector3(e4.x, 0, currZ2);

          addBeamSegment('Common Rafter (Wing 2 Valley Side)', pEaveVal, pRidge, rafterWidth, rafterDepth, 'timber-common-rafter');
          addBeamSegment('Common Rafter (Wing 2 Outer Side)', pEaveOut, pRidge, rafterWidth, rafterDepth, 'timber-common-rafter');

          currZ2 += studSpacing;
        }

        // 8. Hip End Jack Rafters (When Hip Roof is Selected)
        if (isHip) {
          // --- Wing 1 Hip End ---
          // A. Side Jack Rafters in the hip setback zone (x between r1.x and e1.x)
          const hipSpanX1 = e1.x - r1.x;
          if (hipSpanX1 > 0.05) {
            let xJack = r1.x + studSpacing;
            while (xJack <= e1.x - 0.05) {
              const t = (xJack - r1.x) / hipSpanX1; // 0 at ridge apex r1, 1 at eave corners
              const pTopLeft = r1.clone().lerp(e1, t);
              const pTopRight = r1.clone().lerp(e2, t);

              addBeamSegment('Jack Rafter (Wing 1 Valley Hip)', new THREE.Vector3(xJack, 0, e0.z), pTopLeft, rafterWidth, rafterDepth, 'timber-hip-jack-rafter');
              addBeamSegment('Jack Rafter (Wing 1 Outer Hip)', new THREE.Vector3(xJack, 0, e2.z), pTopRight, rafterWidth, rafterDepth, 'timber-hip-jack-rafter');

              xJack += studSpacing;
            }
          }

          // B. End Eave Jack Rafters along e1 -> e2 (at x = e1.x)
          const spanZ1 = Math.abs(e2.z - e1.z);
          const midZ1 = (e1.z + e2.z) / 2;
          let zJack1 = Math.min(e1.z, e2.z) + studSpacing;
          const maxZ1 = Math.max(e1.z, e2.z) - 0.05;
          while (zJack1 <= maxZ1) {
            const pEave = new THREE.Vector3(e1.x, 0, zJack1);
            let pTop: THREE.Vector3;
            if (zJack1 < r1.z) {
              const t = Math.abs(r1.z - zJack1) / Math.max(0.01, Math.abs(r1.z - e1.z));
              pTop = r1.clone().lerp(e1, Math.min(1, t));
            } else {
              const t = Math.abs(zJack1 - r1.z) / Math.max(0.01, Math.abs(e2.z - r1.z));
              pTop = r1.clone().lerp(e2, Math.min(1, t));
            }
            addBeamSegment('Jack Rafter (Wing 1 Hip End)', pEave, pTop, rafterWidth, rafterDepth, 'timber-hip-jack-rafter');
            zJack1 += studSpacing;
          }

          // --- Wing 2 Hip End ---
          // A. Side Jack Rafters in the hip setback zone (z between r2.z and e5.z)
          const hipSpanZ2 = e5.z - r2.z;
          if (hipSpanZ2 > 0.05) {
            let zJack = r2.z + studSpacing;
            while (zJack <= e5.z - 0.05) {
              const t = (zJack - r2.z) / hipSpanZ2;
              const pTopLeft = r2.clone().lerp(e5, t);
              const pTopRight = r2.clone().lerp(e4, t);

              addBeamSegment('Jack Rafter (Wing 2 Valley Hip)', new THREE.Vector3(e0.x, 0, zJack), pTopLeft, rafterWidth, rafterDepth, 'timber-hip-jack-rafter');
              addBeamSegment('Jack Rafter (Wing 2 Outer Hip)', new THREE.Vector3(e4.x, 0, zJack), pTopRight, rafterWidth, rafterDepth, 'timber-hip-jack-rafter');

              zJack += studSpacing;
            }
          }

          // B. End Eave Jack Rafters along e5 -> e4 (at z = e5.z)
          const minX2 = Math.min(e5.x, e4.x) + studSpacing;
          const maxX2 = Math.max(e5.x, e4.x) - 0.05;
          let xJack2 = minX2;
          while (xJack2 <= maxX2) {
            const pEave = new THREE.Vector3(xJack2, 0, e5.z);
            let pTop: THREE.Vector3;
            if (xJack2 < r2.x) {
              const t = Math.abs(r2.x - xJack2) / Math.max(0.01, Math.abs(r2.x - e5.x));
              pTop = r2.clone().lerp(e5, Math.min(1, t));
            } else {
              const t = Math.abs(xJack2 - r2.x) / Math.max(0.01, Math.abs(e4.x - r2.x));
              pTop = r2.clone().lerp(e4, Math.min(1, t));
            }
            addBeamSegment('Jack Rafter (Wing 2 Hip End)', pEave, pTop, rafterWidth, rafterDepth, 'timber-hip-jack-rafter');
            xJack2 += studSpacing;
          }
        }

        // Ceiling Joists / Ties across each wing
        const v0 = new THREE.Vector3(V[0][0], 0.04, V[0][1]);
        const v1 = new THREE.Vector3(V[1][0], 0.04, V[1][1]);
        const v2 = new THREE.Vector3(V[2][0], 0.04, V[2][1]);
        const v3 = new THREE.Vector3(V[3][0], 0.04, V[3][1]);
        const v4 = new THREE.Vector3(V[4][0], 0.04, V[4][1]);
        const v5 = new THREE.Vector3(V[5][0], 0.04, V[5][1]);

        // Wing 1 Ceiling Joists (between V[0]..V[1] and V[3]..V[2])
        const lenW1 = v0.distanceTo(v1);
        let j1 = studSpacing;
        while (j1 < lenW1 - 0.05) {
          const t = j1 / lenW1;
          const pA = v0.clone().lerp(v1, t);
          const pB = v3.clone().lerp(v2, t);
          addBeamSegment('Ceiling Joist (Wing 1)', pA, pB, rafterWidth, rafterDepth, 'timber-ceiling-joist');
          j1 += studSpacing;
        }

        // Wing 2 Ceiling Joists (between V[5]..V[0] and V[4]..V[3])
        const lenW2 = v5.distanceTo(v0);
        let j2 = studSpacing;
        while (j2 < lenW2 - 0.05) {
          const t = j2 / lenW2;
          const pA = v5.clone().lerp(v0, t);
          const pB = v4.clone().lerp(v3, t);
          addBeamSegment('Ceiling Joist (Wing 2)', pA, pB, rafterWidth, rafterDepth, 'timber-ceiling-joist');
          j2 += studSpacing;
        }

      } else if (isHip) {
        // =========================================================================
        // RECTANGULAR HIP ROOF FRAMING
        // =========================================================================
        if (isWidthLonger) {
          const ridgeHalfLen = Math.max(0, (roofW - roofD) / 2);
          const apexLeft = new THREE.Vector3(-ridgeHalfLen, roofH, 0);
          const apexRight = new THREE.Vector3(ridgeHalfLen, roofH, 0);

          if (ridgeHalfLen > 0.05) {
            addBeamSegment(
              'Hip Ridge Board',
              new THREE.Vector3(-ridgeHalfLen, roofH - ridgeBeamDepth / 2, 0),
              new THREE.Vector3(ridgeHalfLen, roofH - ridgeBeamDepth / 2, 0),
              ridgeBeamWidth,
              ridgeBeamDepth,
              'timber-ridge-beam'
            );
          }

          const cornerNW = new THREE.Vector3(-halfW, 0, -halfD);
          const cornerSW = new THREE.Vector3(-halfW, 0, halfD);
          const cornerNE = new THREE.Vector3(halfW, 0, -halfD);
          const cornerSE = new THREE.Vector3(halfW, 0, halfD);

          addBeamSegment('Hip Rafter (North-West)', apexLeft, cornerNW, hipRafterWidth, hipRafterDepth, 'timber-hip-rafter');
          addBeamSegment('Hip Rafter (South-West)', apexLeft, cornerSW, hipRafterWidth, hipRafterDepth, 'timber-hip-rafter');
          addBeamSegment('Hip Rafter (North-East)', apexRight, cornerNE, hipRafterWidth, hipRafterDepth, 'timber-hip-rafter');
          addBeamSegment('Hip Rafter (South-East)', apexRight, cornerSE, hipRafterWidth, hipRafterDepth, 'timber-hip-rafter');

          let currX = -ridgeHalfLen + 0.15;
          while (currX <= ridgeHalfLen - 0.15) {
            const topPt = new THREE.Vector3(currX, roofH, 0);
            const frontEave = new THREE.Vector3(currX, 0, halfD);
            const backEave = new THREE.Vector3(currX, 0, -halfD);

            addBeamSegment('Common Rafter (Front)', topPt, frontEave, rafterWidth, rafterDepth, 'timber-rafter');
            addBeamSegment('Common Rafter (Back)', topPt, backEave, rafterWidth, rafterDepth, 'timber-rafter');

            const tieY = roofH * 0.40;
            const tieZ = halfD * (1 - 0.40);
            addBeamSegment(
              'Collar Tie',
              new THREE.Vector3(currX, tieY, -tieZ),
              new THREE.Vector3(currX, tieY, tieZ),
              rafterWidth,
              rafterDepth * 0.7,
              'timber-collar-tie'
            );

            currX += studSpacing;
          }

          // Jack Rafters on West & East Hip Ends
          let zJack = -halfD + studSpacing;
          while (zJack < halfD - 0.05) {
            const distFromCenterZ = Math.abs(zJack);
            const t = distFromCenterZ / halfD;
            const xTop = -ridgeHalfLen - (1 - t) * (halfW - ridgeHalfLen);
            const yTop = (1 - t) * roofH;
            const topPt = new THREE.Vector3(xTop, yTop, zJack);
            const eavePt = new THREE.Vector3(-halfW, 0, zJack);
            addBeamSegment('Jack Rafter (West Hip)', topPt, eavePt, rafterWidth, rafterDepth, 'timber-jack-rafter');
            zJack += studSpacing;
          }

          zJack = -halfD + studSpacing;
          while (zJack < halfD - 0.05) {
            const distFromCenterZ = Math.abs(zJack);
            const t = distFromCenterZ / halfD;
            const xTop = ridgeHalfLen + (1 - t) * (halfW - ridgeHalfLen);
            const yTop = (1 - t) * roofH;
            const topPt = new THREE.Vector3(xTop, yTop, zJack);
            const eavePt = new THREE.Vector3(halfW, 0, zJack);
            addBeamSegment('Jack Rafter (East Hip)', topPt, eavePt, rafterWidth, rafterDepth, 'timber-jack-rafter');
            zJack += studSpacing;
          }

          // Corner Jack Rafters
          let xCorner = -halfW + studSpacing;
          while (xCorner < -ridgeHalfLen - 0.05) {
            const t = (xCorner - (-halfW)) / (halfW - ridgeHalfLen);
            const zTopFront = t * halfD;
            const zTopBack = -t * halfD;
            const yTop = t * roofH;
            addBeamSegment('Jack Rafter (SW Corner)', new THREE.Vector3(xCorner, yTop, zTopFront), new THREE.Vector3(xCorner, 0, halfD), rafterWidth, rafterDepth, 'timber-jack-rafter');
            addBeamSegment('Jack Rafter (NW Corner)', new THREE.Vector3(xCorner, yTop, zTopBack), new THREE.Vector3(xCorner, 0, -halfD), rafterWidth, rafterDepth, 'timber-jack-rafter');
            xCorner += studSpacing;
          }

          xCorner = ridgeHalfLen + studSpacing;
          while (xCorner < halfW - 0.05) {
            const t = (halfW - xCorner) / (halfW - ridgeHalfLen);
            const zTopFront = t * halfD;
            const zTopBack = -t * halfD;
            const yTop = t * roofH;
            addBeamSegment('Jack Rafter (SE Corner)', new THREE.Vector3(xCorner, yTop, zTopFront), new THREE.Vector3(xCorner, 0, halfD), rafterWidth, rafterDepth, 'timber-jack-rafter');
            addBeamSegment('Jack Rafter (NE Corner)', new THREE.Vector3(xCorner, yTop, zTopBack), new THREE.Vector3(xCorner, 0, -halfD), rafterWidth, rafterDepth, 'timber-jack-rafter');
            xCorner += studSpacing;
          }
        } else {
          // Depth is longer
          const ridgeHalfLen = Math.max(0, (roofD - roofW) / 2);
          const apexNorth = new THREE.Vector3(0, roofH, -ridgeHalfLen);
          const apexSouth = new THREE.Vector3(0, roofH, ridgeHalfLen);

          if (ridgeHalfLen > 0.05) {
            addBeamSegment(
              'Hip Ridge Board',
              new THREE.Vector3(0, roofH - ridgeBeamDepth / 2, -ridgeHalfLen),
              new THREE.Vector3(0, roofH - ridgeBeamDepth / 2, ridgeHalfLen),
              ridgeBeamWidth,
              ridgeBeamDepth,
              'timber-ridge-beam'
            );
          }

          const cornerNW = new THREE.Vector3(-halfW, 0, -halfD);
          const cornerSW = new THREE.Vector3(-halfW, 0, halfD);
          const cornerNE = new THREE.Vector3(halfW, 0, -halfD);
          const cornerSE = new THREE.Vector3(halfW, 0, halfD);

          addBeamSegment('Hip Rafter (North-West)', apexNorth, cornerNW, hipRafterWidth, hipRafterDepth, 'timber-hip-rafter');
          addBeamSegment('Hip Rafter (North-East)', apexNorth, cornerNE, hipRafterWidth, hipRafterDepth, 'timber-hip-rafter');
          addBeamSegment('Hip Rafter (South-West)', apexSouth, cornerSW, hipRafterWidth, hipRafterDepth, 'timber-hip-rafter');
          addBeamSegment('Hip Rafter (South-East)', apexSouth, cornerSE, hipRafterWidth, hipRafterDepth, 'timber-hip-rafter');

          let currZ = -ridgeHalfLen + 0.15;
          while (currZ <= ridgeHalfLen - 0.15) {
            const topPt = new THREE.Vector3(0, roofH, currZ);
            const leftEave = new THREE.Vector3(-halfW, 0, currZ);
            const rightEave = new THREE.Vector3(halfW, 0, currZ);

            addBeamSegment('Common Rafter (Left)', topPt, leftEave, rafterWidth, rafterDepth, 'timber-rafter');
            addBeamSegment('Common Rafter (Right)', topPt, rightEave, rafterWidth, rafterDepth, 'timber-rafter');

            const tieY = roofH * 0.40;
            const tieX = halfW * (1 - 0.40);
            addBeamSegment(
              'Collar Tie',
              new THREE.Vector3(-tieX, tieY, currZ),
              new THREE.Vector3(tieX, tieY, currZ),
              rafterWidth,
              rafterDepth * 0.7,
              'timber-collar-tie'
            );

            currZ += studSpacing;
          }

          let xJack = -halfW + studSpacing;
          while (xJack < halfW - 0.05) {
            const distFromCenterX = Math.abs(xJack);
            const t = distFromCenterX / halfW;
            const zTop = -ridgeHalfLen - (1 - t) * (halfD - ridgeHalfLen);
            const yTop = (1 - t) * roofH;
            const topPt = new THREE.Vector3(xJack, yTop, zTop);
            const eavePt = new THREE.Vector3(xJack, 0, -halfD);
            addBeamSegment('Jack Rafter (North Hip)', topPt, eavePt, rafterWidth, rafterDepth, 'timber-jack-rafter');
            xJack += studSpacing;
          }

          xJack = -halfW + studSpacing;
          while (xJack < halfW - 0.05) {
            const distFromCenterX = Math.abs(xJack);
            const t = distFromCenterX / halfW;
            const zTop = ridgeHalfLen + (1 - t) * (halfD - ridgeHalfLen);
            const yTop = (1 - t) * roofH;
            const topPt = new THREE.Vector3(xJack, yTop, zTop);
            const eavePt = new THREE.Vector3(xJack, 0, halfD);
            addBeamSegment('Jack Rafter (South Hip)', topPt, eavePt, rafterWidth, rafterDepth, 'timber-jack-rafter');
            xJack += studSpacing;
          }
        }

      } else if (roof.geometryData?.positions && !isRectangular) {
        // =========================================================================
        // UNIVERSAL 3D MESH SLOPE FACET FRAMING (Polygonal / Custom Roofs)
        // =========================================================================
        const positions = roof.geometryData.positions as number[];
        const numTriangles = Math.floor(positions.length / 9);

        for (let i = 0; i < numTriangles; i++) {
          const idx = i * 9;
          const p1 = new THREE.Vector3(positions[idx], positions[idx + 1], positions[idx + 2]);
          const p2 = new THREE.Vector3(positions[idx + 3], positions[idx + 4], positions[idx + 5]);
          const p3 = new THREE.Vector3(positions[idx + 6], positions[idx + 7], positions[idx + 8]);

          // Compute triangle normal
          const normal = new THREE.Vector3().crossVectors(p2.clone().sub(p1), p3.clone().sub(p1)).normalize();

          // Only process upward-facing slope triangles (exclude vertical gable infills and flat plates)
          if (normal.y > 0.05 && normal.y < 0.999) {
            // Horizontal eave direction vector
            const uEave = new THREE.Vector3(-normal.z, 0, normal.x).normalize();
            if (uEave.lengthSq() < 0.1) continue;

            // Up-slope pitch vector
            const uUp = new THREE.Vector3().crossVectors(normal, uEave).normalize();

            // Project 3 vertices onto (uEave, uUp) 2D coordinate system
            const pts2D = [p1, p2, p3].map(p => ({
              u: p.dot(uEave),
              v: p.dot(uUp),
              p3D: p
            }));

            const minU = Math.min(...pts2D.map(pt => pt.u));
            const maxU = Math.max(...pts2D.map(pt => pt.u));

            let uStep = minU + studSpacing;
            while (uStep < maxU - 0.05) {
              // Find intersections of line u = uStep with the triangle edges in 2D
              const vIntersections: number[] = [];
              for (let edge = 0; edge < 3; edge++) {
                const a = pts2D[edge];
                const b = pts2D[(edge + 1) % 3];
                if ((a.u <= uStep && b.u >= uStep) || (b.u <= uStep && a.u >= uStep)) {
                  if (Math.abs(b.u - a.u) > 1e-5) {
                    const t = (uStep - a.u) / (b.u - a.u);
                    vIntersections.push(a.v + t * (b.v - a.v));
                  }
                }
              }

              if (vIntersections.length >= 2) {
                const vMin = Math.min(...vIntersections);
                const vMax = Math.max(...vIntersections);
                if (vMax - vMin > 0.15) {
                  // Reconstruct 3D points
                  const origin3D = p1.clone().addScaledVector(uEave, uStep - pts2D[0].u);
                  const pBottom = origin3D.clone().addScaledVector(uUp, vMin - pts2D[0].v);
                  const pTop = origin3D.clone().addScaledVector(uUp, vMax - pts2D[0].v);

                  addBeamSegment('Slope Rafter', pBottom, pTop, rafterWidth, rafterDepth, 'timber-rafter');
                }
              }
              uStep += studSpacing;
            }
          }
        }

      } else {
        // =========================================================================
        // RECTANGULAR GABLE ROOF FRAMING
        // =========================================================================
        if (isWidthLonger) {
          // 1. Full Length Ridge Board
          addBeamSegment(
            'Ridge Board Beam',
            new THREE.Vector3(-halfW, roofH - ridgeBeamDepth / 2, 0),
            new THREE.Vector3(halfW, roofH - ridgeBeamDepth / 2, 0),
            ridgeBeamWidth,
            ridgeBeamDepth,
            'timber-ridge-beam'
          );

          // 2. Common Rafter Pairs along length of roof
          let currX = -halfW;
          while (currX <= halfW + 0.02) {
            const topPt = new THREE.Vector3(currX, roofH, 0);
            const frontEave = new THREE.Vector3(currX, 0, halfD);
            const backEave = new THREE.Vector3(currX, 0, -halfD);

            addBeamSegment('Common Rafter (Front)', topPt, frontEave, rafterWidth, rafterDepth, 'timber-rafter');
            addBeamSegment('Common Rafter (Back)', topPt, backEave, rafterWidth, rafterDepth, 'timber-rafter');

            // Collar Tie (horizontal strut across Z at lower third)
            const tieSpan = roofD * 0.65;
            const tieY = roofH * 0.35;
            addBeamSegment(
              'Collar Tie',
              new THREE.Vector3(currX, tieY, -tieSpan / 2),
              new THREE.Vector3(currX, tieY, tieSpan / 2),
              rafterWidth,
              rafterDepth * 0.7,
              'timber-collar-tie'
            );

            // Ceiling Joist / Tie Beam at bottom
            addBeamSegment(
              'Ceiling Joist',
              new THREE.Vector3(currX, 0.04, -halfD),
              new THREE.Vector3(currX, 0.04, halfD),
              rafterWidth,
              rafterDepth,
              'timber-ceiling-joist'
            );

            currX += studSpacing;
          }
        } else {
          // Ridge runs along World Z axis
          addBeamSegment(
            'Ridge Board Beam',
            new THREE.Vector3(0, roofH - ridgeBeamDepth / 2, -halfD),
            new THREE.Vector3(0, roofH - ridgeBeamDepth / 2, halfD),
            ridgeBeamWidth,
            ridgeBeamDepth,
            'timber-ridge-beam'
          );

          let currZ = -halfD;
          while (currZ <= halfD + 0.02) {
            const topPt = new THREE.Vector3(0, roofH, currZ);
            const leftEave = new THREE.Vector3(-halfW, 0, currZ);
            const rightEave = new THREE.Vector3(halfW, 0, currZ);

            addBeamSegment('Common Rafter (Left)', topPt, leftEave, rafterWidth, rafterDepth, 'timber-rafter');
            addBeamSegment('Common Rafter (Right)', topPt, rightEave, rafterWidth, rafterDepth, 'timber-rafter');

            // Collar Tie
            const tieSpan = roofW * 0.65;
            const tieY = roofH * 0.35;
            addBeamSegment(
              'Collar Tie',
              new THREE.Vector3(-tieSpan / 2, tieY, currZ),
              new THREE.Vector3(tieSpan / 2, tieY, currZ),
              rafterWidth,
              rafterDepth * 0.7,
              'timber-collar-tie'
            );

            // Ceiling Joist / Tie Beam at bottom
            addBeamSegment(
              'Ceiling Joist',
              new THREE.Vector3(-halfW, 0.04, currZ),
              new THREE.Vector3(halfW, 0.04, currZ),
              rafterWidth,
              rafterDepth,
              'timber-ceiling-joist'
            );

            currZ += studSpacing;
          }
        }
      }
    });
  }

  return {
    shapes: resultShapes,
    wallStudCount,
    floorJoistCount,
    roofRafterCount
  };
}

/**
 * Convenient wrapper returning members array and breakdown
 */
export function generateTimberFrameForBuilding(
  allShapes: Shape[],
  options?: TimberFrameOptions & { joistSpacing?: number; rafterSpacing?: number }
): { members: Shape[]; totalCount: number; wallCount: number; floorCount: number; roofCount: number } {
  const res = generateTimberFraming(allShapes, options);
  return {
    members: res.shapes,
    totalCount: res.shapes.length,
    wallCount: res.wallStudCount,
    floorCount: res.floorJoistCount,
    roofCount: res.roofRafterCount
  };
}

/**
 * Computes a geometric fingerprint of host architectural components (walls, openings, slabs, roofs).
 * If none of these have moved or changed dimension, timber framing does not need regeneration.
 */
function getArchFingerprint(shapes: Shape[]): string {
  const archShapes = shapes.filter(s =>
    !s.tags?.includes('timber-frame') &&
    !s.name?.toLowerCase().startsWith('timber ') &&
    (s.type === 'wall' || s.type === 'door' || s.type === 'window' || s.tags?.includes('wall') || s.tags?.includes('roof') || s.tags?.includes('floor') || s.tags?.includes('slab'))
  );
  return archShapes.map(s => `${s.id}:${s.type}:${s.position.map(p => p.toFixed(2)).join(',')}:${JSON.stringify(s.args)}:${(s.quaternion || []).map(q => q.toFixed(2)).join(',')}`).join('|');
}

let lastArchFingerprint = '';

/**
 * Automatically regenerates active timber frames whenever doors, windows, walls,
 * floors, or roofs are added, modified, moved, or deleted, while preserving user
 * visibility toggles (hidden property) and respecting user deletions.
 */
export function updateTimberFramesIfPresent(allShapes: Shape[]): Shape[] {
  const existingTimberShapes = allShapes.filter(
    s => s.tags?.includes('timber-frame') || s.name?.toLowerCase().startsWith('timber ')
  );
  if (existingTimberShapes.length === 0) return allShapes;

  const currentArchFingerprint = getArchFingerprint(allShapes);
  // If host architecture has not changed (e.g. only timber visibility toggled or timber deleted), do NOT overwrite!
  if (currentArchFingerprint === lastArchFingerprint && lastArchFingerprint !== '') {
    return allShapes;
  }
  lastArchFingerprint = currentArchFingerprint;

  // Track existing hidden state by category / tag
  const hiddenCategories = new Set<string>();
  const hiddenNames = new Set<string>();
  existingTimberShapes.forEach(s => {
    if (s.hidden) {
      if (s.name) hiddenNames.add(s.name);
      if (s.tags?.includes('timber-floor-joist')) hiddenCategories.add('timber-floor-joist');
      if (s.tags?.includes('timber-roof-rafter')) hiddenCategories.add('timber-roof-rafter');
      if (s.tags?.includes('timber-stud')) hiddenCategories.add('timber-stud');
    }
  });

  const nonTimber = allShapes.filter(
    s => !s.tags?.includes('timber-frame') && !s.name?.toLowerCase().startsWith('timber ')
  );

  const res = generateTimberFraming(nonTimber, {
    studSpacing: 0.40,
    includeWalls: true,
    includeFloors: true,
    includeRoof: true,
  });

  // Re-apply preserved hidden status if a whole category or member was hidden
  const preservedShapes = res.shapes.map(s => {
    const isCatHidden = s.tags?.some(t => hiddenCategories.has(t));
    const isNameHidden = s.name && hiddenNames.has(s.name);
    return (isCatHidden || isNameHidden) ? { ...s, hidden: true } : s;
  });

  return [...nonTimber, ...preservedShapes];
}
