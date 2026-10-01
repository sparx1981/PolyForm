import { useEffect, useState } from 'react';
import { presentation, usePresentation } from '../../lib/presentation/store';
import { focusDepth, resetPresentationEffects } from '../../lib/presentation/effects';
import { orbitControls } from '../../lib/presentation/camera';
import { usePickOnModel } from './ContentEditor';
import { Popover, Slider } from './PresentationPanel';

export default function PresentationEffectsControls(){
  const s=usePresentation();
  const [picking,setPicking]=useState(false);
  useEffect(()=>{if(!s.depthOfField)setPicking(false);},[s.depthOfField]);
  usePickOnModel(picking&&s.depthOfField,point=>{
    const camera=orbitControls()?.object;
    const distance=camera?focusDepth(camera,point,s.focusDistance):s.focusDistance;
    presentation.set({focusPoint:point,focusDistance:Math.round(distance*100)/100});setPicking(false);
  },()=>setPicking(false));
  const configured=s.bloom>0||(s.depthOfField&&s.blurStrength>0);
  return <Popover title="Presentation effects" hint="Optional · off by default">
    <div className="space-y-3">
      <Slider label="Bloom" value={s.bloom} min={0} max={.8} step={.05}
        onChange={v=>presentation.set({bloom:v})} format={v=>`${Math.round(v*100)}%`} />
      <p className="text-[11px] text-white/55">A soft glow around bright lights and highlights.</p>
      <label className="flex gap-2 text-xs"><input type="checkbox" checked={s.depthOfField} onChange={e=>presentation.set({depthOfField:e.target.checked})} />Depth of field</label>
      {s.depthOfField && <>
        <Slider label="Blur strength" value={s.blurStrength} min={0} max={1} step={.05}
          onChange={v=>presentation.set({blurStrength:v})} format={v=>`${Math.round(v*100)}%`} />
        <Slider label="In-focus depth" value={s.focusRange} min={.1} max={20} step={.1}
          onChange={v=>presentation.set({focusRange:v})} format={v=>`${v.toFixed(1)} m`} />
        <div className="flex gap-2 items-center text-xs">
          <button type="button" aria-pressed={picking} onClick={()=>setPicking(!picking)} className="rounded bg-sky-600 px-3 py-2">{picking?'Cancel focus pick':'Pick focus on model'}</button>
          {s.focusPoint&&<button type="button" onClick={()=>{setPicking(false);presentation.set({focusPoint:null});}} className="rounded bg-white/10 px-3 py-2">Use distance</button>}
        </div>
        {picking&&<p role="status" className="text-xs text-sky-200">Click or tap a surface to focus. Escape cancels.</p>}
        {s.focusPoint?<p className="text-[11px] text-white/65">The picked detail stays in focus as you move the camera.</p>:<label className="flex items-center justify-between text-xs">Focus distance
          <span className="flex items-center gap-1"><input type="number" aria-label="Focus distance" min={.1} max={5000} step={.1} value={s.focusDistance}
            onChange={e=>{const v=e.currentTarget.valueAsNumber;if(Number.isFinite(v))presentation.set({focusDistance:Math.max(.1,Math.min(5000,v))});}}
            className="w-24 rounded bg-white/10 px-2 py-1 text-right"/>m</span>
        </label>}
      </>}
      {s.effectsBypassed&&<p role="status" className="text-xs text-amber-200">Showing the original view.</p>}
      <div className="flex gap-2 text-xs">
        <button type="button" disabled={!configured} aria-pressed={s.effectsBypassed} onClick={()=>presentation.set({effectsBypassed:!s.effectsBypassed})} className="flex-1 rounded bg-white/10 px-3 py-2 disabled:opacity-40">{s.effectsBypassed?'Show effects':'Show original'}</button>
        <button type="button" onClick={()=>{setPicking(false);resetPresentationEffects();}} className="rounded bg-white/10 px-3 py-2">Reset effects</button>
      </div>
    </div>
  </Popover>;
}
