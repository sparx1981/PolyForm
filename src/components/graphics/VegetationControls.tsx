import React from 'react';
import { useApp } from '../../AppContext';
import { GraphicsSlider } from './WeatherControls';

export function VegetationControls() {
  const { graphicsSettings, setGraphicsSettings } = useApp();
  const settings = graphicsSettings.vegetation;
  const update = (changes: Partial<typeof settings>) => setGraphicsSettings(previous => ({ ...previous, vegetation: { ...previous.vegetation, ...changes } }));
  return <details className="border rounded p-2 space-y-2 text-xs" data-testid="vegetation-controls">
    <summary className="cursor-pointer font-semibold">Vegetation rendering</summary>
    <label className="flex gap-2"><input type="checkbox" checked={settings.instancing} onChange={e => update({ instancing: e.target.checked })} />Batch repeated plants</label>
    <label className="flex gap-2"><input type="checkbox" checked={settings.windEnabled} onChange={e => update({ windEnabled: e.target.checked })} />Animate plant wind</label>
    <GraphicsSlider label="Plant wind strength" value={settings.strength} min={0} max={0.4} onChange={strength => update({ strength })} />
    <GraphicsSlider label="Plant wind speed" value={settings.speed} min={0} max={5} step={0.1} onChange={speed => update({ speed })} />
    <GraphicsSlider label="Plant wind direction" value={settings.direction} min={0} max={360} step={1} unit="°" onChange={direction => update({ direction })} />
    <p className="text-[10px] text-gray-500">Selected plants stay individually editable. Repeated plants share GPU draw calls.</p>
  </details>;
}
