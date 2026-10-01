import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useApp } from '../../AppContext';
import { compareRuns } from '../../lib/perf/profilerCore';
import { comparisonWarnings, perfStore, runToMarkdown } from '../../lib/perf/profilerStore';
import { MAX_HISTORY_BYTES, parseHistory } from '../../lib/perf/history';
import { downloadBlob } from '../../lib/presentation/recorder';
const button='rounded bg-slate-700 px-3 py-2 disabled:opacity-40';
export default function PerfHistory({onClose}:{onClose:()=>void}){
  const {user}=useApp(),uid=user?.uid as string|undefined;
  const {runs}=useSyncExternalStore(perfStore.subscribe,perfStore.getState);
  const [selected,setSelected]=useState(runs.at(-1)?.id??''),[baseline,setBaseline]=useState(runs.at(-2)?.id??'');
  const [filter,setFilter]=useState(''),[scenario,setScenario]=useState(()=>perfStore.getContext().scenario),[cloud,setCloud]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const root=useRef<HTMLDivElement>(null),file=useRef<HTMLInputElement>(null),close=useRef(onClose);
  close.current=onClose;
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;root.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close.current();}if(e.key==='Tab'){
      const items=Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([type="file"]),select:not(:disabled)')??[]);
      const i=items.indexOf(document.activeElement as HTMLElement);if(i<0||!e.shiftKey&&i===items.length-1||e.shiftKey&&i===0){e.preventDefault();(e.shiftKey?items.at(-1):items[0])?.focus();}
    }};window.addEventListener('keydown',key,true);return()=>{window.removeEventListener('keydown',key,true);if(previous?.isConnected)previous.focus();};
  },[]);
  useEffect(()=>{
    if(!cloud||!uid)return;let disposed=false,stop:(()=>void)|undefined;
    void import('../../lib/perf/historyCloud').then(service=>{if(disposed)return;stop=service.watchBenchmarkCloud(uid,loaded=>{if(disposed)return;perfStore.importRuns(loaded);setNotice(`Cloud history connected (${loaded.length} recent runs).`);},error=>{if(!disposed)setNotice(`Cloud history unavailable: ${error.message}`);});}).catch(error=>{if(!disposed)setNotice(`Cloud history unavailable: ${String(error)}`);});
    return()=>{disposed=true;stop?.();};
  },[cloud,uid]);
  const run=runs.find(r=>r.id===selected),before=runs.find(r=>r.id===baseline);
  const warnings=run&&before?comparisonWarnings(before,run):[];
  const exportHistory=()=>downloadBlob(new Blob([JSON.stringify({schemaVersion:1,runs},null,2)],{type:'application/json'}),'polyform-benchmark-history.json');
  const saveCloud=async()=>{if(!uid||!run)return;setBusy(true);setNotice('Saving selected run…');try{const {saveBenchmarkCloud}=await import('../../lib/perf/historyCloud');await saveBenchmarkCloud(uid,run);setNotice('Selected run saved to your private cloud history.');}catch(error){setNotice(`Cloud save failed: ${String(error)}`);}finally{setBusy(false);}};
  const visible=runs.filter(r=>`${r.label} ${r.context?.scenario??''} ${r.context?.modelId??''} ${r.context?.revision??''} ${r.device.gpu}`.toLowerCase().includes(filter.toLowerCase())).slice().reverse();
  return <div ref={root} role="dialog" aria-modal="true" aria-label="Benchmark history" className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 p-3" onPointerDown={e=>e.stopPropagation()}><section className="max-h-[95dvh] w-full max-w-4xl overflow-auto rounded-xl bg-slate-900 p-4 text-sm text-white shadow-xl">
    <header className="flex items-center justify-between"><h2 className="font-semibold">Benchmark history</h2><button className={button} onClick={onClose}>Close history</button></header>
    <p className="my-3 text-xs text-slate-300">The latest 100 runs stay on this device. Cloud saves are manual and private to your account; they include GPU metrics, settings, model ID and scenario, with no geometry, URLs or object/texture names.</p>
    <label className="block">Scenario for next run <input aria-label="Next benchmark scenario" maxLength={120} value={scenario} onChange={e=>{setScenario(e.target.value);perfStore.setContext({scenario:e.target.value});}} placeholder="e.g. Lake walk · Beta clouds on" className="ml-2 rounded bg-slate-800 px-2 py-1"/></label>
    <div className="my-3 flex flex-wrap gap-2"><button className={button} disabled={!runs.length} onClick={exportHistory}>Export history</button><button className={button} onClick={()=>file.current?.click()}>Import logs</button><button className={button} disabled={!uid||!run||busy} onClick={()=>void saveCloud()}>Save selected to cloud</button><button className={button} disabled={!uid} aria-pressed={cloud} onClick={()=>setCloud(!cloud)}>{cloud?'Disconnect cloud':'Load cloud history'}</button></div>
    {!uid&&<p className="text-xs text-slate-400">Sign in to save or load cloud history.</p>}
    <input ref={file} type="file" accept=".json,application/json" className="hidden" aria-label="Import benchmark logs" onChange={async e=>{const selected=e.currentTarget.files?.[0];e.currentTarget.value='';if(!selected)return;try{if(selected.size>MAX_HISTORY_BYTES)throw new Error('History file exceeds 20 MB.');const imported=parseHistory(await selected.text());perfStore.importRuns(imported);if(imported.length)setSelected(imported.at(-1)!.id);setNotice(`Imported ${imported.length} runs.`);}catch(error){setNotice(`Import failed: ${String(error)}`);}}}/>
    <p role="status" aria-live="polite" className="text-xs text-amber-200">{notice}</p>
    <label className="my-3 block">Filter history <input aria-label="Filter benchmark history" value={filter} onChange={e=>setFilter(e.target.value)} className="ml-2 rounded bg-slate-800 px-2 py-1"/></label>
    <div className="max-h-48 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th>Date / scenario</th><th>Build</th><th>FPS</th><th>GPU ms</th><th>View</th></tr></thead><tbody>{visible.map(r=><tr key={r.id} className={r.id===selected?'bg-sky-900/40':''}><td className="py-2">{new Date(r.startedAt).toLocaleString()}<br/>{r.context?.scenario||r.label}</td><td>{r.context?.revision??'unknown'}</td><td>{r.stats.fpsAvg.toFixed(1)}</td><td>{r.stats.gpuMs?.avg.toFixed(2)??'Unavailable'}</td><td><button className={button} onClick={()=>setSelected(r.id)} aria-label={`View ${r.id}`}>Select</button></td></tr>)}</tbody></table></div>
    {!runs.length&&<p>No saved runs yet. Run a benchmark or import a downloaded log.</p>}
    {run&&<div className="mt-4 space-y-3"><p>{run.device.gpu} · {run.device.canvas} @ {run.device.pixelRatio}× · {run.context?.modelId||'Unsaved / unknown model'}</p>
      <label>Compare with <select aria-label="Benchmark comparison baseline" value={baseline} onChange={e=>setBaseline(e.target.value)} className="ml-2 max-w-full rounded bg-slate-800 p-1"><option value="">Choose baseline</option>{runs.filter(r=>r.id!==run.id).map(r=><option key={r.id} value={r.id}>{new Date(r.startedAt).toLocaleString()} · {r.context?.scenario||r.label} · {r.context?.revision??'unknown'}</option>)}</select></label>
      {before&&before.id!==run.id&&<><ul className="text-xs text-amber-200">{warnings.map(w=><li key={w}>{w}</li>)}</ul><table className="w-full text-left"><thead><tr><th>Metric</th><th>Baseline</th><th>Selected</th><th>Change</th></tr></thead><tbody>{compareRuns(before.stats,run.stats).map(row=><tr key={row.metric}><td>{row.metric}</td><td>{row.before}</td><td>{row.after}</td><td className={row.better?'text-emerald-300':'text-amber-300'}>{row.change>0?'+':''}{row.change}%</td></tr>)}</tbody></table></>}
      <ul className="list-disc pl-4 text-xs">{run.diagnosis.map(d=><li key={d}>{d}</li>)}</ul>
      <button className={button} onClick={()=>downloadBlob(new Blob([runToMarkdown(run)],{type:'text/markdown'}),'polyform-benchmark-summary.md')}>Export selected summary</button>
      <p className="text-xs text-slate-400">Same model ID does not prove unchanged geometry. Match camera, scenario, device and quality settings before drawing conclusions. These reports suggest changes; they do not change rendering settings automatically.</p>
    </div>}
  </section></div>;
}
