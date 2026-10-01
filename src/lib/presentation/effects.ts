import * as THREE from 'three';
import type { DepthOfFieldEffect } from 'postprocessing';
import { INITIAL_PRESENTATION, presentation, type PresentationState } from './store';

const origin=new THREE.Vector3(),forward=new THREE.Vector3(),selected=new THREE.Vector3();
export const boundedEffectValue=(value:number,min:number,max:number,fallback:number)=>Number.isFinite(value)?THREE.MathUtils.clamp(value,min,max):THREE.MathUtils.clamp(fallback,min,max);

/** Focus is measured along the viewing direction, rather than radial distance to the picked surface. */
export function focusDepth(camera:THREE.Camera,point:[number,number,number]|null,distance:number):number {
  const near=Math.max(.01,(camera as THREE.PerspectiveCamera).near??.1);
  const far=Math.max(near+.01,(camera as THREE.PerspectiveCamera).far??5000);
  let depth=boundedEffectValue(distance,near,far,10);
  if(point){
    camera.getWorldPosition(origin);camera.getWorldDirection(forward);
    const picked=selected.fromArray(point).sub(origin).dot(forward);
    if(Number.isFinite(picked)&&picked>near)depth=Math.min(far,picked);
  }
  return depth;
}

export function presentationEffectsActive(s:PresentationState):boolean {
  return s.active&&!s.effectsBypassed&&(boundedEffectValue(s.bloom,0,.8,0)>0||(s.depthOfField&&boundedEffectValue(s.blurStrength,0,1,.5)>0));
}

/** Live uniforms avoid reconstructing the DOF pass whenever its focus slider or camera changes. */
export function syncPresentationFocus(effect:DepthOfFieldEffect,camera:THREE.Camera,s:PresentationState){
  effect.cocMaterial.focusDistance=focusDepth(camera,s.focusPoint,s.focusDistance);
  effect.cocMaterial.focusRange=boundedEffectValue(s.focusRange,.1,20,1.5);
  effect.bokehScale=boundedEffectValue(s.blurStrength,0,1,.5)*3;
}

export function resetPresentationEffects(){
  const {bloom,depthOfField,focusPoint,focusDistance,focusRange,blurStrength,effectsBypassed}=INITIAL_PRESENTATION;
  presentation.set({bloom,depthOfField,focusPoint,focusDistance,focusRange,blurStrength,effectsBypassed});
}
