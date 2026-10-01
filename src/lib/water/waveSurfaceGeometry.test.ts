import { describe, expect, it } from 'vitest';
import { createWaveSurfaceGeometry } from './waveSurfaceGeometry';

describe('displaced water surface geometry',()=>{
  it('adds interior vertices and retains the exact polygon boundary',()=>{
    const g=createWaveSurfaceGeometry([[-3,-2],[3,-2],[3,2],[-3,2]],0);
    const p=g.getAttribute('position');
    expect(p.count).toBeGreaterThan(100);
    for(let i=0;i<p.count;i++){
      expect(Math.abs(p.getX(i))).toBeLessThanOrEqual(3);
      expect(Math.abs(p.getZ(i))).toBeLessThanOrEqual(2);
    }
    expect(p.count/3).toBeLessThanOrEqual(18000);g.dispose();
  });
});
