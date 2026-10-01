// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as THREE from 'three';
import { qualityCapture } from '../../lib/presentation/qualitySnapshot';
import QualityRenderDialog from './QualityRenderDialog';
import { canvasRef } from '../../lib/presentation/recorder';
const mocks = vi.hoisted(() => ({ dispose: vi.fn(), workerDispose: vi.fn(), rendererDispose: vi.fn(), resolve: undefined as undefined | (() => void) }));
vi.mock('three', async (importOriginal) => { const actual = await importOriginal<typeof import('three')>(); return { ...actual, WebGLRenderer: class {
        domElement = document.createElement('canvas');
        extensions = { has: () => true };
        debug = {};
        setPixelRatio() { }
        setSize() { }
        dispose() { mocks.rendererDispose(); }
        forceContextLoss() { }
    } }; });
vi.mock('three-gpu-pathtracer', () => ({ WebGLPathTracer: class {
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
afterEach(() => { cleanup(); qualityCapture.current = null; canvasRef.current = null; vi.clearAllMocks(); });
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
