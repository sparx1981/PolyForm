import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { X } from 'lucide-react';
import { qualityCapture, type QualitySnapshot } from '../../lib/presentation/qualitySnapshot';
import { canvasRef, downloadBlob } from '../../lib/presentation/recorder';
export default function QualityRenderDialog({ onClose }: {
    onClose: () => void;
}) {
    const dialog = useRef<HTMLDivElement>(null);
    const close = useRef(onClose);
    close.current = onClose;
    const host = useRef<HTMLDivElement>(null), stop = useRef<(() => void) | null>(null), snapshot = useRef<QualitySnapshot | null>(null);
    const [message, setMessage] = useState('Preparing frozen view…'), [warnings, setWarnings] = useState<string[]>([]), [running, setRunning] = useState(false), [ready, setReady] = useState(false), [samples, setSamples] = useState(0), [raster, setRaster] = useState('');
    const [targetSamples, setTargetSamples] = useState(64);
    const [showCanvas, setShowCanvas] = useState(false);
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
        const key = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                close.current();
            }
            if (e.key === 'Tab') {
                const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled),[tabindex="0"]') ?? []);
                const index = controls.indexOf(document.activeElement as HTMLElement), next = e.shiftKey ? index - 1 : index + 1;
                if (index < 0 || next < 0 || next >= controls.length) {
                    e.preventDefault();
                    (e.shiftKey ? controls[controls.length - 1] : controls[0])?.focus();
                }
            }
        };
        window.addEventListener('keydown', key, true);
        return () => { window.removeEventListener('keydown', key, true); if (previous?.isConnected)
            previous.focus(); };
    }, []);
    useEffect(() => {
        try {
            const current = canvasRef.current?.toDataURL('image/png') ?? '';
            setRaster(current);
            if (!qualityCapture.current)
                throw new Error('The presentation view is not ready.');
            const frozen = qualityCapture.current();
            snapshot.current = frozen;
            setRaster(frozen.raster || current);
            setWarnings(frozen.warnings);
            setReady(true);
            setMessage('Frozen view ready. Choose Quality render or save the current raster image.');
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
        }
        return () => { stop.current?.(); snapshot.current?.dispose(); snapshot.current = null; };
    }, []);
    const render = async () => {
        if (!snapshot.current || !host.current)
            return;
        stop.current?.();
        host.current.replaceChildren();
        setRunning(true);
        setShowCanvas(false);
        setSamples(0);
        setMessage('Loading quality renderer…');
        let cancelled = false, frame = 0, renderer: THREE.WebGLRenderer | undefined, tracer: import('three-gpu-pathtracer').WebGLPathTracer | undefined, worker: {
            dispose: () => void;
        } | undefined, environment: THREE.Texture | undefined;
        let removeContextListener = () => { };
        let shaderError = false;
        const cleanup = () => {
            if (cancelled)
                return;
            cancelled = true;
            removeContextListener();
            cancelAnimationFrame(frame);
            worker?.dispose();
            tracer?.dispose();
            renderer?.dispose();
            renderer?.forceContextLoss();
            if (snapshot.current?.scene.environment === environment)
                snapshot.current.scene.environment = null;
            environment?.dispose();
        };
        stop.current = cleanup;
        try {
            const [{ WebGLPathTracer, GradientEquirectTexture }, { GenerateMeshBVHWorker }] = await Promise.all([import('three-gpu-pathtracer'), import('three-mesh-bvh/worker')]);
            if (cancelled)
                return;
            renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
            if (!renderer.extensions.has('EXT_color_buffer_float'))
                throw new Error('Floating-point GPU render targets are unavailable');
            renderer.debug.onShaderError = () => { shaderError = true; };
            const contextLost = (event: Event) => { event.preventDefault(); if (cancelled)
                return; cleanup(); setShowCanvas(false); setSamples(0); setRunning(false); setMessage('GPU context lost. Save raster or start again.'); };
            renderer.domElement.addEventListener('webglcontextlost', contextLost);
            removeContextListener = () => renderer?.domElement.removeEventListener('webglcontextlost', contextLost);
            renderer.setPixelRatio(1);
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            const frozen = snapshot.current;
            if (!frozen)
                return;
            const aspect = Math.abs(frozen.camera.projectionMatrix.elements[5] / frozen.camera.projectionMatrix.elements[0]);
            const width = aspect >= 1 ? 1024 : Math.round(1024 * aspect), height = aspect >= 1 ? Math.round(1024 / aspect) : 1024;
            renderer.setSize(width, height, false);
            renderer.domElement.style.cssText = 'width:100%;height:100%;object-fit:contain;';
            host.current?.appendChild(renderer.domElement);
            setShowCanvas(true);
            if (!frozen.scene.environment) {
                const sky = new GradientEquirectTexture(128);
                sky.topColor.set('#bccad9');
                sky.bottomColor.set('#80796c');
                sky.update();
                environment = sky;
                frozen.scene.environment = sky;
            }
            tracer = new WebGLPathTracer(renderer);
            tracer.bounces = 6;
            tracer.tiles.set(3, 3);
            tracer.textureSize.set(512, 512);
            tracer.renderDelay = 0;
            tracer.minSamples = 1;
            tracer.fadeDuration = 0;
            tracer.rasterizeScene = false;
            tracer.filterGlossyFactor = .5;
            const bvhWorker = new GenerateMeshBVHWorker();
            worker = bvhWorker;
            tracer.setBVHWorker(bvhWorker);
            setMessage('Preparing geometry…');
            await tracer.setSceneAsync(frozen.scene, frozen.camera);
            if (cancelled)
                return;
            setMessage('Rendering indirect light and reflections…');
            let reported = 0;
            const tick = () => {
                if (cancelled || !tracer)
                    return;
                try {
                    tracer.renderSample();
                    if (shaderError)
                        throw new Error('The GPU could not compile the quality renderer');
                    const done = Math.floor(tracer.samples);
                    if (done !== reported) {
                        reported = done;
                        setSamples(done);
                    }
                    if (tracer.samples >= targetSamples) {
                        setRunning(false);
                        setMessage('Quality still ready. Save PNG or start another render.');
                        return;
                    }
                    frame = requestAnimationFrame(tick);
                }
                catch (error) {
                    cleanup();
                    setShowCanvas(false);
                    setSamples(0);
                    setRunning(false);
                    setMessage(`Quality rendering unavailable: ${error instanceof Error ? error.message : String(error)}. Save raster instead.`);
                }
            };
            frame = requestAnimationFrame(tick);
        }
        catch (error) {
            if (cancelled)
                return;
            cleanup();
            setShowCanvas(false);
            setSamples(0);
            setRunning(false);
            setMessage(`Quality rendering unavailable: ${error instanceof Error ? error.message : String(error)}. Save raster instead.`);
        }
    };
    const saveRaster = async () => {
        if (!raster)
            return;
        const response = await fetch(raster);
        downloadBlob(await response.blob(), 'polyform-presentation-raster.png');
    };
    const saveQuality = () => {
        const canvas = host.current?.querySelector('canvas');
        canvas?.toBlob(blob => {
            if (blob)
                downloadBlob(blob, 'polyform-presentation-quality.png');
        }, 'image/png');
    };
    return <div ref={dialog} className="fixed inset-0 z-[130] bg-black/70 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Quality still render" onPointerDown={e => e.stopPropagation()}><section className="w-full max-w-4xl max-h-[95dvh] overflow-auto rounded-2xl bg-slate-900 p-4 text-white shadow-2xl"><header className="flex justify-between items-center"><h2 className="font-semibold">Quality still render · experimental</h2><button aria-label="Close quality render" onClick={onClose}><X size={20}/></button></header>
    <p role="status" className="text-sm text-slate-300 my-3">{message}</p>
    {warnings.length > 0 && <ul className="list-disc pl-5 text-xs text-amber-200 mb-3">{warnings.map(w => <li key={w}>{w}</li>)}</ul>}
    <div className="relative bg-slate-950 rounded-lg h-[min(55vh,560px)] flex items-center justify-center">{!showCanvas && raster && <img src={raster} alt="Current presentation raster preview" className="max-w-full max-h-full object-contain"/>}<div ref={host} className="absolute inset-0" style={{ visibility: showCanvas ? 'visible' : 'hidden' }}/></div>
    <div className="flex flex-wrap gap-3 items-center mt-4 text-sm"><label>Samples <select aria-label="Quality render samples" value={targetSamples} disabled={running} onChange={e => setTargetSamples(+e.target.value)} className="bg-slate-800 rounded p-1"><option value={32}>32 · preview</option><option value={64}>64 · standard</option><option value={256}>256 · refined</option></select></label><button disabled={!ready || running} onClick={render} className="bg-sky-600 rounded px-3 py-2 disabled:opacity-40">Quality render</button>{running && <button onClick={() => { stop.current?.(); setShowCanvas(false); setSamples(0); setRunning(false); setMessage('Rendering cancelled. Save raster or start again.'); }} className="bg-slate-700 rounded px-3 py-2">Cancel render</button>}<button disabled={!raster} onClick={saveRaster} className="bg-slate-700 rounded px-3 py-2">Save raster</button><button disabled={running || samples < 1} onClick={saveQuality} className="bg-slate-700 rounded px-3 py-2 disabled:opacity-40">Save quality PNG</button><span>{samples}/{targetSamples} samples</span></div>
  </section></div>;
}
