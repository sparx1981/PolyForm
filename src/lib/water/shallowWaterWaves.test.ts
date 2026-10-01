import { describe, expect, it } from 'vitest';
import { ShallowWaterWaves } from './shallowWaterWaves';
const forcing={speed:2,direction:[1,0] as [number,number],turbulence:1};
const metrics=(s:ShallowWaterWaves)=>({height:Math.max(...s.heights.map(Math.abs)),foam:Math.max(...s.foam)});
describe('shallow-water surface dynamics',()=>{
  it('keeps a resting pond flat and unfoamed',()=>{
    const s=new ShallowWaterWaves([0,0,8,8],()=>1,24);
    for(let i=0;i<120;i++)s.update(1/30,{...forcing,speed:0,turbulence:0});
    expect(metrics(s)).toEqual({height:0,foam:0});s.dispose();
  });
  it('produces displaced crests and whitecaps at high turbulence',()=>{
    const calm=new ShallowWaterWaves([0,0,8,8],()=>1,24), rough=new ShallowWaterWaves([0,0,8,8],()=>1,24);
    for(let i=0;i<150;i++){calm.update(1/30,{...forcing,turbulence:0.1});rough.update(1/30,forcing);}
    expect(metrics(rough).height).toBeGreaterThan(0.025);
    expect(metrics(rough).height).toBeGreaterThan(metrics(calm).height*3);
    expect(metrics(rough).foam).toBeGreaterThan(0.15);
    expect(metrics(calm).foam).toBe(0);calm.dispose();rough.dispose();
  });
  it('reflects at dry faces and remains finite for slow mobile frames',()=>{
    const s=new ShallowWaterWaves([0,0,8,8],(x,z)=>x>3&&x<5&&z>3&&z<5 ? 0 : .2+z/2,24);
    for(let i=0;i<100;i++)s.update(.1,{...forcing,speed:4});
    expect(Array.from(s.heights).every(Number.isFinite)).toBe(true);
    expect(metrics(s).height).toBeLessThan(1.5);
    const center=12*24+12;expect(s.heights[center]).toBe(0);expect(s.foam[center]).toBe(0);s.dispose();
  });
  it('conserves the mean height of freely propagating waves in a closed basin',()=>{
    const s=new ShallowWaterWaves([0,0,8,8],()=>1,24);
    s.heights[12*24+12]=.03;
    for(let i=0;i<120;i++)s.update(1/60,{...forcing,speed:0,turbulence:0});
    expect(Array.from(s.heights).reduce((a,b)=>a+b,0)).toBeCloseTo(.03,5);
    s.dispose();
  });
  it('foam persists and decays after the turbulence source is stopped',()=>{
    const s=new ShallowWaterWaves([0,0,8,8],()=>1,24);
    for(let i=0;i<100;i++)s.update(1/30,forcing);
    const initial=metrics(s).foam;
    expect(initial).toBeGreaterThan(.15);
    s.update(1/30,{...forcing,speed:0,turbulence:0});expect(metrics(s).foam).toBeGreaterThan(initial*.9);
    for(let i=0;i<300;i++)s.update(1/30,{...forcing,speed:0,turbulence:0});expect(metrics(s).foam).toBeLessThan(initial*.1);s.dispose();
  });
});
