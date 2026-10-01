import { isPerfRun, mergeHistory, MAX_HISTORY_RUNS } from './history';
import { compareRuns, diagnose, summarise, timeline, type FrameSample, type RunStats, type TimelinePoint } from './profilerCore';

export type RunKind = 'recording' | 'benchmark';

export interface SceneCost {
  meshes: number; instancedMeshes: number; triangles: number; lights: number; shadowLights: number;
  transparentMeshes: number; materials: number; textures: number; textureMemoryMB: number;
  geometries: number; programs: number;
  heaviest: { name: string; triangles: number; meshes: number }[];
  biggestTextures: { name: string; size: string; memoryMB: number }[];
}

export interface DeviceInfo {
  gpu: string; vendor: string; webgl: string; maxTextureSize: number; antialias: boolean | null;
  canvas: string; pixelRatio: number; gpuTimer: boolean; cores: number | null; memoryGB: number | null; userAgent: string;
}

export interface PerfRun {
  id: string;
  context?: { scenario: string; modelId: string | null; revision: string };
  kind: RunKind;
  label: string;
  startedAt: string;
  app: { url: string };
  device: DeviceInfo;
  /** Quality-related switches in effect while measuring. */
  settings: Record<string, string | number | boolean>;
  scene: SceneCost;
  stats: RunStats;
  diagnosis: string[];
  timeline: TimelinePoint[];
}

export interface LiveStats { fps: number; frameMs: number; gpuMs: number | null; renderCpuMs: number; calls: number; triangles: number; geometries: number; textures: number }

export type PerfPhase = { kind: 'idle' } | { kind: 'recording'; startedAt: number } | { kind: 'benchmark'; startedAt: number; warmupMs: number; durationMs: number };

export const BENCHMARK_WARMUP_MS = 1500;
export const BENCHMARK_DURATION_MS = 12000;
const STORAGE_KEY = 'polyform.perfRuns.v1';
const MAX_RUNS = MAX_HISTORY_RUNS;
const MAX_SAMPLES = 30000;

export interface PerfState { phase: PerfPhase; live: LiveStats | null; runs: PerfRun[]; notice: string | null }

let state: PerfState = { phase: { kind: 'idle' }, live: null, runs: loadRuns(), notice: null };
const listeners = new Set<() => void>();
let samples: FrameSample[] = [];
let context: NonNullable<PerfRun['context']> = { scenario: '', modelId: null, revision: typeof __BUILD_COMMIT__ !== 'undefined' ? __BUILD_COMMIT__ : 'unknown' };
let activeContext = { ...context };
let startedAt = '';

function loadRuns(): PerfRun[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isPerfRun).slice(-MAX_RUNS) : [];
  } catch { return []; }
}
function saveRuns(runs: PerfRun[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(runs)); return true; } catch { return false; }
}
function set(patch: Partial<PerfState>) { state = { ...state, ...patch }; listeners.forEach(l => l()); }

export function comparisonWarnings(before: PerfRun, after: PerfRun): string[] {
  const warnings: string[] = [];
  if(before.kind!==after.kind)warnings.push('Recording and fly-around benchmark use different workloads.');
  if(!before.context||!after.context)warnings.push('Older run has no model, scenario or revision metadata.');
  else {
    if(before.context.modelId!==after.context.modelId)warnings.push('Model changed.');
    if(!before.context.modelId||!after.context.modelId)warnings.push('Unsaved model: identity is not verified.');
    if(before.context.scenario!==after.context.scenario)warnings.push('Scenario changed.');
  }
  if(before.device.gpuTimer!==after.device.gpuTimer)warnings.push('GPU timing availability changed.');
  if (before.device.gpu !== after.device.gpu || before.device.webgl !== after.device.webgl) warnings.push('GPU/WebGL device changed.');
  if (before.device.canvas !== after.device.canvas || before.device.pixelRatio !== after.device.pixelRatio) warnings.push('Canvas size or pixel ratio changed.');
  const keys = new Set([...Object.keys(before.settings), ...Object.keys(after.settings)]);
  const changedSettings = [...keys].filter(key => before.settings[key] !== after.settings[key]);
  if (changedSettings.length) warnings.push(`Quality/settings changed: ${changedSettings.join(', ')}.`);
  const beforeTris = Math.max(1, before.scene.triangles);
  const triangleDelta = Math.abs(after.scene.triangles - before.scene.triangles) / beforeTris;
  if (triangleDelta > 0.05 || before.scene.meshes !== after.scene.meshes) warnings.push('Scene complexity changed, so this is not a strict before/after benchmark.');
  return warnings;
}

export const perfStore = {
  getContext: () => ({...context}),
  setContext(patch: Partial<NonNullable<PerfRun['context']>>) { context = {...context,...patch}; },
  importRuns(incoming: PerfRun[]) { if (!incoming.every(isPerfRun)) throw new Error('Invalid benchmark history.'); const runs=mergeHistory(state.runs,incoming);const saved=saveRuns(runs);set({runs,notice:saved?null:'Browser storage is full or blocked. Export history to keep these runs.'}); },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  getState: () => state,
  setLive(live: LiveStats | null) { set({ live }); },
  setNotice(notice: string | null) { set({ notice }); },
  /** Called by the probe on every frame while a run is active. */
  pushSample(sample: FrameSample) { if (samples.length < MAX_SAMPLES) samples.push(sample); },
  sampleCount: () => samples.length,
  startRecording() {
    samples = []; activeContext={...context}; startedAt=new Date().toISOString();
    set({ phase: { kind: 'recording', startedAt: performance.now() }, notice: null });
  },
  startBenchmark() {
    samples = []; activeContext={...context}; startedAt=new Date().toISOString();
    set({ phase: { kind: 'benchmark', startedAt: performance.now(), warmupMs: BENCHMARK_WARMUP_MS, durationMs: BENCHMARK_DURATION_MS }, notice: null });
  },
  /** Ends the current run and stores it. `context` is captured by the probe (it owns the renderer). */
  finish(context: { device: DeviceInfo; settings: PerfRun['settings']; scene: SceneCost }, cancel = false): PerfRun | null {
    const phase = state.phase;
    if (phase.kind === 'idle') return null;
    const taken = samples; samples = [];
    set({ phase: { kind: 'idle' } });
    if (cancel || taken.length < 10) { set({ notice: cancel ? 'Run cancelled.' : 'Run was too short to measure.' }); return null; }
    const t0 = taken[0]!.t;
    const rebased = taken.map(s => ({ ...s, t: s.t - t0 }));
    const stats = summarise(rebased);
    const run: PerfRun = {
      id: typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`, kind: phase.kind,
      label: phase.kind === 'benchmark' ? 'Fly-around benchmark' : 'Recording',
      startedAt, context: activeContext,
      app: { url: typeof location !== 'undefined' ? location.origin + location.pathname : '' },
      device: context.device, settings: context.settings, scene: context.scene,
      stats, diagnosis: diagnose({ stats }), timeline: timeline(rebased).filter((_,i,all)=>i%Math.max(1,Math.ceil(all.length/600))===0),
    };
    const runs = [...state.runs, run].slice(-MAX_RUNS);
    const saved=saveRuns(runs);
    set({ runs, notice: saved ? null : 'Browser storage is full or blocked. Export history to keep these runs.' });
    return run;
  },
  clearRuns() { saveRuns([]); set({ runs: [] }); },
  removeRun(id: string) { const runs = state.runs.filter(r => r.id !== id); saveRuns(runs); set({ runs }); },
  /** The latest run compared with the one before it of the same kind. */
  latestComparison() {
    const runs = state.runs; const latest = runs[runs.length - 1];
    if (!latest) return null;
    const previous = [...runs.slice(0, -1)].reverse().find(r => r.kind === latest.kind);
    return previous ? { previous, latest, rows: compareRuns(previous.stats, latest.stats), warnings: comparisonWarnings(previous, latest) } : null;
  },
};

/** A readable summary for pasting into a chat or an issue. */
export function runToMarkdown(run: PerfRun): string {
  const s = run.stats; const f = (n: number, d = 1) => n.toFixed(d);
  const lines = [
    `### ${run.label} - ${run.startedAt}`,
    `Scenario: ${run.context?.scenario || 'Unlabelled'}; model: ${run.context?.modelId || 'unsaved/unknown'}; build: ${run.context?.revision || 'unknown'}`,
    `Device: ${run.device.gpu} (${run.device.webgl}), canvas ${run.device.canvas} @ ${run.device.pixelRatio}x, GPU timer ${run.device.gpuTimer ? 'yes' : 'no'}`,
    `Frames: ${s.frames} over ${f(s.durationS)} s. FPS avg ${f(s.fpsAvg)}, slowest 1% ${f(s.fps1Low)}, frame ms p50/p95/p99 ${f(s.frameMs.p50)}/${f(s.frameMs.p95)}/${f(s.frameMs.p99)}, hitches ${s.hitches}`,
    s.gpuMs ? `GPU ms avg/p95/max ${f(s.gpuMs.avg, 2)}/${f(s.gpuMs.p95, 2)}/${f(s.gpuMs.max, 2)}; draw submission avg ${f(s.renderCpuMs.avg, 2)} ms` : `Draw submission avg ${f(s.renderCpuMs.avg, 2)} ms (no GPU timer)`,
    `Draw calls avg/max ${Math.round(s.calls.avg)}/${s.calls.max}; triangles avg/max ${Math.round(s.triangles.avg)}/${s.triangles.max}`,
    `Scene: ${run.scene.meshes} meshes (${run.scene.instancedMeshes} instanced), ${run.scene.lights} lights (${run.scene.shadowLights} casting shadows), ${run.scene.textures} textures (~${f(run.scene.textureMemoryMB)} MB), ${run.scene.geometries} geometries, ${run.scene.programs} shader programs`,
    `Settings: ${Object.entries(run.settings).map(([k, v]) => `${k}=${v}`).join(', ')}`,
    'Findings:', ...run.diagnosis.map(d => `- ${d}`),
    run.scene.heaviest.length ? 'Heaviest objects: ' + run.scene.heaviest.slice(0, 5).map(h => `${h.name} (${h.triangles} tris)`).join(', ') : '',
  ];
  return lines.filter(Boolean).join('\n');
}
