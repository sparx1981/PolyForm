import React from 'react';
import { useApp } from '../../AppContext';
import { FENCE_STYLES, WOOD_FINISHES, fenceStyleInfo, isGardenStyle, type FenceStyle } from '../../lib/fence/fenceTypes';
import type { FenceToolSettings } from '../../types';
import { cn } from '../../lib/utils';

/**
 * Fence style, height and finish. Changes set the defaults for the next fence drawn and, when
 * a fence is selected, restyle that fence too (one undo step per change).
 */
export function FenceControls() {
  const { fenceToolSettings, setFenceToolSettings, shapes, setShapes, selectedId } = useApp();
  const selected = shapes.find(shape => shape.id === selectedId && shape.type === 'fence' && shape.fenceData);
  const current: FenceToolSettings = selected?.fenceData
    ? { style: selected.fenceData.style, height: selected.fenceData.height, finish: selected.fenceData.finish ?? 'weathered', color: selected.fenceData.color ?? fenceToolSettings.color }
    : fenceToolSettings;
  const info = fenceStyleInfo(current.style);

  const update = (patch: Partial<FenceToolSettings>) => {
    const next = { ...current, ...patch };
    // A new style starts at its own typical height and colour.
    if (patch.style && patch.style !== current.style) {
      const style = fenceStyleInfo(patch.style);
      next.height = style.defaultHeight;
      if (style.color) next.color = style.color;
    }
    setFenceToolSettings(next);
    if (selected?.fenceData) {
      setShapes(prev => prev.map(shape => shape.id === selected.id
        ? { ...shape, color: next.color, fenceData: { ...selected.fenceData!, style: next.style, height: next.height, finish: next.finish, color: next.color } }
        : shape));
    }
  };

  return (
    <div className="space-y-3.5">
      <p className="text-[10px] text-gray-500 dark:text-gray-400">
        {selected ? `Editing ${selected.name}. Drag yellow handles to move corners, click white dots to add one, right-click a corner to remove it.`
          : 'Click points along the ground, click the first point to close, double-click or press Enter to finish.'}
      </p>
      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Style</label>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {FENCE_STYLES.map(style => (
            <button key={style.id} type="button" title={style.description}
              onClick={() => update({ style: style.id as FenceStyle })}
              className={cn('rounded-md border px-2 py-1.5 text-left text-[11px] font-semibold transition-colors',
                current.style === style.id
                  ? 'border-trimble-blue bg-trimble-blue/10 text-trimble-blue'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-300')}>
              {style.label}
              <span className="block text-[9px] font-normal text-gray-400">{style.description}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="flex justify-between">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Height</label>
          <span className="text-[10px] font-mono text-trimble-blue">{current.height.toFixed(2)} m</span>
        </div>
        <input type="range" className="w-full" min={info.minHeight} max={info.maxHeight} step={0.05}
          value={current.height} onChange={event => update({ height: parseFloat(event.target.value) })} />
      </div>
      {isGardenStyle(current.style) ? (
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Colour</label>
          <input type="color" value={current.color} onChange={event => update({ color: event.target.value })}
            className="h-6 w-10 cursor-pointer rounded border border-gray-200 dark:border-gray-700" />
        </div>
      ) : (
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Timber</label>
          <select value={current.finish} onChange={event => update({ finish: event.target.value as FenceToolSettings['finish'] })}
            className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-800">
            {WOOD_FINISHES.map(finish => <option key={finish.id} value={finish.id}>{finish.label}</option>)}
          </select>
        </div>
      )}
      {(current.style === 'skigard' || current.style === 'hybrid') && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400">Skigard needs gentle curves. Tight corners are rejected; the fence keeps its last valid shape.</p>
      )}
    </div>
  );
}
