import { expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_GRASS_SETTINGS, type Shape } from '../../types';
import { createGrassField, grassRings, createGrassClumpTemplate, grassRootCell } from './bladeGrass';
import { GrassPatchBatch, grassPatchCapacity, GRASS_PATCH_BLADES, grassPatchOccupied } from './grassPatches';

const terrain: Shape = { id:'field',type:'terrain',position:[0,0,0],args:[],color:'#466b35',terrainData:{width:500,depth:500,gridX:2,gridY:2,heights:[0,0,0,0]} };
const camera = () => { const c=new THREE.PerspectiveCamera(55,1.5,0.1,1000);c.position.set(0,1.8,0);c.lookAt(0,1.5,-30);c.updateMatrixWorld(true);return c; };
const view = (ringIndex=0) => {
  const rings=grassRings(DEFAULT_GRASS_SETTINGS);
  return { camera:camera(),field:createGrassField(terrain,[],[],DEFAULT_GRASS_SETTINGS),ring:rings[ringIndex],finer:rings[ringIndex-1],centreX:0,centreZ:0,lodOrigin:new THREE.Vector3(0,1.8,0),lodVertical:1,lodBias:0,margin:0.8 };
};
const dispose = (v:ReturnType<typeof view>) => {v.field.heights.dispose();v.field.mask.dispose();};

it('culls unseen patches before submission and retains world lattice identities when moving', () => {
  const v=view(), batch=new GrassPatchBatch(grassPatchCapacity(v.ring));
  const count=batch.prepare(v);
  expect(count).toBeGreaterThan(0);expect(count).toBeLessThan(v.ring.cells**2*0.75);
  expect(count).toBe(batch.visiblePatches*GRASS_PATCH_BLADES);
  const roots=new Set(Array.from({length:batch.visiblePatches},(_,i)=>`${batch.origins.getX(i)},${batch.origins.getY(i)}`));
  const version=batch.origins.version;expect(batch.prepare(v)).toBe(count);expect(batch.origins.version).toBe(version);
  v.centreX+=v.ring.spacing;batch.prepare(v);
  expect(Array.from({length:batch.visiblePatches},(_,i)=>roots.has(`${batch.origins.getX(i)},${batch.origins.getY(i)}`)).some(Boolean)).toBe(true);
  expect(batch.origins.meshPerAttribute).toBe(GRASS_PATCH_BLADES);dispose(v);
});
it('rejects empty and off-terrain patches while keeping partially eligible boundaries', () => {
  const v=view();
  expect(grassPatchOccupied(v.field,251,0,260,10)).toBe(false);
  expect(grassPatchOccupied(v.field,249,0,251,10)).toBe(true);
  v.field.occupancy.fill(0);
  expect(new GrassPatchBatch(grassPatchCapacity(v.ring)).prepare(v)).toBe(0);dispose(v);
});
it('keeps all candidate patches available for an overhead orthographic camera and recomputes for mirror cameras', () => {
  const v=view(3), batch=new GrassPatchBatch(grassPatchCapacity(v.ring));
  const initial=batch.prepare(v);
  const ortho=new THREE.OrthographicCamera(-250,250,250,-250,.1,1000);ortho.position.set(0,300,0);ortho.lookAt(0,0,0);ortho.updateMatrixWorld(true);
  const overhead=batch.prepare({...v,camera:ortho,lodOrigin:new THREE.Vector3(),lodVertical:0});
  expect(overhead).toBeGreaterThan(initial);expect(overhead).toBeLessThanOrEqual(batch.origins.count*GRASS_PATCH_BLADES);
  expect(batch.prepare(v)).toBe(initial);dispose(v);
});
it('covers three times the previous radius with two-triangle tuft cards and preserves nearby density', () => {
  const rings=grassRings(DEFAULT_GRASS_SETTINGS);
  expect(rings[3].radius).toBe(rings[2].radius*3);expect(rings[3].kind).toBe('clump');
  expect(rings[0].kind).toBe('blade');expect(rings[0].segments).toBe(4);
  const card=createGrassClumpTemplate();expect(card.index!.count/3).toBe(2);expect(card.attributes.position.count).toBe(4);card.dispose();
});
it('never omits an eligible near root inside the render frustum and active distance band', () => {
  const v=view(),batch=new GrassPatchBatch(grassPatchCapacity(v.ring));batch.prepare(v);
  const patches=new Set(Array.from({length:batch.visiblePatches},(_,i)=>`${batch.origins.getX(i)},${batch.origins.getY(i)}`));
  const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(v.camera.projectionMatrix,v.camera.matrixWorldInverse));
  for(let x=-100;x<100;x+=3) for(let z=-200;z<0;z+=3) {
    const p=new THREE.Vector3((x+.5)*v.ring.spacing,0,(z+.5)*v.ring.spacing);
    if(!frustum.containsPoint(p)||p.distanceTo(v.lodOrigin)>=v.ring.radius*.97)continue;
    expect(patches.has(`${Math.floor(x/16)*16},${Math.floor(z/16)*16}`)).toBe(true);
  }
  dispose(v);
});

it('coarse roots remain exact subsets at negative and positive coordinates without forming fixed rows', () => {
  const offsets=new Set<number>();
  for(const stride of [2,4,16,64,256]) for(let x=-12;x<12;x++) for(let z=-12;z<12;z++) {
    const root=grassRootCell(x,z,stride);
    expect(root[0]).toBeGreaterThanOrEqual(x*stride);expect(root[0]).toBeLessThan((x+1)*stride);
    expect(root[1]).toBeGreaterThanOrEqual(z*stride);expect(root[1]).toBeLessThan((z+1)*stride);
    const finer=stride/2;
    expect(grassRootCell(Math.floor(root[0]/finer),Math.floor(root[1]/finer),finer)).toEqual(root);
    offsets.add(root[0]-x*stride);
  }
  expect(offsets.size).toBeGreaterThan(32);
});

it('retains grass on raised terrain and invalidates the cache when the LOD anchor or mask changes', () => {
  const v=view(1), batch=new GrassPatchBatch(grassPatchCapacity(v.ring));
  const initial=batch.prepare(v);expect(initial).toBeGreaterThan(0);
  v.lodOrigin.set(1000,0,1000);expect(batch.prepare(v)).toBe(0);
  v.lodOrigin.set(0,1.8,0);expect(batch.prepare(v)).toBe(initial);
  const elevated=createGrassField({...terrain,position:[0,20,0]},[],[],DEFAULT_GRASS_SETTINGS);
  v.camera.position.y+=20;v.camera.lookAt(0,21.5,-30);v.camera.updateMatrixWorld(true);v.lodOrigin.y+=20;
  expect(batch.prepare({...v,field:elevated})).toBe(initial);
  const empty={...elevated,occupancy:new Uint32Array(elevated.occupancy.length)};
  expect(batch.prepare({...v,field:empty})).toBe(0);
  elevated.heights.dispose();elevated.mask.dispose();dispose(v);
});
