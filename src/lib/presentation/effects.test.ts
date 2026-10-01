import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DepthOfFieldEffect } from 'postprocessing';
import { focusDepth, presentationEffectsActive, resetPresentationEffects, syncPresentationFocus } from './effects';
import { INITIAL_PRESENTATION, presentation } from './store';

afterEach(()=>presentation.reset(false));
describe('Optional presentation effects',()=>{
  it('starts disabled and bypasses passes without discarding settings',()=>{
    expect(presentationEffectsActive({...INITIAL_PRESENTATION,active:true})).toBe(false);
    const s={...INITIAL_PRESENTATION,active:true,depthOfField:true};
    expect(presentationEffectsActive(s)).toBe(true);
    expect(presentationEffectsActive({...s,blurStrength:0})).toBe(false);
    expect(presentationEffectsActive({...s,effectsBypassed:true})).toBe(false);
    expect(presentationEffectsActive({...s,active:false})).toBe(false);
    expect(presentationEffectsActive({...s,bloom:.3,blurStrength:0})).toBe(true);
  });
  it('focuses on view depth, rather than distance to an off-axis point',()=>{
    const camera=new THREE.PerspectiveCamera(50,1,.1,5000);
    expect(focusDepth(camera,[30,0,-10],2)).toBeCloseTo(10);
    camera.position.z=5;
    expect(focusDepth(camera,[30,0,-10],2)).toBeCloseTo(15);
  });
  it('uses world transforms and follows the picked point as the camera turns',()=>{
    const parent=new THREE.Group(),camera=new THREE.PerspectiveCamera();
    parent.position.set(20,0,0);parent.add(camera);
    expect(focusDepth(camera,[20,0,-15],2)).toBeCloseTo(15);
    camera.rotation.y=Math.PI/4;
    expect(focusDepth(camera,[20,0,-15],2)).toBeCloseTo(15/Math.sqrt(2));
  });
  it('bounds invalid or behind-camera focus without a negative blur plane',()=>{
    const camera=new THREE.PerspectiveCamera(50,1,.1,5);
    expect(focusDepth(camera,[0,0,10],3)).toBe(3);
    expect(focusDepth(camera,[0,0,-100],3)).toBe(5);
    expect(focusDepth(camera,null,NaN)).toBe(5);
    expect(focusDepth(camera,null,-10)).toBe(.1);
    expect(focusDepth(camera,[NaN,0,-1],2)).toBe(2);
  });
  it('updates the actual DOF uniforms in metres without replacing the effect',()=>{
    const camera=new THREE.PerspectiveCamera(50,1,.1,5000);
    const effect=new DepthOfFieldEffect(camera);
    try {
      const material=effect.cocMaterial;
      const s={...INITIAL_PRESENTATION,focusPoint:[12,0,-150] as [number,number,number],focusRange:4,blurStrength:.8};
      syncPresentationFocus(effect,camera,s);
      expect(material.focusDistance).toBeCloseTo(150);
      expect(material.focusRange).toBeCloseTo(4);
      expect(effect.bokehScale).toBeCloseTo(2.4);
      camera.position.z=10;syncPresentationFocus(effect,camera,s);
      expect(effect.cocMaterial).toBe(material);
      expect(material.focusDistance).toBeCloseTo(160);
      syncPresentationFocus(effect,camera,{...s,focusRange:100,blurStrength:10});
      expect(material.focusRange).toBe(20);expect(effect.bokehScale).toBe(3);
    } finally { effect.dispose(); }
  });
  it('resets only effects, preserving the lens and presentation stages',()=>{
    presentation.set({active:true,loupe:true,stage:1,build:.4,bloom:.7,depthOfField:true,focusPoint:[0,0,-10],focusDistance:150,focusRange:8,blurStrength:.9,effectsBypassed:true});
    resetPresentationEffects();
    expect(presentation.get()).toMatchObject({active:true,loupe:true,stage:1,build:.4,bloom:0,depthOfField:false,focusPoint:null,focusDistance:10,focusRange:1.5,blurStrength:.5,effectsBypassed:false});
  });
});
