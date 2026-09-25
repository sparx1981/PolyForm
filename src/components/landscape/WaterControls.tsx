import React from 'react';
import { useApp } from '../../AppContext';
import { WATER_CLARITY, type WaterClarity } from '../../lib/water/waterBody';
import { cn } from '../../lib/utils';

/**
 * Depth and water type for the next pond, and for the selected pond or lake: its level, depth,
 * water type and whether it digs its own basin.
 */
export function WaterControls() {
  const { waterToolSettings, setWaterToolSettings, shapes, setShapes, selectedId } = useApp();
  const selected = shapes.find(shape => shape.id === selectedId && shape.type === 'water' && shape.waterData);
  const depth = selected?.waterData?.depth ?? waterToolSettings.depth;
  const clarity = selected?.waterData?.clarity ?? waterToolSettings.clarity;

  const update = (patch: { depth?: number; clarity?: WaterClarity; dig?: boolean; level?: number }) => {
    const { level, dig, ...toolPatch } = patch;
    if (Object.keys(toolPatch).length) setWaterToolSettings({ ...waterToolSettings, ...toolPatch });
    if (selected?.waterData) {
      setShapes(prev => prev.map(shape => shape.id !== selected.id ? shape : {
        ...shape,
        position: level === undefined ? shape.position : [shape.position[0], level, shape.position[2]],
        waterData: { ...selected.waterData!, ...toolPatch, ...(dig === undefined ? {} : { dig }) },
      }));
    }
  };

  return (
    <div className="space-y-3.5">
      <p className="text-[10px] text-gray-500 dark:text-gray-400">
        {selected ? `Editing ${selected.name}. Drag yellow handles to reshape, click white dots to add a point, right-click a point to remove it.`
          : 'Click around the edge of the pond or lake, then click the first point (or press Enter) to fill it. The ground is dug into a basin; delete the water to restore it.'}
      </p>
      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Water</label>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {(Object.keys(WATER_CLARITY) as WaterClarity[]).map(id => (
            <button key={id} type="button" onClick={() => update({ clarity: id })}
              className={cn('rounded-md border px-2 py-1.5 text-left text-[11px] font-semibold transition-colors',
                clarity === id ? 'border-polyform-blue bg-polyform-blue/10 text-polyform-blue'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-300')}>
              {WATER_CLARITY[id].label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="flex justify-between">
          <label className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Depth</label>
          <span className="text-[10px] font-mono text-polyform-blue">{depth.toFixed(1)} m</span>
        </div>
        <input type="range" className="w-full" min={0.3} max={6} step={0.1} value={depth}
          onChange={event => update({ depth: parseFloat(event.target.value) })} />
      </div>
      {selected && (
        <>
          <div>
            <div className="flex justify-between">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Water level</label>
              <span className="text-[10px] font-mono text-polyform-blue">{selected.position[1].toFixed(2)} m</span>
            </div>
            <input type="range" className="w-full" min={selected.position[1] - 2} max={selected.position[1] + 2} step={0.05}
              value={selected.position[1]} onChange={event => update({ level: parseFloat(event.target.value) })} />
          </div>
          <label className="flex items-center justify-between text-[11px] text-gray-600 dark:text-gray-300">
            Dig basin into terrain
            <input type="checkbox" checked={selected.waterData!.dig !== false} onChange={event => update({ dig: event.target.checked })} />
          </label>
        </>
      )}
    </div>
  );
}
