import { expect, it } from 'vitest';
import * as THREE from 'three';
import type { Shape } from '../../types';
import { PresentationEngine } from './engine';
import { INITIAL_PRESENTATION } from './store';
import { pencilDrawing, pencilSeconds, withoutShortEdges } from './pencil';
import { lookAt } from './classify';

it('draws shared architectural geometry sequentially, pauses, and restores editor outlines', () => {
  const geometry = new THREE.BoxGeometry(6,3,0.2), material = new THREE.MeshStandardMaterial();
  const scene = new THREE.Scene();
  const shapes: Shape[] = [-2,2].map((z,i)=>({id:`wall-${i}`,type:'wall',position:[0,1.5,z],args:[6,3,0.2],color:'#fff'}));
  const meshes = shapes.map(shape=>{
    const mesh = new THREE.Mesh(geometry,material);
    mesh.position.set(...shape.position); mesh.userData={isShape:true,id:shape.id};
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial()));
    scene.add(mesh); return mesh;
  });
  const outlines=meshes.map(m=>m.children[0]);
  const engine = new PresentationEngine(scene); engine.sync(shapes);
  const state={...INITIAL_PRESENTATION,active:true,stage:0,stagePlaying:true};
  const tick=(seconds:number,s=state)=>{for(let i=0;i<seconds*10;i++) engine.update(s,0.1);};
  tick(2);
  expect(engine.holdsSketch(0)).toBe(true);
  expect(engine.sketchProgress).toBeGreaterThan(0);
  expect(engine.sketchProgress).toBeLessThan(1);
  expect(outlines.map(o=>o.visible)).toEqual([false,false]);
  const strokes=meshes.flatMap(m=>m.children.filter(o=>o.userData.presentationAux && (o as THREE.Line).isLine) as THREE.LineSegments[]);
  expect(strokes).toHaveLength(4);
  expect(strokes[0].geometry).not.toBe(strokes[2].geometry);
  const counts=strokes.map(line=>line.geometry.drawRange.count);
  expect(counts.some(n=>n>0 && Number.isFinite(n))).toBe(true);
  expect(counts.filter(n=>n===0)).toHaveLength(2);
  tick(4,{...state,stagePlaying:false});
  expect(strokes.map(line=>line.geometry.drawRange.count)).toEqual(counts);
  tick(30);
  expect(engine.holdsSketch(0)).toBe(false);
  expect(strokes.every(line=>line.geometry.drawRange.count===Infinity)).toBe(true);
  tick(2,{...state,stage:1,stagePlaying:false});
  expect(meshes.every(mesh=>mesh.visible)).toBe(true);
  engine.dispose();
  expect(outlines.map(o=>o.visible)).toEqual([true,true]);
  expect(meshes.every(mesh=>mesh.geometry===geometry && mesh.material===material)).toBe(true);
  expect(meshes.map(mesh=>mesh.position.toArray())).toEqual(shapes.map(shape=>shape.position));
  geometry.dispose(); material.dispose();
});

it('keeps freehand offsets deterministic, preserves source geometry, and settles at Massing', () => {
  const source=new THREE.EdgesGeometry(new THREE.BoxGeometry(4,3,0.2));
  const before=source.attributes.position.array.slice();
  const a=pencilDrawing(source), b=pencilDrawing(source);
  expect(source.attributes.position.array).toEqual(before);
  expect(a.geometry.attributes.pencilOffset.array).toEqual(b.geometry.attributes.pencilOffset.array);
  expect(a.geometry.attributes.pencilOffset.array.some(n=>Math.abs(n)>0.002)).toBe(true);
  expect(a.geometry.attributes.position.count).toBeLessThanOrEqual(24000);
  expect(pencilSeconds(a.strokes)).toBeGreaterThanOrEqual(5);
  expect(pencilSeconds(100000)).toBe(12);
  expect(pencilSeconds(0)).toBe(5);
  expect(lookAt(0).pencilRoughness).toBe(1);
  expect(lookAt(1).pencilRoughness).toBeCloseTo(0.22);
  expect(lookAt(2).pencilRoughness).toBe(0);
  a.geometry.dispose(); b.geometry.dispose(); source.dispose();
});

it('can pause before the first Sketch frame without drawing in the background', () => {
  const scene=new THREE.Scene(), geometry=new THREE.BoxGeometry(6,3,0.2);
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial());
  mesh.userData={isShape:true,id:'wall'}; scene.add(mesh);
  const engine=new PresentationEngine(scene);
  engine.sync([{id:'wall',type:'wall',position:[0,0,0],args:[6,3,0.2],color:'#fff'}]);
  const paused={...INITIAL_PRESENTATION,active:true,stage:0,stagePlaybackStarted:true};
  for(let i=0;i<50;i++) engine.update(paused,0.1);
  const lines=mesh.children.filter(o=>o.userData.presentationAux) as THREE.LineSegments[];
  expect(lines.every(line=>line.geometry.drawRange.count===0)).toBe(true);
  engine.update({...paused,stagePlaying:true},0.1);
  expect(lines.some(line=>line.geometry.drawRange.count>0)).toBe(true);
  engine.dispose(); geometry.dispose();
});

it('includes high-detail roof form, gable infill and flat decks during Sketch, leaving tiles for Detailed', () => {
  const scene = new THREE.Scene();
  const shapes: Shape[] = [
    {id:'slopes',type:'roof',position:[0,4,0],args:[],color:'#fff',tags:['roof-slopes']},
    {id:'gable',type:'custom',position:[0,4,0],args:[],color:'#fff',tags:['roof-part','roof-pediment']},
    {id:'deck',type:'custom',position:[0,4,0],args:[],color:'#fff',tags:['roof-part','roof-deck']},
    {id:'tiles',type:'custom',position:[0,4,0],args:[],color:'#fff',tags:['roof-part','roof-tiles']},
  ];
  const meshes = shapes.map(shape => {
    // The roof slopes exceed the old 20,000-vertex cutoff even though their outline is simple.
    const geometry = shape.id === 'slopes' ? new THREE.BoxGeometry(6,1,4,60,60,60) : new THREE.BoxGeometry(6,0.2,4);
    const mesh = new THREE.Mesh(geometry,new THREE.MeshStandardMaterial());
    mesh.position.set(...shape.position); mesh.userData={isShape:true,id:shape.id};scene.add(mesh);return mesh;
  });
  const engine=new PresentationEngine(scene);engine.sync(shapes);
  for(let i=0;i<330;i++) engine.update({...INITIAL_PRESENTATION,active:true,stage:0,stagePlaying:true},0.1);
  for(const mesh of meshes.slice(0,3)) {
    expect(mesh.visible).toBe(true);
    const lines=mesh.children.filter(o=>o.userData.presentationAux) as THREE.LineSegments[];
    expect(lines).toHaveLength(2);expect(lines[0].geometry.drawRange.count).toBe(Infinity);
  }
  expect(meshes[3].visible).toBe(false);expect(meshes[3].children).toHaveLength(0);
  engine.dispose();
  expect(meshes.every(mesh=>mesh.visible)).toBe(true);
  meshes.forEach(mesh=>{mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();});
});

it('leaves fine detail like balusters and nosings out of a stair drawing', () => {
  const tread = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 0.2, 0.3));
  const baluster = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.03, 0.9, 0.03));
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute([...tread.attributes.position.array, ...baluster.attributes.position.array], 3));
  const coarse = withoutShortEdges(merged, 0.25);
  expect(coarse.attributes.position.count).toBeLessThan(merged.attributes.position.count);
  expect(coarse.attributes.position.count).toBeGreaterThan(0);
  // Longer edges stay; only edges under the limit go.
  for (let i = 0; i < coarse.attributes.position.count; i += 2) {
    const a = new THREE.Vector3().fromBufferAttribute(coarse.attributes.position, i), b = new THREE.Vector3().fromBufferAttribute(coarse.attributes.position, i + 1);
    expect(a.distanceTo(b)).toBeGreaterThanOrEqual(0.25);
  }
  // A busy model is drawn quicker than before, and a stair adds little.
  expect(pencilSeconds(5000)).toBeLessThanOrEqual(12);
  expect(pencilSeconds(5000) - pencilSeconds(4000)).toBeLessThan(2);
});
