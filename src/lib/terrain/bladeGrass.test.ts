import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Shape, DEFAULT_GRASS_SETTINGS } from '../../types';
import {
  bladesPerSquareMetre, grassRings, MAX_RING_BLADES, createBladeTemplate, createGrassField,
  maskResolution, ringOrigin, GrassTrail, TRAIL_LENGTH
} from './bladeGrass';
import { createBladeGrassMaterial, createBladeGrassUniforms, createBladeRingUniforms, updateRingUniforms } from './bladeGrassMaterial';

const terrain = (heights = new Array(16 * 16).fill(0)): Shape => ({
  id: 't-1', name: 'Terrain', type: 'terrain', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
  color: '#ffffff', args: [20, 0, 20],
  terrainData: { gridX: 16, gridY: 16, width: 20, depth: 20, heights },
});

describe('Dense blade grass', () => {
  it('draws hundreds of blades per square metre and stays within the ring budgets', () => {
    expect(bladesPerSquareMetre(DEFAULT_GRASS_SETTINGS.density)).toBeGreaterThanOrEqual(300);
    for (const density of [1, 10, 25]) {
      const rings = grassRings({ ...DEFAULT_GRASS_SETTINGS, density });
      expect(rings).toHaveLength(3);
      rings.forEach((ring, i) => {
        expect(ring.cells * ring.cells).toBeLessThanOrEqual(MAX_RING_BLADES[i] * 1.02);
        expect(ring.cells * ring.spacing).toBeGreaterThanOrEqual(2 * ring.radius - 1e-6);
      });
      for (let i = 1; i < rings.length; i++) {
        expect(rings[i].radius).toBeGreaterThan(rings[i - 1].radius);
        expect(rings[i].spacing).toBeGreaterThan(rings[i - 1].spacing);
        expect(rings[i].segments).toBeLessThan(rings[i - 1].segments);
        // Sparser rings get wider blades so ground coverage doesn't drop off.
        expect(rings[i].widthScale).toBeGreaterThanOrEqual(rings[i - 1].widthScale);
      }
      expect(rings[0].widthScale).toBe(1);
    }
  });

  it('keeps taller grass visible further away', () => {
    const lawn = grassRings({ density: 10, baseHeight: 0.05, heightVariance: 0.1 });
    const meadow = grassRings({ density: 10, baseHeight: 0.8, heightVariance: 0.5 });
    expect(meadow[2].radius).toBeGreaterThan(lawn[2].radius);
  });

  it('builds a blade template with a centre ridge per row', () => {
    const geometry = createBladeTemplate(5);
    expect(geometry.getAttribute('position').count).toBe(3 * 6);
    expect(geometry.getIndex()!.count / 3).toBe(4 * 5);
    const ts = Array.from({ length: 18 }, (_, i) => geometry.getAttribute('position').getY(i));
    expect(Math.min(...ts)).toBe(0);
    expect(Math.max(...ts)).toBe(1);
    geometry.dispose();
  });

  it('snaps ring grids to whole cells so blades stay put as the camera moves', () => {
    const [ring] = grassRings(DEFAULT_GRASS_SETTINGS);
    const a = ringOrigin(ring, 3.217, -8.9), b = ringOrigin(ring, 3.217 + ring.spacing * 0.4, -8.9);
    for (const origin of [a, b]) {
      expect(Math.abs(origin.x / ring.spacing - Math.round(origin.x / ring.spacing))).toBeLessThan(1e-6);
      expect(Math.abs(origin.y / ring.spacing - Math.round(origin.y / ring.spacing))).toBeLessThan(1e-6);
    }
    expect(a.x + (ring.cells * ring.spacing) / 2).toBeCloseTo(3.217, 0);
  });

  it('bakes the terrain height grid and a slope mask', () => {
    const heights = new Array(16 * 16).fill(0).map((_, i) => (i % 16 >= 12 ? (i % 16 - 12) * 3 : 0));
    const field = createGrassField(terrain(heights), [], [], DEFAULT_GRASS_SETTINGS);
    expect(field.heights.image.width).toBe(16);
    expect((field.heights.image.data as Float32Array)[13]).toBe(3);
    const [nx, nz] = maskResolution(20, 20);
    expect(field.mask.image.width).toBe(nx);
    const data = field.mask.image.data as Uint8Array;
    expect(data[Math.floor(nz / 2) * nx + 2]).toBe(255); // flat west side grows grass
    expect(data[Math.floor(nz / 2) * nx + nx - 2]).toBe(0); // steep east side does not
    expect(field.bounds.toArray()).toEqual([-10, -10, 20, 20]);
    field.heights.dispose(); field.mask.dispose();
  });

  it('records footprints only after the walker moves, and keeps standing footprints pressed', () => {
    const trail = new GrassTrail();
    expect(trail.step(0, 0, 1)).toBe(true);
    expect(trail.step(0.05, 0, 2)).toBe(false);
    expect(trail.points[0].z).toBe(2);
    expect(trail.step(1, 0, 3)).toBe(true);
    for (let i = 0; i < TRAIL_LENGTH * 2; i++) trail.step(2 + i, 0, 4 + i);
    expect(trail.points.every(point => point.w === 1)).toBe(true);
    trail.clear();
    expect(trail.points.every(point => point.w === 0)).toBe(true);
  });

  it('hands over between rings over the same distance band', () => {
    const rings = grassRings(DEFAULT_GRASS_SETTINGS);
    const near = createBladeRingUniforms(), far = createBladeRingUniforms();
    updateRingUniforms(near, rings[0], undefined, 0, 0);
    updateRingUniforms(far, rings[1], rings[0], 0, 0);
    expect(near.uFadeIn.value.x).toBeGreaterThan(near.uFadeIn.value.y);
    expect(far.uFadeIn.value.toArray()).toEqual(near.uFade.value.toArray());
    expect(far.uFade.value.y).toBeLessThanOrEqual(rings[1].radius);
  });

  it('patches a lit standard material with the shared and ring uniforms', () => {
    const shared = createBladeGrassUniforms(), ring = createBladeRingUniforms();
    const material = createBladeGrassMaterial(shared, ring);
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    };
    material.onBeforeCompile(shader as any, {} as any);
    expect(shader.uniforms.uTrail).toBe(shared.uTrail);
    expect(shader.uniforms.uOrigin).toBe(ring.uOrigin);
    expect(shader.vertexShader).toContain('gl_InstanceID');
    expect(shader.vertexShader).not.toContain('#include <begin_vertex>');
    expect(shader.fragmentShader).toContain('directionalLights[0]');
    material.dispose();
  });
});
