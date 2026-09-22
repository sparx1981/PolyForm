import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { dequantizeAttributes } from './plantAssets';

describe('dequantizeAttributes', () => {
  it('lets applyMatrix4 scale a KHR_mesh_quantization-style normalized position attribute beyond [-1,1]', () => {
    // Int16 normalized attribute, as produced by EXT_meshopt_compression + KHR_mesh_quantization -
    // every real value is confined to [-1,1] by construction (that's what "normalized" means here).
    const geometry = new THREE.BufferGeometry();
    const quantized = new Int16Array([16384, -16384, 8192]); // ~[0.5, -0.5, 0.25]
    const position = new THREE.BufferAttribute(quantized, 3, true);
    geometry.setAttribute('position', position);

    // Baking a real-world node scale (as plantAssets.ts does for a decimated Poly Haven model)
    // pushes the value to 5, which cannot be represented by a normalized Int16 attribute - writing
    // it back through the normalized setter would clamp it straight back into [-1,1].
    const scale = new THREE.Matrix4().makeScale(10, 10, 10);
    const untouched = geometry.clone().applyMatrix4(scale);
    // Wraps/clamps into the normalized int16 range instead of holding the real value (5) -
    // exactly what corrupted every Poly Haven tree's geometry before this fix.
    expect(untouched.getAttribute('position').getX(0)).not.toBeCloseTo(5, 1);

    const fixed = dequantizeAttributes(geometry.clone()).applyMatrix4(scale);
    expect(fixed.getAttribute('position').getX(0)).toBeCloseTo(5, 1);
    expect(fixed.getAttribute('position').normalized).toBe(false);
  });

  it('leaves already-plain (non-normalized) attributes untouched', () => {
    const geometry = new THREE.BufferGeometry();
    const position = new THREE.BufferAttribute(new Float32Array([1, 2, 3]), 3, false);
    geometry.setAttribute('position', position);
    const result = dequantizeAttributes(geometry);
    expect(result.getAttribute('position').getX(0)).toBe(1);
  });
});
