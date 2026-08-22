/**
 * PolyForm — measurement field parsing. §4.3
 *
 * Precision without a dialog: inference plus this field means exact modelling
 * never requires leaving the drawing gesture. Type nothing and get a fast
 * sketch; type a number and get a 2400 mm wall. The fast path and the precise
 * path are the same path.
 *
 * Pure. No tool state, no kernel access — just text in, intent out.
 */

import type { Vec3 } from '../lib/geometry/types';

export type DocumentUnit = 'm' | 'cm' | 'mm' | 'ft' | 'in';

/** Metres per one of each unit. The single source of conversion truth. */
const METRES: Record<DocumentUnit, number> = {
  m: 1,
  cm: 0.01,
  mm: 0.001,
  ft: 0.3048,
  in: 0.0254,
};

export type Measurement =
  | { kind: 'length'; value: number }
  /** Absolute coordinates: [x, y, z] */
  | { kind: 'absolute'; point: Vec3 }
  /** Relative to the segment start: <x, y, z> */
  | { kind: 'relative'; offset: Vec3 }
  /** Arc radius: 24r */
  | { kind: 'radius'; value: number }
  /** Arc segment count: 12s */
  | { kind: 'segments'; count: number }
  /** Angle in degrees: 45deg or 45° */
  | { kind: 'angle'; degrees: number };

export interface ParseFailure {
  readonly ok: false;
  readonly reason: string;
}
export interface ParseSuccess {
  readonly ok: true;
  readonly value: Measurement;
}
export type ParseResult = ParseSuccess | ParseFailure;

const fail = (reason: string): ParseFailure => ({ ok: false, reason });
const ok = (value: Measurement): ParseSuccess => ({ ok: true, value });

/** Converts a value expressed in `from` into document units. */
export function convert(value: number, from: DocumentUnit, to: DocumentUnit): number {
  return (value * METRES[from]) / METRES[to];
}

const UNIT_ALIASES: Record<string, DocumentUnit> = {
  m: 'm', metre: 'm', metres: 'm', meter: 'm', meters: 'm',
  cm: 'cm', centimetre: 'cm', centimetres: 'cm', centimeter: 'cm', centimeters: 'cm',
  mm: 'mm', millimetre: 'mm', millimetres: 'mm', millimeter: 'mm', millimeters: 'mm',
  ft: 'ft', foot: 'ft', feet: 'ft',
  in: 'in', inch: 'in', inches: 'in',
};

/**
 * A bare number with an optional unit suffix.
 * Returns null when the text is not a plain scalar.
 */
function parseScalar(text: string, docUnit: DocumentUnit): number | null {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*([a-z]*)$/i.exec(text);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  const suffix = (m[2] ?? '').toLowerCase();
  if (suffix === '') return value;
  const unit = UNIT_ALIASES[suffix];
  if (!unit) return null;
  return convert(value, unit, docUnit);
}

/**
 * Feet-and-inches: 8', 6", 8'6", 8' 6", 8ft 6in.
 * Returns null when the text is not in that form.
 */
function parseImperial(text: string, docUnit: DocumentUnit): number | null {
  const m = /^([+-]?\d+\.?\d*)\s*(?:'|ft|feet)\s*(?:([+-]?\d+\.?\d*)\s*(?:"|in|inch|inches)?)?$/i
    .exec(text);
  if (m) {
    const feet = Number(m[1]);
    const inches = m[2] === undefined ? 0 : Number(m[2]);
    if (!Number.isFinite(feet) || !Number.isFinite(inches)) return null;
    const sign = feet < 0 ? -1 : 1;
    return convert(Math.abs(feet) * 12 + Math.abs(inches), 'in', docUnit) * sign;
  }
  const inchOnly = /^([+-]?\d+\.?\d*)\s*(?:"|in|inch|inches)$/i.exec(text);
  if (inchOnly) {
    const inches = Number(inchOnly[1]);
    if (!Number.isFinite(inches)) return null;
    return convert(inches, 'in', docUnit);
  }
  return null;
}

/** Three comma- or semicolon-separated components, each possibly with a unit. */
function parseTriple(inner: string, docUnit: DocumentUnit): Vec3 | null {
  const parts = inner.split(/[,;]/).map((p) => p.trim());
  if (parts.length !== 3) return null;
  const nums: number[] = [];
  for (const p of parts) {
    const imperial = parseImperial(p, docUnit);
    const scalar = imperial ?? parseScalar(p, docUnit);
    if (scalar === null) return null;
    nums.push(scalar);
  }
  return { x: nums[0]!, y: nums[1]!, z: nums[2]! };
}

/**
 * Parses whatever the user typed into the measurement field.
 *
 * Order matters: the bracketed and suffixed forms are checked before the bare
 * scalar, or `24r` would parse as 24 with an unknown unit.
 */
export function parseMeasurement(
  raw: string,
  docUnit: DocumentUnit = 'm',
): ParseResult {
  const text = raw.trim();
  if (text === '') return fail('empty');

  // Absolute [x, y, z]
  const abs = /^\[(.*)\]$/.exec(text);
  if (abs) {
    const point = parseTriple(abs[1] ?? '', docUnit);
    return point ? ok({ kind: 'absolute', point }) : fail('expected three numbers in [x, y, z]');
  }

  // Relative <x, y, z>
  const rel = /^<(.*)>$/.exec(text);
  if (rel) {
    const offset = parseTriple(rel[1] ?? '', docUnit);
    return offset ? ok({ kind: 'relative', offset }) : fail('expected three numbers in <x, y, z>');
  }

  // Angle: 45deg, 45°
  const ang = /^([+-]?\d+\.?\d*)\s*(?:deg|degrees|°)$/i.exec(text);
  if (ang) {
    const degrees = Number(ang[1]);
    return Number.isFinite(degrees) ? ok({ kind: 'angle', degrees }) : fail('bad angle');
  }

  // Segment count: 12s. Must be a positive integer — a curve cannot have
  // 2.5 segments, and silently rounding hides a typo.
  const seg = /^(\d+)\s*s$/i.exec(text);
  if (seg) {
    const count = Number(seg[1]);
    if (!Number.isInteger(count) || count < 2) return fail('segment count must be an integer >= 2');
    if (count > 1000) return fail('segment count above 1000 is not useful');
    return ok({ kind: 'segments', count });
  }

  // Radius: 24r, 2400mmr
  const rad = /^([+-]?\d+\.?\d*)\s*([a-z]*)r$/i.exec(text);
  if (rad) {
    const inner = `${rad[1]}${rad[2] ?? ''}`;
    const value = parseScalar(inner, docUnit);
    if (value === null) return fail('bad radius');
    if (value <= 0) return fail('radius must be positive');
    return ok({ kind: 'radius', value });
  }

  // Imperial before the bare scalar, so 8'6" is not read as 8.
  const imperial = parseImperial(text, docUnit);
  if (imperial !== null) return ok({ kind: 'length', value: imperial });

  const scalar = parseScalar(text, docUnit);
  if (scalar !== null) return ok({ kind: 'length', value: scalar });

  return fail(`could not parse "${raw}"`);
}

/**
 * Formats a length for display in the field.
 * Trailing zeros are trimmed — "2.4" reads better than "2.400000".
 */
export function formatLength(value: number, docUnit: DocumentUnit = 'm', precision = 4): string {
  if (!Number.isFinite(value)) return '';
  if (docUnit === 'ft') {
    const totalInches = convert(value, 'ft', 'in');
    const sign = totalInches < 0 ? '-' : '';
    const abs = Math.abs(totalInches);
    const feet = Math.floor(abs / 12);
    const inches = abs - feet * 12;
    const inchText = Number(inches.toFixed(precision)).toString();
    return feet > 0 ? `${sign}${feet}' ${inchText}"` : `${sign}${inchText}"`;
  }
  const rounded = Number(value.toFixed(precision));
  return `${rounded}${docUnit}`;
}

/**
 * Keystroke routing.
 *
 * The user never clicks into the field — keystrokes go there automatically
 * during a drag. This decides which ones belong to it, so the tool can pass
 * everything else through to shortcuts and inference locks.
 */
export function isMeasurementKey(key: string): boolean {
  if (key.length === 1) return /[0-9.,;'"<>[\]a-zA-Z°+-]/.test(key);
  return key === 'Backspace' || key === 'Delete';
}
