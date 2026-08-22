import { describe, it, expect } from 'vitest';
import { KernelSession } from './index';
import { vec3 } from './math';

describe('KernelSession', () => {
  it('derives a face from a drawn chain', () => {
    const s = new KernelSession({ cameraDirection: vec3(0, 0, -1) });
    s.drawChain([vec3(0,0,0), vec3(2,0,0), vec3(2,2,0), vec3(0,2,0), vec3(0,0,0)]);
    expect(s.stats.faces).toBe(1);
    expect(s.totalArea()).toBeCloseTo(4, 9);
  });

  it('splits a face with a later line', () => {
    const s = new KernelSession({ cameraDirection: vec3(0, 0, -1) });
    s.drawChain([vec3(0,0,0), vec3(2,0,0), vec3(2,2,0), vec3(0,2,0), vec3(0,0,0)]);
    s.drawLine(vec3(0,0,0), vec3(2,2,0));
    expect(s.stats.faces).toBe(2);
    expect(s.totalArea()).toBeCloseTo(4, 9);
  });

  it('undoes and redoes with identical face ids', () => {
    const s = new KernelSession({ cameraDirection: vec3(0, 0, -1) });
    s.drawChain([vec3(0,0,0), vec3(2,0,0), vec3(2,2,0), vec3(0,2,0), vec3(0,0,0)]);
    const before = s.faceIds;
    s.drawLine(vec3(0,0,0), vec3(2,2,0));
    const after = s.faceIds;

    expect(s.undo()).toBe(true);
    expect(s.faceIds).toEqual(before);
    expect(s.redo()).toBe(true);
    expect(s.faceIds).toEqual(after);
  });

  it('reports when there is nothing to undo', () => {
    const s = new KernelSession();
    expect(s.canUndo).toBe(false);
    expect(s.undo()).toBe(false);
  });

  it('caps history length', () => {
    const s = new KernelSession({ cameraDirection: vec3(0, 0, -1) });
    for (let i = 0; i < 20; i++) s.drawLine(vec3(i, 0, 0), vec3(i, 1, 0));
    s.trimHistory(5);
    let count = 0;
    while (s.undo()) count++;
    expect(count).toBe(5);
  });

  it('works headless with no camera', () => {
    const s = new KernelSession();
    s.drawChain([vec3(0,0,0), vec3(1,0,0), vec3(1,1,0), vec3(0,1,0), vec3(0,0,0)]);
    expect(s.stats.faces).toBe(1);
  });
});
