import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { presentation, usePresentation } from '../../lib/presentation/store';
import { DEFAULT_GLASS, GLASS_KEYS, GLASS_PROFILES, type GlassSettings } from '../../lib/presentation/glass';
import { cn } from '../../lib/utils';

type Tone = 'dark' | 'themed';

const text = (tone: Tone) => ({
  label: tone === 'dark' ? 'text-white/70' : 'text-gray-600 dark:text-gray-300',
  heading: tone === 'dark' ? 'text-white/50' : 'text-gray-500',
  off: tone === 'dark' ? 'bg-white/10 text-white/80 hover:bg-white/20' : 'bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/20',
});

function Row({ label, value, min, max, step, onChange, format, tone }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string; tone: Tone;
}) {
  return (
    <label className="block">
      <div className={cn('flex justify-between text-[11px] mb-1', text(tone).label)}>
        <span>{label}</span><span className="tabular-nums">{format(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(+e.target.value)} className="w-full accent-sky-400" />
    </label>
  );
}

function Choice<T extends string | number>({ options, value, onChange, tone, label }: {
  options: { id: T; name: string; hint?: string }[]; value: T; onChange: (v: T) => void; tone: Tone; label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1">
      {options.map(o => (
        <button key={String(o.id)} type="button" title={o.hint} aria-pressed={value === o.id} onClick={() => onChange(o.id)}
          className={cn('flex-1 px-2 py-1 rounded-md text-xs font-semibold', value === o.id ? 'bg-polyform-blue text-white' : text(tone).off)}>
          {o.name}
        </button>
      ))}
    </div>
  );
}

function Group({ title, tone, children }: { title: string; tone: Tone; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <div className={cn('text-[10px] font-bold uppercase tracking-wider', text(tone).heading)}>{title}</div>
      {children}
    </div>
  );
}

/**
 * Every setting of the glass lens. One component for Presentation mode's popover and the Camera toolbar's Glass tool,
 * since both drive the same shared lens. `follow` adds the "always follow cursor" switch (Camera tool only).
 */
export function GlassSettingsPanel({ tone = 'dark', follow = false }: { tone?: Tone; follow?: boolean }) {
  const s = usePresentation();
  const set = (patch: Parameters<typeof presentation.set>[0]) => presentation.set(patch);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const rounded = s.loupeShape === 'rounded';
  // Everything from Refraction down is for fine-tuning, so it starts folded away.
  const [advanced, setAdvanced] = useState(false);
  const row = (label: string, key: keyof GlassSettings & ('loupeAspect' | 'loupeRoundness' | 'glassBezel' | 'glassThickness' | 'glassIndex' | 'glassRefraction' | 'glassChromatic' | 'glassSpecular' | 'glassSpecularAngle' | 'glassSpecularWidth' | 'glassShadow' | 'glassShadowBlur' | 'glassTintAmount' | 'glassEdgeBlur'),
    min: number, max: number, step: number, format: (v: number) => string) =>
    <Row tone={tone} label={label} value={s[key]} min={min} max={max} step={step} format={format} onChange={v => set({ [key]: v })} />;

  return (
    <div className="space-y-4">
      {follow && (
        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <span className={cn('text-xs font-semibold', tone === 'dark' ? 'text-white' : 'text-gray-800 dark:text-gray-100')}>
            Always follow cursor
            <span className={cn('block text-[10px] font-normal', text(tone).heading)}>The glass sits under the pointer; turn off to drag it</span>
          </span>
          <input type="checkbox" role="switch" checked={s.loupeFollow} onChange={e => set({ loupeFollow: e.target.checked })} className="h-4 w-4 accent-sky-500" />
        </label>
      )}

      <Group title="Lens" tone={tone}>
        <Choice tone={tone} label="Lens shape" value={s.loupeShape} onChange={v => set({ loupeShape: v })}
          options={[{ id: 'circle', name: 'Circle' }, { id: 'rounded', name: 'Rounded / pill' }]} />
        <Row tone={tone} label="Magnification" value={s.loupeZoom} min={1.5} max={6} step={.1} onChange={v => set({ loupeZoom: v })} format={v => `${v.toFixed(1)}×`} />
        <Row tone={tone} label="Lens size" value={s.loupeRadius} min={70} max={180} step={5} onChange={v => set({ loupeRadius: v })} format={v => `${Math.round(v * 2)} px`} />
        {rounded && row('Width', 'loupeAspect', 1, 3.5, .05, v => `${v.toFixed(2)}×`)}
        {rounded && row('Corner roundness', 'loupeRoundness', .15, 1, .05, pct)}
      </Group>

      <div className="space-y-4">
        <button type="button" aria-expanded={advanced} onClick={() => setAdvanced(v => !v)}
          className={cn('w-full flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider', text(tone).heading, tone === 'dark' ? 'hover:text-white' : 'hover:text-gray-800 dark:hover:text-gray-100')}>
          {advanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}Advanced
        </button>
        {advanced && (
          <div className="space-y-4">
        <Group title="Refraction" tone={tone}>
          <Choice tone={tone} label="Edge profile" value={s.glassProfile} onChange={v => set({ glassProfile: v })}
            options={GLASS_PROFILES.map(p => ({ id: p.id as number, name: p.name, hint: p.hint }))} />
          {row('Bezel width', 'glassBezel', .08, .6, .01, pct)}
          {row('Thickness', 'glassThickness', 2, 40, 1, v => `${Math.round(v)} px`)}
          {row('Refractive index', 'glassIndex', 1.05, 2.4, .01, v => v.toFixed(2))}
          {row('Refraction strength', 'glassRefraction', 0, 2, .05, pct)}
          {row('Colour fringing', 'glassChromatic', 0, 1, .05, pct)}
          {row('Edge blur', 'glassEdgeBlur', 0, 1, .05, pct)}
        </Group>

        <Group title="Highlight" tone={tone}>
          {row('Specular', 'glassSpecular', 0, 1, .05, pct)}
          {row('Light angle', 'glassSpecularAngle', 0, 360, 5, v => `${Math.round(v)}°`)}
          {row('Highlight width', 'glassSpecularWidth', .5, 10, .1, v => `${v.toFixed(1)} px`)}
        </Group>

        <Group title="Shadow and tint" tone={tone}>
          {row('Shadow', 'glassShadow', 0, .7, .02, pct)}
          {row('Shadow softness', 'glassShadowBlur', 2, 60, 1, v => `${Math.round(v)} px`)}
          {row('Tint amount', 'glassTintAmount', 0, .6, .02, pct)}
          <label className={cn('flex items-center justify-between text-[11px]', text(tone).label)}>
            <span>Tint colour</span>
            <input type="color" value={s.glassTint} onChange={e => set({ glassTint: e.target.value })} className="h-6 w-10 rounded border-0 bg-transparent p-0" aria-label="Glass tint colour" />
          </label>
        </Group>

        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <span className={cn('text-xs font-semibold', tone === 'dark' ? 'text-white' : 'text-gray-800 dark:text-gray-100')}>
            Liquid motion
            <span className={cn('block text-[10px] font-normal', text(tone).heading)}>The glass squashes and stretches as it moves</span>
          </span>
          <input type="checkbox" role="switch" checked={s.glassLiquid} onChange={e => set({ glassLiquid: e.target.checked })} className="h-4 w-4 accent-sky-500" />
        </label>

        <button type="button" onClick={() => {
          const patch: Record<string, unknown> = { loupeZoom: 2.5, loupeRadius: 110 };
          for (const k of GLASS_KEYS) if (k !== 'loupeFollow') patch[k] = DEFAULT_GLASS[k];
          set(patch as Parameters<typeof presentation.set>[0]);
        }} className={cn('w-full px-2 py-1.5 rounded-md text-xs font-semibold', text(tone).off)}>
          Reset glass settings
        </button>
          </div>
        )}
      </div>
    </div>
  );
}
