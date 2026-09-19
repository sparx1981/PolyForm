import React from 'react';
import { useApp } from '../../AppContext';
import type { WeatherKind } from '../../lib/graphics/WeatherSystem';
import type { WeatherLayerSettings } from '../../lib/graphics/graphicsSettings';

export function GraphicsSlider({ label, value, min, max, step = 0.01, onChange, unit = '' }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void;
}) {
  return <label className="block space-y-1 text-xs"><span className="flex justify-between"><span>{label}</span><span>{Number(value.toFixed(2))}{unit}</span></span>
    <input className="w-full accent-blue-500" type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} /></label>;
}

export function WeatherControls() {
  const { graphicsSettings, setGraphicsSettings } = useApp();
  const weather = graphicsSettings.weather;
  const update = (changes: Partial<typeof weather>) => setGraphicsSettings(previous => ({ ...previous, weather: { ...previous.weather, ...changes } }));
  const layer = (kind: WeatherKind, changes: Partial<WeatherLayerSettings>) => setGraphicsSettings(previous => ({ ...previous,
    weather: { ...previous.weather, layers: { ...previous.weather.layers, [kind]: { ...previous.weather.layers[kind], ...changes } } } }));
  return <div className="space-y-3" data-testid="weather-controls">
    <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={weather.enabled} onChange={e => update({ enabled: e.target.checked })} />Enable weather</label>
    {weather.enabled && <>
      <GraphicsSlider label="Weather area" value={weather.width} min={20} max={500} step={10} unit=" m" onChange={width => update({ width })} />
      <GraphicsSlider label="Precipitation height" value={weather.height} min={5} max={100} step={1} unit=" m" onChange={height => update({ height })} />
      <GraphicsSlider label="Wind east / west" value={weather.windX} min={-20} max={20} step={0.1} unit=" m/s" onChange={windX => update({ windX })} />
      <GraphicsSlider label="Wind north / south" value={weather.windZ} min={-20} max={20} step={0.1} unit=" m/s" onChange={windZ => update({ windZ })} />
      {(Object.keys(weather.layers) as WeatherKind[]).map(kind => {
        const settings = weather.layers[kind], airborne = kind === 'clouds' || kind === 'mist';
        // `open` tracks settings.enabled each render (auto-expands on enable, auto-collapses
        // on disable) but React only touches the DOM attribute when that value actually
        // changes, so a manual expand/collapse by the user in between isn't fought.
        return <details key={kind} open={settings.enabled} className="space-y-2 border-t border-gray-200 dark:border-gray-700 pt-3">
          <summary className="flex items-center gap-2 text-xs font-semibold capitalize cursor-pointer list-none">
            <input type="checkbox" checked={settings.enabled} onClick={e => e.stopPropagation()} onChange={e => layer(kind, { enabled: e.target.checked })} />{kind}
          </summary>
          {settings.enabled && <div className="space-y-2 pt-2">
            <GraphicsSlider label={`${kind} density`} value={settings.density} min={0} max={1} onChange={density => layer(kind, { density })} />
            <GraphicsSlider label={`${kind} opacity`} value={settings.opacity} min={0} max={1} onChange={opacity => layer(kind, { opacity })} />
            <GraphicsSlider label={`${kind} size`} value={settings.size} min={airborne ? 1 : 0.02} max={airborne ? 60 : 1} step={airborne ? 1 : 0.01} unit=" m" onChange={size => layer(kind, { size })} />
            <label className="flex justify-between text-xs">{kind} colour<input aria-label={`${kind} colour`} type="color" value={settings.color} onChange={e => layer(kind, { color: e.target.value })} /></label>
            {airborne && <>
              <GraphicsSlider label={`${kind} altitude`} value={settings.altitude} min={0} max={kind === 'clouds' ? 300 : 30} step={kind === 'clouds' ? 1 : 0.1} unit=" m" onChange={altitude => layer(kind, { altitude })} />
              <GraphicsSlider label={`${kind} thickness`} value={settings.thickness} min={0.1} max={kind === 'clouds' ? 60 : 15} step={0.1} unit=" m" onChange={thickness => layer(kind, { thickness })} />
            </>}
            {kind === 'clouds' && <>
              <label className="block text-xs">Cloud type<select className="w-full p-1 rounded bg-white dark:bg-gray-800 border" value={settings.cloudType} onChange={e => layer(kind, { cloudType: e.target.value as WeatherLayerSettings['cloudType'] })}>
                <option value="cumulus">Puffy (cumulus)</option><option value="cirrus">Wispy (cirrus)</option><option value="stratus">Layered (stratus)</option>
              </select></label>
              <label className="block text-xs">Cloud rendering<select className="w-full p-1 rounded bg-white dark:bg-gray-800 border" value={weather.cloudsMode} onChange={e => update({ cloudsMode: e.target.value as typeof weather.cloudsMode })}>
                <option value="fast">Fast</option><option value="volumetric">Volumetric</option>
              </select></label>
              <p className="text-[10px] text-gray-500">Volumetric adds shaded depth inside each cloud and uses more GPU power.</p>
            </>}
            {!airborne && <>
              <GraphicsSlider label={`${kind} fall speed`} value={settings.speed} min={0} max={40} step={0.1} unit=" m/s" onChange={speed => layer(kind, { speed })} />
              <GraphicsSlider label={`${kind} gravity`} value={settings.gravity} min={0} max={20} step={0.1} onChange={gravity => layer(kind, { gravity })} />
            </>}
            <GraphicsSlider label={`${kind} turbulence`} value={settings.turbulence} min={0} max={5} step={0.05} onChange={turbulence => layer(kind, { turbulence })} />
          </div>}
        </details>;
      })}
    </>}
  </div>;
}
