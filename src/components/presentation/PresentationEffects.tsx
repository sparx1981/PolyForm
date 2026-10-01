import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Bloom, DepthOfField } from '@react-three/postprocessing';
import type { DepthOfFieldEffect } from 'postprocessing';
import { presentation, usePresentation } from '../../lib/presentation/store';
import { boundedEffectValue, presentationEffectsActive, syncPresentationFocus } from '../../lib/presentation/effects';

/** Uses the viewport's existing composer. All expensive passes unmount when bypassed or disabled. */
export default function PresentationEffects(){
  const s=usePresentation(),{camera,size}=useThree();
  const focus=useRef<DepthOfFieldEffect|null>(null);
  useFrame(()=>{if(focus.current)syncPresentationFocus(focus.current,camera,presentation.get());});
  if(!presentationEffectsActive(s))return null;
  return <>
    {s.bloom>0 && <Bloom intensity={boundedEffectValue(s.bloom,0,.8,0)} luminanceThreshold={1} luminanceSmoothing={.2} mipmapBlur resolutionScale={.5} />}
    {s.depthOfField&&boundedEffectValue(s.blurStrength,0,1,.5)>0 && <DepthOfField ref={focus} bokehScale={boundedEffectValue(s.blurStrength,0,1,.5)*3} height={Math.min(480,size.height)} />}
  </>;
}
