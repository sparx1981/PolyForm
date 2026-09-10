import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import {
  applyCivilUVProjection,
  prepareTerrainGeometry,
  exportTerrainToOBJ,
  exportTerrainToGLB,
} from './terrainExporter';
import { dispatchTerrainRasterWithWatchdog } from './workerWatchdog';
import type { RoadModifier, PadModifier } from '../../types';

beforeAll(() => {
  if (typeof (globalThis as any).FileReader === 'undefined') {
    class MockFileReader {
      onload: any = null;
      onloadend: any = null;
      result: any = null;
      readAsArrayBuffer(blob: any) {
        if (blob && blob.arrayBuffer) {
          blob.arrayBuffer().then((buf: any) => {
            this.result = buf;
            if (this.onload) this.onload({ target: this });
            if (this.onloadend) this.onloadend({ target: this });
          });
        } else {
          this.result = new ArrayBuffer(0);
          if (this.onload) this.onload({ target: this });
          if (this.onloadend) this.onloadend({ target: this });
        }
      }
    }
    (globalThis as any).FileReader = MockFileReader;
  }
});

describe('Terrain Exporter & Watchdog Suite', () => {
  it('applies civil UV projection mapping across planar bounds', () => {
    const geo = new THREE.PlaneGeometry(20, 20, 2, 2);
    applyCivilUVProjection(geo, 10.0);
    const uvAttr = geo.getAttribute('uv');
    expect(uvAttr).toBeDefined();
    expect(uvAttr.count).toBe(geo.getAttribute('position').count);

    // Coordinate [0, 0] should map to UV [0, 0]
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      expect(uvAttr.getX(i)).toBeCloseTo(x / 10.0);
      expect(uvAttr.getY(i)).toBeCloseTo(z / 10.0);
    }
  });

  it('prepares terrain geometry with sanitized elevations and normals', () => {
    const geo = new THREE.PlaneGeometry(10, 10, 2, 2);
    const pos = geo.getAttribute('position');
    pos.setY(0, 99999); // Extreme elevation outside allowed civil range
    pos.needsUpdate = true;

    const cleaned = prepareTerrainGeometry(geo, 5.0);
    const cleanPos = cleaned.getAttribute('position');
    expect(cleanPos.getY(0)).toBe(5000); // Clamped to 5000m
    expect(cleaned.getAttribute('normal')).toBeDefined();
    expect(cleaned.getAttribute('uv')).toBeDefined();
  });

  it('exports terrain geometry to valid Wavefront OBJ string format', () => {
    const geo = new THREE.PlaneGeometry(10, 10, 2, 2);
    const objText = exportTerrainToOBJ(geo);
    expect(typeof objText).toBe('string');
    expect(objText.length).toBeGreaterThan(50);
    expect(objText).toContain('v ');
    expect(objText).toContain('vn ');
    expect(objText).toContain('f ');
  });

  it('exports terrain and civil modifiers into binary GLB blob', async () => {
    const geo = new THREE.PlaneGeometry(15, 15, 2, 2);
    const pad: PadModifier = {
      id: 'test-pad-1',
      name: 'Test Building Pad',
      type: 'pad',
      enabled: true,
      center: [0, 2.0, 0],
      primitive: 'rectangle',
      dimensions: [10, 8],
      rotationY: 0,
      targetElevation: 2.0,
      batterDistance: 2.0,
      batterProfile: 'linear',
    };

    const road: RoadModifier = {
      id: 'test-road-1',
      name: 'Access Corridor',
      type: 'road',
      enabled: true,
      points: [
        [-5, 0, -5],
        [0, 0.5, 0],
        [5, 1.0, 5],
      ],
      width: 4.0,
      maxGradePercent: 8,
      bankingAngle: 0,
      markings: 'center-dashed',
      profile: 'crowned',
    };

    const glbBlob = await exportTerrainToGLB(geo, [pad, road], { includeCutFill: true });
    expect(glbBlob).toBeDefined();
    expect(glbBlob.size).toBeGreaterThan(100);
    expect(glbBlob.type).toContain('model/gltf-binary');
  });

  it('dispatches rasterization with watchdog and returns accurate cut/fill calculations', async () => {
    const gridW = 8;
    const gridD = 8;
    const baseHeights = new Float32Array(gridW * gridD).fill(1.0);

    const pad: PadModifier = {
      id: 'watchdog-pad',
      name: 'Site Pad',
      type: 'pad',
      enabled: true,
      center: [0, 2.5, 0],
      primitive: 'rectangle',
      dimensions: [6, 6],
      rotationY: 0,
      targetElevation: 2.5,
      batterDistance: 1.0,
      batterProfile: 'linear',
    };

    const result = await dispatchTerrainRasterWithWatchdog({
      gridWidth: gridW,
      gridDepth: gridD,
      bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
      baseHeights,
      modifiers: [pad],
    });

    expect(result).toBeDefined();
    expect(result.metrics).toBeDefined();
    expect(result.metrics.fillVolumeM3).toBeGreaterThan(0);
    expect(result.modifiedHeights.length).toBe(gridW * gridD);
  });
});
