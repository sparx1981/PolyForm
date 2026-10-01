import React, { useState } from 'react';
import { useApp } from '../../AppContext';
import { WATER_CLARITY, type WaterClarity, type WaterFlowProfile } from '../../lib/water/waterBody';
import { cn } from '../../lib/utils';

/**
 * Depth and water type for the next pond, and for the selected pond or lake: its level, depth,
 * water type and whether it digs its own basin.
 */
export function WaterControls() {
  const { waterToolSettings, setWaterToolSettings, shapes, setShapes, selectedId } = useApp();
  const selected = shapes.find(shape => shape.id === selectedId && shape.type === 'water' && shape.waterData);
  const [levelRange, setLevelRange] = useState({ id: selected?.id, centre: selected?.position[1] ?? 0 });
  if (levelRange.id !== selected?.id) setLevelRange({ id: selected?.id, centre: selected?.position[1] ?? 0 });
  const depth = selected?.waterData?.depth ?? waterToolSettings.depth;
  const clarity = selected?.waterData?.clarity ?? waterToolSettings.clarity;
  const flow = selected?.waterData?.flow ?? { mode: 'still' as const };

  const update = (patch: { depth?: number; clarity?: WaterClarity; dig?: boolean; level?: number; flow?: WaterFlowProfile }) => {
    const { level, dig, flow: flowPatch, ...toolPatch } = patch;
    if (Object.keys(toolPatch).length) setWaterToolSettings({ ...waterToolSettings, ...toolPatch });
    if (selected?.waterData) {
      setShapes(prev => prev.map(shape => shape.id !== selected.id ? shape : {
        ...shape,
        position: level === undefined ? shape.position : [shape.position[0], level, shape.position[2]],
        waterData: { ...shape.waterData!, ...toolPatch, ...(dig === undefined ? {} : { dig }), ...(flowPatch === undefined ? {} : { flow: flowPatch }) },
      }));
    }
  };

  return (
    <div className="space-y-3.5">
      <p className="text-[10px] text-gray-500 dark:text-gray-400">
        {selected ? `Editing ${selected.name}. Drag yellow handles to reshape, then choose Still, Gentle drift or Stream/current below to control surface flow.`
          : 'Click around the edge of the pond or lake, then click the first point (or press Enter) to fill it. Select the water afterwards to add gentle drift or a directional current.'}
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
            <input type="range" className="w-full" aria-label="Water level" min={levelRange.centre - 2} max={levelRange.centre + 2} step={0.05}
              value={selected.position[1]} onChange={event => update({ level: parseFloat(event.target.value) })} />
          </div>
          <label className="flex items-center justify-between text-[11px] text-gray-600 dark:text-gray-300">
            Dig basin into terrain
            <input type="checkbox" checked={selected.waterData!.dig !== false} onChange={event => update({ dig: event.target.checked })} />
          </label>
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700 space-y-3">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Surface motion</label>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                <button type="button"
                  onClick={() => update({ flow: { mode: 'still' } })}
                  className={cn('rounded-md border px-2 py-1.5 text-[11px] font-semibold',
                    flow.mode !== 'stream' ? 'border-polyform-blue bg-polyform-blue/10 text-polyform-blue'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300')}>
                  Pond / still
                </button>
                <button type="button"
                  onClick={() => update({ flow: { mode: 'stream', direction: flow.direction ?? [1, 0], speed: 0.12, turbulence: 0.1 } })}
                  className={cn('rounded-md border px-2 py-1.5 text-[11px] font-semibold',
                    flow.mode === 'stream' && (flow.speed ?? 0.45) < 0.3 ? 'border-polyform-blue bg-polyform-blue/10 text-polyform-blue'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300')}>
                  Gentle drift
                </button>
                <button type="button"
                  onClick={() => update({ flow: { mode: 'stream', direction: flow.direction ?? [1, 0], speed: Math.max(flow.speed ?? 0.65, 0.35), turbulence: flow.turbulence ?? 0.35 } })}
                  className={cn('rounded-md border px-2 py-1.5 text-[11px] font-semibold',
                    flow.mode === 'stream' && (flow.speed ?? 0.45) >= 0.3 ? 'border-polyform-blue bg-polyform-blue/10 text-polyform-blue'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300')}>
                  Stream / current
                </button>
              </div>
            </div>
            {flow.mode === 'stream' && (
              <>
                <div>
                  <div className="flex justify-between">
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Current speed</label>
                    <span className="text-[10px] font-mono text-polyform-blue">{(flow.speed ?? 0.45).toFixed(2)} m/s</span>
                  </div>
                  <input type="range" className="w-full" min={0} max={4} step={0.05} value={flow.speed ?? 0.45}
                    onChange={event => update({ flow: { ...flow, mode: 'stream', speed: parseFloat(event.target.value) } })} />
                </div>
                <div>
                  <div className="flex justify-between">
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Turbulence</label>
                    <span className="text-[10px] font-mono text-polyform-blue">{Math.round((flow.turbulence ?? 0.35) * 100)}%</span>
                  </div>
                  <input type="range" className="w-full" min={0} max={1} step={0.05} value={flow.turbulence ?? 0.35}
                    onChange={event => update({ flow: { ...flow, mode: 'stream', turbulence: parseFloat(event.target.value) } })} />
                </div>
                <p className="text-[10px] text-gray-500">Enable Weather and adjust its wind for lake waves. Current turbulence adds irregular crests; shallow fast flow and steep waves produce foam.</p>
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Flow direction</label>
                    <div className="flex gap-1">
                      {[
                        ['←', [-1, 0]],
                        ['↑', [0, -1]],
                        ['↓', [0, 1]],
                        ['→', [1, 0]],
                      ].map(([label, direction]) => (
                        <button key={String(label)} type="button"
                          onClick={() => update({ flow: { ...flow, mode: 'stream', direction: direction as [number, number] } })}
                          className="h-6 w-6 rounded border border-gray-200 dark:border-gray-700 text-[11px] hover:border-polyform-blue">
                          {label as string}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 mt-1">
                    <input type="number" step={0.1} value={flow.direction?.[0] ?? 1}
                      onChange={event => update({ flow: { ...flow, mode: 'stream', direction: [parseFloat(event.target.value) || 0, flow.direction?.[1] ?? 0] } })}
                      className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-[11px]" />
                    <input type="number" step={0.1} value={flow.direction?.[1] ?? 0}
                      onChange={event => update({ flow: { ...flow, mode: 'stream', direction: [flow.direction?.[0] ?? 1, parseFloat(event.target.value) || 0] } })}
                      className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-[11px]" />
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
