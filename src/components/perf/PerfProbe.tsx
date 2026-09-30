import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useApp } from '../../AppContext';
import { perfStore, type DeviceInfo, type SceneCost, type PerfRun } from '../../lib/perf/profilerStore';

/** Estimated GPU bytes of a texture (with mip maps). */
function textureBytes(t: THREE.Texture): number {
  const img = t.image as { width?: number; height?: number } | undefined;
  const w = img?.width ?? 0, h = img?.height ?? 0;
  if (!w || !h) return 0;
  const compressed = (t as THREE.CompressedTexture).isCompressedTexture;
  return w * h * (compressed ? 0.5 : 4) * (t.generateMipmaps || compressed ? 1.33 : 1);
}

export function measureSceneCost(gl: THREE.WebGLRenderer, scene: THREE.Scene): SceneCost {
  let meshes = 0, instanced = 0, triangles = 0, lights = 0, shadowLights = 0, transparent = 0;
  const materials = new Set<THREE.Material>(), textures = new Map<THREE.Texture, string>();
  const groups = new Map<string, { triangles: number; meshes: number }>();
  const visibleInTree = (o: THREE.Object3D) => { for (let n: THREE.Object3D | null = o; n; n = n.parent) if (!n.visible) return false; return true; };
  const ownerName = (o: THREE.Object3D) => {
    for (let n: THREE.Object3D | null = o; n; n = n.parent) {
      const ud = n.userData as Record<string, unknown>;
      const id = (ud.shapeId ?? ud.id ?? ud.name) as string | undefined;
      if (typeof id === 'string' && id) return id;
      if (n.name) return n.name;
    }
    return o.type;
  };
  scene.traverse(o => {
    if ((o as THREE.Light).isLight) { lights++; if ((o as THREE.Light & { castShadow: boolean }).castShadow) shadowLights++; }
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh && !(o as THREE.Points).isPoints && !(o as THREE.Line).isLine) return;
    if (!visibleInTree(o)) return;
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
    if (!geometry) return;
    const count = geometry.index ? geometry.index.count : geometry.attributes.position?.count ?? 0;
    const inst = (o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1;
    const tris = mesh.isMesh ? Math.floor(count / 3) * inst : 0;
    meshes++; triangles += tris; if (inst > 1 || (o as THREE.InstancedMesh).isInstancedMesh) instanced++;
    const owner = ownerName(o); const g = groups.get(owner) ?? { triangles: 0, meshes: 0 };
    g.triangles += tris; g.meshes++; groups.set(owner, g);
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!m) continue;
      materials.add(m);
      if (m.transparent) transparent++;
      for (const value of Object.values(m as unknown as Record<string, unknown>)) {
        if (value && (value as THREE.Texture).isTexture && !textures.has(value as THREE.Texture)) textures.set(value as THREE.Texture, m.name || owner);
      }
    }
  });
  let bytes = 0; const sizes: SceneCost['biggestTextures'] = [];
  for (const [t, owner] of textures) {
    const b = textureBytes(t); bytes += b;
    const img = t.image as { width?: number; height?: number } | undefined;
    sizes.push({ name: t.name || owner, size: `${img?.width ?? '?'}x${img?.height ?? '?'}`, memoryMB: +(b / 1048576).toFixed(2) });
  }
  return {
    meshes, instancedMeshes: instanced, triangles, lights, shadowLights, transparentMeshes: transparent,
    materials: materials.size, textures: textures.size, textureMemoryMB: +(bytes / 1048576).toFixed(1),
    geometries: gl.info.memory.geometries, programs: gl.info.programs?.length ?? 0,
    heaviest: [...groups.entries()].map(([name, g]) => ({ name, ...g })).sort((a, b) => b.triangles - a.triangles).slice(0, 15),
    biggestTextures: sizes.sort((a, b) => b.memoryMB - a.memoryMB).slice(0, 10),
  };
}

function deviceInfo(gl: THREE.WebGLRenderer, gpuTimer: boolean): DeviceInfo {
  const ctx = gl.getContext();
  const dbg = ctx.getExtension('WEBGL_debug_renderer_info');
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    gpu: String(dbg ? ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER)),
    vendor: String(dbg ? ctx.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : ctx.getParameter(ctx.VENDOR)),
    webgl: String(ctx.getParameter(ctx.VERSION)),
    maxTextureSize: Number(ctx.getParameter(ctx.MAX_TEXTURE_SIZE)),
    antialias: ctx.getContextAttributes()?.antialias ?? null,
    canvas: `${gl.domElement.width}x${gl.domElement.height}`,
    pixelRatio: gl.getPixelRatio(),
    gpuTimer, cores: nav.hardwareConcurrency ?? null, memoryGB: nav.deviceMemory ?? null, userAgent: nav.userAgent,
  };
}

/**
 * Lives inside the 3D canvas. While the profiler is on it times every frame (interval, draw submission,
 * GPU time where the browser supports it, draw calls, triangles), feeds the overlay, and drives the
 * repeatable fly-around benchmark.
 */
export default function PerfProbe() {
  const { gl, scene, camera } = useThree();
  const { perfProfilerEnabled, shadowsEnabled, ambientOcclusionEnabled, godRaysEnabled, edgeLinesEnabled, graphicsSettings, shapes, autoOrbitEnabled } = useApp();
  const settingsRef = useRef<PerfRun['settings']>({});
  const runSettingsRef = useRef<PerfRun['settings'] | null>(null);
  settingsRef.current = {
    shadows: shadowsEnabled, ambientOcclusion: ambientOcclusionEnabled, godRays: godRaysEnabled, edgeLines: edgeLinesEnabled,
    weather: graphicsSettings.weather.enabled, clouds: graphicsSettings.weather.cloudsMode,
    vegetationInstancing: graphicsSettings.vegetation.instancing, shapes: shapes.length, autoOrbit: autoOrbitEnabled,
    toneMapping: gl.toneMapping, shadowMapType: gl.shadowMap.enabled ? gl.shadowMap.type : 0,
  };
  const gpu = useRef({ ext: null as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null, pending: [] as WebGLQuery[], last: null as number | null });
  const frame = useRef({ last: 0, renderCpu: 0, t0: 0, live: [] as number[], lastLive: 0, gpuRecent: [] as number[] });
  const bench = useRef<{ target: THREE.Vector3; offset: THREE.Vector3; wasEnabled: boolean; wasRotating: boolean } | null>(null);

  // Wrap render to time it and (where possible) bracket it with a GPU timer query.
  useEffect(() => {
    if (!perfProfilerEnabled) return;
    const ctx = gl.getContext() as WebGL2RenderingContext;
    const ext = ctx.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    gpu.current.ext = ext; gpu.current.pending = []; gpu.current.last = null;
    const g = gpu.current, f = frame.current;
    const prevAutoReset = gl.info.autoReset;
    gl.info.autoReset = false;
    const original = gl.render;
    let active: WebGLQuery | null = null;
    gl.render = function patched(this: THREE.WebGLRenderer, s: THREE.Object3D, c: THREE.Camera) {
      if (ext && !active && g.pending.length < 6) {
        try { const q = ctx.createQuery(); ctx.beginQuery(ext.TIME_ELAPSED_EXT, q); active = q; queueMicrotask(() => { if (!active) return; try { ctx.endQuery(ext.TIME_ELAPSED_EXT); g.pending.push(active); } catch { /* another query is open elsewhere */ } active = null; }); } catch { active = null; }
      }
      const t = performance.now();
      try { return original.call(this, s, c); } finally { f.renderCpu += performance.now() - t; }
    } as typeof gl.render;
    return () => {
      gl.render = original;
      gl.info.autoReset = prevAutoReset;
      for (const q of g.pending) ctx.deleteQuery(q);
      g.pending = [];
      perfStore.setLive(null);
    };
  }, [gl, perfProfilerEnabled]);

  const finish = (cancel = false) => {
    const b = bench.current;
    const runSettings: PerfRun['settings'] = { ...(runSettingsRef.current ?? settingsRef.current) };
    if (b) {
      runSettings.benchmarkRadius = +Math.hypot(b.offset.x, b.offset.z).toFixed(3);
      runSettings.benchmarkElevation = +b.offset.y.toFixed(3);
      runSettings.benchmarkTarget = `${b.target.x.toFixed(3)},${b.target.y.toFixed(3)},${b.target.z.toFixed(3)}`;
      const controls = scene.userData.controls as { enabled: boolean; autoRotate: boolean; target: THREE.Vector3; update: () => void } | undefined;
      if (controls) { controls.enabled = b.wasEnabled; controls.autoRotate = b.wasRotating; }
      camera.position.copy(b.target).add(b.offset); camera.lookAt(b.target);
      bench.current = null;
    }
    perfStore.finish({ device: deviceInfo(gl, !!gpu.current.ext), settings: runSettings, scene: measureSceneCost(gl, scene) }, cancel);
    runSettingsRef.current = null;
  };

  useFrame(() => {
    if (!perfProfilerEnabled) return;
    const now = performance.now(), f = frame.current, g = gpu.current;
    const interval = f.last ? now - f.last : 0;
    f.last = now;
    const { calls, triangles } = gl.info.render;
    const renderCpu = f.renderCpu;
    f.renderCpu = 0; gl.info.reset();

    // Collect finished GPU timer queries (they finish a few frames late). Only
    // attach fresh results to samples; reusing the previous result on every
    // intervening frame would overweight slower query-return cadences.
    let freshGpu: number | null = null;
    if (g.ext && g.pending.length) {
      const ctx = gl.getContext() as WebGL2RenderingContext;
      const disjoint = ctx.getParameter(g.ext.GPU_DISJOINT_EXT);
      while (g.pending.length && ctx.getQueryParameter(g.pending[0]!, ctx.QUERY_RESULT_AVAILABLE)) {
        const q = g.pending.shift()!;
        if (!disjoint) {
          freshGpu = Number(ctx.getQueryParameter(q, ctx.QUERY_RESULT)) / 1e6;
          g.last = freshGpu;
        }
        ctx.deleteQuery(q);
      }
    }
    if (interval <= 0) return;

    // Live numbers: rolling average of the last second or so.
    f.live.push(interval); if (f.live.length > 90) f.live.shift();
    if (freshGpu !== null) { f.gpuRecent.push(freshGpu); if (f.gpuRecent.length > 90) f.gpuRecent.shift(); }
    if (now - f.lastLive > 250) {
      f.lastLive = now;
      const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
      const ms = avg(f.live);
      perfStore.setLive({
        fps: 1000 / ms, frameMs: ms, gpuMs: f.gpuRecent.length ? avg(f.gpuRecent) : null, renderCpuMs: renderCpu,
        calls, triangles, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures,
      });
    }

    const phase = perfStore.getState().phase;
    if (phase.kind === 'idle') { f.t0 = 0; runSettingsRef.current = null; return; }
    if (!f.t0) {
      f.t0 = now;
      runSettingsRef.current = { ...settingsRef.current };
    }

    if (phase.kind === 'benchmark') {
      const elapsed = now - phase.startedAt;
      const controls = scene.userData.controls as { enabled: boolean; autoRotate: boolean; target: THREE.Vector3; update: () => void } | undefined;
      if (!bench.current && !controls) {
        finish(true);
        perfStore.setNotice('Benchmark could not start because orbit controls are unavailable in this view.');
        return;
      }
      if (!bench.current && controls) {
        bench.current = { target: controls.target.clone(), offset: camera.position.clone().sub(controls.target), wasEnabled: controls.enabled, wasRotating: controls.autoRotate };
        controls.enabled = false; controls.autoRotate = false;
      }
      const b = bench.current;
      if (b) {
        const angle = (Math.max(0, elapsed - phase.warmupMs) / phase.durationMs) * Math.PI * 2;
        camera.position.copy(b.target).add(b.offset.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, angle));
        camera.lookAt(b.target);
      }
      if (elapsed < phase.warmupMs) { f.t0 = 0; return; }
      if (elapsed >= phase.warmupMs + phase.durationMs) { finish(); return; }
    }
    perfStore.pushSample({ frameMs: interval, renderCpuMs: renderCpu, gpuMs: freshGpu, calls, triangles, t: (now - f.t0) / 1000 });
  });

  // Turning the profiler off, or leaving the scene, ends a run in progress without saving it.
  useEffect(() => () => { if (perfStore.getState().phase.kind !== 'idle') finish(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!perfProfilerEnabled && perfStore.getState().phase.kind !== 'idle') finish(true); }, [perfProfilerEnabled]); // eslint-disable-line react-hooks/exhaustive-deps


  // Stop-recording requests from the overlay arrive as a window event (the probe owns the renderer).
  useEffect(() => {
    const stop = () => finish(false), cancel = () => finish(true);
    window.addEventListener('polyform-perf-stop', stop); window.addEventListener('polyform-perf-cancel', cancel);
    return () => { window.removeEventListener('polyform-perf-stop', stop); window.removeEventListener('polyform-perf-cancel', cancel); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
