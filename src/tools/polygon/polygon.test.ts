import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { generatePolygonVertices } from './math';
import { PolygonTool } from './PolygonTool';

describe('Polygon Tool math & state', () => {
  it('generates regular circumscribed polygon vertices with exact side count + closed loop', () => {
    const center = new THREE.Vector3(0, 0, 0);
    const radiusPoint = new THREE.Vector3(2, 0, 0);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    
    // 6-sided hexagon
    const hexVertices = generatePolygonVertices(center, radiusPoint, 6, plane);
    expect(hexVertices.length).toBe(7); // 6 vertices + 1 closing vertex matching first
    expect(hexVertices[0].distanceTo(radiusPoint)).toBeLessThan(1e-4);
    expect(hexVertices[0].distanceTo(hexVertices[6])).toBeLessThan(1e-4);

    // Check all vertices have radius 2
    for (const v of hexVertices) {
      expect(Math.abs(v.distanceTo(center) - 2)).toBeLessThan(1e-4);
    }
  });

  it('updates side count on ArrowUp and ArrowDown keys within limits [3, 128]', () => {
    const tool = new PolygonTool();
    tool.activate();
    expect(tool.getState().sides).toBe(6);

    tool.onKeyDown('ArrowUp');
    expect(tool.getState().sides).toBe(7);

    tool.onKeyDown('ArrowDown');
    tool.onKeyDown('ArrowDown');
    expect(tool.getState().sides).toBe(5);

    // Limit clamp
    for (let i = 0; i < 10; i++) tool.onKeyDown('ArrowDown');
    expect(tool.getState().sides).toBe(3);
  });

  it('handles side and radius measurement inputs', () => {
    const tool = new PolygonTool();
    tool.activate();
    tool.setCenter(new THREE.Vector3(0, 0, 0));
    tool.setRadiusPoint(new THREE.Vector3(1, 0, 0));

    tool.handleMeasurementInput(8, 'sides');
    expect(tool.getState().sides).toBe(8);

    tool.handleMeasurementInput(3.5, 'radius');
    const radius = tool.getState().center!.distanceTo(tool.getState().radiusPoint!);
    expect(Math.abs(radius - 3.5)).toBeLessThan(1e-4);
  });
});
