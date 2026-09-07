import * as THREE from 'three';
import {
  createParametricStaircaseGeometry,
  calculateParametricStairs,
  DEFAULT_IDEAL_STEP_HEIGHT,
  DEFAULT_STRIDE_CONSTANT
} from './parametricStairs';
import { buildStairFlightGeometry } from './stairs/stairFlightGeometry';

export type StairStyleType = 'straight' | 'l-shape' | 'u-shape' | 'c-shape' | 'winder' | 'spiral' | 'curved' | 'bifurcated';
export type StairStructureType = 'closed' | 'open' | 'floating' | 'mono-stringer';
export type RailingModeType = 'none' | 'left' | 'right' | 'both';

export const ALL_STAIR_STYLES: StairStyleType[] = [
  'straight', 'l-shape', 'u-shape', 'c-shape', 'winder', 'spiral', 'curved', 'bifurcated'
];

export interface StaircaseOptions {
  width?: number;          // Total width (e.g. 1.0m or 2.2m for switchback)
  height?: number;         // Total vertical rise (e.g. 2.7m)
  length?: number;         // Total horizontal run (e.g. 3.6m)
  numSteps?: number;       // Number of steps (default: 14)
  stairStyle?: StairStyleType | string;
  stairStructure?: StairStructureType;
  railingMode?: RailingModeType;
  isParametric?: boolean;
  idealStepHeight?: number;
  strideConstant?: number;
  targetHeight?: number;
  actualStepHeight?: number;
  treadDepth?: number;
}

/**
 * Master architectural staircase geometry generator.
 *
 * StairFix note: as of this refactor, the actual per-style geometry algorithms
 * (straight, l-shape, u-shape, c-shape, winder, spiral, curved, bifurcated) no
 * longer live in this file — they live once, in
 * `src/lib/stairs/stairFlightGeometry.ts`, and this function (the static/
 * non-parametric-straight entry point) and `createParametricStaircaseGeometry`
 * (the parametric entry point, for every style except 'straight') both call
 * that same shared function. This guarantees the two paths can never diverge
 * in which style they render — see stairFlightGeometry.ts for the full
 * rationale.
 */
export function createArchitecturalStaircaseGeometry(
  options: StaircaseOptions = {}
): THREE.BufferGeometry {
  const width = options.width || 1.0;
  let height = options.targetHeight || options.height || 2.7;
  let length = options.length || 3.6;
  let numSteps = Math.max(4, options.numSteps || 14);
  const style = (options.stairStyle || 'straight').toString().toLowerCase();
  const structure = options.stairStructure || 'closed';
  const railing = options.railingMode || 'both';

  // If parametric mode is enabled, dynamically compute step count, equal riser height,
  // and ergonomic tread depth without any global Y-stretching
  if (options.isParametric) {
    const calc = calculateParametricStairs({
      targetHeight: height,
      idealStepHeight: options.idealStepHeight,
      strideConstant: options.strideConstant,
      width
    });
    height = calc.targetHeight;
    numSteps = calc.stepCount;
    length = calc.totalRun;

    if (style === 'straight') {
      return createParametricStaircaseGeometry({
        targetHeight: height,
        idealStepHeight: options.idealStepHeight,
        strideConstant: options.strideConstant,
        width,
        stairStructure: structure,
        railingMode: railing
      }).geometry;
    }
  }

  return buildStairFlightGeometry({ style, width, height, length, numSteps, structure, railing });
}
