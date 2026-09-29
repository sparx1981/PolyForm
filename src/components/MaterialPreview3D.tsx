import React, { Suspense, useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Box, Circle } from 'lucide-react';
import { cn } from '../lib/utils';

/** What the preview shows: a plain colour, a texture, or both, with the material's settings. */
export interface PreviewSpec {
  label?: string;
  color?: string;
  textureUrl?: string;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  /** A height map (relief) and its matching normal map. */
  heightMapUrl?: string;
  normalMapUrl?: string;
  /** How far the height map lifts the surface, metres (as painted). */
  depthScale?: number;
}

/** Loads an image as a repeating texture; null while loading or if it can't be read. */
function useImageTexture(url: string | undefined, colour: boolean, repeat: number): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!url) { setTex(null); return; }
    let alive = true;
    let made: THREE.Texture | null = null;
    new THREE.TextureLoader().setCrossOrigin('anonymous').load(url, t => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat, repeat);
      t.anisotropy = 4;
      if (colour) t.colorSpace = THREE.SRGBColorSpace;
      made = t;
      if (alive) setTex(t); else t.dispose();
    }, undefined, () => { if (alive) setTex(null); });
    return () => { alive = false; made?.dispose(); };
  }, [url, colour, repeat]);
  return tex;
}

function Model({ spec, shape }: { spec: PreviewSpec; shape: 'cube' | 'sphere' }) {
  const repeat = shape === 'cube' ? 1 : 2;
  const map = useImageTexture(spec.textureUrl, true, repeat);
  const height = useImageTexture(spec.heightMapUrl, false, repeat);
  const normal = useImageTexture(spec.normalMapUrl, false, repeat);
  const opacity = spec.opacity ?? 1;
  // The painted depth is centimetres on a metre-sized object; scaled up so it shows on a 1 unit preview.
  const displacement = Math.min(0.12, Math.max(0.02, (spec.depthScale ?? 0.04) * 2));
  return (
    <mesh castShadow>
      {shape === 'cube' ? <boxGeometry args={[1.3, 1.3, 1.3, 48, 48, 48]} /> : <sphereGeometry args={[0.85, 96, 64]} />}
      <meshStandardMaterial
        color={map ? '#ffffff' : (spec.color ?? '#cccccc')}
        map={map}
        roughness={spec.roughness ?? 0.6}
        metalness={spec.metalness ?? 0}
        transparent={opacity < 1}
        opacity={opacity}
        normalMap={normal}
        displacementMap={height}
        displacementScale={height ? displacement : 0}
        displacementBias={height ? -displacement / 2 : 0}
      />
    </mesh>
  );
}

/** A small turntable preview of a material on a cube or a sphere. */
export function MaterialPreview3D({ spec, className }: { spec: PreviewSpec | null; className?: string }) {
  const [shape, setShape] = useState<'cube' | 'sphere'>('sphere');
  const stable = useMemo(() => spec, [JSON.stringify(spec)]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider truncate">{stable?.label ?? 'Preview'}</span>
        <div className="flex gap-1 p-0.5 rounded-lg bg-gray-100" role="group" aria-label="Preview shape">
          {([['sphere', <Circle key="s" size={12} />, 'Sphere'], ['cube', <Box key="c" size={12} />, 'Cube']] as const).map(([id, icon, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setShape(id)}
              title={label}
              aria-pressed={shape === id}
              className={cn('px-2 py-1 rounded-md text-[10px] font-semibold flex items-center gap-1 transition-colors',
                shape === id ? 'bg-white text-polyform-blue shadow-sm' : 'text-gray-500 hover:text-gray-700')}
            >
              {icon}{label}
            </button>
          ))}
        </div>
      </div>
      <div className="relative aspect-square w-full rounded-xl overflow-hidden border border-gray-200 bg-gradient-to-b from-slate-100 to-slate-300">
        {stable ? (
          <Canvas camera={{ position: [1.9, 1.3, 2.3], fov: 35 }} dpr={[1, 2]} gl={{ antialias: true }}>
            <ambientLight intensity={0.55} />
            <hemisphereLight args={['#ffffff', '#94a3b8', 0.6]} />
            <directionalLight position={[3, 4, 2]} intensity={2.2} />
            <directionalLight position={[-3, 1, -2]} intensity={0.6} />
            <Suspense fallback={null}>
              <Model spec={stable} shape={shape} />
            </Suspense>
            <OrbitControls enablePan={false} enableZoom={false} autoRotate autoRotateSpeed={2.5} />
          </Canvas>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-gray-500">
            Click the cube icon on a swatch to see it here.
          </div>
        )}
      </div>
    </div>
  );
}
