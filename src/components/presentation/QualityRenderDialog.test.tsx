// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as THREE from 'three';
import { qualityCapture } from '../../lib/presentation/qualitySnapshot';
import QualityRenderDialog from './QualityRenderDialog';
import { canvasRef } from '../../lib/presentation/recorder';
const mocks = vi.hoisted(() => ({ dispose: vi.fn(), workerDispose: vi.fn(), rendererDispose: vi.fn(), resolve: undefined as undefined | (() => void), tracer: null as any, renderer: null as any }));
vi.mock('three', async (importOriginal) => { const actual = await importOriginal<typeof import('three')>(); return { ...actual, WebGLRenderer: class {
        constructor(){mocks.renderer=this;}
        domElement = document.createElement('canvas');
        extensions = { has: () => true };
        debug = {};
        setPixelRatio() { }
        setSize() { }
        dispose() { mocks.rendererDispose(); }
        forceContextLoss() { }
    } }; });
vi.mock('three-gpu-pathtracer', () => ({ WebGLPathTracer: class {
        constructor(){mocks.tracer=this;}
        samples=0;
        renderSample(){this.samples+=8;}
        tiles = { set: () => { } };
        textureSize = { set: () => { } };
        setBVHWorker() { }
        setSceneAsync() { return new Promise<void>(resolve => { mocks.resolve = resolve; }); }
        dispose() { mocks.dispose(); }
    }, GradientEquirectTexture: class {
        topColor = { set: () => { } };
        bottomColor = { set: () => { } };
        update() { }
        dispose() { }
    } }));
vi.mock('three-mesh-bvh/worker', () => ({ GenerateMeshBVHWorker: class {
        dispose() { mocks.workerDispose(); }
    } }));
afterEach(() => { cleanup(); qualityCapture.current = null; canvasRef.current = null; vi.clearAllMocks(); vi.unstubAllGlobals(); });
function ready() { const dispose = vi.fn(); qualityCapture.current = () => ({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(50, 1), raster: 'data:image/png;base64,test', warnings: ['Fabric is frozen'], dispose }); return dispose; }
describe('Quality still lifetime', () => {
    it('cancels preparation and releases GPU and worker resources while retaining raster fallback', async () => {
        const snapshotDispose = ready();
        const view = render(<QualityRenderDialog onClose={() => { }}/>);
        expect(screen.getByText('Fabric is frozen')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Quality render' }));
        await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Preparing geometry…'));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel render' }));
        expect(mocks.workerDispose).toHaveBeenCalledOnce();
        expect(mocks.dispose).toHaveBeenCalledOnce();
        expect(mocks.rendererDispose).toHaveBeenCalledOnce();
        expect((screen.getByRole('button', { name: 'Save raster' }) as HTMLButtonElement).disabled).toBe(false);
        mocks.resolve?.();
        await waitFor(() => expect(screen.getByRole('status').textContent).toContain('cancelled'));
        view.unmount();
        expect(snapshotDispose).toHaveBeenCalledOnce();
        expect(mocks.rendererDispose).toHaveBeenCalledOnce();
    });
    it('allows raster fallback when clipping or scene limits prevent a quality snapshot', () => {
        canvasRef.current = { toDataURL: () => 'data:image/png;base64,test' } as HTMLCanvasElement;
        qualityCapture.current = () => { throw new Error('Turn off section views'); };
        render(<QualityRenderDialog onClose={() => { }}/>);
        expect(screen.getByRole('status').textContent).toBe('Turn off section views');
        expect((screen.getByRole('button', { name: 'Quality render' }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: 'Save raster' }) as HTMLButtonElement).disabled).toBe(false);
    });
});


describe('Path-tracing controls and completion',()=>{
    it('honours quality settings, pauses without losing samples, resumes and completes',async()=>{
        ready();
        const callbacks=new Map<number,FrameRequestCallback>();let id=0;
        vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{callbacks.set(++id,callback);return id;});
        vi.stubGlobal('cancelAnimationFrame',(id:number)=>callbacks.delete(id));
        const advance=()=>act(()=>{const next=callbacks.entries().next().value;if(next){callbacks.delete(next[0]);next[1](0);}});
        const view=render(<QualityRenderDialog onClose={()=>{}}/>);
        fireEvent.change(screen.getByRole('combobox',{name:'Quality render samples'}),{target:{value:'32'}});
        fireEvent.change(screen.getByRole('combobox',{name:'Quality render resolution'}),{target:{value:'2048'}});
        fireEvent.change(screen.getByRole('combobox',{name:'Quality render lighting'}),{target:{value:'refined'}});
        fireEvent.click(screen.getByRole('button',{name:'Quality render'}));
        await waitFor(()=>expect(screen.getByRole('status').textContent).toBe('Preparing geometry…'));
        expect(mocks.tracer).toMatchObject({bounces:12,transmissiveBounces:20,multipleImportanceSampling:true});
        await act(async()=>mocks.resolve?.());
        advance();expect(mocks.tracer.samples).toBe(8);
        fireEvent.click(screen.getByRole('button',{name:'Pause render'}));
        expect(callbacks.size).toBe(0);expect(mocks.tracer.samples).toBe(8);
        fireEvent.click(screen.getByRole('button',{name:'Resume render'}));
        advance();advance();advance();
        expect(screen.getByRole('status').textContent).toContain('Quality still ready');
        expect((screen.getByRole('progressbar') as HTMLProgressElement).value).toBe(32);
        expect((screen.getByRole('button',{name:'Save quality PNG'}) as HTMLButtonElement).disabled).toBe(false);
        expect(mocks.workerDispose).toHaveBeenCalledOnce();
        expect(mocks.rendererDispose).not.toHaveBeenCalled();
        view.unmount();expect(mocks.rendererDispose).toHaveBeenCalledOnce();expect(callbacks.size).toBe(0);
    });
    it('recovers to raster if the GPU context is lost',async()=>{
        ready();render(<QualityRenderDialog onClose={()=>{}}/>);
        fireEvent.click(screen.getByRole('button',{name:'Quality render'}));
        await waitFor(()=>expect(screen.getByRole('status').textContent).toBe('Preparing geometry…'));
        act(()=>mocks.renderer.domElement.dispatchEvent(new Event('webglcontextlost',{cancelable:true})));
        expect(screen.getByRole('status').textContent).toContain('GPU context lost');
        expect((screen.getByRole('button',{name:'Save raster'}) as HTMLButtonElement).disabled).toBe(false);
        await act(async()=>mocks.resolve?.());expect(mocks.rendererDispose).toHaveBeenCalledOnce();
    });
});
