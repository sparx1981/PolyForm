/** Local, backend-free review scene: npm run dev, then /examples/presentation-quality.html. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import '../src/index.css';
import type { Shape, SceneNote } from '../src/types';
import { InstancedTimberFraming } from '../src/components/InstancedTimberFraming';
import { StageTimeline } from '../src/components/presentation/StageTimeline';
import { NoteCard } from '../src/components/NoteCard';
import { PresentationEngine } from '../src/lib/presentation/engine';
import { presentation, playBuild, STAGE_PLAY_SECONDS, usePresentation } from '../src/lib/presentation/store';
import { planAutoLighting } from '../src/lib/autoLighting';

const wall = (id: string, x: number, z: number, length: number, rotation: number): Shape => ({ id, type: 'wall', position: [x, 1.4, z], rotation: [0, rotation, 0], args: [length, 2.8, 0.2], color: '#e8ddc8' });
const shapes: Shape[] = [wall('n', 0, -2, 6.2, 0), wall('s', 0, 2, 6.2, 0), wall('e', 3, 0, 4.2, Math.PI / 2), wall('w', -3, 0, 4.2, Math.PI / 2),
  { id: 'slab', type: 'box', position: [0, -0.1, 0], args: [6.4, 0.2, 4.4], tags: ['floor-slab'], color: '#b9b5aa' },
  { id: 'roof', type: 'roof', position: [0, 3, 0], args: [6.5, 0.2, 4.5], color: '#5d7165' },
  { id: 'table', type: 'box', position: [0, 0.65, 0], args: [1.6, 0.15, 0.9], color: '#8f5c38' },
  ...Array.from({ length: 22 }, (_, i): Shape => ({ id: `tf-${i}`, type: 'box', position: [-2.8 + (i % 11) * 0.56, 1.4, i < 11 ? -2 : 2], args: [0.09, 2.8, 0.14], tags: ['timber-frame'], color: '#c1945a' }))];

function Driver() {
  const { scene, camera, gl } = useThree();
  const engine = useRef<PresentationEngine | null>(null);
  useEffect(() => {
    const e = new PresentationEngine(scene); engine.current = e;
    gl.localClippingEnabled = true; e.sync(shapes);
    return () => { e.dispose(); engine.current = null; };
  }, [scene, gl]);
  useFrame((_, delta) => {
    const s = presentation.get();
    if (s.buildPlaying) { const build = Math.min(1, s.build + delta / 12); presentation.set({ build, buildPlaying: build < 1 }); }
    if (s.stagePlaying && !engine.current?.holdsSketch(s.stage)) { const stage = Math.min(3, s.stage + delta * 3 / STAGE_PLAY_SECONDS); presentation.set({ stage, stagePlaying: stage < 3 }); }
    engine.current?.update(presentation.get(), Math.min(delta, 0.1), camera);
  });
  return null;
}

function Review() {
  const s = usePresentation();
  const [auto, setAuto] = useState(false);
  const [note, setNote] = useState<SceneNote>({ id: 'review', text: 'Check the timber connections before closing the walls.\nThe same card style is used for model notes and comments.', authorUid: 'local-review', authorName: 'Design review', position: { x: 0, y: 0, z: 0 }, createdAt: Date.now(), completed: false });
  const rig = useMemo(() => planAutoLighting(shapes, [], 'custom', 'warm').lights.map(light => {
    const aim = new THREE.Object3D(); aim.position.set(...(light.target ?? [0, 0, 0])); aim.updateMatrixWorld(true);
    return { ...light, aim };
  }), []);
  useEffect(() => { presentation.reset(true); return () => presentation.reset(false); }, []);
  return <main className="h-screen bg-[#f7f5f0] text-slate-800 grid grid-cols-[1fr_330px]">
    <section className="relative min-w-0">
      <Canvas shadows camera={{ position: [10, 8, 12], fov: 45 }}>
        <color attach="background" args={['#e5e9ea']} />
        <ambientLight intensity={auto ? 0.08 : 0.8} />
        <directionalLight position={[8, 12, 4]} intensity={auto ? 0.1 : 2} castShadow />
        {shapes.filter(shape => !shape.id.startsWith('tf-')).map(shape => <mesh key={shape.id} position={shape.position} rotation={shape.rotation} userData={{ isShape: true, id: shape.id }} castShadow receiveShadow>
          <boxGeometry args={shape.args as [number, number, number]} /><meshStandardMaterial color={shape.color} />
        </mesh>)}
        <InstancedTimberFraming shapes={shapes} tags={[]} selectedId={null} shadowsEnabled />
        {auto && rig.map(l => l.type === 'spot' ? <spotLight key={l.id} position={l.position} intensity={l.intensity} color={l.color} distance={l.distance} angle={l.angle} penumbra={l.penumbra} castShadow target={l.aim} />
          : <rectAreaLight key={l.id} position={l.position} rotation={[-Math.PI / 2, 0, 0]} intensity={l.intensity} color={l.color} width={l.width} height={l.height} />)}
        <OrbitControls makeDefault target={[0, 1.5, 0]} /><Driver />
      </Canvas>
      <StageTimeline className="absolute bottom-6 left-6 right-6" />
    </section>
    <aside className="p-5 space-y-5 overflow-auto">
      <h1 className="text-lg font-semibold">Presentation review</h1>
      <p className="text-xs text-slate-500">A local sample scene using the production presentation engine and batched timber renderer.</p>
      <div className="flex flex-wrap gap-2">
        <button className="rounded-lg bg-[#2f3a33] text-white px-3 py-2 text-xs" onClick={playBuild}>Play build</button>
        <button className="rounded-lg bg-white px-3 py-2 text-xs" onClick={() => presentation.set({ active: true, stage: 3, stagePlaying: false, build: 1, buildPlaying: false, explode: s.explode ? 0 : 1 })}>Toggle explode</button>
        <button className="rounded-lg bg-white px-3 py-2 text-xs" onClick={() => presentation.set({ xray: !s.xray })}>Toggle X-ray</button>
        <button className="rounded-lg bg-white px-3 py-2 text-xs" onClick={() => presentation.reset(true)}>Reset</button>
      </div>
      <label className="block text-xs">Build progress<input aria-label="Build progress" type="range" min="0" max="1" step="0.001" value={s.build} onChange={e => presentation.set({ build: Number(e.target.value), buildPlaying: false, stage: 3, stagePlaying: false })} className="w-full" /></label>
      <NoteCard note={note} number={1} date="28 Sep" onComplete={() => setNote(n => ({ ...n, completed: !n.completed }))} />
      <button onClick={() => setAuto(v => !v)} className="rounded-lg bg-[#2f3a33] text-white px-3 py-2 text-xs">{auto ? 'Daylight' : 'Preview auto lighting'}</button>
      <p className="text-xs text-slate-500">{rig.length} editable lights generated for the enclosed sample room. Use X-ray to see inside.</p>
    </aside>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Review />);
