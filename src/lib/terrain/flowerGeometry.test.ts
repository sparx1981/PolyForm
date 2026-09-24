import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createFlowerGeometry, FLOWER_KINDS, FLOWER_PART, meadowKinds } from './flowerGeometry';

describe('flower geometry', () => {
  it.each(FLOWER_KINDS)('%s: a modelled flower with a stem, real-size head and valid normals', kind => {
    const geometry = createFlowerGeometry(kind);
    const position = geometry.getAttribute('position');
    const attach = geometry.getAttribute('aAttach');
    const part = geometry.getAttribute('aPart');
    const normal = geometry.getAttribute('normal');
    expect(position.count).toBeGreaterThan(50);
    // Triangle budget: meadows can hold tens of thousands of flowers.
    expect(geometry.index!.count / 3).toBeLessThan(700);
    const parts = new Set<number>();
    let headReach = 0;
    for (let i = 0; i < position.count; i++) {
      parts.add(part.getX(i));
      // Offsets from the attach point are real sizes: flower heads are a few centimetres.
      headReach = Math.max(headReach, Math.hypot(position.getX(i), position.getY(i) - attach.getX(i), position.getZ(i)));
      const n = new THREE.Vector3(normal.getX(i), normal.getY(i), normal.getZ(i));
      expect(Number.isFinite(n.length())).toBe(true);
    }
    expect(headReach).toBeLessThan(0.08);
    expect(parts.has(FLOWER_PART.stem)).toBe(true);
    expect(parts.has(FLOWER_PART.leaf)).toBe(true);
    expect(parts.has(kind === 'lavender' ? FLOWER_PART.floret : FLOWER_PART.petal)).toBe(true);
  });

  it('a mixed meadow grows every species; a single-species meadow only that one', () => {
    expect(meadowKinds('mixed')).toEqual(FLOWER_KINDS);
    expect(meadowKinds('poppy')).toEqual(['poppy']);
  });
});
