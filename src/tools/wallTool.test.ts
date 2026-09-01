import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { WallTool } from './wallTool';
import { WallSegment } from './inference/types';

describe('WallTool State Machine & Option A T-Junction', () => {
  it('cycles wall justification from exterior -> center -> interior -> exterior', () => {
    const tool = new WallTool();
    expect(tool.getState().justification).toBe('exterior');

    expect(tool.cycleJustification()).toBe('center');
    expect(tool.getState().justification).toBe('center');

    expect(tool.cycleJustification()).toBe('interior');
    expect(tool.getState().justification).toBe('interior');

    expect(tool.cycleJustification()).toBe('exterior');
    expect(tool.getState().justification).toBe('exterior');
  });

  it('detects contextual thickness (0.2m exterior, 0.1m interior)', () => {
    const tool = new WallTool();
    expect(tool.detectContextualThickness(false)).toBe(0.20);
    expect(tool.detectContextualThickness(true)).toBe(0.10);
  });

  it('solves Option A T-Junction: truncates interior partition flush against host interior face', () => {
    const tool = new WallTool();

    // Host exterior wall along X axis from (0,0,0) to (10,0,0), thickness 0.20m
    const hostWall: WallSegment = {
      id: 'host-1',
      startPoint: [0, 0, 0],
      endPoint: [10, 0, 0],
      thickness: 0.20,
      height: 2.40,
    };

    // Interior partition drawn from (5, 0, 5) towards (5, 0, 0)
    const start = new THREE.Vector3(5, 0, 5);
    const end = new THREE.Vector3(5, 0, 0);

    const result = tool.solveOptionATJunction(start, end, hostWall);
    expect(result.isJunction).toBe(true);
    expect(result.hostWallId).toBe('host-1');
    // Interior face is at z = 0.10 (half of 0.20m thickness towards start)
    expect(result.adjustedEndPoint.x).toBeCloseTo(5);
    expect(result.adjustedEndPoint.z).toBeCloseTo(0.10);
  });
});
