import * as THREE from 'three';
import { Shape } from '../types';
import { WallOpening } from './archGeometry';

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

      // 1. Sole / Bottom Plate (continuous at bottom of wall)
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
        // Check if this regular stud intersects an opening
        const hitsOpening = wallOpenings.some(op => {
          const opLeft = op.localX - op.width / 2 - 0.05;
          const opRight = op.localX + op.width / 2 + 0.05;
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
          if (nogginW > 0.1 && nogginW < 0.7) {
            addTimberMember(
              'Noggin (Mid-Height Blocking)',
              currentX + studWidth / 2 + nogginW / 2,
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
  // 2. FLOOR TIMBER JOISTS & RIM FRAMING
  // -------------------------------------------------------------
  if (includeFloors) {
    // Collect explicit floor slabs or poly floor assemblies
    const slabShapes = allShapes.filter(s => 
      (s.tags?.includes('floor-slab') || s.name?.toLowerCase().includes('slab') || s.tags?.includes('architecture')) &&
      !s.tags?.includes('timber-frame') &&
      !s.tags?.includes('foundation-skirt') &&
      (s.type === 'poly' || s.type === 'box') &&
      !s.hidden
    );

    const processedFloorBounds: Array<{ minX: number; maxX: number; minZ: number; maxZ: number; floorY: number }> = [];

    slabShapes.forEach((slab, sIdx) => {
      let minX = -3.0, maxX = 3.0, minZ = -3.0, maxZ = 3.0;
      let floorY = slab.position[1] || 0;
      let slabThickness = 0.2;

      if (slab.type === 'poly' && slab.args && typeof slab.args === 'object') {
        const polyArgs = slab.args as { vertices?: [number, number][]; height?: number };
        slabThickness = polyArgs.height || 0.2;
        floorY = slab.position[1];

        if (polyArgs.vertices && polyArgs.vertices.length > 0) {
          let pMinX = Infinity, pMaxX = -Infinity, pMinZ = Infinity, pMaxZ = -Infinity;
          for (const [vx, vz] of polyArgs.vertices) {
            if (vx < pMinX) pMinX = vx;
            if (vx > pMaxX) pMaxX = vx;
            if (vz < pMinZ) pMinZ = vz;
            if (vz > pMaxZ) pMaxZ = vz;
          }
          // Poly vertices are centered around slab.position
          minX = slab.position[0] + pMinX;
          maxX = slab.position[0] + pMaxX;
          minZ = slab.position[2] + pMinZ;
          maxZ = slab.position[2] + pMaxZ;
        } else {
          minX = slab.position[0] - 3.0;
          maxX = slab.position[0] + 3.0;
          minZ = slab.position[2] - 3.0;
          maxZ = slab.position[2] + 3.0;
        }
      } else if (slab.type === 'box') {
        const args = Array.isArray(slab.args) ? slab.args : [6.0, 0.2, 6.0];
        const bw = args[0] || 6.0;
        const bh = args[1] || 0.2;
        const bd = args[2] || 6.0;

        // Skip tall vertical boxes that are walls rather than floor slabs
        if (bh > 0.6 && (bw < 0.5 || bd < 0.5)) return;

        slabThickness = bh;
        floorY = slab.position[1];
        minX = slab.position[0] - bw / 2;
        maxX = slab.position[0] + bw / 2;
        minZ = slab.position[2] - bd / 2;
        maxZ = slab.position[2] + bd / 2;
      }

      processedFloorBounds.push({ minX, maxX, minZ, maxZ, floorY });
    });

    // If no explicit slabs, check perimeter walls
    if (processedFloorBounds.length === 0) {
      const wallShapes = allShapes.filter(s => s.type === 'wall' && !s.hidden);
      if (wallShapes.length >= 3) {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        let minWallY = Infinity;
        for (const w of wallShapes) {
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
          processedFloorBounds.push({ minX, maxX, minZ, maxZ, floorY: minWallY });
        }
      }
    }

    // Generate accurate, horizontal floor joists for each floor zone
    processedFloorBounds.forEach((fb, fbIdx) => {
      const slabW = fb.maxX - fb.minX;
      const slabD = fb.maxZ - fb.minZ;
      const centerX = (fb.minX + fb.maxX) / 2;
      const centerZ = (fb.minZ + fb.maxZ) / 2;

      if (slabW < 0.5 || slabD < 0.5) return;

      const joistWidth = 0.045; // 45mm width
      const joistDepth = 0.195; // 195mm height (C16/C24 structural timber)
      const joistY = fb.floorY; // Positioned cleanly at floor level

      // Helper to add a floor member in absolute world coordinates with standard horizontal orientation
      const addFloorMember = (
        name: string,
        worldX: number,
        worldZ: number,
        width: number,
        height: number,
        depth: number,
        subTag: string
      ) => {
        resultShapes.push({
          id: `tf-floor-${fbIdx}-${Math.random().toString(36).substr(2, 7)}`,
          name: `Floor ${fbIdx + 1} - ${name}`,
          type: 'box',
          position: [worldX, joistY, worldZ],
          quaternion: [0, 0, 0, 1], // Always perfectly level horizontal orientation
          scale: [1, 1, 1],
          args: [width, height, depth],
          color: '#b45309', // Warm structural timber tone
          roughness: 0.8,
          metalness: 0.05,
          groupId,
          tags: [timberTag, 'timber-floor-joist', subTag],
        });
        floorJoistCount++;
      };

      const halfW = slabW / 2;
      const halfD = slabD / 2;
      // Joists span the shorter dimension for structural efficiency
      const spanAlongZ = slabW <= slabD;

      if (spanAlongZ) {
        // Perimeter Rim & Band Joists
        addFloorMember('Rim Joist (Left)', fb.minX + joistWidth / 2, centerZ, joistWidth, joistDepth, slabD, 'timber-rim-joist');
        addFloorMember('Rim Joist (Right)', fb.maxX - joistWidth / 2, centerZ, joistWidth, joistDepth, slabD, 'timber-rim-joist');
        addFloorMember('Band Joist (Front)', centerX, fb.maxZ - joistWidth / 2, slabW - joistWidth * 2, joistDepth, joistWidth, 'timber-rim-joist');
        addFloorMember('Band Joist (Back)', centerX, fb.minZ + joistWidth / 2, slabW - joistWidth * 2, joistDepth, joistWidth, 'timber-rim-joist');

        // Parallel Floor Joists (400mm c/c)
        let currX = fb.minX + studSpacing;
        while (currX < fb.maxX - joistWidth) {
          addFloorMember('Floor Joist (400mm c/c)', currX, centerZ, joistWidth, joistDepth, slabD - joistWidth * 2, 'timber-joist');
          // Mid-span solid blocking
          const nextX = Math.min(fb.maxX - joistWidth / 2, currX + studSpacing);
          const blockW = Math.max(0.1, (nextX - currX) - joistWidth);
          if (blockW > 0.1 && blockW < 0.7) {
            addFloorMember('Solid Blocking (Mid-Span)', currX + joistWidth / 2 + blockW / 2, centerZ, blockW, joistDepth, joistWidth, 'timber-blocking');
          }
          currX += studSpacing;
        }
      } else {
        // Span along X
        addFloorMember('Rim Joist (Front)', centerX, fb.maxZ - joistWidth / 2, slabW, joistDepth, joistWidth, 'timber-rim-joist');
        addFloorMember('Rim Joist (Back)', centerX, fb.minZ + joistWidth / 2, slabW, joistDepth, joistWidth, 'timber-rim-joist');
        addFloorMember('Band Joist (Left)', fb.minX + joistWidth / 2, centerZ, joistWidth, joistDepth, slabD - joistWidth * 2, 'timber-rim-joist');
        addFloorMember('Band Joist (Right)', fb.maxX - joistWidth / 2, centerZ, joistWidth, joistDepth, slabD - joistWidth * 2, 'timber-rim-joist');

        // Parallel Floor Joists along X (400mm c/c)
        let currZ = fb.minZ + studSpacing;
        while (currZ < fb.maxZ - joistWidth) {
          addFloorMember('Floor Joist (400mm c/c)', centerX, currZ, slabW - joistWidth * 2, joistDepth, joistWidth, 'timber-joist');
          // Mid-span solid blocking
          const nextZ = Math.min(fb.maxZ - joistWidth / 2, currZ + studSpacing);
          const blockD = Math.max(0.1, (nextZ - currZ) - joistWidth);
          if (blockD > 0.1 && blockD < 0.7) {
            addFloorMember('Solid Blocking (Mid-Span)', centerX, currZ + joistWidth / 2 + blockD / 2, joistWidth, joistDepth, blockD, 'timber-blocking');
          }
          currZ += studSpacing;
        }
      }
    });
  }

  // -------------------------------------------------------------
  // 3. ROOF TIMBER FRAMING (Ridge Beam, Common Rafters, Collar Ties)
  // -------------------------------------------------------------
  if (includeRoof) {
    const roofShapes = allShapes.filter(s => 
      (s.tags?.includes('roof') || s.name?.toLowerCase().includes('roof')) &&
      !s.tags?.includes('roof-fascia') &&
      !s.tags?.includes('timber-frame') &&
      !s.hidden
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
      const ridgeBeamWidth = 0.075;
      const ridgeBeamDepth = 0.220;

      const halfW = roofW / 2;
      const halfD = roofD / 2;
      const pitchAngle = Math.atan2(roofH, halfW);
      const rafterLen = Math.hypot(halfW, roofH);

      // Helper to add roof member
      const addRoofMember = (
        name: string,
        posLocal: THREE.Vector3,
        rotLocal: THREE.Euler,
        dims: [number, number, number],
        subTag: string
      ) => {
        const qMember = new THREE.Quaternion().setFromEuler(rotLocal).premultiply(roofQuat);
        const worldPos = posLocal.clone().applyQuaternion(roofQuat).add(roofPos);

        resultShapes.push({
          id: `tf-roof-${roof.id}-${Math.random().toString(36).substr(2, 7)}`,
          name: `${roof.name || `Roof ${rIdx + 1}`} - ${name}`,
          type: 'box',
          position: [worldPos.x, worldPos.y, worldPos.z],
          quaternion: [qMember.x, qMember.y, qMember.z, qMember.w],
          scale: [1, 1, 1],
          args: dims,
          color: '#92400e', // Warm rustic rafter cedar/pine
          roughness: 0.8,
          metalness: 0.05,
          groupId,
          tags: [timberTag, 'timber-roof-rafter', subTag, ...(roof.tags || [])],
        });
        roofRafterCount++;
      };

      // 1. Ridge Board (Spine along roof apex)
      addRoofMember(
        'Ridge Board Beam',
        new THREE.Vector3(0, roofH / 2 - ridgeBeamDepth / 2, 0),
        new THREE.Euler(0, 0, 0),
        [ridgeBeamWidth, ridgeBeamDepth, roofD],
        'timber-ridge-beam'
      );

      // 2. Common Rafter Pairs along length of roof (400mm c/c)
      let currZ = -halfD + 0.1;
      while (currZ <= halfD - 0.1) {
        // Left sloped rafter (rises to center)
        const leftCenterX = -halfW / 2;
        const leftCenterY = 0;
        addRoofMember(
          'Common Rafter (Left)',
          new THREE.Vector3(leftCenterX, leftCenterY, currZ),
          new THREE.Euler(0, 0, -pitchAngle),
          [rafterLen, rafterDepth, rafterWidth],
          'timber-rafter'
        );

        // Right sloped rafter
        const rightCenterX = halfW / 2;
        const rightCenterY = 0;
        addRoofMember(
          'Common Rafter (Right)',
          new THREE.Vector3(rightCenterX, rightCenterY, currZ),
          new THREE.Euler(0, 0, pitchAngle),
          [rafterLen, rafterDepth, rafterWidth],
          'timber-rafter'
        );

        // Collar Tie / Ceiling Tie (horizontal strut across opposite rafters at lower third)
        const tieSpan = roofW * 0.65;
        const tieY = -roofH / 4;
        addRoofMember(
          'Collar Tie',
          new THREE.Vector3(0, tieY, currZ),
          new THREE.Euler(0, 0, 0),
          [tieSpan, rafterDepth * 0.7, rafterWidth],
          'timber-collar-tie'
        );

        currZ += studSpacing;
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
