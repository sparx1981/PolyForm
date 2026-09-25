import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { signedAngle, snapAngle } from './ProtractorTool';

describe('protractor angles', () => {
  it('measures signed angles about the protractor normal', () => {
    const up = new THREE.Vector3(0, 1, 0);
    const x = new THREE.Vector3(1, 0, 0);
    expect(signedAngle(x, new THREE.Vector3(0, 0, -1), up)).toBeCloseTo(90);
    expect(signedAngle(x, new THREE.Vector3(0, 0, 1), up)).toBeCloseTo(-90);
    expect(signedAngle(x, new THREE.Vector3(1, 0, -1).normalize(), up)).toBeCloseTo(45);
  });
  it('snaps to 15 degree steps only when close', () => {
    expect(snapAngle(44)).toBe(45);
    expect(snapAngle(31)).toBe(30);
    expect(snapAngle(37.5)).toBe(37.5);
  });
});
