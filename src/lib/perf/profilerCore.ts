/** Pure maths and report building for the GPU profiler (no three.js or DOM, so it can be tested). */

export interface FrameSample {
  /** Time since the previous frame, ms. */
  frameMs: number;
  /** JS time spent inside the renderer's render calls, ms. */
  renderCpuMs: number;
  /** GPU time for a recent frame, ms (null when the browser can't measure it). */
  gpuMs: number | null;
  calls: number;
  triangles: number;
  /** Seconds since the run started. */
  t: number;
}

export interface Distribution { avg: number; p50: number; p95: number; p99: number; max: number; min: number }

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

export function distribution(values: readonly number[]): Distribution {
  if (values.length === 0) return { avg: 0, p50: 0, p95: 0, p99: 0, max: 0, min: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    avg: sum / sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1]!, min: sorted[0]!,
  };
}

export interface RunStats {
  frames: number;
  durationS: number;
  fpsAvg: number;
  /** Frame rate of the slowest 1% of frames. */
  fps1Low: number;
  frameMs: Distribution;
  /** Frames slower than 33 ms (below 30 fps). */
  hitches: number;
  renderCpuMs: Distribution;
  gpuMs: Distribution | null;
  calls: { avg: number; max: number };
  triangles: { avg: number; max: number };
}

function lowFps(frameTimes: readonly number[], fraction = 0.01): number {
  if (!frameTimes.length) return 0;
  const count = Math.max(1, Math.ceil(frameTimes.length * fraction));
  const worst = [...frameTimes].sort((a, b) => b - a).slice(0, count);
  const avgWorstMs = worst.reduce((sum, value) => sum + value, 0) / worst.length;
  return avgWorstMs > 0 ? 1000 / avgWorstMs : 0;
}

export function summarise(samples: readonly FrameSample[]): RunStats {
  const frameTimes = samples.map(s => s.frameMs);
  const frameMs = distribution(frameTimes);
  const gpu = samples.map(s => s.gpuMs).filter((v): v is number => v !== null);
  const durationS = samples.length ? samples[samples.length - 1]!.t - samples[0]!.t + samples[0]!.frameMs / 1000 : 0;
  const avgMax = (values: number[]) => ({ avg: values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0, max: values.length ? Math.max(...values) : 0 });
  return {
    frames: samples.length,
    durationS,
    fpsAvg: frameMs.avg > 0 ? 1000 / frameMs.avg : 0,
    fps1Low: lowFps(frameTimes),
    frameMs,
    hitches: samples.filter(s => s.frameMs > 33.4).length,
    renderCpuMs: distribution(samples.map(s => s.renderCpuMs)),
    gpuMs: gpu.length ? distribution(gpu) : null,
    calls: avgMax(samples.map(s => s.calls)),
    triangles: avgMax(samples.map(s => s.triangles)),
  };
}

export interface TimelinePoint { t: number; fps: number; gpuMs: number | null; calls: number; triangles: number }

/** One point per second, so a long run stays small in the log. */
export function timeline(samples: readonly FrameSample[]): TimelinePoint[] {
  const buckets = new Map<number, FrameSample[]>();
  for (const s of samples) {
    const key = Math.floor(s.t);
    const list = buckets.get(key);
    if (list) list.push(s); else buckets.set(key, [s]);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, list]) => {
    const avg = (f: (s: FrameSample) => number) => list.reduce((a, s) => a + f(s), 0) / list.length;
    const gpu = list.map(s => s.gpuMs).filter((v): v is number => v !== null);
    return {
      t, fps: +(1000 / avg(s => s.frameMs)).toFixed(1),
      gpuMs: gpu.length ? +(gpu.reduce((a, b) => a + b, 0) / gpu.length).toFixed(2) : null,
      calls: Math.round(avg(s => s.calls)), triangles: Math.round(avg(s => s.triangles)),
    };
  });
}

export interface DiagnosisInput { stats: RunStats; refreshHz?: number; triangleBudget?: number; callBudget?: number }

/** Plain-language pointers to where the time goes. */
export function diagnose({ stats, triangleBudget = 3_000_000, callBudget = 1500 }: DiagnosisInput): string[] {
  const out: string[] = [];
  if (stats.frames < 30) return ['Too few frames to draw conclusions: record for longer.'];
  const frame = stats.frameMs.avg;
  if (stats.gpuMs) {
    if (stats.gpuMs.avg > frame * 0.75) out.push(`GPU-bound: the GPU spends ${stats.gpuMs.avg.toFixed(1)} ms of a ${frame.toFixed(1)} ms frame. Cut pixels (resolution, shadows, post effects) or triangles.`);
    else if (stats.renderCpuMs.avg > frame * 0.5) out.push(`CPU-bound: ${stats.renderCpuMs.avg.toFixed(1)} ms of each ${frame.toFixed(1)} ms frame is spent issuing draw calls. Merge or instance objects.`);
    else if (frame > 18) out.push(`Neither GPU (${stats.gpuMs.avg.toFixed(1)} ms) nor draw submission (${stats.renderCpuMs.avg.toFixed(1)} ms) explains a ${frame.toFixed(1)} ms frame: look at app code between frames (React updates, scripts, physics).`);
  } else {
    out.push('GPU time is not available in this browser, so GPU-bound and CPU-bound cannot be told apart. Use Chrome or Edge for GPU timings.');
    if (stats.renderCpuMs.avg > frame * 0.5) out.push(`Draw submission alone takes ${stats.renderCpuMs.avg.toFixed(1)} ms of a ${frame.toFixed(1)} ms frame: likely CPU-bound.`);
  }
  if (stats.calls.avg > callBudget) out.push(`High draw-call count (${Math.round(stats.calls.avg)} per frame): merge or instance repeated objects.`);
  if (stats.triangles.avg > triangleBudget) out.push(`High triangle count (${(stats.triangles.avg / 1e6).toFixed(1)}M per frame): use lower-detail geometry or level of detail.`);
  if (stats.hitches > stats.frames * 0.05) out.push(`${stats.hitches} slow frames (over 33 ms): stutter from loading, garbage collection or a burst of work.`);
  if (stats.fps1Low < stats.fpsAvg * 0.5) out.push(`The slowest 1% of frames run at ${stats.fps1Low.toFixed(0)} fps against an average of ${stats.fpsAvg.toFixed(0)}: uneven pacing.`);
  if (out.length === 0) out.push('No bottleneck found: frame time is healthy.');
  return out;
}

export interface CompareRow { metric: string; before: number; after: number; change: number; better: boolean }

/** Before/after of two runs, with sign by "is this better". */
export function compareRuns(before: RunStats, after: RunStats): CompareRow[] {
  const row = (metric: string, b: number, a: number, higherIsBetter: boolean): CompareRow => ({
    metric, before: +b.toFixed(2), after: +a.toFixed(2),
    change: b === 0 ? 0 : +(((a - b) / b) * 100).toFixed(1),
    better: higherIsBetter ? a >= b : a <= b,
  });
  const rows = [
    row('Average fps', before.fpsAvg, after.fpsAvg, true),
    row('Slowest 1% fps', before.fps1Low, after.fps1Low, true),
    row('Frame time p95 (ms)', before.frameMs.p95, after.frameMs.p95, false),
    row('Draw calls (avg)', before.calls.avg, after.calls.avg, false),
    row('Triangles (avg)', before.triangles.avg, after.triangles.avg, false),
  ];
  if (before.gpuMs && after.gpuMs) rows.push(row('GPU time (ms, avg)', before.gpuMs.avg, after.gpuMs.avg, false));
  return rows;
}
