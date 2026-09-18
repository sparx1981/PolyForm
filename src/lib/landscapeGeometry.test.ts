import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createLampGeometry, getLampLightAnchor } from './landscapeGeometry';
import { LAMP_STYLES } from './lampStyles';

describe('lamp styles', () => {
  it('builds a valid, non-empty geometry for every style', () => {
    for (const style of LAMP_STYLES) {
      const geometry = createLampGeometry(3.2, style.id);
      expect(geometry.attributes.position.count).toBeGreaterThan(0);
      expect(geometry.attributes.normal).toBeDefined();
      expect(geometry.attributes.uv).toBeDefined();
      expect(geometry.attributes.color).toBeDefined();
      geometry.dispose();
    }
  });

  it('falls back to the classic style for an unknown id', () => {
    const known = createLampGeometry(3.2, 'classic');
    const unknown = createLampGeometry(3.2, 'not-a-real-style');
    expect(unknown.attributes.position.count).toBe(known.attributes.position.count);
    known.dispose(); unknown.dispose();
  });

  it('builds visually distinct geometry per style (different vertex counts or footprints)', () => {
    const geometries = LAMP_STYLES.map(s => createLampGeometry(3.2, s.id));
    const signatures = geometries.map(g => {
      g.computeBoundingBox();
      const size = g.boundingBox!.getSize(new THREE.Vector3());
      return `${g.attributes.position.count}:${size.x.toFixed(2)}:${size.y.toFixed(2)}:${size.z.toFixed(2)}`;
    });
    expect(new Set(signatures).size).toBe(signatures.length);
    geometries.forEach(g => g.dispose());
  });

  it('places the light anchor within (or just above) each style’s own model bounds', () => {
    for (const style of LAMP_STYLES) {
      const geometry = createLampGeometry(3.2, style.id);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      const [x, y, z] = getLampLightAnchor(3.2, style.id);
      expect(x).toBeGreaterThanOrEqual(box.min.x - 0.05);
      expect(x).toBeLessThanOrEqual(box.max.x + 0.05);
      expect(y).toBeGreaterThanOrEqual(box.min.y - 0.05);
      expect(y).toBeLessThanOrEqual(box.max.y + 0.05);
      expect(z).toBeGreaterThanOrEqual(box.min.z - 0.05);
      expect(z).toBeLessThanOrEqual(box.max.z + 0.05);
      geometry.dispose();
    }
  });
});
