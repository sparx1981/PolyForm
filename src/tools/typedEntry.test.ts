import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  acceptsTypedKey, parseTypedLength, parseTypedAngle, parseTypedFactor, parseTypedSides, parseTypedRectangle,
  parseTypedVector, regularRing, rectangleRing, pointAlong, drawingBasis,
} from './typedEntry';

describe('typed values', () => {
  it('starts a value only with a digit, point, minus, [ or <; then letters belong to it', () => {
    expect(acceptsTypedKey('2', '')).toBe(true);
    expect(acceptsTypedKey('-', '')).toBe(true);
    expect(acceptsTypedKey('<', '')).toBe(true);
    expect(acceptsTypedKey('m', '')).toBe(false); // M is still Move
    expect(acceptsTypedKey('m', '2.5')).toBe(true); // ...but 2.5m is a length
    expect(acceptsTypedKey('Backspace', '2')).toBe(true);
    expect(acceptsTypedKey('Enter', '2')).toBe(false);
  });

  it('reads lengths in the display unit unless they carry their own, always answering in metres', () => {
    expect(parseTypedLength('2.5', 'm')).toBeCloseTo(2.5);
    expect(parseTypedLength('2500', 'mm')).toBeCloseTo(2.5);
    expect(parseTypedLength('250', 'cm')).toBeCloseTo(2.5);
    expect(parseTypedLength('2.5m', 'mm')).toBeCloseTo(2.5);
    expect(parseTypedLength('300mm', 'm')).toBeCloseTo(0.3);
    expect(parseTypedLength("8'", 'm')).toBeCloseTo(2.4384);
    expect(parseTypedLength('1.2r', 'm')).toBeCloseTo(1.2);
    expect(parseTypedLength('45deg', 'm')).toBeNull();
    expect(parseTypedLength('abc', 'm')).toBeNull();
  });

  it('reads angles, factors, sides, rectangles and points', () => {
    expect(parseTypedAngle('90')).toBe(90);
    expect(parseTypedAngle('45deg')).toBe(45);
    expect(parseTypedFactor('2')).toBe(2);
    expect(parseTypedFactor('0.5x')).toBe(0.5);
    expect(parseTypedFactor('0')).toBeNull();
    expect(parseTypedSides('8s')).toBe(8);
    expect(parseTypedSides('200s')).toBe(64);
    expect(parseTypedRectangle('3000,2000', 'mm')).toEqual({ x: 3, y: 2 });
    expect(parseTypedRectangle('3', 'm')).toBeNull();
    const rel = parseTypedVector('<100, 0, 50>', 'cm')!;
    expect(rel.kind).toBe('relative');
    expect(rel.v.toArray()).toEqual([1, 0, 0.5]);
    expect(parseTypedVector('[1,2,3]', 'm')!.kind).toBe('absolute');
  });
});

describe('outlines', () => {
  const up = new THREE.Vector3(0, 1, 0);
  it('draws regular polygons of the given radius around their centre', () => {
    const ring = regularRing(new THREE.Vector3(1, 0, 1), up, 2, 6);
    expect(ring).toHaveLength(6);
    for (const p of ring) expect(p.distanceTo(new THREE.Vector3(1, 0, 1))).toBeCloseTo(2);
  });

  it('draws rectangles of the given signed size from their corner, on the drawing plane', () => {
    const ring = rectangleRing(new THREE.Vector3(0, 0, 0), up, 3, 2);
    const { tangent, bitangent } = drawingBasis(up);
    expect(ring[2]!.distanceTo(tangent.clone().multiplyScalar(3).addScaledVector(bitangent, 2))).toBeLessThan(1e-9);
    for (const p of ring) expect(p.y).toBeCloseTo(0);
  });

  it('measures along a direction', () => {
    expect(pointAlong(new THREE.Vector3(1, 0, 0), new THREE.Vector3(1, 0, 7), 2.5).toArray()).toEqual([1, 0, 2.5]);
  });
});
