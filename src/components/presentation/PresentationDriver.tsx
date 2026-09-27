import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useApp } from '../../AppContext';
import { PresentationEngine } from '../../lib/presentation/engine';
import * as THREE from 'three';
import { presentation, STAGE_PLAY_SECONDS, usePresentation } from '../../lib/presentation/store';
import { DoorOpener, doorMotion } from '../../lib/presentation/doors';
import { pickMode, pickShape } from '../../lib/presentation/camera';
import { canvasRef } from '../../lib/presentation/recorder';

/**
 * Lives inside the viewport's canvas and runs presentation effects every frame. Does nothing
 * (and costs nothing) until presentation mode is switched on.
 */
export default function PresentationDriver() {
  const { scene, gl, camera } = useThree();
  const { shapes, kernelRevision } = useApp();
  const engine = useRef<PresentationEngine | null>(null);
  const doors = useRef(new DoorOpener());
  const { active } = usePresentation();
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;

  // Doors open and close on a click (not a drag) while presenting. The press is kept from the
  // editor so it doesn't also select the door or start orbiting.
  useEffect(() => {
    if (!active) { doors.current.dispose(); return; }
    const doorAt = (e: PointerEvent) => {
      if (pickMode.active || e.button !== 0 || e.target !== gl.domElement) return null;
      const hit = pickShape(e.clientX, e.clientY);
      const shape = hit && shapesRef.current.find(s => s.id === hit.id);
      if (!hit || shape?.type !== 'door' || doorMotion(shape.archStyle) === 'none') return null;
      const mesh = (hit.root as THREE.Mesh).isMesh ? (hit.root as THREE.Mesh) : null;
      return mesh ? { mesh, shape } : null;
    };
    let down: { x: number; y: number; door: NonNullable<ReturnType<typeof doorAt>> } | null = null;
    const onDown = (e: PointerEvent) => {
      const door = doorAt(e);
      if (!door) return;
      down = { x: e.clientX, y: e.clientY, door };
      e.stopImmediatePropagation();
    };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      const { door } = down;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      e.stopImmediatePropagation();
      if (moved > 6) return;
      const [w = 0.9, h = 2.1] = Array.isArray(door.shape.args) ? door.shape.args as number[] : [];
      doors.current.toggle(door.mesh, { width: w, height: h }, door.shape.archStyle, camera.position);
    };
    let last = 0;
    const onMove = (e: PointerEvent) => {
      if (e.buttons || performance.now() - last < 120) return;
      last = performance.now();
      if (e.target !== gl.domElement) return;
      gl.domElement.style.cursor = !pickMode.active && doorAt(e) ? 'pointer' : pickMode.active ? 'crosshair' : '';
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointermove', onMove, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointermove', onMove, true);
      gl.domElement.style.cursor = '';
    };
  }, [active, gl, camera]);
  const wasActive = useRef(false);
  const frame = useRef(0);

  useEffect(() => {
    canvasRef.current = gl.domElement;
    return () => { if (canvasRef.current === gl.domElement) canvasRef.current = null; };
  }, [gl]);

  useEffect(() => {
    const e = new PresentationEngine(scene);
    engine.current = e;
    return () => { doors.current.dispose(); e.dispose(); engine.current = null; };
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
    doors.current.update(Math.min(dt, 0.1));
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
