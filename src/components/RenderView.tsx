import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { signInWithCustomToken } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useApp } from '../AppContext';
import Viewport, { modelledBounds } from './Viewport';

/** What the connector asks the render page to show. */
export interface RenderJob {
  /** Firebase custom token for the model's owner, minted by the connector. */
  token: string;
  modelId: string;
  view: 'perspective' | 'plan' | 'front' | 'back' | 'left' | 'right';
  /** Frame just this object instead of the whole model. */
  focus?: string;
}

declare global {
  interface Window {
    __polyformRender?: (job: RenderJob) => Promise<{ objects: number }>;
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const nextFrames = (n: number) => new Promise<void>(resolve => {
  const step = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
  step(n);
});

async function waitUntil(test: () => boolean, timeoutMs: number, what: string) {
  const start = Date.now();
  while (!test()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await sleep(100);
  }
}

/** Camera position and target that fit every corner of `box` in view from the given side. */
export function framing(box: THREE.Box3, view: RenderJob['view'], aspect: number) {
  const center = box.getCenter(new THREE.Vector3());
  const vfov = THREE.MathUtils.degToRad(50);
  const tanV = Math.tan(vfov / 2);
  const tanH = tanV * aspect;
  const directions: Record<RenderJob['view'], [number, number, number]> = {
    perspective: [1, 0.75, 1.15],
    plan: [0, 1, 0.001],
    front: [0, 0.12, 1],
    back: [0, 0.12, -1],
    left: [-1, 0.12, 0],
    right: [1, 0.12, 0],
  };
  // Camera axes: `back` points from the target to the camera.
  const back = new THREE.Vector3(...directions[view]).normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), back).normalize();
  const up = new THREE.Vector3().crossVectors(back, right);
  let distance = 1;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const v = new THREE.Vector3(x, y, z).sub(center);
    const depth = v.dot(back);
    distance = Math.max(distance, depth + Math.abs(v.dot(right)) / tanH, depth + Math.abs(v.dot(up)) / tanV);
  }
  distance *= 1.08;
  const position = center.clone().addScaledVector(back, distance);
  return { position: position.toArray() as [number, number, number], target: center.toArray() as [number, number, number] };
}

/**
 * The `?render=1` page: signs in with the connector's token, opens the model read-only, hides
 * the grid and axes, frames the model and reports back when the picture is ready.
 */
export default function RenderView() {
  const app = useApp();
  const { setUser, setCurrentModelId, setGridEnabled, setAxisIndicatorEnabled, setMiniAxisIndicatorEnabled } = app;
  const [job, setJob] = useState<(RenderJob & { resolve: (r: { objects: number }) => void; reject: (e: Error) => void }) | null>(null);
  const live = useRef(app);
  live.current = app;

  useEffect(() => {
    window.__polyformRender = next => new Promise((resolve, reject) => setJob({ ...next, resolve, reject }));
    return () => { delete window.__polyformRender; };
  }, []);

  useEffect(() => {
    if (!job) return;
    (async () => {
      const hideHelpers = () => {
        setGridEnabled(false);
        setAxisIndicatorEnabled(false);
        setMiniAxisIndicatorEnabled(false);
      };
      hideHelpers();
      const credential = await signInWithCustomToken(auth, job.token);
      setUser(credential.user);
      const snap = await getDoc(doc(db, 'models', job.modelId));
      if (!snap.exists()) throw new Error('Model not found');
      const data = snap.data();
      const expected = Array.isArray(data.shapes) ? data.shapes.length : 0;
      setCurrentModelId(job.modelId);
      await waitUntil(() => live.current.currentModelName === data.name && live.current.shapes.length === expected, 45000, 'the model to load');
      // Saved settings load after sign-in and may turn the grid back on.
      await sleep(1500);
      hideHelpers();
      // Terrain, fences and textures build in the background; give them time to appear.
      await sleep(3000);

      const types = new Map(live.current.shapes.map(s => [s.id, s.type]));
      const focus = job.focus ? live.current.shapes.find(s => s.id === job.focus || s.name === job.focus)?.id : undefined;
      const box = (focus && modelledBounds(id => id === focus))
        ?? modelledBounds(id => types.get(id) !== 'terrain' && types.get(id) !== 'measurement')
        ?? modelledBounds(() => true)
        ?? new THREE.Box3(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 3, 5));
      const { position, target } = framing(box, job.view, window.innerWidth / Math.max(1, window.innerHeight));
      window.dispatchEvent(new CustomEvent('set-camera', { detail: { position, target } }));
      await sleep(1500);
      await nextFrames(4);
      job.resolve({ objects: live.current.shapes.length });
    })().catch(error => job.reject(error instanceof Error ? error : new Error(String(error))));
  }, [job]);

  return (
    <div id="polyform-render" className="h-screen w-screen flex overflow-hidden bg-white">
      {/* Only the 3D canvas: every on-screen control and badge is hidden. */}
      <style>{'#polyform-viewport > :not(:has(canvas)) { display: none !important; }'}</style>
      <Viewport />
    </div>
  );
}
