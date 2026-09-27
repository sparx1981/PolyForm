import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useApp } from '../../AppContext';
import { PresentationEngine } from '../../lib/presentation/engine';
import { presentation, STAGE_PLAY_SECONDS } from '../../lib/presentation/store';
import { canvasRef } from '../../lib/presentation/recorder';

/**
 * Lives inside the viewport's canvas and runs presentation effects every frame. Does nothing
 * (and costs nothing) until presentation mode is switched on.
 */
export default function PresentationDriver() {
  const { scene, gl, camera } = useThree();
  const { shapes, kernelRevision } = useApp();
  const engine = useRef<PresentationEngine | null>(null);
  const wasActive = useRef(false);
  const frame = useRef(0);

  useEffect(() => {
    canvasRef.current = gl.domElement;
    return () => { if (canvasRef.current === gl.domElement) canvasRef.current = null; };
  }, [gl]);

  useEffect(() => {
    const e = new PresentationEngine(scene);
    engine.current = e;
    return () => { e.dispose(); engine.current = null; };
  }, [scene]);

  // After React has drawn the change (next frame), re-read which objects are what.
  useEffect(() => {
    if (!presentation.get().active) return;
    const id = requestAnimationFrame(() => {
      engine.current?.sync(shapes);
      publishBounds(engine.current);
    });
    return () => cancelAnimationFrame(id);
  }, [shapes, kernelRevision]);

  useFrame((_, dt) => {
    const e = engine.current;
    if (!e) return;
    const s = presentation.get();
    if (s.active && !wasActive.current) {
      gl.localClippingEnabled = true;
      e.sync(shapes);
      publishBounds(e);
    }
    wasActive.current = s.active;
    if (s.buildPlaying) {
      const next = Math.min(1, s.build + dt / Math.max(1, s.buildSeconds));
      presentation.set({ build: next, buildPlaying: next < 1 });
    }
    if (s.stagePlaying) {
      const next = Math.min(3, s.stage + (dt * 3) / STAGE_PLAY_SECONDS);
      presentation.set({ stage: next, stagePlaying: next < 3 });
    }
    // The colour behind the canvas: under x-ray, a faint wall over an empty sky would otherwise
    // come out nearly black from the post-processing pass.
    if (frame.current++ % 60 === 0) e.pageColour.set(pageColourBehind(gl.domElement));
    e.update(presentation.get(), Math.min(dt, 0.1), camera);
  });

  return null;
}

/** The first solid CSS background behind the canvas (white if none). */
function pageColourBehind(el: HTMLElement): string {
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const c = getComputedStyle(n).backgroundColor;
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) continue;
    const [r, g, b, a = '1'] = m[1].split(',').map(x => x.trim());
    if (Number(a) > 0.5) return `rgb(${r}, ${g}, ${b})`;
  }
  return '#ffffff';
}

function publishBounds(e: PresentationEngine | null) {
  if (!e) return;
  const box = e.bounds();
  const s = presentation.get();
  const patch: Parameters<typeof presentation.set>[0] = { storeys: e.storeys };
  if (box) {
    patch.bounds = { min: box.min.toArray() as [number, number, number], max: box.max.toArray() as [number, number, number] };
    // A sensible first cut: a metre and a bit above the ground floor, or through the middle.
    if (!s.bounds) patch.cutAt = Math.min(box.max.y, box.min.y + 1.3);
  }
  presentation.set(patch);
}
