import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createLampGeometry, getLampLightAnchor, getLampLightAimOffset } from './landscapeGeometry';
import { LAMP_STYLES, findLampStyle } from './lampStyles';

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

  it('covers both interior and exterior categories', () => {
    expect(LAMP_STYLES.some(s => s.category === 'exterior')).toBe(true);
    expect(LAMP_STYLES.some(s => s.category === 'interior')).toBe(true);
  });

  it('gives every style a light spec with the fields its own type needs', () => {
    for (const style of LAMP_STYLES) {
      const { light } = style;
      expect(['point', 'spot', 'rect']).toContain(light.type);
      expect(light.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(light.intensity).toBeGreaterThan(0);
      if (light.type === 'spot') {
        expect(light.angle).toBeGreaterThan(0);
        expect(light.penumbra).toBeGreaterThanOrEqual(0);
      }
      if (light.type === 'rect') {
        expect(light.width).toBeGreaterThan(0);
        expect(light.height).toBeGreaterThan(0);
      }
    }
  });

  it('gives every directional (spot) style a downward aim offset', () => {
    const spotStyles = LAMP_STYLES.filter(s => s.light.type === 'spot');
    expect(spotStyles.length).toBeGreaterThan(0);
    for (const style of spotStyles) {
      const [, y] = getLampLightAimOffset(style.id);
      expect(y).toBeLessThan(0);
    }
  });

  it('keeps roadway fixtures at a realistic minimum height regardless of the shape arg', () => {
    // A freshly-placed landscape feature starts with args [1,1,1] (see Viewport.tsx's
    // placement code), so a tiny height arg must not shrink a cobra head or LED
    // cutoff down to a toy-scale pedestrian post.
    for (const id of ['cobra', 'cobra-double', 'modern-led']) {
      const geometry = createLampGeometry(1, id);
      geometry.computeBoundingBox();
      expect(geometry.boundingBox!.max.y).toBeGreaterThan(5);
      geometry.dispose();
    }
  });

  it('emits light at or below a ceiling fixture\'s own mounting point, not above it', () => {
    // The housing itself can extend a little ABOVE the mounting plane (a recessed
    // can's body genuinely sits up in the ceiling cavity in real life) - it's the
    // light-emitting point that must be at or below where the fixture is mounted.
    for (const id of ['pendant', 'chandelier', 'recessed', 'track', 'troffer', 'high-bay']) {
      const [, y] = getLampLightAnchor(1, id);
      expect(y).toBeLessThanOrEqual(0.01);
    }
  });

  it('tags every style with where it actually mounts', () => {
    for (const style of LAMP_STYLES) {
      expect(['floor', 'ceiling', 'wall']).toContain(style.mount);
    }
    // Every ceiling-mount style is interior - there's no such thing as an exterior
    // fixture that mounts to a ceiling in this library.
    for (const style of LAMP_STYLES.filter(s => s.mount === 'ceiling')) {
      expect(style.category).toBe('interior');
    }
  });

  it('gives cobra and cobra-double their requested 46 intensity / 4.5 scale', () => {
    for (const id of ['cobra', 'cobra-double']) {
      const style = findLampStyle(id);
      expect(style.light.intensity).toBe(46);
      expect(style.light.scale).toBe(4.5);
    }
  });

  it('gives modern-led a rect light, not a spot', () => {
    expect(findLampStyle('modern-led').light.type).toBe('rect');
  });
});
