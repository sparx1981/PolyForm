import { useEffect, useState, useSyncExternalStore } from 'react';
import { useApp } from '../../AppContext';
import { perfStore, runToMarkdown, type PerfRun } from '../../lib/perf/profilerStore';

function download(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const stamp = (run: PerfRun) => run.startedAt.replace(/[:.]/g, '-').slice(0, 19);
const tone = (fps: number) => fps >= 50 ? 'text-emerald-400' : fps >= 30 ? 'text-amber-400' : 'text-red-400';
const ms = (n: number | null, d = 1) => n === null ? 'n/a' : n.toFixed(d);

/** Scene Helpers > Performance profiler: live GPU/frame numbers, recording, and the fly-around benchmark. */
export default function PerfOverlay() {
  const { perfProfilerEnabled } = useApp();
  const state = useSyncExternalStore(perfStore.subscribe, perfStore.getState);
  const [open, setOpen] = useState(true);
  const [now, setNow] = useState(0);
  const running = state.phase.kind !== 'idle';

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(id);
  }, [running]);

  // A console/automation handle so runs can be started and read without the UI.
  useEffect(() => {
    if (!perfProfilerEnabled) return;
    (window as unknown as Record<string, unknown>).__polyformPerf = {
      startBenchmark: () => perfStore.startBenchmark(),
      startRecording: () => perfStore.startRecording(),
      stop: () => window.dispatchEvent(new Event('polyform-perf-stop')),
      getRuns: () => perfStore.getState().runs,
      latest: () => perfStore.getState().runs.at(-1) ?? null,
    };
    return () => { delete (window as unknown as Record<string, unknown>).__polyformPerf; };
  }, [perfProfilerEnabled]);

  if (!perfProfilerEnabled) return null;
  const { live, runs, phase, notice } = state;
  const latest = runs[runs.length - 1];
  const comparison = perfStore.latestComparison();
  const progress = phase.kind === 'benchmark'
    ? Math.min(1, Math.max(0, (now - phase.startedAt) / (phase.warmupMs + phase.durationMs))) : null;
  const btn = 'px-2 py-1 rounded-md border border-gray-600 bg-gray-800 hover:bg-gray-700 text-white text-[10px] font-semibold disabled:opacity-40';

  return (
    <div className="fixed bottom-28 left-4 z-[60] w-[300px] max-w-[calc(100vw-2rem)] select-none" role="region" aria-label="Performance profiler">
      <div className="bg-gray-900/90 text-white text-[11px] font-mono rounded-lg shadow-xl border border-gray-700 overflow-hidden">
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
          className="w-full flex items-center justify-between px-2.5 py-1.5 bg-gray-800/80 text-left">
          <span className="font-bold tracking-wide">GPU PROFILER</span>
          <span className={live ? tone(live.fps) : 'text-gray-400'}>{live ? `${live.fps.toFixed(0)} fps` : '...'}</span>
        </button>
        {open && (
          <div className="p-2.5 space-y-2">
            {live ? (
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                <span>Frame <b>{ms(live.frameMs)}</b> ms</span>
                <span>GPU <b>{ms(live.gpuMs)}</b> ms</span>
                <span>Submit <b>{ms(live.renderCpuMs)}</b> ms</span>
                <span>Calls <b>{live.calls}</b></span>
                <span>Tris <b>{(live.triangles / 1000).toFixed(0)}k</b></span>
                <span>Textures <b>{live.textures}</b></span>
              </div>
            ) : <div className="text-gray-400">Waiting for frames...</div>}
            {live && live.gpuMs === null && <div className="text-[10px] text-amber-400">GPU timer not available in this browser (Chrome or Edge have it).</div>}

            {progress !== null && (
              <div className="h-1.5 rounded bg-gray-700 overflow-hidden" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Benchmark progress">
                <div className="h-full bg-polyform-blue" style={{ width: `${progress * 100}%` }} />
              </div>
            )}
            {phase.kind === 'recording' && <div className="text-amber-400">Recording {perfStore.sampleCount()} frames... use the model as normal, then Stop.</div>}
            {notice && <div className="text-amber-400">{notice}</div>}

            <div className="flex flex-wrap gap-1.5">
              {phase.kind === 'idle' && <>
                <button type="button" className={btn} onClick={() => perfStore.startBenchmark()} title="Orbits the camera once round the model, the same way every time (about 14 s)">Run benchmark</button>
                <button type="button" className={btn} onClick={() => perfStore.startRecording()}>Record</button>
              </>}
              {phase.kind === 'recording' && <button type="button" className={btn} onClick={() => window.dispatchEvent(new Event('polyform-perf-stop'))}>Stop and save</button>}
              {running && <button type="button" className={btn} onClick={() => window.dispatchEvent(new Event('polyform-perf-cancel'))}>Cancel</button>}
            </div>

            {latest && !running && (
              <div className="border-t border-gray-700 pt-2 space-y-1">
                <div className="font-bold">Last run: {latest.label}</div>
                <div>Avg <b className={tone(latest.stats.fpsAvg)}>{latest.stats.fpsAvg.toFixed(0)}</b> fps, slowest 1% <b className={tone(latest.stats.fps1Low)}>{latest.stats.fps1Low.toFixed(0)}</b>, GPU {ms(latest.stats.gpuMs?.avg ?? null)} ms</div>
                <ul className="list-disc pl-4 text-[10px] text-gray-300 space-y-0.5">
                  {latest.diagnosis.map(d => <li key={d}>{d}</li>)}
                </ul>
                {comparison && (
                  <div className="text-[10px] text-gray-300 space-y-0.5">
                    <div>
                      vs previous {comparison.latest.kind}:{' '}
                      {comparison.rows.slice(0, 3).map(r => <span key={r.metric} className={r.better ? 'text-emerald-400' : 'text-red-400'}>{r.metric} {r.change > 0 ? '+' : ''}{r.change}%; </span>)}
                    </div>
                    {comparison.warnings.map(warning => (
                      <div key={warning} className="text-amber-400">Comparison caution: {warning}</div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  <button type="button" className={btn} onClick={() => download(`polyform-perf-${latest.kind}-${stamp(latest)}.json`, JSON.stringify(latest, null, 2))}>Download log</button>
                  <button type="button" className={btn} onClick={() => { void navigator.clipboard?.writeText(runToMarkdown(latest)); perfStore.setNotice('Summary copied.'); }}>Copy summary</button>
                  {runs.length > 1 && <button type="button" className={btn} onClick={() => download(`polyform-perf-all-${stamp(latest)}.json`, JSON.stringify(runs, null, 2))}>Download all ({runs.length})</button>}
                  <button type="button" className={btn} onClick={() => perfStore.clearRuns()}>Clear</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
