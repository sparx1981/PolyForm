import { describe,expect,it } from 'vitest';
import type { Shape } from '../../types';
import { exposedWallEdges,resolveWallJunctions,wallWorldFootprint } from './wallJunctions';
import * as THREE from 'three';
import { createWallWithOpeningsGeometry } from '../archGeometry';
const wall=(id:string,x:number,z:number,length:number,yaw=0,interior=true):Shape=>({id,type:'wall',position:[x,1.4,z],rotation:[0,yaw,0],args:[length,2.8,0.2],color:'#fff',tags:[interior?'wall-interior':'wall-exterior']});
describe('open interior wall junctions',()=>{
  it('clips an extended partition at the near face of an exterior wall',()=>{
    const host=wall('host',0,0,6,0,false),partition=wall('partition',0,2,4.2,Math.PI/2);
    const resolved=resolveWallJunctions([host,partition]);
    const fp=wallWorldFootprint(resolved.get('partition')!);
    expect(Math.min(...fp.map(p=>p[1]))).toBeCloseTo(0.1);
    expect(resolved.get('host')).toBe(host);
    expect(partition.wallMiterFootprint).toBeUndefined();
  });
  it('shares an exact mitre across a 90° partition corner',()=>{
    const a=wall('a',2,-0.1,4.2),b=wall('b',4.1,2,4.2,-Math.PI/2);
    const resolved=resolveWallJunctions([a,b]);
    const fa=wallWorldFootprint(resolved.get('a')!),fb=wallWorldFootprint(resolved.get('b')!);
    expect(fa[2][0]).toBeCloseTo(fb[1][0]);expect(fa[2][1]).toBeCloseTo(fb[1][1]);
    expect(fa[3][0]).toBeCloseTo(fb[0][0]);expect(fa[3][1]).toBeCloseTo(fb[0][1]);
  });
  it('leaves separate storeys and closed exterior mitres untouched',()=>{
    const a=wall('a',2,-0.1,4.2),b={...wall('b',4.1,2,4.2,-Math.PI/2),position:[4.1,4.2,2] as [number,number,number]};
    const resolved=resolveWallJunctions([a,b]);
    expect(resolved.get('a')!.wallMiterFootprint![2][0]).toBeCloseTo(2.1);
  });
  it('preserves near-face abutments after a shared arbitrary rotation and mixed thickness',()=>{
    const host={...wall('host',0,0,6,0,false),args:[6,2.8,0.4]},partition=wall('partition',0,2,4.2,Math.PI/2);
    const rotate=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),0.63);
    const shapes=[host,partition].map(s=>{const p=new THREE.Vector3(...s.position).applyQuaternion(rotate);const q=rotate.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...s.rotation!)));return {...s,position:p.toArray() as [number,number,number],quaternion:q.toArray() as [number,number,number,number]};});
    const fp=wallWorldFootprint(resolveWallJunctions(shapes).get('partition')!).map(([x,z])=>new THREE.Vector3(x,0,z).applyQuaternion(rotate.clone().invert()));
    expect(Math.min(...fp.map(p=>p.z))).toBeCloseTo(0.2);
  });
  it('keeps opening holes and wall height in a resolved partition',()=>{
    const host=wall('host',0,0,6,0,false),partition=wall('partition',0,2,4.2,Math.PI/2);
    const shape=resolveWallJunctions([host,partition]).get('partition')!;
    const geom=createWallWithOpeningsGeometry(4.2,2.8,0.2,[{localX:0,localY:-0.4,width:0.9,height:2}],undefined,shape.wallMiterFootprint);
    geom.computeBoundingBox();expect(geom.boundingBox!.min.y).toBeCloseTo(-1.4);expect(geom.boundingBox!.max.y).toBeCloseTo(1.4);
    const mesh=new THREE.Mesh(geom,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));mesh.updateMatrixWorld();
    const ray=new THREE.Raycaster(new THREE.Vector3(0,0,1),new THREE.Vector3(0,0,-1));
    expect(ray.intersectObject(mesh)).toHaveLength(0);
    geom.dispose();(mesh.material as THREE.Material).dispose();
  });
  it('splits a host edge and keeps the portions outside a T junction',()=>{
    const host=wall('host',0,0,6,0,false),partition=wall('partition',0,2,4.2,Math.PI/2);
    const resolved=resolveWallJunctions([host,partition]);
    const visible=exposedWallEdges([-3,1.4,0.1,3,1.4,0.1],host,[...resolved.values()]);
    expect(visible).toHaveLength(12);
    expect(visible[3]).toBeCloseTo(-0.1);expect(visible[6]).toBeCloseTo(0.1);
  });
});
