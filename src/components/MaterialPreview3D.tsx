import React, { Suspense, useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Box, Circle } from 'lucide-react';
import { cn } from '../lib/utils';
import { loadMaterialMaps, type LoadedMaterialMaps } from '../lib/assets/libraryTextures';
import { resolveMaterial } from '../lib/assets/materialResolver';
import { ManagedTextureManager } from '../lib/assets/textureManager';
import { isMaterialAssetId, type AssetManifest, type AssetSummary, type MapSemantic, type MaterialInstance } from '../lib/assets/types';

/** What the preview shows: a plain colour, a texture, or a library material, with the material's settings. */
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
  /**
   * A PBR library material: its real maps (colour, normal, roughness/metal/occlusion, height) are loaded,
   * with `instance` (tint, roughness, opacity, normal strength, texture scale, relief) applied on top.
   */
  library?: { asset: AssetSummary; instance?: Partial<MaterialInstance> };
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

const RUNTIME_MAPS: MapSemantic[] = ['basecolor', 'normal-gl', 'orm', 'height'];

/** The real maps of a library material, loaded once per asset (the sliders don't reload them). */
function useLibraryMaps(asset: AssetSummary | undefined): { manifest: AssetManifest | null; textures: Partial<Record<MapSemantic, THREE.Texture>> } {
  const { gl } = useThree();
  const [state, setState] = useState<{ manifest: AssetManifest | null; textures: Partial<Record<MapSemantic, THREE.Texture>> }>({ manifest: null, textures: {} });
  useEffect(() => {
    setState({ manifest: null, textures: {} });
    if (!asset || !isMaterialAssetId(asset.id)) return;
    const controller = new AbortController();
    let loaded: LoadedMaterialMaps | null = null;
    const manager = new ManagedTextureManager(gl);
    void loadMaterialMaps(manager, asset, RUNTIME_MAPS, (semantic, texture) => {
      if (!controller.signal.aborted) setState(prev => ({ manifest: prev.manifest, textures: { ...prev.textures, [semantic]: texture } }));
    }, controller.signal).then(result => {
      loaded = result;
      // The numbers (roughness, relief ...) show as soon as the manifest is known.
      if (!controller.signal.aborted) setState(prev => ({ manifest: result.manifest, textures: prev.textures }));
      if (controller.signal.aborted) result.release();
    }).catch(error => { if (!controller.signal.aborted) console.warn('[Material preview] Could not load the material', error); });
    return () => {
      controller.abort();
      loaded?.release();
      manager.dispose();
    };
  }, [asset?.id, asset?.revision, gl]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

/** A soft studio light and reflections (nothing to download), so gloss, metal and glass read properly. */
function StudioLight() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    return () => { scene.environment = null; env.dispose(); pmrem.dispose(); };
  }, [gl, scene]);
  return null;
}

function Surface({ shape, children }: { shape: 'cube' | 'sphere'; children: React.ReactNode }) {
  return (
    <mesh castShadow>
      {shape === 'cube' ? <boxGeometry args={[1.3, 1.3, 1.3, 48, 48, 48]} /> : <sphereGeometry args={[0.85, 96, 64]} />}
      {children}
    </mesh>
  );
}

function PlainModel({ spec, shape }: { spec: PreviewSpec; shape: 'cube' | 'sphere' }) {
  const repeat = shape === 'cube' ? 1 : 2;
  const map = useImageTexture(spec.textureUrl, true, repeat);
  const height = useImageTexture(spec.heightMapUrl, false, repeat);
  const normal = useImageTexture(spec.normalMapUrl, false, repeat);
  const opacity = spec.opacity ?? 1;
  const clear = opacity < 1;
  // The painted depth is centimetres on a metre-sized object; scaled up so it shows on a 1 unit preview.
  const displacement = Math.min(0.12, Math.max(0.02, (spec.depthScale ?? 0.04) * 2));
  return (
    <Surface shape={shape}>
      <meshPhysicalMaterial
        // A new material when a map arrives: switching a map on needs the shader rebuilt.
        key={`${map ? 'm' : '-'}${normal ? 'n' : '-'}${height ? 'h' : '-'}`}
        color={map ? '#ffffff' : (spec.color ?? '#cccccc')}
        map={map}
        roughness={spec.roughness ?? 0.6}
        metalness={spec.metalness ?? 0}
        transparent={clear}
        opacity={opacity}
        depthWrite={!clear}
        side={clear ? THREE.DoubleSide : THREE.FrontSide}
        normalMap={normal}
        displacementMap={height}
        displacementScale={height ? displacement : 0}
        displacementBias={height ? -displacement / 2 : 0}
      />
    </Surface>
  );
}

function LibraryModel({ spec, shape }: { spec: PreviewSpec; shape: 'cube' | 'sphere' }) {
  const asset = spec.library!.asset;
  const instance = spec.library!.instance;
  const { manifest, textures } = useLibraryMaps(asset);
  const resolved = useMemo(() => {
    if (!manifest) return null;
    const merged: MaterialInstance = { ref: { assetId: asset.id as MaterialInstance['ref']['assetId'], revision: asset.revision }, ...instance };
    try { return resolveMaterial(merged, manifest, '1k'); } catch { return null; }
  }, [manifest, asset.id, asset.revision, JSON.stringify(instance)]); // eslint-disable-line react-hooks/exhaustive-deps
  const uv = resolved?.uv;
  const baseRepeat = shape === 'cube' ? 1 : 2;
  useEffect(() => {
    for (const t of Object.values(textures)) {
      if (!t) continue;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(baseRepeat * (uv?.repeat[0] ?? 1), baseRepeat * (uv?.repeat[1] ?? 1));
      t.needsUpdate = true;
    }
  }, [textures, uv?.repeat[0], uv?.repeat[1], baseRepeat]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!resolved) return <PlainModel spec={{ ...spec, textureUrl: asset.thumbnailUrl, color: '#ffffff', library: undefined }} shape={shape} />;
  const opacity = resolved.opacity;
  const clear = opacity < 1;
  const strength = instance?.normalStrength ?? 1;
  const depth = resolved.depth && resolved.depth.enabled && textures.height ? resolved.depth : null;
  // Relief is metres on a real object; magnified for a one-unit preview so it can be seen.
  const relief = depth ? Math.min(0.08, depth.scaleMeters * 1.5) : 0;
  return (
    <Surface shape={shape}>
      <meshPhysicalMaterial
        key={Object.keys(textures).sort().join(',') + (depth ? 'd' : '')}
        color={resolved.color}
        map={textures.basecolor ?? null}
        roughness={resolved.roughness}
        metalness={resolved.metalness}
        roughnessMap={textures.orm ?? null}
        metalnessMap={textures.orm ?? null}
        normalMap={textures['normal-gl'] ?? null}
        normalScale={new THREE.Vector2(strength, strength)}
        transparent={clear}
        opacity={opacity}
        depthWrite={!clear}
        side={clear ? THREE.DoubleSide : THREE.FrontSide}
        displacementMap={depth ? textures.height ?? null : null}
        displacementScale={relief}
        displacementBias={depth ? -relief / 2 + depth.biasMeters * 1.5 : 0}
      />
    </Surface>
  );
}

/** A small turntable preview of a material on a cube or a sphere, in studio light over a chequered backdrop. */
/** Does this browser give us WebGL (jsdom and locked-down browsers don't)? */
function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function MaterialPreview3D({ spec, className }: { spec: PreviewSpec | null; className?: string }) {
  const [shape, setShape] = useState<'cube' | 'sphere'>('sphere');
  const webgl = useMemo(hasWebGL, []);
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
      {/* The chequered backdrop shows through transparent materials. */}
      <div
        className="relative aspect-square w-full rounded-xl overflow-hidden border border-gray-200"
        style={{ background: 'repeating-conic-gradient(#e2e8f0 0% 25%, #f8fafc 0% 50%) 50% / 24px 24px' }}
      >
        {!webgl ? (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-gray-500 bg-white/60">The 3D preview needs WebGL, which this browser is not offering.</div>
        ) : stable ? (
          <Canvas camera={{ position: [1.9, 1.3, 2.3], fov: 35 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }} style={{ background: 'transparent' }}>
            <StudioLight />
            <ambientLight intensity={0.25} />
            <directionalLight position={[3, 4, 2]} intensity={1.6} />
            <directionalLight position={[-3, 1, -2]} intensity={0.4} />
            <Suspense fallback={null}>
              {stable.library ? <LibraryModel spec={stable} shape={shape} /> : <PlainModel spec={stable} shape={shape} />}
            </Suspense>
            <OrbitControls enablePan={false} enableZoom={false} autoRotate autoRotateSpeed={2.5} />
          </Canvas>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-gray-500 bg-white/60">
            Click the cube icon on a swatch to see it here.
          </div>
        )}
      </div>
    </div>
  );
}
