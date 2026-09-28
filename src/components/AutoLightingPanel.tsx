import { useState } from 'react';
import { X } from 'lucide-react';
import { useApp } from '../AppContext';
import type { CustomLight, Shape } from '../types';
import { planAutoLighting, type AutoLightSource, type LightMood } from '../lib/autoLighting';

export function AutoLightingPanel() {
  const { shapes, setShapes, commitHistory, tags, customLights, setCustomLights, currentModelId, theme, selectedLightId, setSelectedLightId } = useApp();
  const [source, setSource] = useState<AutoLightSource>('place');
  const [mood, setMood] = useState<LightMood>('warm');
  const [status, setStatus] = useState('');
  const [undo, setUndo] = useState<{ model: typeof currentModelId; before: CustomLight[]; after: CustomLight[]; shapesBefore?: Shape[] } | null>(null);
  const canUndo = undo && undo.model === currentModelId && (undo.shapesBefore ? true : customLights === undo.after);
  // Native dropdown lists ignore Tailwind's dark: variants on some browsers, so colour them explicitly.
  const dark = theme === 'dark';
  const fieldStyle = { backgroundColor: dark ? '#1f2937' : '#ffffff', color: dark ? '#f1f5f9' : '#0f172a', colorScheme: dark ? 'dark' : 'light' } as const;
  const fieldClass = 'w-full rounded-lg px-2 py-1.5 text-xs ring-1 ring-black/10 dark:ring-white/10';
  return <div className="rounded-xl bg-[#eef3f0] dark:bg-white/5 ring-1 ring-black/10 p-3 space-y-2">
    <h4 className="text-xs font-semibold">Auto light</h4>
    <p className="text-[11px] text-slate-500 dark:text-slate-400">Place ceiling fixtures in rooms, balance your fixtures, or add soft room lighting. Every light stays editable below.</p>
    <select aria-label="Auto light source" value={source} onChange={e => setSource(e.target.value as AutoLightSource)} className={fieldClass} style={fieldStyle}>
      <option style={fieldStyle} value="place">Place fixtures in rooms</option>
      <option style={fieldStyle} value="fixtures">Existing fixtures</option>
      <option style={fieldStyle} value="custom">Custom room lights</option>
    </select>
    <select aria-label="Auto light mood" value={mood} onChange={e => setMood(e.target.value as LightMood)} className={fieldClass} style={fieldStyle}>
      <option style={fieldStyle} value="warm">Warm · residential</option>
      <option style={fieldStyle} value="neutral">Neutral · studio</option>
      <option style={fieldStyle} value="cool">Cool · workspace</option>
    </select>
    <div className="flex gap-2">
      <button className="rounded-lg bg-[#2f3a33] text-white px-3 py-1.5 text-xs" onClick={() => {
        const visible = shapes.filter(s => !s.hidden && (!s.tags?.length || s.tags.some(id => tags.find(t => t.id === id)?.visible !== false)));
        const plan = planAutoLighting(visible, customLights, source, mood);
        setStatus(plan.message);
        if (!plan.changed) return;
        if (plan.addShapes) {
          const removed = new Set(plan.removeShapeIds ?? []);
          setUndo({ model: currentModelId, before: customLights, after: customLights, shapesBefore: shapes });
          setShapes([...shapes.filter(s => !removed.has(s.id)), ...plan.addShapes]);
          commitHistory();
          return;
        }
        setUndo({ model: currentModelId, before: customLights, after: plan.lights });
        setCustomLights(plan.lights);
      }}>Apply auto light</button>
      {canUndo && <button className="text-xs underline" onClick={() => {
        if (undo.shapesBefore) { setShapes(undo.shapesBefore); commitHistory(); } else setCustomLights(undo.before);
        setUndo(null); setStatus('Previous lighting restored.');
      }}>Undo auto light</button>}
    </div>
    {status && <p role="status" className="text-[11px] text-slate-600 dark:text-slate-300">{status}</p>}
    {customLights.length > 0 && <div className="pt-2 space-y-1.5">
      <h5 className="text-[10px] font-bold uppercase text-slate-500">Lights in this model ({customLights.length})</h5>
      {customLights.map(l => <div key={l.id} className={`rounded-lg px-2 py-1.5 ring-1 ${selectedLightId === l.id ? 'ring-amber-500 bg-amber-500/10' : 'ring-black/10 dark:ring-white/10'}`}>
        <div className="flex items-center justify-between gap-2">
          <button className="flex-1 text-left text-[11px] font-semibold truncate" onClick={() => setSelectedLightId(selectedLightId === l.id ? null : l.id)}>
            {l.name || (l.parentShapeId ? 'Fixture light' : 'Custom light')} <span className="uppercase text-[9px] text-slate-500">{l.type}</span>
          </button>
          <input type="color" aria-label="Light colour" value={l.color} onChange={e => setCustomLights(prev => prev.map(x => x.id === l.id ? { ...x, color: e.target.value } : x))} className="w-5 h-5 p-0 border-none rounded" />
          <button aria-label="Delete light" className="text-red-500" onClick={() => { setCustomLights(prev => prev.filter(x => x.id !== l.id)); if (selectedLightId === l.id) setSelectedLightId(null); }}><X size={12} /></button>
        </div>
        <input type="range" aria-label="Light intensity" min="0" max="100" step="0.5" value={l.intensity} onChange={e => setCustomLights(prev => prev.map(x => x.id === l.id ? { ...x, intensity: parseFloat(e.target.value) } : x))} className="w-full h-1 accent-amber-500" />
      </div>)}
    </div>}
  </div>;
}
