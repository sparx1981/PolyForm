// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as THREE from 'three';
import { presentation } from '../../lib/presentation/store';
import PresentationEffectsControls from './PresentationEffectsControls';
const pick=vi.hoisted(()=>({active:false,onPick:null as null|((point:[number,number,number])=>void),onCancel:null as null|(()=>void),onMiss:null as null|(()=>void)}));
vi.mock('./ContentEditor',()=>({usePickOnModel:(active:boolean,onPick:typeof pick.onPick,onCancel:typeof pick.onCancel,onMiss:typeof pick.onMiss)=>Object.assign(pick,{active,onPick,onCancel,onMiss})}));
vi.mock('../../lib/presentation/camera',()=>({orbitControls:()=>({object:new THREE.PerspectiveCamera(50,1,.1,5000)})}));
vi.mock('./PresentationPanel',()=>({
  Popover:({children}:React.PropsWithChildren)=> <div>{children}</div>,
  Slider:({label,value,min,max,step,onChange}:{label:string,value:number,min:number,max:number,step:number,onChange:(value:number)=>void})=><label>{label}<input type="range" aria-label={label} value={value} min={min} max={max} step={step} onChange={e=>onChange(Number(e.target.value))}/></label>
}));
afterEach(()=>{cleanup();presentation.reset(false);});
describe('Presentation effect controls',()=>{
  it('supports distant manual focus and adjustable blur',()=>{
    render(<PresentationEffectsControls/>);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByRole('spinbutton',{name:'Focus distance'}),{target:{value:'150'}});
    fireEvent.change(screen.getByRole('slider',{name:'Blur strength'}),{target:{value:'.8'}});
    fireEvent.change(screen.getByRole('slider',{name:'In-focus depth'}),{target:{value:'4'}});
    expect(presentation.get()).toMatchObject({focusDistance:150,blurStrength:.8,focusRange:4});
  });
  it('picks a world point, can cancel, and switches back to manual focus',()=>{
    render(<PresentationEffectsControls/>);fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button',{name:'Pick focus on model'}));
    expect(pick.active).toBe(true);
    act(()=>pick.onCancel?.());expect(pick.active).toBe(false);
    fireEvent.click(screen.getByRole('button',{name:'Pick focus on model'}));
    act(()=>pick.onPick?.([30,0,-150]));
    expect(pick.active).toBe(false);
    expect(presentation.get()).toMatchObject({focusPoint:[30,0,-150],focusDistance:150});
    fireEvent.click(screen.getByRole('button',{name:'Use distance'}));
    expect(presentation.get().focusPoint).toBeNull();
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('150');
  });
  it('says so when a click lands on nothing solid, and keeps waiting for a better click',()=>{
    render(<PresentationEffectsControls/>);fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button',{name:'Pick focus on model'}));
    expect(screen.getByRole('status').textContent).toMatch(/Click or tap a surface/);
    act(()=>pick.onMiss?.());
    expect(screen.getByRole('status').textContent).toMatch(/No solid surface/);
    expect(pick.active).toBe(true);
    act(()=>pick.onPick?.([1,0,-5]));
    expect(pick.active).toBe(false);expect(screen.queryByText(/No solid surface/)).toBeNull();
  });
  it('compares the original view while retaining effects and resets only effects',()=>{
    presentation.set({active:true,loupe:true,stage:1});render(<PresentationEffectsControls/>);
    fireEvent.change(screen.getByRole('slider',{name:'Bloom'}),{target:{value:'.4'}});
    fireEvent.click(screen.getByRole('button',{name:'Show original'}));
    expect(presentation.get()).toMatchObject({effectsBypassed:true,bloom:.4});
    fireEvent.click(screen.getByRole('button',{name:'Show effects'}));
    expect(presentation.get()).toMatchObject({effectsBypassed:false,bloom:.4});
    fireEvent.click(screen.getByRole('button',{name:'Reset effects'}));
    expect(presentation.get()).toMatchObject({bloom:0,loupe:true,stage:1,active:true});
  });
});
