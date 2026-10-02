import { createPortal } from 'react-dom';
import { motion, useDragControls } from 'motion/react';
import { usePhoneLayout } from '../../lib/phoneLayout';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { FlaskConical, X, PanelRightClose, GripVertical } from 'lucide-react';
import { useApp } from '../../AppContext';
import { defaultBetaEnvironment, type BetaEnvironmentSettings } from '../../lib/graphics/betaEnvironment';
import { getBetaTime, subscribeBetaTime } from '../../lib/graphics/betaDayCycle';
import { getCloudQuality, subscribeCloudQuality } from '../../lib/graphics/cloudQuality';
import { GraphicsSlider } from './WeatherControls';

/** Available in every editor layout, including the phone; opening it never enables effects. */
export function BetaToolbar() {
  const [open, setOpen] = useState(false);
  const [docked, setDocked] = useState(() => { try { return localStorage.getItem('polyform-beta-docked') === 'true'; } catch { return false; } });
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const { isPhone } = usePhoneLayout();
  const dragControls = useDragControls();
  useEffect(() => {
    if (!open || !docked) { setSlot(null); return; }
    const findSlot = () => setSlot(document.getElementById('beta-environment-dock'));
    findSlot();
    const observer = new MutationObserver(findSlot);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [open, docked]);
  const { graphicsSettings, setGraphicsSettings, theme, setRightPanelVisible, toolbarVisibility } = useApp();
  const s = graphicsSettings.beta;
  const clock = useSyncExternalStore(subscribeBetaTime, getBetaTime, getBetaTime);
  const autoQuality = useSyncExternalStore(subscribeCloudQuality, getCloudQuality, getCloudQuality);
  const displayedDate = s.enabled && s.animateDayCycle && clock.seed === s.date ? clock.date : s.date;
  const update = (changes: Partial<BetaEnvironmentSettings>) => setGraphicsSettings(p => ({ ...p, beta: { ...p.beta, ...changes } }));
  const toggle = (key: 'enabled' | 'animateDayCycle' | 'clouds' | 'atmosphere' | 'flare' | 'grading', title: string) =>
    <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={s[key]} onChange={e => update({ [key]: e.target.checked, ...((key === 'animateDayCycle' || key === 'enabled') && !e.target.checked ? { date: displayedDate } : {}) })} />{title}</label>;
  const slider = (key: keyof BetaEnvironmentSettings, label: string, min: number, max: number, step = 0.01, unit = '') =>
    <GraphicsSlider label={label} value={s[key] as number} min={min} max={max} step={step} unit={unit} onChange={v => update({ [key]: v })} />;
  const selectClass = 'block w-full rounded border bg-white text-gray-900 p-1 dark:bg-gray-800 dark:text-gray-100';
  const commitTime = (value: string) => { if (/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) update({ date: `${s.date.slice(0,10)}T${value.slice(0,5)}` }); };
  const embedded = docked && Boolean(slot);
  const panel = <motion.section key={`${isPhone}:${embedded}`} role="dialog" aria-label="Beta environment lab"
    drag={!embedded && !isPhone} dragListener={false} dragControls={dragControls} dragMomentum={false}
    className={`${embedded ? 'relative w-full' : 'fixed right-3 bottom-28 w-[min(360px,calc(100vw-24px))]'} z-[85] max-h-[75dvh] overflow-y-auto rounded-lg border shadow-xl p-4 text-xs space-y-3 ${theme === 'dark' ? 'bg-gray-900 text-gray-100 border-gray-700' : 'bg-white text-gray-900 border-gray-200'}`}>
      <div className="flex justify-between items-center gap-2">
        <h2 className={`font-semibold text-sm flex items-center gap-1 ${!embedded && !isPhone ? 'cursor-grab touch-none' : ''}`} onPointerDown={e => { if (!embedded && !isPhone) dragControls.start(e); }}><GripVertical size={16} />Environment lab · Beta</h2>
        <button aria-label={docked ? 'Undock environment lab' : 'Dock environment lab'} onClick={() => { const next = !docked; setDocked(next); try { localStorage.setItem('polyform-beta-docked', String(next)); } catch { /* Docking still works without browser storage. */ } if (next) setRightPanelVisible(true); }}><PanelRightClose size={18} /></button>
        <button aria-label="Close environment lab" onClick={() => setOpen(false)}><X size={18} /></button>
      </div>
      {toggle('enabled', 'Enable Beta environment')}
      <p className="text-gray-500">Saved with this model. Clouds use Weather wind. Cloud quality is Auto by default: it adapts to this device. Disable clouds to keep the sky on slower devices.</p>
      <button className="text-blue-500 underline" onClick={() => setGraphicsSettings(p => ({ ...p, beta: defaultBetaEnvironment() }))}>Reset to existing environment</button>
      <fieldset disabled={!s.enabled} className="space-y-3 disabled:opacity-50">
        <label className="flex items-center gap-2"><input type="checkbox" checked={s.useSite} onChange={e => update({ useSite: e.target.checked })} />Use imported site location</label>
        {!s.useSite && <>{slider('latitude','Latitude',-89.9,89.9,0.1,'°')}{slider('longitude','Longitude',-180,180,0.1,'°')}{slider('elevation','Elevation',-100,9000,10,' m')}</>}
        <label className="block">Time (UTC)<input aria-label="Environment time UTC" type="time" className={selectClass} value={displayedDate.slice(11,16)} onChange={e => commitTime(e.target.value)} onInput={e => commitTime(e.currentTarget.value)} /></label>
        {toggle('animateDayCycle','Animate day cycle')}
        {s.animateDayCycle && <div className="space-y-2">
          {slider('dayCycleSpeed','Day cycle speed',0.05,2,0.05,' h/s')}
          <p className="text-gray-500">One full day takes {Math.round(24 / s.dayCycleSpeed)} seconds. Physical sky and stars follow the time automatically.</p>
        </div>}
        {toggle('clouds','Volumetric clouds')}
        {s.clouds && <div className="space-y-2 pl-3">
          <p className="text-gray-500">Cloud shadows require the viewport Shadows setting. Higher quality improves cloud detail and uses more GPU time.</p>
          {slider('coverage','Cloud coverage',0,1)}
          <label>Cloud type<select className={selectClass} value={s.cloudType} onChange={e => update({ cloudType: e.target.value as typeof s.cloudType })}><option value="cumulus">Cumulus</option><option value="stratus">Stratus</option><option value="cirrus">Cirrus</option></select></label>
          {slider('altitude','Cloud altitude',200,12000,100,' m')}{slider('thickness','Cloud thickness',100,6000,100,' m')}
          {slider('layers','Cloud layers',1,3,1)}{slider('windScale','Weather wind multiplier',0,5,0.1)}
          <label>Cloud quality<select className={selectClass} value={s.quality} onChange={e => update({ quality: e.target.value as typeof s.quality })}><option value="auto">Auto{s.quality === 'auto' ? ` (now ${autoQuality})` : ''}</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
        </div>}
        {toggle('atmosphere','Atmospheric distance haze')}
        {toggle('flare','Lens flare')}{s.flare && <>{slider('flareIntensity','Flare intensity',0,1)}{slider('ghosts','Flare ghosts',0,1)}{slider('halo','Flare halo',0,1)}</>}
        {toggle('grading','Colour grading')}{s.grading && <><label>Grading preset<select className={selectClass} value={s.grade} onChange={e => update({ grade: e.target.value as typeof s.grade })}><option value="neutral">Neutral architecture</option><option value="warm">Warm</option><option value="cool">Cool</option></select></label>{slider('gradeStrength','Grading strength',0,1)}</>}
        {slider('exposure','Exposure',0.1,4,0.05)}
      </fieldset>
    </motion.section>;
  if (toolbarVisibility.beta_lab === false) return null;
  return <>
    <div className="fixed right-3 bottom-16 z-[85]" data-testid="beta-toolbar">
      <button className="flex items-center gap-2 rounded border border-blue-500 bg-gray-900 text-white px-3 py-2 text-xs shadow-lg" title="Beta environment lab" aria-expanded={open} onClick={() => { setOpen(v => !v); if (docked) setRightPanelVisible(true); }}><FlaskConical size={16} />Beta</button>
    </div>
    {open && (embedded ? createPortal(panel, slot!) : panel)}
  </>;
}
