import React, { useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { cn } from '../lib/utils';
import { extrasOf, withRoofExtras, type Facing, type RoofExtras } from '../lib/roofExtras';
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

      <div className={cn('space-y-1.5', flat && 'opacity-40 pointer-events-none')}>
        <div className="flex items-center justify-between">
          <span>
            <span className="block text-[11px] font-semibold text-gray-700 dark:text-gray-200">Dormers</span>
            <span className="block text-[9px] text-gray-400">{flat ? 'Pitched roofs only' : 'Gabled dormer windows on one slope'}</span>
          </span>
          <div className="flex gap-1">
            {[0, 1, 2, 3].map(n => (
              <button key={n} type="button" onClick={() => apply({ dormers: n }, n ? `Added ${n} dormer${n > 1 ? 's' : ''}.` : 'Removed the dormers.')}
                className={cn('w-6 h-6 rounded text-[10px] font-bold border', (extras.dormers ?? 0) === n
                  ? 'bg-polyform-blue text-white border-polyform-blue'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700')}>{n}</button>
            ))}
          </div>
        </div>
        {(extras.dormers ?? 0) > 0 && <FacingPicker value={extras.dormerFacing ?? 'south'} onChange={f => apply({ dormerFacing: f })} />}
      </div>
    </div>
  );
}
