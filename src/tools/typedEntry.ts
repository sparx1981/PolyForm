/**
 * PolyForm — typed values for drawing and editing tools (the "type a number" box).
 *
 * Like SketchUp's measurement box: draw or drag roughly, then type a value and press Enter to make
 * it exact - while you drag, between clicks of a chain, or right after you let go (which adjusts
 * the step you just did). What you type shows in the status bar. Values use the model's display
 * unit unless they carry their own (2.5m, 300mm, 8'6"); angles are degrees; "8s" sets sides.
 *
 * This file is the pure part: which keys belong to the value, what it means for each kind of
 * step, and the outlines the shape tools draw. Viewport.tsx wires it to the tools.
 */

import * as THREE from 'three';
import { convert, isMeasurementKey, parseMeasurement, type DocumentUnit } from './measurement';

export type DisplayUnit = 'm' | 'cm' | 'mm';

/**
 * Whether a key goes into the typed value. A value starts with a digit, a point, a minus sign or
 * an opening [ or < (a point or offset); once one is started, letters belong to it too (2.5m,
 * 8s, 45deg), so they don't trigger tool shortcuts half-way through.
 */
export function acceptsTypedKey(key: string, typed: string): boolean {
  if (typed === '') return /^[0-9.\-[<]$/.test(key);
  return key !== 'Delete' && isMeasurementKey(key);
}

/** A length (metres) from what was typed: 2.5, 300mm, 8'6", or a radius written 2r. */
export function parseTypedLength(typed: string, unit: DisplayUnit): number | null {
  const r = parseMeasurement(typed, unit as DocumentUnit);
  if (!r.ok) return null;
  // The parser answers in the display unit (a bare number is in it); lengths here are metres.
  if (r.value.kind === 'length' || r.value.kind === 'radius') return convert(r.value.value, unit, 'm');
  return null;
}

/** An angle in degrees: 45 or 45deg / 45°. */
export function parseTypedAngle(typed: string): number | null {
  const r = parseMeasurement(typed, 'm');
  if (!r.ok) return null;
  if (r.value.kind === 'angle') return r.value.degrees;
  const n = Number(typed.trim());
  return Number.isFinite(n) ? n : null;
}

/** A scale factor: 2, 0.5 or 2x. */
export function parseTypedFactor(typed: string): number | null {
  const m = /^([+-]?\d*\.?\d+)\s*x?$/i.exec(typed.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/** A side count: 8s (3 to 64). */
export function parseTypedSides(typed: string): number | null {
  const r = parseMeasurement(typed, 'm');
  if (!r.ok || r.value.kind !== 'segments') return null;
  return Math.min(64, Math.max(3, r.value.count));
}

/** Width and depth for a rectangle: "3,2" or "3;2", each with an optional unit. */
export function parseTypedRectangle(typed: string, unit: DisplayUnit): { x: number; y: number } | null {
  const parts = typed.split(/[,;]/).map(p => p.trim());
  if (parts.length !== 2) return null;
  const x = parseTypedLength(parts[0]!, unit);
  const y = parseTypedLength(parts[1]!, unit);
  return x !== null && y !== null && x !== 0 && y !== 0 ? { x, y } : null;
}

/** A point [x, y, z] or an offset <x, y, z>, in metres. */
export function parseTypedVector(typed: string, unit: DisplayUnit): { kind: 'absolute' | 'relative'; v: THREE.Vector3 } | null {
  const r = parseMeasurement(typed, unit as DocumentUnit);
  if (!r.ok) return null;
  const m = convert(1, unit, 'm');
  if (r.value.kind === 'absolute') return { kind: 'absolute', v: new THREE.Vector3(r.value.point.x, r.value.point.y, r.value.point.z).multiplyScalar(m) };
  if (r.value.kind === 'relative') return { kind: 'relative', v: new THREE.Vector3(r.value.offset.x, r.value.offset.y, r.value.offset.z).multiplyScalar(m) };
  return null;
}

/**
 * The drawing tools' axes on a plane: tangent and bitangent span it; zAxis is the in-plane axis
 * the shape previews use (cross(tangent, normal)). Matches Viewport's drag maths exactly.
 */
export function drawingBasis(normal: THREE.Vector3) {
  const up = new THREE.Vector3(0, 1, 0);
  if (Math.abs(normal.dot(up)) > 0.99) up.set(0, 0, 1);
  const tangent = new THREE.Vector3().crossVectors(normal, up).normalize();
  const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
  const zAxis = new THREE.Vector3().crossVectors(tangent, normal).normalize();
  return { tangent, bitangent, zAxis };
}

/** A rectangle's corners from one corner and signed sizes along the plane's tangent and bitangent. */
export function rectangleRing(start: THREE.Vector3, normal: THREE.Vector3, x: number, y: number): THREE.Vector3[] {
  const { tangent, bitangent } = drawingBasis(normal);
  return [
    start.clone(),
    start.clone().addScaledVector(tangent, x),
    start.clone().addScaledVector(tangent, x).addScaledVector(bitangent, y),
    start.clone().addScaledVector(bitangent, y),
  ];
}

/** A regular polygon's corners (a circle is 32 of them), as the Circle, Polygon and Triangle tools draw. */
export function regularRing(center: THREE.Vector3, normal: THREE.Vector3, radius: number, sides: number): THREE.Vector3[] {
  const { tangent, zAxis } = drawingBasis(normal);
  return Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2;
    return center.clone().addScaledVector(tangent, Math.sin(a) * radius).addScaledVector(zAxis, Math.cos(a) * radius);
  });
}

/** The point `length` along the direction from `from` towards `towards` (along +X if they coincide). */
export function pointAlong(from: THREE.Vector3, towards: THREE.Vector3, length: number): THREE.Vector3 {
  const dir = towards.clone().sub(from);
  if (dir.lengthSq() < 1e-12) dir.set(1, 0, 0);
  return from.clone().addScaledVector(dir.normalize(), length);
}

/** Converts a length in metres to the display unit, for messages. */
export function formatTyped(metres: number, unit: DisplayUnit): string {
  const v = unit === 'mm' ? metres * 1000 : unit === 'cm' ? metres * 100 : metres;
  return `${Number(v.toFixed(unit === 'm' ? 3 : 1))} ${unit}`;
}
