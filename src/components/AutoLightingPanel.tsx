import { useState } from 'react';
import { useApp } from '../AppContext';
import type { CustomLight, Shape } from '../types';
import { AUTO_FIXTURE_STYLES, DEFAULT_AUTO_FIXTURE_STYLES, planAutoLighting, type AutoLightSource, type LightMood } from '../lib/autoLighting';

export function AutoLightingPanel() {
  const { shapes, setShapes, commitHistory, tags, customLights, setCustomLights, currentModelId, theme } = useApp();
  const [source, setSource] = useState<AutoLightSource>('place');
  const [mood, setMood] = useState<LightMood>('warm');
  const [fixtureStyles, setFixtureStyles] = useState<string[]>(DEFAULT_AUTO_FIXTURE_STYLES);
  const [status, setStatus] = useState('');
  const [undo, setUndo] = useState<{ model: typeof currentModelId; before: CustomLight[]; after: CustomLight[]; shapesBefore?: Shape[] } | null>(null);
  const canUndo = undo && undo.model === currentModelId && (undo.shapesBefore ? true : customLights === undo.after);
  // Native dropdown lists ignore Tailwind's dark: variants on some browsers, so colour them explicitly.
  const dark = theme === 'dark';
  const fieldStyle = { backgroundColor: dark ? '#1f2937' : '#ffffff', color: dark ? '#f1f5f9' : '#0f172a', colorScheme: dark ? 'dark' : 'light' } as const;
  const fieldClass = 'w-full rounded-lg px-2 py-1.5 text-xs ring-1 ring-black/10 dark:ring-white/10';
  return <div className="rounded-xl bg-[#eef3f0] dark:bg-white/5 ring-1 ring-black/10 p-3 space-y-2">
    <h4 className="text-xs font-semibold">Auto light</h4>
    <select aria-label="Auto light source" value={source} onChange={e => setSource(e.target.value as AutoLightSource)} className={fieldClass} style={fieldStyle}>
      <option style={fieldStyle} value="place">Place fixtures in rooms</option>
      <option style={fieldStyle} value="fixtures">Existing fixtures</option>
      <option style={fieldStyle} value="custom">Custom room lights</option>
    </select>
    {source === 'place' && (
      <fieldset className="space-y-1">
        <legend className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Fixtures to include</legend>
        {AUTO_FIXTURE_STYLES.map(f => (
          <label key={f.id} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
            <input type="checkbox" checked={fixtureStyles.includes(f.id)}
              onChange={e => setFixtureStyles(prev => (e.target.checked ? [...prev, f.id] : prev.filter(id => id !== f.id)))} />
            {f.name}
          </label>
        ))}
      </fieldset>
    )}
    <select aria-label="Auto light mood" value={mood} onChange={e => setMood(e.target.value as LightMood)} className={fieldClass} style={fieldStyle}>
      <option style={fieldStyle} value="warm">Warm · residential</option>
      <option style={fieldStyle} value="neutral">Neutral · studio</option>
      <option style={fieldStyle} value="cool">Cool · workspace</option>
    </select>
    <div className="flex gap-2">
      <button className="rounded-lg bg-[#2f3a33] text-white px-3 py-1.5 text-xs" onClick={() => {
        const visible = shapes.filter(s => !s.hidden && (!s.tags?.length || s.tags.some(id => tags.find(t => t.id === id)?.visible !== false)));
        const plan = planAutoLighting(visible, customLights, source, mood, fixtureStyles);
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
  </div>;
}
