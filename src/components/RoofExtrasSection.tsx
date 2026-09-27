import React, { useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { cn } from '../lib/utils';
import { extrasOf, withRoofExtras, type Facing, type RoofExtras } from '../lib/roofExtras';
import { DORMER_DEFAULTS, dormerLayout, dormersOf, evenlySpaced, type Dormer, type DormerType } from '../lib/dormers';
import { usePickOnModel } from './presentation/ContentEditor';
import type { Shape } from '../types';

const FACINGS: { id: Facing; label: string }[] = [
  { id: 'south', label: 'South' }, { id: 'north', label: 'North' }, { id: 'east', label: 'East' }, { id: 'west', label: 'West' },
];

function Toggle({ on, label, hint, onChange, disabled }: { on: boolean; label: string; hint?: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={cn('flex items-center justify-between gap-2 py-0.5', disabled && 'opacity-40 pointer-events-none')}>
      <span>
        <span className="block text-[11px] font-semibold text-gray-700 dark:text-gray-200">{label}</span>
        {hint && <span className="block text-[9px] text-gray-400">{hint}</span>}
      </span>
      <button type="button" onClick={() => onChange(!on)} aria-pressed={on}
        className={cn('w-8 h-4 rounded-full relative transition-colors shrink-0', on ? 'bg-polyform-blue' : 'bg-gray-300 dark:bg-gray-600')}>
        <span className={cn('absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all', on ? 'left-4.5' : 'left-0.5')} />
      </button>
    </label>
  );
}

function FacingPicker({ value, onChange }: { value: Facing; onChange: (f: Facing) => void }) {
  return (
    <div className="grid grid-cols-4 gap-1">
      {FACINGS.map(f => (
        <button key={f.id} type="button" onClick={() => onChange(f.id)}
          className={cn('py-1 rounded text-[10px] font-semibold border', value === f.id
            ? 'bg-polyform-blue text-white border-polyform-blue'
            : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700')}>
          {f.label}
        </button>
      ))}
    </div>
  );
}

/** Moves on release only: each move rebuilds the extras and is one undo step. */
function PositionSlider({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div>
      <div className="flex justify-between text-gray-500 dark:text-gray-400 mb-1 text-[10px]"><span>{label}</span></div>
      <input type="range" min={-1} max={1} step={0.05} value={v} onChange={e => setV(Number(e.target.value))}
        onPointerUp={() => onCommit(v)} onKeyUp={() => onCommit(v)}
        className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-polyform-blue" />
    </div>
  );
}

/**
 * The roof panel's "Roof extras": gutters and downpipes, a chimney, solar panels and dormers,
 * fitted to the selected roof and rebuilt whenever the roof changes.
 */
export function RoofExtrasSection({ roof }: { roof: Shape }) {
  const { shapes, setShapes, commitHistory, setMeasurements } = useApp();
  const extras = extrasOf(roof);
  const flat = (roof.roofData?.roofType ?? roof.customData?.roofType) === 'parapet';

  const apply = (patch: Partial<RoofExtras>, message?: string) => {
    const next = { ...extras, ...patch };
    setShapes(withRoofExtras(shapes, roof.id, next));
    commitHistory();
    if (message) setMeasurements(message);
  };

  return (
    <div id="roof-extras" className="space-y-2.5 rounded-lg bg-gray-50/70 dark:bg-gray-800/40 p-2.5 border border-gray-200/70 dark:border-gray-700/60">
      <div>
        <label className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider block">Roof extras</label>
        <span className="text-[9px] text-gray-400">Fitted to this roof; they follow it when it changes. North is the plan's top (−z).</span>
      </div>

      <Toggle on={!!extras.gutters} label="Gutters & downpipes" hint={flat ? 'Pitched roofs only' : 'Along every eave, with a downpipe at each corner'}
        disabled={flat} onChange={v => apply({ gutters: v }, v ? 'Added gutters and downpipes.' : 'Removed the gutters.')} />

      <div className="space-y-1.5">
        <Toggle on={!!extras.chimney} label="Chimney" hint="Brick stack with pots, rising above the ridge"
          onChange={v => apply({ chimney: v }, v ? 'Added a chimney. Use the sliders to move it.' : 'Removed the chimney.')} />
        {extras.chimney && (
          <div className="space-y-1.5 pl-1">
            <PositionSlider label="Position west ↔ east" value={extras.chimneyX ?? 0} onCommit={v => apply({ chimneyX: v })} />
            <PositionSlider label="Position north ↔ south" value={extras.chimneyZ ?? 0} onCommit={v => apply({ chimneyZ: v })} />
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Toggle on={!!extras.solar} label="Solar panels" hint={flat ? 'Tilted rows on the flat roof' : 'As many as fit on one slope'}
          onChange={v => apply({ solar: v }, v ? 'Added solar panels.' : 'Removed the solar panels.')} />
        {extras.solar && !flat && <FacingPicker value={extras.solarFacing ?? 'south'} onChange={f => apply({ solarFacing: f })} />}
      </div>

      <DormerEditor roof={roof} flat={flat} />
    </div>
  );
}

const TYPES: { id: DormerType; label: string }[] = [{ id: 'gable', label: 'Gable' }, { id: 'flat', label: 'Flat' }, { id: 'hipped', label: 'Hipped' }];

/** Dormers: click the roof to place one; each can be changed, moved or removed; or space some evenly. */
function DormerEditor({ roof, flat }: { roof: Shape; flat: boolean }) {
  const { shapes, setShapes, commitHistory, setMeasurements } = useApp();
  const list = dormersOf(roof);
  const [placing, setPlacing] = useState<string | null>(null);
  const [count, setCount] = useState(2);
  const [facing, setFacing] = useState<Facing>('south');
  const [draft, setDraft] = useState<Omit<Dormer, 'id' | 'x' | 'z'>>(DORMER_DEFAULTS);

  const save = (next: Dormer[], message?: string) => {
    const extras = { ...extrasOf(roof), dormerList: next, dormers: 0 };
    setShapes(withRoofExtras(shapes, roof.id, extras));
    commitHistory();
    if (message) setMeasurements(message);
  };

  usePickOnModel(placing !== null, point => {
    const local = { x: +(point[0] - roof.position[0]).toFixed(3), z: +(point[2] - roof.position[2]).toFixed(3) };
    const existing = list.find(d => d.id === placing);
    const candidate: Dormer = existing ? { ...existing, ...local } : { ...draft, id: placing!, ...local };
    if (!dormerLayout(roof, candidate)) {
      setMeasurements("A dormer doesn't fit there: click a roof slope, clear of hips, the ridge and the ends.");
      return;
    }
    setPlacing(null);
    save(existing ? list.map(d => (d.id === existing.id ? candidate : d)) : [...list, candidate],
      existing ? 'Moved the dormer.' : `Added a ${candidate.type} dormer.`);
  }, () => setPlacing(null));

  const change = (id: string, patch: Partial<Dormer>) => {
    const next = list.map(d => (d.id === id ? { ...d, ...patch } : d));
    const changed = next.find(d => d.id === id)!;
    if (!dormerLayout(roof, changed)) { setMeasurements("That doesn't fit on this slope; try it narrower, lower or further from the ridge."); return; }
    save(next);
  };

  const fits = list.map(d => !!dormerLayout(roof, d));

  const btn = (active?: boolean) => cn('px-2 py-1 rounded text-[10px] font-semibold border', active
    ? 'bg-polyform-blue text-white border-polyform-blue'
    : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700');

  return (
    <div className={cn('space-y-2', flat && 'opacity-40 pointer-events-none')}>
      <div>
        <span className="block text-[11px] font-semibold text-gray-700 dark:text-gray-200">Dormers</span>
        <span className="block text-[9px] text-gray-400">{flat ? 'Pitched roofs only' : 'Cut into the roof, framed, and finished inside'}</span>
      </div>

      {list.map((d, i) => (
        <div key={d.id} className="rounded border border-gray-200 dark:border-gray-700 p-2 space-y-1.5 bg-white/60 dark:bg-gray-900/30">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] font-bold text-gray-500">
              Dormer {i + 1}
              {!fits[i] && <span className="ml-1 font-semibold text-amber-600" title="It isn't drawn. Move it, or make it narrower or lower.">doesn't fit</span>}
            </span>
            <div className="flex gap-1">
              <button type="button" className={btn(placing === d.id)} onClick={() => setPlacing(placing === d.id ? null : d.id)}>
                {placing === d.id ? 'Click the roof…' : 'Move'}
              </button>
              <button type="button" className={btn()} onClick={() => save(list.filter(x => x.id !== d.id), 'Removed the dormer.')}>Remove</button>
            </div>
          </div>
          <div className="flex gap-1">
            {TYPES.map(t => <button key={t.id} type="button" className={cn(btn(d.type === t.id), 'flex-1')} onClick={() => change(d.id, { type: t.id })}>{t.label}</button>)}
          </div>
          <SizeSlider label="Width" value={d.width} min={0.9} max={4} onCommit={v => change(d.id, { width: v })} />
          <SizeSlider label="Front wall height" value={d.height} min={0.9} max={2.2} onCommit={v => change(d.id, { height: v })} />
          <Toggle on={d.flush} label="Flush with the wall below" hint="Breaks the eave; otherwise set back on the slope"
            onChange={v => change(d.id, { flush: v })} />
        </div>
      ))}

      <div className="space-y-1.5">
        <div className="flex gap-1">
          {TYPES.map(t => <button key={t.id} type="button" className={cn(btn(draft.type === t.id), 'flex-1')} onClick={() => setDraft({ ...draft, type: t.id })}>{t.label}</button>)}
        </div>
        <button type="button" onClick={() => setPlacing(placing === 'new' ? null : 'new')}
          className={cn('w-full py-1.5 rounded text-[11px] font-bold', placing === 'new' ? 'bg-amber-500 text-white' : 'bg-polyform-blue text-white')}>
          {placing === 'new' ? 'Click a roof slope… (Esc to cancel)' : '+ Place a dormer on the roof'}
        </button>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-500 shrink-0">Or space</span>
          <select value={count} onChange={e => setCount(Number(e.target.value))} className="text-[10px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-1 py-0.5">
            {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="text-[10px] text-gray-500 shrink-0">evenly on</span>
          <select value={facing} onChange={e => setFacing(e.target.value as Facing)} className="text-[10px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-1 py-0.5">
            {FACINGS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          <button type="button" className={btn()} onClick={() => {
            const next = evenlySpaced(roof, count, facing, draft).filter(d => dormerLayout(roof, d));
            if (!next.length) { setMeasurements(`No room for dormers on the ${facing} slope.`); return; }
            save(next, next.length < count ? `Only ${next.length} fit on the ${facing} slope.` : `Spaced ${next.length} dormers on the ${facing} slope.`);
          }}>Go</button>
        </div>
      </div>
    </div>
  );
}

/** A size slider that applies on release (each change rebuilds the dormers and is one undo step). */
function SizeSlider({ label, value, min, max, onCommit }: { label: string; value: number; min: number; max: number; onCommit: (v: number) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <div>
      <div className="flex justify-between text-gray-500 dark:text-gray-400 text-[10px]"><span>{label}</span><span className="font-mono">{v.toFixed(2)} m</span></div>
      <input type="range" min={min} max={max} step={0.05} value={v} onChange={e => setV(Number(e.target.value))}
        onPointerUp={() => onCommit(v)} onKeyUp={() => onCommit(v)}
        className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-polyform-blue" />
    </div>
  );
}
