import type { StairStyleType } from '../archStairGenerator';
import { ALL_STAIR_STYLES } from '../archStairGenerator';
import {
  DEFAULT_STAIRCASE_HEIGHT,
  DEFAULT_IDEAL_STEP_HEIGHT,
  DEFAULT_STRIDE_CONSTANT
} from '../parametricStairs';

/**
 * styleParamSchema.ts
 * -------------------
 * StairFix Phase 3: a single source of truth for "which parameters apply to
 * which staircase style", so the parameter panel can disable/gray out and
 * label inapplicable controls instead of silently ignoring them (the "dead
 * control" / "misleading option" failure mode called out in the spec).
 *
 * Any UI that renders per-style parameters (e.g. RightPanelStack.tsx /
 * StyleLibraryModal.tsx) should read this map rather than hard-coding a
 * parallel set of conditionals — that duplication is exactly how the panel
 * and the geometry engine drift apart over time.
 */

export type StairParamKey =
  | 'stepCount'
  | 'riserHeight'
  | 'treadDepth'
  | 'width'
  | 'turnRadius'
  | 'sweepAngle'
  | 'helixPitch'
  | 'stairStructure'
  | 'railingMode';

export interface StairParamDef {
  key: StairParamKey;
  label: string;
  /** Shown in a tooltip on a disabled control, per spec section 1.5. */
  disabledReason: string;
}

export const ALL_STAIR_PARAM_DEFS: Record<StairParamKey, StairParamDef> = {
  stepCount: { key: 'stepCount', label: 'Step Count', disabledReason: 'Step count applies to every style.' },
  riserHeight: { key: 'riserHeight', label: 'Riser Height', disabledReason: 'Riser height applies to every style.' },
  treadDepth: { key: 'treadDepth', label: 'Tread Depth', disabledReason: 'Tread depth applies to every style.' },
  width: { key: 'width', label: 'Width', disabledReason: 'Width applies to every style.' },
  turnRadius: {
    key: 'turnRadius',
    label: 'Turn Radius',
    disabledReason: 'Turn radius applies to Spiral, Curved, and C-Shaped styles only.'
  },
  sweepAngle: {
    key: 'sweepAngle',
    label: 'Sweep Angle',
    disabledReason: 'Sweep angle applies to Curved and C-Shaped styles only.'
  },
  helixPitch: {
    key: 'helixPitch',
    label: 'Helix Pitch',
    disabledReason: 'Helix pitch applies to Spiral and Curved styles only.'
  },
  stairStructure: { key: 'stairStructure', label: 'Structure', disabledReason: 'Structure applies to every style.' },
  railingMode: { key: 'railingMode', label: 'Railing', disabledReason: 'Railing applies to every style.' }
};

/** Which parameters are meaningful/active for each of the 8 supported styles. */
export const STYLE_PARAM_SCHEMA: Record<StairStyleType, StairParamKey[]> = {
  'straight': ['stepCount', 'riserHeight', 'treadDepth', 'width', 'stairStructure', 'railingMode'],
  'l-shape': ['stepCount', 'riserHeight', 'treadDepth', 'width', 'stairStructure', 'railingMode'],
  'u-shape': ['stepCount', 'riserHeight', 'treadDepth', 'width', 'stairStructure', 'railingMode'],
  'winder': ['stepCount', 'riserHeight', 'treadDepth', 'width', 'stairStructure', 'railingMode'],
  'bifurcated': ['stepCount', 'riserHeight', 'treadDepth', 'stairStructure', 'railingMode'],
  'spiral': ['stepCount', 'riserHeight', 'width', 'turnRadius', 'helixPitch', 'railingMode'],
  'c-shape': ['stepCount', 'riserHeight', 'width', 'turnRadius', 'sweepAngle', 'railingMode'],
  'curved': ['stepCount', 'riserHeight', 'width', 'turnRadius', 'sweepAngle', 'helixPitch', 'railingMode']
};

/** Returns true if a given parameter control should be enabled for a style. */
export function isParamActiveForStyle(style: string, param: StairParamKey): boolean {
  const key = (style || 'straight').toLowerCase() as StairStyleType;
  const list = STYLE_PARAM_SCHEMA[key] || STYLE_PARAM_SCHEMA['straight'];
  return list.includes(param);
}

export function getParamDefsForStyle(style: string): StairParamDef[] {
  const key = (style || 'straight').toLowerCase() as StairStyleType;
  const list = STYLE_PARAM_SCHEMA[key] || STYLE_PARAM_SCHEMA['straight'];
  return list.map(k => ALL_STAIR_PARAM_DEFS[k]);
}

// ---------------------------------------------------------------------------
// Phase 4: persistence sanitation & diagnostics
// ---------------------------------------------------------------------------

export interface ParametricStairParameters {
  style: StairStyleType;
  targetHeight: number;
  idealStepHeight: number;
  strideConstant: number;
  width: number;
  stairStructure?: string;
  railingMode?: string;
}

export function getDefaultStairParameters(style: string): ParametricStairParameters {
  const validStyle = (ALL_STAIR_STYLES as string[]).includes(style) ? (style as StairStyleType) : 'straight';
  return {
    style: validStyle,
    targetHeight: DEFAULT_STAIRCASE_HEIGHT,
    idealStepHeight: DEFAULT_IDEAL_STEP_HEIGHT,
    strideConstant: DEFAULT_STRIDE_CONSTANT,
    width: 1.0,
    stairStructure: 'closed',
    railingMode: 'both'
  };
}

/**
 * Guards Firestore-loaded (or otherwise externally-supplied) stair parameter
 * objects against missing fields or an invalid/legacy style string, so a
 * corrupted or pre-StairFix document can never silently resolve to the
 * straight-run fallback the way the original bug did. Never throws.
 */
export function sanitizeStairParameters(raw: any): ParametricStairParameters {
  if (!raw || typeof raw !== 'object') return getDefaultStairParameters('straight');
  const style = (ALL_STAIR_STYLES as string[]).includes(raw.style) ? raw.style : 'straight';
  return {
    ...getDefaultStairParameters(style),
    ...raw,
    style
  };
}

export interface StairDiagnosticEvent {
  kind: 'clamped' | 'fallback' | 'regeneration-failed';
  message: string;
  paramKey?: StairParamKey;
}

/** Clamps a raw riser height to the safe ergonomic range, emitting a diagnostic if clamped. */
export function clampRiserHeight(value: number, maxRiser: number = 0.22): { value: number; event?: StairDiagnosticEvent } {
  if (value > maxRiser) {
    return {
      value: maxRiser,
      event: {
        kind: 'clamped',
        paramKey: 'riserHeight',
        message: `Riser Height clamped to ${maxRiser.toFixed(2)}m max`
      }
    };
  }
  if (value <= 0) {
    return {
      value: 0.15,
      event: { kind: 'clamped', paramKey: 'riserHeight', message: 'Riser Height clamped to 0.15m minimum' }
    };
  }
  return { value };
}
