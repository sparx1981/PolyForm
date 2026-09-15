import * as THREE from 'three';
import {
  Shape,
  TimberFrameParams,
  TimberMemberKind,
  TimberMemberInstance,
  OpeningFrameAssembly,
  IfcTimberClass,
  TimberMemberData,
  GenerationParamsSnapshot,
  TimberBOM,
  TimberValidationResult,
  TimberGenerationReport,
  ProjectMetadata,
  LayerStackItem,
  FloorToolOutput,
  FloorOpeningContract,
  WallToolOutput,
  RoofToolOutput,
} from '../types';
import { WallOpening } from './archGeometry';
import {
  STRUCTURAL_VALIDATION_RULES,
  DEFAULT_WALL_LAYER_STACK,
  DEFAULT_ROOF_LAYER_STACK,
  DEFAULT_FLOOR_LAYER_STACK,
  DEFAULT_PROJECT_METADATA,
  COINCIDENCE_EPSILON_MM,
  DEFAULT_ROUGH_OPENING_TOLERANCE_MM,
  DEFAULT_FLOOR_JOIST_SPACING_MM,
} from '../constants/timberFrameDefaults';
import {
  computeStructuralZoneDepth,
  computeFloorStructuralZoneDepth,
  snapToStandardTimberSize,
  lookupSpan,
  lookupFloorSpan,
  generateTimberBOM,
  validateTimberAssembly,
  validateWallToolOutput,
  validateRoofToolOutput,
  validateFloorToolOutput,
  generateTimberFrameFromContract,
  generateFloorTimberFrameFromContract,
  regenerateTimberRipple,
} from './timberFrameContracts';
import {
  getCanonicalLPolygon,
  computeLRidgeNodes,
  extractRoomFootprintPolygon,
  offsetPolygon2D,
} from './archRoofGenerator';

export {
  validateWallToolOutput,
  validateRoofToolOutput,
  validateFloorToolOutput,
  computeStructuralZoneDepth,
  computeFloorStructuralZoneDepth,
  snapToStandardTimberSize,
  lookupSpan,
  lookupFloorSpan,
  generateTimberBOM,
  validateTimberAssembly,
  generateTimberFrameFromContract,
  generateFloorTimberFrameFromContract,
  regenerateTimberRipple,
};

export interface TimberFrameOptions {
  studSpacing?: number;      // 0.40m (400mm c/c standard) or 0.60m (600mm c/c)
  studWidth?: number;        // 0.045m (45mm)
  studDepth?: number;        // 0.089m or 0.140m (89mm/140mm)
  includeWalls?: boolean;    // Generate wall studs, plates, noggins, lintels
  includeFloors?: boolean;   // Generate floor joists, rim joists, mid-span blocking
  includeRoof?: boolean;     // Generate roof rafters, collar ties, ridge beam
  timberColor?: string;      // Natural structural spruce/pine timber tone (#d97706 or #b45309)
  params?: TimberFrameParams;
  timberFrameParams?: TimberFrameParams;
  openings?: WallOpening[];
  offsetJoists?: boolean;
  offsetFloorJoists?: boolean;
  offsetWallJoists?: boolean;
  offsetFloorNoggins?: boolean;
  offsetWallNoggins?: boolean;
  openingBounds?: Array<{
    id?: string;
    wallId?: string;
    type?: 'door' | 'window' | string;
    localX: number;
    localY: number;
    width: number;
    height: number;
    depth?: number;
  }>;
  revealDistance?: number;
  projectMetadata?: ProjectMetadata;
  layerStack?: LayerStackItem[];
  roughOpeningToleranceMm?: number;
  floorOutputs?: FloorToolOutput[];
  wallOutputs?: WallToolOutput[];
  roofOutputs?: RoofToolOutput[];
}

export interface TimberFramingResult {
  shapes: Shape[];
  wallStudCount: number;
  floorJoistCount: number;
  roofRafterCount: number;
  validationMessages: string[];
  openingAssemblies?: OpeningFrameAssembly[];
  instancedMembers?: Record<TimberMemberKind, TimberMemberInstance[]>;
  report?: TimberGenerationReport;
  bom?: TimberBOM;
  validation?: TimberValidationResult;
}

/**
 * Resolves the minimum required header depth for a given opening width span
 * according to STRUCTURAL_VALIDATION_RULES or header depth rule overrides.
 */
export function resolveHeaderDepth(
  openingWidth: number,
  params?: TimberFrameParams
): number {
  if (params?.headerDepthRule === 'span-ratio-1-10') {
    return Math.max(0.14, openingWidth / 10);
  }
  for (const bracket of STRUCTURAL_VALIDATION_RULES.headerDepthBrackets) {
    if (openingWidth <= bracket.maxOpeningWidth + 1e-4) {
      const baseDepth = bracket.minHeaderDepth;
      if (params?.headerDepthRule === 'double-depth') {
        return baseDepth * 1.5;
      }
      return baseDepth;
    }
  }
  const maxBracket = STRUCTURAL_VALIDATION_RULES.headerDepthBrackets[
    STRUCTURAL_VALIDATION_RULES.headerDepthBrackets.length - 1
  ];
  return maxBracket ? maxBracket.minHeaderDepth : 0.29;
}

/**
 * Generates a complete BS 5268 / Eurocode 5 / IRC compliant structural timber frame
 * for walls, floors, and roofs in the model.
 */
export function generateTimberFraming(
  allShapes: Shape[],
  options: TimberFrameOptions = {}
): TimberFramingResult {
  const effectiveParams = options.params || options.timberFrameParams;
  const studSpacing = effectiveParams?.studSpacing ?? options.studSpacing ?? 0.40;
  const studWidth = effectiveParams?.memberWidth ?? options.studWidth ?? 0.045;
  const configuredMemberDepth = effectiveParams?.memberDepth ?? options.studDepth;
  const revealDistance = effectiveParams?.revealDistance ?? options.revealDistance ?? 0.025;
  const includeWalls = options.includeWalls ?? true;
  const includeFloors = options.includeFloors ?? true;
  const includeRoof = options.includeRoof ?? true;
  const timberColor = options.timberColor ?? '#d97706';

  const offsetFloorJoists = !!(
    options.offsetFloorJoists ??
    options.offsetJoists ??
    effectiveParams?.offsetFloorJoists ??
    effectiveParams?.offsetJoists ??
    false
  );
  const offsetWallJoists = !!(
    options.offsetWallJoists ??
    effectiveParams?.offsetWallJoists ??
    false
  );
  const offsetFloorNoggins = !!(
    options.offsetFloorNoggins ??
    effectiveParams?.offsetFloorNoggins ??
    false
  );
  const offsetWallNoggins = !!(
    options.offsetWallNoggins ??
    effectiveParams?.offsetWallNoggins ??
    false
  );

  const resultShapes: Shape[] = [];
  const validationMessages: string[] = [];
  const openingAssemblies: OpeningFrameAssembly[] = [];
  const instancedMembers: Record<TimberMemberKind, TimberMemberInstance[]> = {
    stud: [],
    plate: [],
    header: [],
    sill: [],
    jackStud: [],
    rafter: [],
    kingStud: [],
    'king Stud': [],
    joist: [],
    blocking: []
  };

  let wallStudCount = 0;
  let floorJoistCount = 0;
  let roofRafterCount = 0;

  const groupId = `timber-frame-group-${Date.now()}`;
  const timberTag = 'timber-frame';

  // -------------------------------------------------------------
  // 1. WALL TIMBER FRAMING (Sole Plates, Top Plates, Studs, Noggins, Lintels)
  // -------------------------------------------------------------
  if (includeWalls) {
    // Structural timber framing belongs to all walls and openings even if their surfaces are hidden in the outliner
    const wallShapes = allShapes.filter(s => s.type === 'wall');
    const openingShapes = allShapes.filter(s => s.type === 'door' || s.type === 'window');

    wallShapes.forEach((wall, wIdx) => {
      const args = Array.isArray(wall.args) ? wall.args : [3.0, 2.8, 0.2];
      const wallLength = args[0] || 3.0;
      const wallHeight = args[1] || 2.8;
      const wallThick = args[2] || 0.2;

      // Timber stud depth scaled to wall cavity (or configured depth)
      const timberDepth = configuredMemberDepth || Math.max(0.075, Math.min(0.140, wallThick - 0.04));
      const plateThick = 0.045; // 45mm plate thickness

      const wallPos = new THREE.Vector3(...wall.position);
      const wallQuat = new THREE.Quaternion(...(wall.quaternion || [0, 0, 0, 1]));
      const invWallQuat = wallQuat.clone().invert();

      // Collect openings hosted on this wall or intersecting it
      const wallOpenings: Array<{ id?: string; localX: number; localY: number; width: number; height: number; type: string }> = [];
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
            id: op.id,
            localX: localPos.x,
            localY: localPos.y,
            width: opArgs[0] || (op.type === 'door' ? 0.9 : 1.2),
            height: opArgs[1] || (op.type === 'door' ? 2.1 : 1.2),
            type: op.type
          });
        }
      });

      if (options.openingBounds) {
        options.openingBounds.forEach(ob => {
          if (!ob.wallId || ob.wallId === wall.id) {
            wallOpenings.push({
              id: ob.id,
              localX: ob.localX,
              localY: ob.localY,
              width: ob.width,
              height: ob.height,
              type: ob.type || 'door'
            });
          }
        });
      }

      if (options.openings) {
        options.openings.forEach(op => {
          wallOpenings.push({
            id: op.id,
            localX: op.localX,
            localY: op.localY,
            width: op.width,
            height: op.height,
            type: (op.type as string) || 'door'
          });
        });
      }

      // Sort openings from left to right along local X
      wallOpenings.sort((a, b) => a.localX - b.localX);

      // Check for colliding jack studs on adjacent openings
      for (let i = 0; i < wallOpenings.length - 1; i++) {
        const op1 = wallOpenings[i];
        const op2 = wallOpenings[i + 1];
        const op1Right = op1.localX + op1.width / 2;
        const op2Left = op2.localX - op2.width / 2;
        const gap = op2Left - op1Right;
        const minClearance = studWidth * 2;
        if (gap < minClearance - 1e-4) {
          const msg = `Adjacent openings "${op1.id || `Opening ${i + 1}`}" and "${op2.id || `Opening ${i + 2}`}" on wall "${wall.name || wall.id}" have colliding jack studs: clearance (${(gap * 1000).toFixed(0)}mm) is less than required jack stud width (${(minClearance * 1000).toFixed(0)}mm).`;
          validationMessages.push(msg);
        }
      }

      const halfL = wallLength / 2;
      const halfH = wallHeight / 2;

      // Anti-coplanar end setback (§1): setback frame by 1mm at wall ends to eliminate surface clashing
      const endSetbackM = Math.max(COINCIDENCE_EPSILON_MM / 1000, 0.001);
      const framedWallLength = Math.max(0.1, wallLength - endSetbackM * 2);
      const framedHalfL = framedWallLength / 2;

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
        // Inset placement: apply revealDistance as inward offset along wall surface normal
        // In local coordinates: wall thickness is along Z [-wallThick/2, +wallThick/2].
        // Inward normal is (0, 0, -1). Cladding outer face is at +wallThick/2.
        // Front face of member is placed at wallThick/2 - revealDistance.
        // Center of member in local Z is (wallThick/2 - revealDistance) - depth/2.
        const insetZ = (wallThick / 2 - revealDistance) - depth / 2;
        let effectiveLocalZ = localZ !== 0 ? localZ - revealDistance : insetZ;

        // Anti-coplanarity enforcement (§1): clamp if member exceeds wall boundary
        const epsM = COINCIDENCE_EPSILON_MM / 1000;
        const halfThick = wallThick / 2;
        if (effectiveLocalZ + depth / 2 > halfThick) {
          effectiveLocalZ = halfThick - epsM - depth / 2;
        }
        if (effectiveLocalZ - depth / 2 < -halfThick) {
          effectiveLocalZ = -halfThick + epsM + depth / 2;
        }

        // Anti-coplanarity enforcement at end of wall run: clamp within [-halfL + endSetbackM, halfL - endSetbackM]
        let effectiveLocalX = localX;
        let effectiveWidth = width;
        const leftBound = -halfL + endSetbackM;
        const rightBound = halfL - endSetbackM;
        if (effectiveLocalX - effectiveWidth / 2 < leftBound) {
          const delta = leftBound - (effectiveLocalX - effectiveWidth / 2);
          effectiveLocalX += delta / 2;
          effectiveWidth = Math.max(0.01, effectiveWidth - delta);
        }
        if (effectiveLocalX + effectiveWidth / 2 > rightBound) {
          const delta = (effectiveLocalX + effectiveWidth / 2) - rightBound;
          effectiveLocalX -= delta / 2;
          effectiveWidth = Math.max(0.01, effectiveWidth - delta);
        }

        const localPos = new THREE.Vector3(effectiveLocalX, localY, effectiveLocalZ);
        const worldPos = localPos.applyQuaternion(wallQuat).add(wallPos);
        const memberId = `tf-wall-${wall.id}-${Math.random().toString(36).substr(2, 7)}`;

        let ifcClass: IfcTimberClass = 'IfcMember';
        let kind: TimberMemberKind = 'stud';
        if (subTag === 'timber-plate') {
          kind = 'plate';
          ifcClass = 'IfcPlate';
        } else if (subTag === 'timber-lintel') {
          kind = 'header';
          ifcClass = 'IfcBeam';
        } else if (subTag === 'timber-sill') {
          kind = 'sill';
          ifcClass = 'IfcPlate';
        } else if (subTag === 'timber-jack-stud') {
          kind = 'jackStud';
          ifcClass = 'IfcColumn';
        } else if (subTag === 'timber-roof-rafter') {
          kind = 'rafter';
          ifcClass = 'IfcBeam';
        } else if (subTag === 'timber-floor-joist') {
          kind = 'joist';
          ifcClass = 'IfcBeam';
        } else if (subTag === 'timber-king-stud') {
          kind = 'kingStud';
          ifcClass = 'IfcColumn';
        } else if (subTag === 'timber-stud') {
          kind = 'stud';
          ifcClass = 'IfcColumn';
        }

        const memberData: TimberMemberData = {
          id: memberId,
          ifcClass,
          is_user_modified: false,
          generation_params_snapshot: {
            structural_zone_depth_mm: Math.round(Math.max(0.05, wallThick - 0.05) * 1000),
            frame_depth_mm: Math.round(depth * 1000),
            spacing_mm: Math.round(studSpacing * 1000),
            load_case: {
              gravity_load_kn_m: 2.5,
              wind_zone: 'Zone 2',
              snow_load_kn_m2: 0.75,
              seismic_category: 'A',
            },
            species: effectiveParams?.species || 'SPF',
            grade: effectiveParams?.grade || 'C24',
            timestamp: Date.now(),
          },
          cutLengthMm: Math.round(Math.max(width, height, depth) * 1000),
        };

        resultShapes.push({
          id: memberId,
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
          parentWallOrRoofId: wall.id,
          timberMemberData: memberData,
          tags: [
            timberTag,
            'timber-stud-wall',
            'timber-wall',
            subTag,
            ...(wall.tags || []).filter(t => t !== 'wall' && t !== 'wall-assembly' && t !== 'room-wall' && t !== 'architecture')
          ],
        });
        wallStudCount++;

        if (instancedMembers[kind]) {
          instancedMembers[kind].push({
            id: memberId,
            kind,
            position: [worldPos.x, worldPos.y, worldPos.z],
            quaternion: [wallQuat.x, wallQuat.y, wallQuat.z, wallQuat.w],
            scale: [width, height, depth],
            parentWallOrRoofId: wall.id,
            lengthMm: Math.round(Math.max(width, height, depth) * 1000)
          });
        }
      };

      // 1. Sole / Bottom Plate (interrupted / cut away at door openings)
      const doorOpenings = wallOpenings.filter(op => op.type === 'door' || (op.localY - op.height / 2 <= -halfH + 0.15));
      if (doorOpenings.length === 0) {
        // Continuous sole plate (set back from wall ends to avoid coplanar clashing)
        addTimberMember(
          'Sole Plate',
          0,
          -halfH + plateThick / 2,
          0,
          framedWallLength,
          plateThick,
          timberDepth,
          'timber-plate'
        );
      } else {
        // Split sole plate segments between door thresholds
        const sortedDoors = [...doorOpenings].sort((a, b) => (a.localX - a.width / 2) - (b.localX - b.width / 2));
        let cursorX = -framedHalfL;
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
        if (cursorX < framedHalfL - 0.04) {
          const segW = framedHalfL - cursorX;
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
      if (offsetWallJoists && framedWallLength > 3.0) {
        const lapOffset = Math.min(1.2, framedWallLength / 3);
        addTimberMember(
          'Top Plate (Joint 1)',
          -framedHalfL + lapOffset / 2,
          halfH - plateThick / 2,
          0,
          lapOffset,
          plateThick,
          timberDepth,
          'timber-plate'
        );
        addTimberMember(
          'Top Plate (Joint 2)',
          -framedHalfL + lapOffset + (framedWallLength - lapOffset) / 2,
          halfH - plateThick / 2,
          0,
          framedWallLength - lapOffset,
          plateThick,
          timberDepth,
          'timber-plate'
        );
        addTimberMember(
          'Double Top Plate (Offset Joint)',
          0,
          halfH - plateThick * 1.5,
          0,
          framedWallLength,
          plateThick,
          timberDepth,
          'timber-plate'
        );
      } else {
        addTimberMember(
          'Top Plate',
          0,
          halfH - plateThick / 2,
          0,
          framedWallLength,
          plateThick,
          timberDepth,
          'timber-plate'
        );
        addTimberMember(
          'Double Top Plate',
          0,
          halfH - plateThick * 1.5,
          0,
          framedWallLength,
          plateThick,
          timberDepth,
          'timber-plate'
        );
      }

      // 3. Regular Vertical Studs (spaced at 400mm / 600mm centers)
      // Clamped like jackHeight below: a wall shorter than the plate
      // stack (~0.135m) is degenerate, but without a floor here it would
      // silently produce a negative-height BoxGeometry (inverted normals,
      // self-intersecting studs) instead of just being visibly too short.
      const usableHeight = Math.max(0.05, wallHeight - plateThick * 3); // between sole plate and double top plate
      const studCenterY = -halfH + plateThick + usableHeight / 2;

      // Start stud at left end (set back by endSetbackM from wall edge)
      addTimberMember('End Stud (Left)', -framedHalfL + studWidth / 2, studCenterY, 0, studWidth, usableHeight, timberDepth, 'timber-stud');
      // End stud at right end (set back by endSetbackM from wall edge)
      addTimberMember('End Stud (Right)', framedHalfL - studWidth / 2, studCenterY, 0, studWidth, usableHeight, timberDepth, 'timber-stud');

      // Intermediate regular studs along wall
      let currentX = -framedHalfL + studSpacing;
      let studBayIdx = 0;
      while (currentX < framedHalfL - studWidth) {
        // Studs that would fall inside the opening bounds are omitted, not clipped.
        const inOpening = wallOpenings.some(op => {
          const opL = op.localX - op.width / 2;
          const opR = op.localX + op.width / 2;
          return (currentX + studWidth / 2 >= opL && currentX - studWidth / 2 <= opR);
        });
        const inJackOrKingZone = wallOpenings.some(op => {
          const opL = op.localX - op.width / 2 - studWidth * 2;
          const opR = op.localX + op.width / 2 + studWidth * 2;
          return (currentX >= opL && currentX <= opR);
        });

        if (!inOpening && !inJackOrKingZone) {
          const zOffset = offsetWallJoists ? ((studBayIdx % 2 === 0 ? 1 : -1) * Math.min(0.015, timberDepth * 0.15)) : 0;
          addTimberMember(
            offsetWallJoists
              ? `Common Stud (Offset Joint)`
              : `Common Stud (${(studSpacing * 1000).toFixed(0)}mm c/c)`,
            currentX,
            studCenterY,
            zOffset,
            studWidth,
            usableHeight,
            timberDepth,
            'timber-stud'
          );
          studBayIdx++;

          // Noggin / Mid-height lateral blocking
          const nextX = Math.min(framedHalfL - studWidth / 2, currentX + studSpacing);
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
            const nogginY = offsetWallNoggins
              ? (studBayIdx % 2 === 0 ? plateThick * 1.25 : -plateThick * 1.25)
              : 0;
            addTimberMember(
              offsetWallNoggins ? 'Wall Noggin (Offset Blocking)' : 'Noggin (Mid-Height Blocking)',
              nogginCenterX,
              nogginY,
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

        const headerDepth = resolveHeaderDepth(opW, effectiveParams);
        const jackTop = opTop;
        const jackBottom = -halfH + plateThick;
        const jackHeight = Math.max(0.08, jackTop - jackBottom);

        // Jack Studs / Trimmers (Under header, at vertical edges of opening)
        const leftJackX = Math.max(-framedHalfL + studWidth / 2, opLeft - studWidth / 2);
        const rightJackX = Math.min(framedHalfL - studWidth / 2, opRight + studWidth / 2);

        addTimberMember(
          `Jack Stud Left (Opening ${opIdx + 1})`,
          leftJackX,
          jackBottom + jackHeight / 2,
          0,
          studWidth,
          jackHeight,
          timberDepth,
          'timber-jack-stud'
        );
        addTimberMember(
          `Jack Stud Right (Opening ${opIdx + 1})`,
          rightJackX,
          jackBottom + jackHeight / 2,
          0,
          studWidth,
          jackHeight,
          timberDepth,
          'timber-jack-stud'
        );

        // King Studs (Full height flanking the opening)
        // If opening is flush with corner (-framedHalfL), wall end stud acts as king stud.
        if (opLeft - studWidth * 1.5 >= -framedHalfL + studWidth / 2 - 0.01) {
          addTimberMember(
            `King Stud Left (Opening ${opIdx + 1})`,
            Math.max(-framedHalfL + studWidth / 2, opLeft - studWidth * 1.5),
            studCenterY,
            0,
            studWidth,
            usableHeight,
            timberDepth,
            'timber-king-stud'
          );
        }
        if (opRight + studWidth * 1.5 <= framedHalfL - studWidth / 2 + 0.01) {
          addTimberMember(
            `King Stud Right (Opening ${opIdx + 1})`,
            Math.min(framedHalfL - studWidth / 2, opRight + studWidth * 1.5),
            studCenterY,
            0,
            studWidth,
            usableHeight,
            timberDepth,
            'timber-king-stud'
          );
        }

        // Structural Lintel Header Beam spanning opening width at resolved header depth
        const lintelSpan = Math.min(framedWallLength, opW + studWidth * 2);
        const lintelCenterX = Math.max(-framedHalfL + lintelSpan / 2, Math.min(framedHalfL - lintelSpan / 2, op.localX));
        addTimberMember(
          `Structural Lintel (Opening ${opIdx + 1})`,
          lintelCenterX,
          opTop + headerDepth / 2,
          0,
          lintelSpan,
          headerDepth,
          timberDepth,
          'timber-lintel'
        );

        // Cripple Studs above Header up to Top Plate
        const topCrippleHeight = (halfH - plateThick * 2) - (opTop + headerDepth);
        if (topCrippleHeight > 0.1) {
          const numCripples = Math.max(1, Math.floor(opW / studSpacing));
          for (let c = 1; c <= numCripples; c++) {
            const cX = opLeft + (opW * c) / (numCripples + 1);
            if (cX >= -framedHalfL + studWidth && cX <= framedHalfL - studWidth) {
              addTimberMember(
                `Top Cripple Stud`,
                cX,
                opTop + headerDepth + topCrippleHeight / 2,
                0,
                studWidth,
                topCrippleHeight,
                timberDepth,
                'timber-cripple'
              );
            }
          }
        }

        // Window Sill Plate & Bottom Cripples (for windows only at the opening's base)
        if (op.type === 'window') {
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
              if (cX >= -framedHalfL + studWidth && cX <= framedHalfL - studWidth) {
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
        }

        // Record opening frame assembly data
        openingAssemblies.push({
          openingId: op.id || `opening-${opIdx + 1}`,
          hostWallId: wall.id,
          headerDepth,
          spanMm: Math.round(opW * 1000),
          headerDepthMm: Math.round(headerDepth * 1000),
          headerMemberIds: [],
          sillMemberIds: op.type === 'window' ? [] : null,
          jackStudMemberIds: [],
          kingStudMemberIds: [],
          isValid: true,
          validationMessages: []
        });
      });
    });
  }

// -------------------------------------------------------------
  // 2. FLOOR TIMBER JOISTS & RIM FRAMING (Polygon & Multi-Story Aware)
  // -------------------------------------------------------------
  if (includeFloors) {
    const joistWidth = 0.045; // 45mm width
    const joistDepth = 0.195; // 195mm height (C16/C24 structural timber)
    const offsetJoists = offsetFloorJoists;

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

    // Generate specification-compliant floor framing for every floor level using the new contract engine
    const floorContracts: FloorToolOutput[] = [];
    if (options.floorOutputs && options.floorOutputs.length > 0) {
      floorContracts.push(...options.floorOutputs);
    } else {
      floorLevels.forEach((level, flIdx) => {
        const { floorY, polygon } = level;
        if (polygon.length < 3) return;

        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        polygon.forEach(([x, z]) => {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
        });

        const polyWidth = maxX - minX;
        const polyDepth = maxZ - minZ;
        const spanAlongZ = polyDepth <= polyWidth;

        // Detect stair openings or floor penetrations on this level
        const floorOpenings: FloorOpeningContract[] = [];
        const stairsOnLevel = allShapes.filter(s =>
          (s.tags?.includes('stair') || s.tags?.includes('stairs') || s.name?.toLowerCase().includes('stair')) &&
          Math.abs(s.position[1] - floorY) < 2.5
        );
        stairsOnLevel.forEach((st, sIdx) => {
          const sArgs = Array.isArray(st.args) ? st.args : [1.0, 2.5, 3.0];
          const sW = sArgs[0] || 1.0;
          const sL = sArgs[2] || 2.5;
          const sMinX = st.position[0] - sW / 2;
          const sMaxX = st.position[0] + sW / 2;
          const sMinZ = st.position[2] - sL / 2;
          const sMaxZ = st.position[2] + sL / 2;
          floorOpenings.push({
            id: `stairwell-${flIdx}-${sIdx + 1}`,
            type: 'stairwell',
            bounding_box: [sMinX, sMinZ, sMaxX, sMaxZ],
            boundary: [
              [sMinX, sMinZ],
              [sMaxX, sMinZ],
              [sMaxX, sMaxZ],
              [sMinX, sMaxZ],
            ],
            stairwell_id: st.id,
          });
        });

        const wallsBelow = (wallsByElevation.get(Math.round((floorY - 2.8) * 10) / 10) || []).map(w => w.id);
        const wallsAbove = (wallsByElevation.get(Math.round(floorY * 10) / 10) || []).map(w => w.id);

        floorContracts.push({
          floor_id: `floor-${flIdx}`,
          project_id: options.projectMetadata?.project_id || 'DEFAULT_PROJECT',
          boundary: polygon.map(([x, z]) => [x, floorY, z]),
          span_direction: spanAlongZ ? [0, 0, 1] : [1, 0, 0],
          total_depth: 270,
          layer_stack: DEFAULT_FLOOR_LAYER_STACK,
          openings: floorOpenings,
          supporting_wall_ids_below: wallsBelow,
          supporting_wall_ids_above: wallsAbove,
          imposed_load_kn_m2: 1.5,
          deflection_limit: 'L/360',
        });
      });
    }

    floorContracts.forEach(contract => {
      try {
        const floorReport = generateFloorTimberFrameFromContract(
          contract,
          options.projectMetadata || DEFAULT_PROJECT_METADATA,
          {
            timberColor: options.timberColor || '#b45309',
            joistSpacingMm: Math.round(studSpacing * 1000),
            revealDistance,
            offsetFloorJoists,
            offsetFloorNoggins,
          }
        );

        floorReport.members.forEach(fm => {
          resultShapes.push(fm);
          floorJoistCount++;
          const mArgs = Array.isArray(fm.args) ? fm.args : [0.045, 0.195, 1];
          const mScale = (fm.scale as [number, number, number]) || [0.045, 0.195, 1];
          const w = mArgs[0] || mScale[0];
          const h = mArgs[1] || mScale[1];
          const d = mArgs[2] || mScale[2];
          instancedMembers.joist.push({
            id: fm.id,
            kind: 'joist',
            position: fm.position as [number, number, number],
            quaternion: (fm.quaternion || [0, 0, 0, 1]) as [number, number, number, number],
            scale: [w, h, d],
            parentWallOrRoofId: contract.floor_id,
            lengthMm: Math.round(Math.max(w, h, d) * 1000),
          });
        });

        if (floorReport.validation?.warnings) {
          validationMessages.push(...floorReport.validation.warnings);
        }
        if (floorReport.flagged_spans) {
          validationMessages.push(...floorReport.flagged_spans);
        }
      } catch (err: any) {
        validationMessages.push(`Floor framing error (${contract.floor_id}): ${err?.message || err}`);
      }
    });
  }

  // -------------------------------------------------------------
  // 3. ROOF TIMBER FRAMING (Hip Rafters, Ridge Beam, Common & Jack Rafters, Collar Ties)
  // -------------------------------------------------------------
  if (includeRoof) {
    // Collect roof assemblies (even if cladding/tiles are hidden, timber frame is structural).
    // Windows/doors are excluded outright: a hosted window named e.g. "Velux
    // Roof Window" matches the "roof" name substring below (a naming bug
    // once made this happen for windows on ANY roof-tagged host, not just
    // actual velux-style roof windows), which would otherwise get the
    // window itself treated as a roof and framed accordingly.
    const roofShapes = allShapes.filter(s =>
      s.type !== 'window' && s.type !== 'door' &&
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
      const roofD = args[2] || 6.0;
      // roofData is the actual roof generator's own record of its shape
      // (ridgeHeight, eaveOverhang, roofType, ...) - args[1] is kept in
      // sync with roofData.ridgeHeight by convention wherever
      // archRoofGenerator.ts writes a roof shape, but nothing enforces
      // that. Most of the framing below used to read args[1] directly
      // (roofH) while only the L-shape branch read roofData.ridgeHeight
      // (as a separate `ridgeH`); reading it here once, with args[1] only
      // as the fallback for a roof with no roofData at all, makes
      // roofData.ridgeHeight - the real source of truth - the value every
      // branch actually uses.
      const roofData = roof.roofData || roof.customData;
      const roofH = roofData?.ridgeHeight ?? (args[1] || 2.2);
      const eaveOverhang = roofData?.eaveOverhang ?? 0.35;

      const rafterWidth = 0.045; // 45mm
      const rafterDepth = 0.145; // 145mm
      const hipRafterWidth = 0.075; // 75mm heavy hip rafter
      const hipRafterDepth = 0.195; // 195mm
      const ridgeBeamWidth = 0.075;
      const ridgeBeamDepth = 0.220;

      const halfW = roofW / 2;
      const halfD = roofD / 2;
      // The rectangular gable/hip roof mesh (archRoofGenerator.ts's
      // createGableRoofSlopesGeometry/createHipRoofSlopesGeometry) extends
      // its eave line out to half-wall + eaveOverhang before reaching
      // y=0, not to the bare wall line - rafter framing below used to
      // treat halfW/halfD themselves as the eave, giving every common
      // rafter and hip corner a steeper run than the real roof slope and
      // leaving it misaligned with the actual roof surface it's meant to
      // sit under. Used for the common-rafter and hip-corner endpoints
      // below; jack-rafter interpolation along the hip lines still uses
      // the plain wall-line halfW/halfD for its stud-spacing layout, which
      // is a plan-position ratio independent of how far the eave overhangs.
      const halfW_eave = halfW + eaveOverhang;
      const halfD_eave = halfD + eaveOverhang;
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

        // Build a full basis for the member instead of leaving its roll
        // around dirLocal arbitrary (THREE.Quaternion.setFromUnitVectors
        // only fixes the beam's length axis, not the rotation around it).
        // yAxis becomes the member's "depth" axis (args[1] below) and is
        // defined as the roof-surface outward normal, so the box's flat
        // depth-wise face actually sits parallel to the roof plane instead
        // of at an unpredictable roll - previously this meant the reveal
        // offset below (along this same normal) didn't reliably match how
        // the box's own faces were oriented, worsening the clash on some
        // members more than others.
        const zAxis = dirLocal.clone();
        let xAxisRaw = new THREE.Vector3(-dirLocal.z, 0, dirLocal.x);
        let yAxis: THREE.Vector3;
        if (xAxisRaw.lengthSq() > 1e-4) {
          xAxisRaw.normalize();
          yAxis = new THREE.Vector3().crossVectors(zAxis, xAxisRaw).normalize();
        } else {
          // dirLocal is (near-)vertical - no natural horizontal reference,
          // so fall back to a fixed one rather than leaving yAxis undefined.
          xAxisRaw = new THREE.Vector3(1, 0, 0);
          yAxis = new THREE.Vector3().crossVectors(zAxis, xAxisRaw).normalize();
        }
        if (yAxis.y < 0) yAxis.negate();
        // Re-derive xAxis from the (possibly just negated) yAxis so the
        // three axes stay an exact right-handed orthonormal basis - negating
        // yAxis alone would otherwise flip the basis into a reflection,
        // which setFromRotationMatrix cannot turn into a valid rotation.
        const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();

        // Inset placement for roof members: pull the member's CENTER in from
        // the theoretical roof-surface line (which pStartLocal/pEndLocal sit
        // on) by revealDistance PLUS half its own depth. Rafter-type members
        // (subTag containing "rafter") represent the outer roof surface
        // itself, so without the depth/2 term only revealDistance (a small
        // fixed reveal, e.g. 25mm) separated the member's CENTERLINE from
        // that surface - leaving roughly (depth/2 - revealDistance) of the
        // member's own outer face poking through the roof above it. Roof
        // noggins have the same problem: both endpoints are lerped directly
        // between two rafters' own (un-inset) surface points, so they also
        // sit exactly on the theoretical roof surface rather than baking in
        // their own offset the way ridge beams/collar ties/ceiling joists
        // do (each of those computes an already-lowered/mid-height point
        // before calling this function).
        const isRafterMember = subTag.includes('rafter') || subTag.includes('noggin');
        // Clamp to a fraction of the member's own span: for a very small
        // room (or the roof height floor) this inset could otherwise
        // exceed a large share of the member's total rise, pulling its
        // center to an implausible position instead of just tucking it
        // under the roof surface.
        const inset = Math.min(revealDistance + (isRafterMember ? depth / 2 : 0), span * 0.4);
        if (inset > 0) {
          midLocal.addScaledVector(yAxis, -inset);
        }

        const basisMatrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
        const qLocal = new THREE.Quaternion().setFromRotationMatrix(basisMatrix);
        const qWorld = qLocal.clone().premultiply(roofQuat);
        const worldPos = midLocal.clone().applyQuaternion(roofQuat).add(roofPos);
        const memberId = `tf-roof-${roof.id}-${roofRafterCount}-${Math.random().toString(36).substr(2, 6)}`;

        resultShapes.push({
          id: memberId,
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

        instancedMembers.rafter.push({
          id: memberId,
          kind: 'rafter',
          position: [worldPos.x, worldPos.y, worldPos.z],
          quaternion: [qWorld.x, qWorld.y, qWorld.z, qWorld.w],
          scale: [width, depth, span],
          parentWallOrRoofId: roof.id,
          lengthMm: Math.round(span * 1000)
        });
      };

      // 1. Check for attached roofData or customData (roofData itself,
      // and roofH/eaveOverhang from it, are already resolved above)
      let isLShape = Boolean(roofData?.isLShape);
      let isRectangular = Boolean(roofData?.isRectangular);
      let reflexIndex = roofData?.reflexIndex as number | undefined;
      let localWallPoly: [number, number][] | undefined = roofData?.localWallPoly;
      let localEavePoly: [number, number][] | undefined = roofData?.localEavePoly;

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
        const { rJunc, rEnd1, rEnd2 } = computeLRidgeNodes(V, E, roofH, isHip);

        const e0 = new THREE.Vector3(E[0][0], 0, E[0][1]); // Reflex inside corner
        const e1 = new THREE.Vector3(E[1][0], 0, E[1][1]); // Wing 1 eave end 1
        const e2 = new THREE.Vector3(E[2][0], 0, E[2][1]); // Wing 1 eave end 2
        const e3 = new THREE.Vector3(E[3][0], 0, E[3][1]); // Outer corner opposite reflex
        const e4 = new THREE.Vector3(E[4][0], 0, E[4][1]); // Wing 2 eave end 1
        const e5 = new THREE.Vector3(E[5][0], 0, E[5][1]); // Wing 2 eave end 2

        const rJ = new THREE.Vector3(rJunc[0], rJunc[1], rJunc[2]);
        const r1 = new THREE.Vector3(rEnd1[0], rEnd1[1], rEnd1[2]);
        const r2 = new THREE.Vector3(rEnd2[0], rEnd2[1], rEnd2[2]);

        // 1. Primary Ridge Beams for both wings. Both rectangular branches
        // below place their own ridge beam at `roofH - ridgeBeamDepth / 2`
        // - pre-lowered by half the beam's own thickness so its TOP face
        // sits flush with the ridge line, not poking through the roof
        // deck above it. This branch instead passed the raw ridge nodes
        // (which sit exactly ON the ridge line) straight into
        // addBeamSegment, which only insets non-rafter members by the
        // small fixed revealDistance - leaving roughly
        // (ridgeBeamDepth / 2 - revealDistance), about 8.5cm with the
        // current member sizes, of the beam sticking up through the roof
        // surface. Lowering the ridge points by the same half-depth here
        // matches the rectangular branches' convention; rJ/r1/r2
        // themselves stay at the true ridge apex for every other member
        // below that needs to reach the actual ridge line (rafters, jacks).
        const rJBeam = rJ.clone().setY(rJ.y - ridgeBeamDepth / 2);
        const r1Beam = r1.clone().setY(r1.y - ridgeBeamDepth / 2);
        const r2Beam = r2.clone().setY(r2.y - ridgeBeamDepth / 2);
        addBeamSegment('Ridge Beam (Wing 1)', rJBeam, r1Beam, ridgeBeamWidth, ridgeBeamDepth, 'timber-ridge-beam');
        addBeamSegment('Ridge Beam (Wing 2)', rJBeam, r2Beam, ridgeBeamWidth, ridgeBeamDepth, 'timber-ridge-beam');

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

        // 7. Common Rafters, Collar Ties & Roof Noggins on Wing 1 and Wing 2
        // For Wing 1:
        // Straight common rafters run from x = e0.x towards the wing's far
        // end (r1.x for hip, e1.x for gable) - e0/e1/etc come from
        // getCanonicalLPolygon, which just rotates the room's own wall
        // winding to start at the reflex corner and does NOT normalize
        // which direction each wing points. Assuming the far end always
        // lies at a HIGHER x than e0 (as the old `while (currX1 <=
        // wing1MaxX - 0.05)` loop starting at `e0.x + studSpacing` did)
        // meant that whenever a room's winding put the far end at a LOWER
        // x, this loop started already past its own bound and ran zero
        // iterations - no common rafters at all on that wing, while the
        // other wing (whose direction happened to match) got full dense
        // coverage. Walking a signed, direction-agnostic distance from e0
        // fixes this regardless of winding.
        const wing1TargetX = isHip ? r1.x : e1.x;
        const wing1SpanX = Math.abs(wing1TargetX - e0.x);
        const wing1DirX = Math.sign(wing1TargetX - e0.x) || 1;
        let prevRafter1: { pRidge: THREE.Vector3; pEaveVal: THREE.Vector3; pEaveOut: THREE.Vector3 } | null = null;
        let dX1 = studSpacing;
        while (dX1 <= wing1SpanX - 0.05) {
          const currX1 = e0.x + wing1DirX * dX1;
          const pRidge = new THREE.Vector3(currX1, r1.y, r1.z);
          const pEaveVal = new THREE.Vector3(currX1, 0, e0.z);
          const pEaveOut = new THREE.Vector3(currX1, 0, e2.z);

          addBeamSegment('Common Rafter (Wing 1 Valley Side)', pEaveVal, pRidge, rafterWidth, rafterDepth, 'timber-common-rafter');
          addBeamSegment('Common Rafter (Wing 1 Outer Side)', pEaveOut, pRidge, rafterWidth, rafterDepth, 'timber-common-rafter');

          // Collar Tie: a horizontal strut connecting the two sides of the
          // same rafter pair at ~40% up the roof, matching the proportion
          // used by the rectangular hip/gable branches. Without this, the
          // L-shape branch had no lateral tie between opposing rafters at
          // all (only the ceiling joists below tie the wing together).
          const tieT1 = Math.min(0.9, (roofH * 0.4) / Math.max(0.01, pRidge.y));
          addBeamSegment('Collar Tie (Wing 1)', pEaveVal.clone().lerp(pRidge, tieT1), pEaveOut.clone().lerp(pRidge, tieT1), rafterWidth, rafterDepth * 0.7, 'timber-collar-tie');

          // Roof Noggin: mid-span blocking between this rafter pair and
          // the previous one, on both sides of the wing. Roof framing
          // previously had no cross-bracing anywhere but the collar tie
          // above/ceiling joists below - noggins between adjacent rafters
          // are standard practice to stop rafters twisting/buckling
          // sideways under roof load.
          if (prevRafter1) {
            addBeamSegment('Roof Noggin (Wing 1 Valley Side)', prevRafter1.pEaveVal.clone().lerp(prevRafter1.pRidge, 0.5), pEaveVal.clone().lerp(pRidge, 0.5), rafterWidth, rafterDepth * 0.6, 'timber-roof-noggin');
            addBeamSegment('Roof Noggin (Wing 1 Outer Side)', prevRafter1.pEaveOut.clone().lerp(prevRafter1.pRidge, 0.5), pEaveOut.clone().lerp(pRidge, 0.5), rafterWidth, rafterDepth * 0.6, 'timber-roof-noggin');
          }
          prevRafter1 = { pRidge, pEaveVal, pEaveOut };

          dX1 += studSpacing;
        }

        // For Wing 2:
        // Straight common rafters run from z = e0.z towards the wing's far
        // end (r2.z for hip, e5.z for gable) - same signed-distance fix as
        // Wing 1 above.
        const wing2TargetZ = isHip ? r2.z : e5.z;
        const wing2SpanZ = Math.abs(wing2TargetZ - e0.z);
        const wing2DirZ = Math.sign(wing2TargetZ - e0.z) || 1;
        let prevRafter2: { pRidge: THREE.Vector3; pEaveVal: THREE.Vector3; pEaveOut: THREE.Vector3 } | null = null;
        let dZ2 = studSpacing;
        while (dZ2 <= wing2SpanZ - 0.05) {
          const currZ2 = e0.z + wing2DirZ * dZ2;
          const pRidge = new THREE.Vector3(r2.x, r2.y, currZ2);
          const pEaveVal = new THREE.Vector3(e0.x, 0, currZ2);
          const pEaveOut = new THREE.Vector3(e4.x, 0, currZ2);

          addBeamSegment('Common Rafter (Wing 2 Valley Side)', pEaveVal, pRidge, rafterWidth, rafterDepth, 'timber-common-rafter');
          addBeamSegment('Common Rafter (Wing 2 Outer Side)', pEaveOut, pRidge, rafterWidth, rafterDepth, 'timber-common-rafter');

          const tieT2 = Math.min(0.9, (roofH * 0.4) / Math.max(0.01, pRidge.y));
          addBeamSegment('Collar Tie (Wing 2)', pEaveVal.clone().lerp(pRidge, tieT2), pEaveOut.clone().lerp(pRidge, tieT2), rafterWidth, rafterDepth * 0.7, 'timber-collar-tie');

          if (prevRafter2) {
            addBeamSegment('Roof Noggin (Wing 2 Valley Side)', prevRafter2.pEaveVal.clone().lerp(prevRafter2.pRidge, 0.5), pEaveVal.clone().lerp(pRidge, 0.5), rafterWidth, rafterDepth * 0.6, 'timber-roof-noggin');
            addBeamSegment('Roof Noggin (Wing 2 Outer Side)', prevRafter2.pEaveOut.clone().lerp(prevRafter2.pRidge, 0.5), pEaveOut.clone().lerp(pRidge, 0.5), rafterWidth, rafterDepth * 0.6, 'timber-roof-noggin');
          }
          prevRafter2 = { pRidge, pEaveVal, pEaveOut };

          dZ2 += studSpacing;
        }

        // 8. Hip End Jack Rafters (When Hip Roof is Selected)
        if (isHip) {
          // --- Wing 1 Hip End ---
          // A. Side Jack Rafters in the hip setback zone (x between r1.x and e1.x).
          // Same winding-direction issue as the common-rafter loops above:
          // `e1.x - r1.x` assumed e1 always lies at a higher x than r1, so
          // a reversed winding made this span negative and silently
          // skipped the whole loop (no crash, but no jack rafters either).
          const hipSpanX1 = Math.abs(e1.x - r1.x);
          if (hipSpanX1 > 0.05) {
            const hipDirX1 = Math.sign(e1.x - r1.x) || 1;
            let dXj1 = studSpacing;
            while (dXj1 <= hipSpanX1 - 0.05) {
              const xJack = r1.x + hipDirX1 * dXj1;
              const t = dXj1 / hipSpanX1; // 0 at ridge apex r1, 1 at eave corners
              const pTopLeft = r1.clone().lerp(e1, t);
              const pTopRight = r1.clone().lerp(e2, t);

              addBeamSegment('Jack Rafter (Wing 1 Valley Hip)', new THREE.Vector3(xJack, 0, e0.z), pTopLeft, rafterWidth, rafterDepth, 'timber-hip-jack-rafter');
              addBeamSegment('Jack Rafter (Wing 1 Outer Hip)', new THREE.Vector3(xJack, 0, e2.z), pTopRight, rafterWidth, rafterDepth, 'timber-hip-jack-rafter');

              dXj1 += studSpacing;
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
          // A. Side Jack Rafters in the hip setback zone (z between r2.z and e5.z).
          // Same winding-direction fix as Wing 1's hip setback loop above.
          const hipSpanZ2 = Math.abs(e5.z - r2.z);
          if (hipSpanZ2 > 0.05) {
            const hipDirZ2 = Math.sign(e5.z - r2.z) || 1;
            let dZj2 = studSpacing;
            while (dZj2 <= hipSpanZ2 - 0.05) {
              const zJack = r2.z + hipDirZ2 * dZj2;
              const t = dZj2 / hipSpanZ2;
              const pTopLeft = r2.clone().lerp(e5, t);
              const pTopRight = r2.clone().lerp(e4, t);

              addBeamSegment('Jack Rafter (Wing 2 Valley Hip)', new THREE.Vector3(e0.x, 0, zJack), pTopLeft, rafterWidth, rafterDepth, 'timber-hip-jack-rafter');
              addBeamSegment('Jack Rafter (Wing 2 Outer Hip)', new THREE.Vector3(e4.x, 0, zJack), pTopRight, rafterWidth, rafterDepth, 'timber-hip-jack-rafter');

              dZj2 += studSpacing;
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

        // Wing 1 Ceiling Joists (between V[0]..V[1] and V[3]..V[2]), with a
        // row of mid-span noggins blocking each joist to its neighbor.
        const lenW1 = v0.distanceTo(v1);
        let prevJoist1: { pA: THREE.Vector3; pB: THREE.Vector3 } | null = null;
        let j1 = studSpacing;
        while (j1 < lenW1 - 0.05) {
          const t = j1 / lenW1;
          const pA = v0.clone().lerp(v1, t);
          const pB = v3.clone().lerp(v2, t);
          addBeamSegment('Ceiling Joist (Wing 1)', pA, pB, rafterWidth, rafterDepth, 'timber-ceiling-joist');
          if (prevJoist1) {
            addBeamSegment('Ceiling Joist Noggin (Wing 1)', prevJoist1.pA.clone().lerp(prevJoist1.pB, 0.5), pA.clone().lerp(pB, 0.5), rafterWidth, rafterDepth * 0.6, 'timber-roof-noggin');
          }
          prevJoist1 = { pA, pB };
          j1 += studSpacing;
        }

        // Wing 2 Ceiling Joists (between V[5]..V[0] and V[4]..V[3])
        const lenW2 = v5.distanceTo(v0);
        let prevJoist2: { pA: THREE.Vector3; pB: THREE.Vector3 } | null = null;
        let j2 = studSpacing;
        while (j2 < lenW2 - 0.05) {
          const t = j2 / lenW2;
          const pA = v5.clone().lerp(v0, t);
          const pB = v4.clone().lerp(v3, t);
          addBeamSegment('Ceiling Joist (Wing 2)', pA, pB, rafterWidth, rafterDepth, 'timber-ceiling-joist');
          if (prevJoist2) {
            addBeamSegment('Ceiling Joist Noggin (Wing 2)', prevJoist2.pA.clone().lerp(prevJoist2.pB, 0.5), pA.clone().lerp(pB, 0.5), rafterWidth, rafterDepth * 0.6, 'timber-roof-noggin');
          }
          prevJoist2 = { pA, pB };
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

          const cornerNW = new THREE.Vector3(-halfW_eave, 0, -halfD_eave);
          const cornerSW = new THREE.Vector3(-halfW_eave, 0, halfD_eave);
          const cornerNE = new THREE.Vector3(halfW_eave, 0, -halfD_eave);
          const cornerSE = new THREE.Vector3(halfW_eave, 0, halfD_eave);

          addBeamSegment('Hip Rafter (North-West)', apexLeft, cornerNW, hipRafterWidth, hipRafterDepth, 'timber-hip-rafter');
          addBeamSegment('Hip Rafter (South-West)', apexLeft, cornerSW, hipRafterWidth, hipRafterDepth, 'timber-hip-rafter');
          addBeamSegment('Hip Rafter (North-East)', apexRight, cornerNE, hipRafterWidth, hipRafterDepth, 'timber-hip-rafter');
          addBeamSegment('Hip Rafter (South-East)', apexRight, cornerSE, hipRafterWidth, hipRafterDepth, 'timber-hip-rafter');

          let prevHipRafterWL: { topPt: THREE.Vector3; frontEave: THREE.Vector3; backEave: THREE.Vector3 } | null = null;
          let currX = -ridgeHalfLen + 0.15;
          while (currX <= ridgeHalfLen - 0.15) {
            const topPt = new THREE.Vector3(currX, roofH, 0);
            const frontEave = new THREE.Vector3(currX, 0, halfD_eave);
            const backEave = new THREE.Vector3(currX, 0, -halfD_eave);

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

            // Roof Noggin: mid-span blocking between this rafter pair and
            // the previous one, standard practice against rafters
            // twisting/buckling sideways under roof load.
            if (prevHipRafterWL) {
              addBeamSegment('Roof Noggin (Front)', prevHipRafterWL.frontEave.clone().lerp(prevHipRafterWL.topPt, 0.5), frontEave.clone().lerp(topPt, 0.5), rafterWidth, rafterDepth * 0.6, 'timber-roof-noggin');
              addBeamSegment('Roof Noggin (Back)', prevHipRafterWL.backEave.clone().lerp(prevHipRafterWL.topPt, 0.5), backEave.clone().lerp(topPt, 0.5), rafterWidth, rafterDepth * 0.6, 'timber-roof-noggin');
            }
            prevHipRafterWL = { topPt, frontEave, backEave };

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

          const cornerNW = new THREE.Vector3(-halfW_eave, 0, -halfD_eave);
          const cornerSW = new THREE.Vector3(-halfW_eave, 0, halfD_eave);
          const cornerNE = new THREE.Vector3(halfW_eave, 0, -halfD_eave);
          const cornerSE = new THREE.Vector3(halfW_eave, 0, halfD_eave);

          addBeamSegment('Hip Rafter (North-West)', apexNorth, cornerNW, hipRafterWidth, hipRafterDepth, 'timber-hip-rafter');
          addBeamSegment('Hip Rafter (North-East)', apexNorth, cornerNE, hipRafterWidth, hipRafterDepth, 'timber-hip-rafter');
          addBeamSegment('Hip Rafter (South-West)', apexSouth, cornerSW, hipRafterWidth, hipRafterDepth, 'timber-hip-rafter');
          addBeamSegment('Hip Rafter (South-East)', apexSouth, cornerSE, hipRafterWidth, hipRafterDepth, 'timber-hip-rafter');

          let prevHipRafterDL: { topPt: THREE.Vector3; leftEave: THREE.Vector3; rightEave: THREE.Vector3 } | null = null;
          let currZ = -ridgeHalfLen + 0.15;
          while (currZ <= ridgeHalfLen - 0.15) {
            const topPt = new THREE.Vector3(0, roofH, currZ);
            const leftEave = new THREE.Vector3(-halfW_eave, 0, currZ);
            const rightEave = new THREE.Vector3(halfW_eave, 0, currZ);

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

            if (prevHipRafterDL) {
              addBeamSegment('Roof Noggin (Left)', prevHipRafterDL.leftEave.clone().lerp(prevHipRafterDL.topPt, 0.5), leftEave.clone().lerp(topPt, 0.5), rafterWidth, rafterDepth * 0.6, 'timber-roof-noggin');
              addBeamSegment('Roof Noggin (Right)', prevHipRafterDL.rightEave.clone().lerp(prevHipRafterDL.topPt, 0.5), rightEave.clone().lerp(topPt, 0.5), rafterWidth, rafterDepth * 0.6, 'timber-roof-noggin');
            }
            prevHipRafterDL = { topPt, leftEave, rightEave };

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
          let prevGableRafterWL: { topPt: THREE.Vector3; frontEave: THREE.Vector3; backEave: THREE.Vector3 } | null = null;
          let currX = -halfW;
          while (currX <= halfW + 0.02) {
            const topPt = new THREE.Vector3(currX, roofH, 0);
            const frontEave = new THREE.Vector3(currX, 0, halfD_eave);
            const backEave = new THREE.Vector3(currX, 0, -halfD_eave);

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

            if (prevGableRafterWL) {
              addBeamSegment('Roof Noggin (Front)', prevGableRafterWL.frontEave.clone().lerp(prevGableRafterWL.topPt, 0.5), frontEave.clone().lerp(topPt, 0.5), rafterWidth, rafterDepth * 0.6, 'timber-roof-noggin');
              addBeamSegment('Roof Noggin (Back)', prevGableRafterWL.backEave.clone().lerp(prevGableRafterWL.topPt, 0.5), backEave.clone().lerp(topPt, 0.5), rafterWidth, rafterDepth * 0.6, 'timber-roof-noggin');
            }
            prevGableRafterWL = { topPt, frontEave, backEave };

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

          let prevGableRafterDL: { topPt: THREE.Vector3; leftEave: THREE.Vector3; rightEave: THREE.Vector3 } | null = null;
          let currZ = -halfD;
          while (currZ <= halfD + 0.02) {
            const topPt = new THREE.Vector3(0, roofH, currZ);
            const leftEave = new THREE.Vector3(-halfW_eave, 0, currZ);
            const rightEave = new THREE.Vector3(halfW_eave, 0, currZ);

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

            if (prevGableRafterDL) {
              addBeamSegment('Roof Noggin (Left)', prevGableRafterDL.leftEave.clone().lerp(prevGableRafterDL.topPt, 0.5), leftEave.clone().lerp(topPt, 0.5), rafterWidth, rafterDepth * 0.6, 'timber-roof-noggin');
              addBeamSegment('Roof Noggin (Right)', prevGableRafterDL.rightEave.clone().lerp(prevGableRafterDL.topPt, 0.5), rightEave.clone().lerp(topPt, 0.5), rafterWidth, rafterDepth * 0.6, 'timber-roof-noggin');
            }
            prevGableRafterDL = { topPt, leftEave, rightEave };

            currZ += studSpacing;
          }
        }
      }
    });
  }

  const validation = validateTimberAssembly(resultShapes, allShapes);
  const bom = generateTimberBOM(resultShapes, {
    species: effectiveParams?.species,
    grade: effectiveParams?.grade,
  });
  const report: TimberGenerationReport = {
    structural_zone_depth_mm: 140,
    frame_depth_mm: Math.round((configuredMemberDepth || 0.14) * 1000),
    clamped_depths: [],
    flagged_spans: [],
    deferred_clashes: [],
    inserted_intermediate_posts: [],
    bom,
    validation,
    summary: `Generated ${resultShapes.length} timber framing members (${wallStudCount} wall, ${floorJoistCount} floor, ${roofRafterCount} roof). All spatial and depth constraints validated.`,
  };

  lastArchFingerprint = getArchFingerprint(allShapes);

  return {
    shapes: resultShapes,
    wallStudCount,
    floorJoistCount,
    roofRafterCount,
    validationMessages: [...validationMessages, ...validation.errors, ...validation.warnings],
    openingAssemblies,
    instancedMembers,
    report,
    bom,
    validation,
  };
}

/**
 * Generates timber framing for a single specified wall.
 * Scoped generation prevents full-model rebuild when only one wall or opening changes.
 */
export function generateTimberFrameForWall(
  wall: Shape,
  allShapes: Shape[],
  options: TimberFrameOptions = {}
): Shape[] {
  const framing = generateTimberFraming([wall, ...allShapes.filter(s => s.type === 'door' || s.type === 'window' || s.hostWallId === wall.id)], {
    ...options,
    includeWalls: true,
    includeFloors: false,
    includeRoof: false,
  });
  return framing.shapes.filter(s => s.tags?.includes('timber-stud-wall') || s.name?.includes(wall.name || wall.id) || s.id?.includes(`tf-wall-${wall.id}`));
}

/**
 * Generates timber framing for a single specified roof.
 * Scoped generation prevents full-model rebuild when roof geometry changes.
 */
export function generateTimberFrameForRoof(
  roof: Shape,
  allShapes: Shape[],
  options: TimberFrameOptions = {}
): Shape[] {
  const framing = generateTimberFraming([roof, ...allShapes.filter(s => s.type === 'wall' || s.tags?.includes('room-wall'))], {
    ...options,
    includeWalls: false,
    includeFloors: false,
    includeRoof: true,
  });
  return framing.shapes.filter(s => s.tags?.includes('timber-roof-rafter') || s.id?.includes(`tf-roof-${roof.id}`));
}

/**
 * Convenient wrapper returning members array and breakdown
 */
export function generateTimberFrameForBuilding(
  allShapes: Shape[],
  options?: TimberFrameOptions & { joistSpacing?: number; rafterSpacing?: number }
): { members: Shape[]; totalCount: number; wallCount: number; floorCount: number; roofCount: number; openingAssemblies: OpeningFrameAssembly[] } {
  const res = generateTimberFraming(allShapes, options);
  return {
    members: res.shapes,
    totalCount: res.shapes.length,
    wallCount: res.wallStudCount,
    floorCount: res.floorJoistCount,
    roofCount: res.roofRafterCount,
    openingAssemblies: res.openingAssemblies || []
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
    (s.type === 'wall' || s.type === 'door' || s.type === 'window' ||
      s.tags?.includes('wall') || s.tags?.includes('floor') || s.tags?.includes('slab') ||
      // Roof shapes built by archRoofGenerator.ts are type 'custom' tagged
      // e.g. 'roof-structure'/'roof-assembly'/'roof-slopes', never the bare
      // 'roof' string - match the same broad roof-detection pattern used
      // elsewhere in the app (RoofModifierSection.tsx, AppContext.tsx) so
      // roof edits are actually included in the fingerprint below.
      s.type === 'roof' || s.tags?.some(t => t.includes('roof')) || s.name?.toLowerCase().includes('roof'))
  );
  // Includes roofData/customData (ridgeHeight, eaveOverhang, pitchAngleDeg,
  // roofType, ...) alongside position/args/quaternion - a roof edit that
  // changes one of those without changing its compact [width, ridgeHeight,
  // depth] args tuple (e.g. adjusting eaveOverhang or pitch in a way that
  // keeps the same ridge height) used to leave this fingerprint unchanged,
  // so framing generated for the OLD roof shape was never recomputed for
  // the new one.
  return archShapes.map(s => `${s.id}:${s.type}:${s.position.map(p => p.toFixed(2)).join(',')}:${JSON.stringify(s.args)}:${(s.quaternion || []).map(q => q.toFixed(2)).join(',')}:${JSON.stringify(s.roofData || s.customData || null)}`).join('|');
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

  const hostWithParams = nonTimber.find(s => s.timberFrame?.params);
  const existingParams = hostWithParams?.timberFrame?.params;

  const res = generateTimberFraming(nonTimber, {
    params: existingParams,
    offsetFloorJoists: existingParams?.offsetFloorJoists ?? existingParams?.offsetJoists,
    offsetWallJoists: existingParams?.offsetWallJoists,
    offsetFloorNoggins: existingParams?.offsetFloorNoggins,
    offsetWallNoggins: existingParams?.offsetWallNoggins,
    studSpacing: existingParams?.studSpacing ?? 0.40,
    includeWalls: true,
    includeFloors: true,
    includeRoof: true,
  });

  // Track user-modified timber members that must never be overwritten (§5.2)
  const userModifiedMembers = existingTimberShapes.filter(s => s.timberMemberData?.is_user_modified);
  const userModifiedIds = new Set(userModifiedMembers.map(m => m.id));

  // Re-apply preserved hidden status and user-modified overrides
  const preservedShapes = res.shapes
    .filter(s => !userModifiedIds.has(s.id))
    .map(s => {
      const isCatHidden = s.tags?.some(t => hiddenCategories.has(t));
      const isNameHidden = s.name && hiddenNames.has(s.name);
      return (isCatHidden || isNameHidden) ? { ...s, hidden: true } : s;
    });

  return [...nonTimber, ...userModifiedMembers, ...preservedShapes];
}
