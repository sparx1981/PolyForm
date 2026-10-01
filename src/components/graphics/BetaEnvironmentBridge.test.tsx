// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { render, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({enabled:false}));
vi.mock('../../AppContext',()=>({useApp:()=>({graphicsSettings:{beta:{enabled:state.enabled}},setGraphicsSettings:vi.fn(),setMeasurements:vi.fn()})}));
vi.mock('./BetaEnvironmentRuntime',()=>({BetaEnvironmentRuntime:({onEffects}:{onEffects:(n:React.ReactNode)=>void})=>{
  useEffect(()=>{onEffects(<span>effects ready</span>);return()=>onEffects(null);},[onEffects]);return null;
}}));
import { BetaEnvironmentRoot, BetaEnvironmentEffects } from './BetaEnvironmentBridge';
afterEach(cleanup);
describe('Beta scene lifetime',()=>{
  it('preserves camera and material owners while loading and repeatedly toggling',async()=>{
    let mounts=0,unmounts=0;
    function SceneOwner(){useEffect(()=>{mounts++;return()=>{unmounts++;};},[]);return <div>scene</div>;}
    const tree=()=> <BetaEnvironmentRoot><SceneOwner/><BetaEnvironmentEffects/></BetaEnvironmentRoot>;
    state.enabled=false;const view=render(tree());const original=view.getByText('scene');
    for(let i=0;i<3;i++){
      state.enabled=true;view.rerender(tree());await waitFor(()=>expect(view.queryByText('effects ready')).not.toBeNull());
      expect(view.getByText('scene')).toBe(original);
      state.enabled=false;view.rerender(tree());expect(view.queryByText('effects ready')).toBeNull();
    }
    expect(mounts).toBe(1);expect(unmounts).toBe(0);
  });
});
