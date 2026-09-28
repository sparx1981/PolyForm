import { useState } from 'react';
import { useApp } from '../AppContext';
import type { CustomLight } from '../types';
import { planAutoLighting, type AutoLightSource, type LightMood } from '../lib/autoLighting';

export function AutoLightingPanel() {
  const { shapes, tags, customLights, setCustomLights, currentModelId } = useApp();
  const [source, setSource] = useState<AutoLightSource>('fixtures');
  const [mood, setMood] = useState<LightMood>('warm');
  const [status, setStatus] = useState('');
  const [undo, setUndo] = useState<{ model: typeof currentModelId; before: CustomLight[]; after: CustomLight[] } | null>(null);
  const canUndo = undo && undo.model === currentModelId && customLights === undo.after;
  return <div className="rounded-xl bg-[#eef3f0] dark:bg-white/5 ring-1 ring-black/10 p-3 space-y-2">
    <h4 className="text-xs font-semibold">Auto light</h4>
    <p className="text-[11px] text-slate-500 dark:text-slate-400">Balance your fixtures or add soft room lighting, then fine-tune the editable lights below.</p>
    <select aria-label="Auto light source" value={source} onChange={e => setSource(e.target.value as AutoLightSource)} className="w-full rounded-lg bg-white dark:bg-gray-800 px-2 py-1.5 text-xs">
      <option value="fixtures">Existing fixtures</option><option value="custom">Custom room lights</option>
    </select>
    <select aria-label="Auto light mood" value={mood} onChange={e => setMood(e.target.value as LightMood)} className="w-full rounded-lg bg-white dark:bg-gray-800 px-2 py-1.5 text-xs">
      <option value="warm">Warm · residential</option><option value="neutral">Neutral · studio</option><option value="cool">Cool · workspace</option>
    </select>
    <div className="flex gap-2">
      <button className="rounded-lg bg-[#2f3a33] text-white px-3 py-1.5 text-xs" onClick={() => {
        const visible = shapes.filter(s => !s.hidden && (!s.tags?.length || s.tags.some(id => tags.find(t => t.id === id)?.visible !== false)));
        const plan = planAutoLighting(visible, customLights, source, mood);
        setStatus(plan.message);
        if (!plan.changed) return;
        setUndo({ model: currentModelId, before: customLights, after: plan.lights });
        setCustomLights(plan.lights);
      }}>Apply auto light</button>
      {canUndo && <button className="text-xs underline" onClick={() => { setCustomLights(undo.before); setUndo(null); setStatus('Previous lighting restored.'); }}>Undo auto light</button>}
    </div>
    {status && <p role="status" className="text-[11px] text-slate-600 dark:text-slate-300">{status}</p>}
  </div>;
}
