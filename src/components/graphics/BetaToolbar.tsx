import { useState } from 'react';
import { FlaskConical, X } from 'lucide-react';
import { useApp } from '../../AppContext';
import { defaultBetaEnvironment, type BetaEnvironmentSettings } from '../../lib/graphics/betaEnvironment';
import { GraphicsSlider } from './WeatherControls';

/** Available in every editor layout, including the phone; opening it never enables effects. */
export function BetaToolbar() {
  const [open, setOpen] = useState(false);
  const { graphicsSettings, setGraphicsSettings, theme } = useApp();
  const s = graphicsSettings.beta;
  const update = (changes: Partial<BetaEnvironmentSettings>) => setGraphicsSettings(p => ({ ...p, beta: { ...p.beta, ...changes } }));
  const toggle = (key: 'enabled' | 'sky' | 'stars' | 'clouds' | 'atmosphere' | 'flare' | 'grading', title: string) =>
    <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={s[key]} onChange={e => update({ [key]: e.target.checked })} />{title}</label>;
  const slider = (key: keyof BetaEnvironmentSettings, label: string, min: number, max: number, step = 0.01, unit = '') =>
    <GraphicsSlider label={label} value={s[key] as number} min={min} max={max} step={step} unit={unit} onChange={v => update({ [key]: v })} />;
  const selectClass = 'block w-full rounded border bg-white text-gray-900 p-1 dark:bg-gray-800 dark:text-gray-100';
  const commitDate = (value: string) => { if (value && Number.isFinite(Date.parse(value + 'Z'))) update({ date: value.slice(0,16) }); };
  return <div className="fixed right-3 bottom-16 z-40" data-testid="beta-toolbar">
    <button className="flex items-center gap-2 rounded border border-blue-500 bg-gray-900 text-white px-3 py-2 text-xs shadow-lg" title="Beta environment lab" aria-expanded={open} onClick={() => setOpen(v => !v)}><FlaskConical size={16} />Beta</button>
    {open && <section role="dialog" aria-label="Beta environment lab" className={`absolute right-0 bottom-12 w-[min(360px,calc(100vw-24px))] max-h-[75dvh] overflow-y-auto rounded-lg border shadow-xl p-4 text-xs space-y-3 ${theme === 'dark' ? 'bg-gray-900 text-gray-100 border-gray-700' : 'bg-white text-gray-900 border-gray-200'}`}>
      <div className="flex justify-between items-center"><h2 className="font-semibold text-sm">Environment lab · Beta</h2><button aria-label="Close environment lab" onClick={() => setOpen(false)}><X size={18} /></button></div>
      {toggle('enabled', 'Enable Beta environment')}
      <p className="text-gray-500">Saved with this model. Clouds use Weather wind. Quality starts at Low; disable clouds to keep the sky on slower devices.</p>
      <button className="text-blue-500 underline" onClick={() => setGraphicsSettings(p => ({ ...p, beta: defaultBetaEnvironment() }))}>Reset to existing environment</button>
      <fieldset disabled={!s.enabled} className="space-y-3 disabled:opacity-50">
        <label className="flex items-center gap-2"><input type="checkbox" checked={s.useSite} onChange={e => update({ useSite: e.target.checked })} />Use imported site location</label>
        {!s.useSite && <>{slider('latitude','Latitude',-89.9,89.9,0.1,'°')}{slider('longitude','Longitude',-180,180,0.1,'°')}{slider('elevation','Elevation',-100,9000,10,' m')}</>}
        <label className="block">Date and time (UTC)<input aria-label="Environment date and time UTC" type="datetime-local" className={selectClass} value={s.date} onChange={e => commitDate(e.target.value)} onInput={e => commitDate(e.currentTarget.value)} onBlur={e => commitDate(e.currentTarget.value)} /></label>
        {toggle('sky','Physical sky')}
        {toggle('stars','Stars')}{s.stars && slider('starIntensity','Star intensity',0,10,0.1)}
        {toggle('clouds','Volumetric clouds')}
        {s.clouds && <div className="space-y-2 pl-3">
          <p className="text-gray-500">Cloud shadows require Physical sky and the viewport Shadows setting. Higher quality improves cloud detail and uses more GPU time.</p>
          {slider('coverage','Cloud coverage',0,1)}
          <label>Cloud type<select className={selectClass} value={s.cloudType} onChange={e => update({ cloudType: e.target.value as typeof s.cloudType })}><option value="cumulus">Cumulus</option><option value="stratus">Stratus</option><option value="cirrus">Cirrus</option></select></label>
          {slider('altitude','Cloud altitude',200,12000,100,' m')}{slider('thickness','Cloud thickness',100,6000,100,' m')}
          {slider('layers','Cloud layers',1,3,1)}{slider('windScale','Weather wind multiplier',0,5,0.1)}
          <label>Cloud quality<select className={selectClass} value={s.quality} onChange={e => update({ quality: e.target.value as typeof s.quality })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
        </div>}
        {toggle('atmosphere','Atmospheric distance haze')}
        {toggle('flare','Lens flare')}{s.flare && <>{slider('flareIntensity','Flare intensity',0,1)}{slider('ghosts','Flare ghosts',0,1)}{slider('halo','Flare halo',0,1)}</>}
        {toggle('grading','Colour grading')}{s.grading && <><label>Grading preset<select className={selectClass} value={s.grade} onChange={e => update({ grade: e.target.value as typeof s.grade })}><option value="neutral">Neutral architecture</option><option value="warm">Warm</option><option value="cool">Cool</option></select></label>{slider('gradeStrength','Grading strength',0,1)}</>}
        {slider('exposure','Exposure',0.1,4,0.05)}
      </fieldset>
    </section>}
  </div>;
}
