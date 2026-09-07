import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Shape } from '../types';
import { StairStructureType, RailingModeType, StairStyleType } from './archStairGenerator';

/**
 * Predefined architectural defaults
 */
export const DEFAULT_STAIRCASE_HEIGHT = 2.70; // 2.70 meters (standard residential/commercial floor-to-floor height)
export const DEFAULT_IDEAL_STEP_HEIGHT = 0.1778; // 0.1778 meters (7.0 inches - international standard ideal riser)
export const DEFAULT_STRIDE_CONSTANT = 0.63; // 0.63 meters (~24.8 inches, Blondel's 2R + T = 62-64cm standard)
export const MIN_TREAD_DEPTH = 0.22; // 22 cm safe minimum tread depth
export const MAX_TREAD_DEPTH = 0.38; // 38 cm maximum ergonomic tread depth

export interface SceneScanResult {
  targetHeight: number;
  source: 'upper_floor' | 'wall' | 'default';
  detectedObjectId?: string;
  detectedObjectName?: string;
  detectedElevation: number;
  baseElevation: number;
  description: string;
}

export interface ParametricCalculationResult {
  targetHeight: number;
  idealStepHeight: number;
  stepCount: number;
  actualStepHeight: number; // Equal riser height across every single step
  treadDepth: number;       // Horizontal length of the step adjusted via 2R + T formula
  totalRun: number;         // Overall run length of the staircase
  strideFormulaValue: number; // Evaluated (2 * Riser) + Tread (meters)
  pitchAngleDeg: number;    // Incline angle of the staircase flight in degrees
  width: number;
  source: 'upper_floor' | 'wall' | 'default';
  sourceDescription: string;
}

export interface ParametricStairOptions {
  targetHeight?: number;
  idealStepHeight?: number;
  strideConstant?: number;
  width?: number;
  baseElevation?: number;
  stairStyle?: StairStyleType | string;
  stairStructure?: StairStructureType;
  railingMode?: RailingModeType;
  // Optional scene shapes for automatic scanning
  shapes?: Shape[];
  currentPosition?: [number, number, number] | THREE.Vector3;
}

/**
 * Scans the current 3D design environment to detect the presence of "wall" or "upper floor" objects.
 * Programmatically determines the required staircase height by extracting their top elevation.
 * If the scene contains no walls or upper floors, falls back to DEFAULT_STAIRCASE_HEIGHT (2.7m).
 */
export function scanSceneForTargetHeight(
  shapes: Shape[] = [],
  baseElevation: number = 0,
  currentPosition?: [number, number, number] | THREE.Vector3
): SceneScanResult {
  if (!shapes || shapes.length === 0) {
    return {
      targetHeight: DEFAULT_STAIRCASE_HEIGHT,
      source: 'default',
      detectedElevation: baseElevation + DEFAULT_STAIRCASE_HEIGHT,
      baseElevation,
      description: `Default staircase height (${DEFAULT_STAIRCASE_HEIGHT.toFixed(2)}m) - no walls or floors in scene.`
    };
  }

  const posVec = currentPosition
    ? (Array.isArray(currentPosition)
        ? new THREE.Vector3(currentPosition[0], currentPosition[1], currentPosition[2])
        : currentPosition)
    : null;

  interface DetectedCandidate {
    shape: Shape;
    type: 'upper_floor' | 'wall';
    topElevation: number;
    heightDiff: number;
    dist2D: number;
  }

  const upperFloorCandidates: DetectedCandidate[] = [];
  const wallCandidates: DetectedCandidate[] = [];

  for (const s of shapes) {
    if (s.hidden) continue;

    const isUpperFloor =
      s.tags?.includes('floor-slab') ||
      s.tags?.includes('ceiling-slab') ||
      s.tags?.includes('slab') ||
      s.name?.toLowerCase().includes('floor') ||
      s.name?.toLowerCase().includes('slab') ||
      s.name?.toLowerCase().includes('ceiling') ||
      (s.type === 'poly' && typeof (s.args as any)?.height === 'number' && (s.args as any).height <= 0.6) ||
      (s.type === 'box' &&
        Array.isArray(s.args) &&
        (s.args[1] || 0) <= 0.6 &&
        (s.args[0] || 0) >= 1.0 &&
        (s.args[2] || 0) >= 1.0);

    const isWall =
      s.type === 'wall' ||
      s.tags?.includes('wall') ||
      s.name?.toLowerCase().includes('wall');

    const dist2D = posVec
      ? Math.hypot(s.position[0] - posVec.x, s.position[2] - posVec.z)
      : 0;

    if (isUpperFloor) {
      const slabThickness =
        (s.args as any)?.height ??
        (Array.isArray(s.args) ? s.args[1] : 0.20) ??
        0.20;
      // Floor slabs in Polyform have top elevation at position[1] + thickness / 2
      const topY = s.position[1] + slabThickness / 2;
      const heightDiff = topY - baseElevation;

      // Must be meaningfully elevated above the staircase base (at least 0.5m)
      if (heightDiff >= 0.5) {
        upperFloorCandidates.push({
          shape: s,
          type: 'upper_floor',
          topElevation: topY,
          heightDiff,
          dist2D
        });
      }
    } else if (isWall) {
      const wallH = Array.isArray(s.args) ? s.args[1] ?? 2.80 : 2.80;
      // Polyform walls are centered at position[1], so top elevation is position[1] + wallH / 2
      const topY = s.position[1] + wallH / 2;
      const heightDiff = topY - baseElevation;

      if (heightDiff >= 0.5) {
        wallCandidates.push({
          shape: s,
          type: 'wall',
          topElevation: topY,
          heightDiff,
          dist2D
        });
      }
    }
  }

  // 1. Priority: Upper floor slab (represents true finished floor landing level)
  if (upperFloorCandidates.length > 0) {
    // Sort by proximity to current position if provided, else lowest heightDiff above base
    upperFloorCandidates.sort((a, b) => {
      if (posVec && Math.abs(a.dist2D - b.dist2D) > 2.0) {
        return a.dist2D - b.dist2D;
      }
      return a.heightDiff - b.heightDiff;
    });

    const chosen = upperFloorCandidates[0];
    const targetHeight = Math.round(chosen.heightDiff * 1000) / 1000;
    return {
      targetHeight,
      source: 'upper_floor',
      detectedObjectId: chosen.shape.id,
      detectedObjectName: chosen.shape.name || 'Upper Floor Slab',
      detectedElevation: chosen.topElevation,
      baseElevation,
      description: `Target height (${targetHeight.toFixed(2)}m) detected from upper floor slab "${chosen.shape.name || 'Floor Slab'}" at elevation ${chosen.topElevation.toFixed(2)}m.`
    };
  }

  // 2. Secondary: Wall top elevation
  if (wallCandidates.length > 0) {
    wallCandidates.sort((a, b) => {
      if (posVec && Math.abs(a.dist2D - b.dist2D) > 2.0) {
        return a.dist2D - b.dist2D;
      }
      return a.heightDiff - b.heightDiff;
    });

    const chosen = wallCandidates[0];
    const targetHeight = Math.round(chosen.heightDiff * 1000) / 1000;
    return {
      targetHeight,
      source: 'wall',
      detectedObjectId: chosen.shape.id,
      detectedObjectName: chosen.shape.name || 'Wall',
      detectedElevation: chosen.topElevation,
      baseElevation,
      description: `Target height (${targetHeight.toFixed(2)}m) detected from wall "${chosen.shape.name || 'Wall'}" top elevation at ${chosen.topElevation.toFixed(2)}m.`
    };
  }

  // 3. Fallback: Predefined default height
  return {
    targetHeight: DEFAULT_STAIRCASE_HEIGHT,
    source: 'default',
    detectedElevation: baseElevation + DEFAULT_STAIRCASE_HEIGHT,
    baseElevation,
    description: `Default staircase height (${DEFAULT_STAIRCASE_HEIGHT.toFixed(2)}m) - no walls or upper floors detected.`
  };
}

/**
 * Parametric Step Calculation & Slope/Depth Adjustment.
 *
 * Core Logic & Constraints:
 * 1. Equal Riser Heights: Every single step has the exact same height.
 * 2. Optimal Step Count: target_height / ideal_step_height, rounded to nearest whole number.
 * 3. Exact Actual Riser Height: target_height / step_count.
 * 4. Slope & Depth Adjustment: Standard ergonomic stair formula (2 * Riser) + Tread = stride_constant
 *    (targeting 24 to 25 inches / 62 to 64 cm).
 * 5. Run Length: step_count * tread_depth.
 */
export function calculateParametricStairs(params: {
  targetHeight: number;
  idealStepHeight?: number;
  strideConstant?: number;
  width?: number;
  source?: 'upper_floor' | 'wall' | 'default';
  sourceDescription?: string;
}): ParametricCalculationResult {
  const targetHeight = Math.max(0.4, params.targetHeight);
  const idealStepHeight = params.idealStepHeight ?? DEFAULT_IDEAL_STEP_HEIGHT;
  const strideConstant = params.strideConstant ?? DEFAULT_STRIDE_CONSTANT;
  const width = params.width ?? 1.0;

  // 1. Calculate step count by dividing target height by ideal step height, rounded to nearest whole number
  const stepCount = Math.max(2, Math.round(targetHeight / idealStepHeight));

  // 2. Divide target height by step count to determine the exact actual step height (riser height)
  // Equal riser height for every single step
  const actualStepHeight = targetHeight / stepCount;

  // 3. Calculate tread depth dynamically using the standard ergonomic formula:
  // (2 * Riser) + Tread = strideConstant (e.g. 24 to 25 inches / 62 to 64 cm)
  // Tread = strideConstant - (2 * actualStepHeight)
  const rawTreadDepth = strideConstant - (2 * actualStepHeight);

  // Clamp within safe ergonomic bounds so extreme heights still maintain functional tread depth
  const treadDepth = Math.max(MIN_TREAD_DEPTH, Math.min(MAX_TREAD_DEPTH, rawTreadDepth));

  // 4. Overall horizontal run length of the staircase
  const totalRun = stepCount * treadDepth;

  // Stride formula check
  const strideFormulaValue = (2 * actualStepHeight) + treadDepth;

  // Pitch angle in degrees
  const pitchAngleDeg = (Math.atan2(actualStepHeight, treadDepth) * 180) / Math.PI;

  return {
    targetHeight,
    idealStepHeight,
    stepCount,
    actualStepHeight,
    treadDepth,
    totalRun,
    strideFormulaValue,
    pitchAngleDeg,
    width,
    source: params.source || 'default',
    sourceDescription: params.sourceDescription || ''
  };
}

/**
 * Helper to build balustrades & handrail along a line path.
 */
function createRailingAlongSegment(
  pStart: [number, number, number],
  pEnd: [number, number, number],
  railHeight: number = 0.95,
  numBalusters: number = 6
): THREE.BufferGeometry[] {
  const geoms: THREE.BufferGeometry[] = [];
  const vStart = new THREE.Vector3(...pStart);
  const vEnd = new THREE.Vector3(...pEnd);
  const delta = new THREE.Vector3().subVectors(vEnd, vStart);
  const totalDist = delta.length();
  if (totalDist < 0.12) return geoms;

  // Newel Posts at start & end
  const postGeom1 = new THREE.BoxGeometry(0.06, railHeight, 0.06);
  postGeom1.translate(pStart[0], pStart[1] + railHeight / 2, pStart[2]);
  geoms.push(postGeom1);

  const postGeom2 = new THREE.BoxGeometry(0.06, railHeight, 0.06);
  postGeom2.translate(pEnd[0], pEnd[1] + railHeight / 2, pEnd[2]);
  geoms.push(postGeom2);

  // Handrail bar: elevated by railHeight along the path
  const handrailStart = vStart.clone().add(new THREE.Vector3(0, railHeight, 0));
  const handrailEnd = vEnd.clone().add(new THREE.Vector3(0, railHeight, 0));
  const handrailMid = handrailStart.clone().lerp(handrailEnd, 0.5);

  const railBar = new THREE.BoxGeometry(0.05, 0.04, totalDist);
  const dir = delta.clone().normalize();
  const orientationQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  railBar.applyQuaternion(orientationQuat);
  railBar.translate(handrailMid.x, handrailMid.y, handrailMid.z);
  geoms.push(railBar);

  // Vertical Balusters along path
  const count = Math.max(1, numBalusters);
  const spindleH = Math.max(0.1, railHeight - 0.06);
  for (let b = 1; b < count; b++) {
    const t = b / count;
    const bx = pStart[0] + delta.x * t;
    const by = pStart[1] + delta.y * t;
    const bz = pStart[2] + delta.z * t;

    const balGeom = new THREE.CylinderGeometry(0.012, 0.012, spindleH, 8);
    balGeom.translate(bx, by + spindleH / 2 + 0.03, bz);
    geoms.push(balGeom);
  }

  return geoms;
}

/**
 * Iterative Construction:
 * The code constructs the staircase iteratively in a loop, instancing/generating the
 * geometry for each individual step using the calculated actual_step_height and adjusted
 * tread depth, translating each subsequent step up and forward.
 *
 * NO GLOBAL STRETCHING: Under no circumstances is the staircase scaled or stretched
 * along the Y-axis to reach the target height.
 * EQUAL RISER HEIGHTS: Every single step has the exact same actual_step_height.
 */
export function createParametricStaircaseGeometry(
  options: ParametricStairOptions = {}
): {
  geometry: THREE.BufferGeometry;
  calculation: ParametricCalculationResult;
} {
  // 1. Scene Scanning or direct target height
  let targetHeight = options.targetHeight;
  let source: 'upper_floor' | 'wall' | 'default' = 'default';
  let sourceDesc = '';

  if (targetHeight === undefined || targetHeight === null) {
    if (options.shapes && options.shapes.length > 0) {
      const scan = scanSceneForTargetHeight(options.shapes, options.baseElevation ?? 0, options.currentPosition);
      targetHeight = scan.targetHeight;
      source = scan.source;
      sourceDesc = scan.description;
    } else {
      targetHeight = DEFAULT_STAIRCASE_HEIGHT;
      source = 'default';
      sourceDesc = `Default height (${DEFAULT_STAIRCASE_HEIGHT.toFixed(2)}m) fallback.`;
    }
  }

  // 2. Parametric Calculation
  const calc = calculateParametricStairs({
    targetHeight,
    idealStepHeight: options.idealStepHeight,
    strideConstant: options.strideConstant,
    width: options.width ?? 1.0,
    source,
    sourceDescription: sourceDesc
  });

  const { stepCount, actualStepHeight, treadDepth, width } = calc;
  const structure = options.stairStructure || 'closed';
  const railing = options.railingMode || 'both';

  const geoms: THREE.BufferGeometry[] = [];

  const totalRun = calc.totalRun;
  const totalHeight = calc.targetHeight;

  // 3. Iterative Construction Loop
  // Each step is generated using the exact actual_step_height and treadDepth,
  // translating each subsequent step up and forward.
  for (let i = 0; i < stepCount; i++) {
    // Local coordinates: centered vertically at 0, ranging from -totalHeight/2 to +totalHeight/2
    // and along Z from -totalRun/2 to +totalRun/2
    const topY = -totalHeight / 2 + (i + 1) * actualStepHeight;
    const centerZ = -totalRun / 2 + (i + 0.5) * treadDepth;

    if (structure === 'closed') {
      // Solid step block from ground up to step height
      const stepBlockH = (i + 1) * actualStepHeight;
      const stepGeom = new THREE.BoxGeometry(width, stepBlockH, treadDepth);
      stepGeom.translate(0, topY - stepBlockH / 2, centerZ);
      geoms.push(stepGeom);

      // Tread nosing plank with front overhang
      const nosingOverhang = 0.025;
      const treadThickness = 0.035;
      const treadGeom = new THREE.BoxGeometry(width + 0.02, treadThickness, treadDepth + nosingOverhang);
      treadGeom.translate(0, topY - treadThickness / 2, centerZ + nosingOverhang / 2);
      geoms.push(treadGeom);
    } else if (structure === 'open') {
      // Open riser: tread board only with nosing
      const nosingOverhang = 0.025;
      const treadThickness = 0.04;
      const treadGeom = new THREE.BoxGeometry(width, treadThickness, treadDepth + nosingOverhang);
      treadGeom.translate(0, topY - treadThickness / 2, centerZ + nosingOverhang / 2);
      geoms.push(treadGeom);
    } else if (structure === 'floating') {
      // Floating cantilever treads
      const treadThickness = 0.065;
      const treadGeom = new THREE.BoxGeometry(width, treadThickness, treadDepth - 0.02);
      treadGeom.translate(0, topY - treadThickness / 2, centerZ);
      geoms.push(treadGeom);

      // Wall anchor cantilever bracket
      const bracket = new THREE.BoxGeometry(0.08, 0.12, 0.14);
      bracket.translate(-width / 2 + 0.04, topY - 0.06, centerZ);
      geoms.push(bracket);
    } else if (structure === 'mono-stringer') {
      // Central mono-stringer spine support
      const nosingOverhang = 0.025;
      const treadThickness = 0.045;
      const treadGeom = new THREE.BoxGeometry(width, treadThickness, treadDepth + nosingOverhang);
      treadGeom.translate(0, topY - treadThickness / 2, centerZ + nosingOverhang / 2);
      geoms.push(treadGeom);

      // Steel support plate under tread
      const plate = new THREE.BoxGeometry(0.30, 0.015, treadDepth * 0.75);
      plate.translate(0, topY - 0.05, centerZ);
      geoms.push(plate);
    }
  }

  // 4. Structural Stringers (sized accurately to totalRun and totalHeight without stretching)
  if (structure === 'open' || structure === 'closed') {
    const stringerSpan = Math.hypot(totalRun, totalHeight);
    const angle = Math.atan2(totalHeight, totalRun);

    const stringerL = new THREE.BoxGeometry(0.04, 0.22, stringerSpan);
    stringerL.rotateX(-angle);
    stringerL.translate(-width / 2 + 0.02, 0, 0);
    geoms.push(stringerL);

    const stringerR = new THREE.BoxGeometry(0.04, 0.22, stringerSpan);
    stringerR.rotateX(-angle);
    stringerR.translate(width / 2 - 0.02, 0, 0);
    geoms.push(stringerR);
  } else if (structure === 'mono-stringer') {
    const stringerSpan = Math.hypot(totalRun, totalHeight);
    const angle = Math.atan2(totalHeight, totalRun);

    const spine = new THREE.BoxGeometry(0.14, 0.18, stringerSpan);
    spine.rotateX(-angle);
    spine.translate(0, -0.08, 0);
    geoms.push(spine);
  }

  // 5. Railings and Balustrades
  if (railing === 'left' || railing === 'both') {
    const pLeftStart: [number, number, number] = [-width / 2 + 0.04, -totalHeight / 2, -totalRun / 2];
    const pLeftEnd: [number, number, number] = [-width / 2 + 0.04, totalHeight / 2, totalRun / 2];
    geoms.push(...createRailingAlongSegment(pLeftStart, pLeftEnd, 0.95, stepCount));
  }
  if (railing === 'right' || railing === 'both') {
    const pRightStart: [number, number, number] = [width / 2 - 0.04, -totalHeight / 2, -totalRun / 2];
    const pRightEnd: [number, number, number] = [width / 2 - 0.04, totalHeight / 2, totalRun / 2];
    geoms.push(...createRailingAlongSegment(pRightStart, pRightEnd, 0.95, stepCount));
  }

  try {
    const merged = BufferGeometryUtils.mergeGeometries(
      geoms.map(g => (g.index ? g.toNonIndexed() : g)),
      false
    );
    return {
      geometry: merged || new THREE.BoxGeometry(width, totalHeight, totalRun),
      calculation: calc
    };
  } catch (e) {
    return {
      geometry: new THREE.BoxGeometry(width, totalHeight, totalRun),
      calculation: calc
    };
  }
}
