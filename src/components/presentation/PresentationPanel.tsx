import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  Presentation, X, Hammer, PenLine, Layers, Scissors, ScanEye, RotateCw, Sparkles, Circle, Square, Share2, FlipHorizontal2, Loader2,
} from 'lucide-react';
import { useApp } from '../../AppContext';
import { cn } from '../../lib/utils';
import { playBuild, playStages, presentation, usePresentation, type CutMode } from '../../lib/presentation/store';
import { StageCaption, StageTimeline } from './StageTimeline';
import { downloadBlob, recordingSupported, startRecording, videoFileName, type Recording } from '../../lib/presentation/recorder';
import { runShowcase, SHOWCASE_STEPS } from '../../lib/presentation/showcase';
import { modelledBounds } from '../Viewport';
import { framing } from '../RenderView';
import ShareWithClientDialog from './ShareWithClientDialog';

/** Frames the whole building from a three-quarter view. */
export function frameModel(shapes: { id: string; type: string }[]) {
  const types = new Map(shapes.map(s => [s.id, s.type]));
  const box = modelledBounds(id => types.get(id) !== 'terrain' && types.get(id) !== 'measurement')
    ?? modelledBounds(() => true)
    ?? new THREE.Box3(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 3, 5));
  const canvas = document.querySelector('#polyform-viewport canvas') as HTMLCanvasElement | null;
  const aspect = canvas ? canvas.clientWidth / Math.max(1, canvas.clientHeight) : window.innerWidth / Math.max(1, window.innerHeight);
  const { position, target } = framing(box, 'perspective', aspect);
  window.dispatchEvent(new CustomEvent('set-camera', { detail: { position, target } }));
}

/** The top bar's "Present" switch. */
export function PresentButton({ compact }: { compact?: boolean }) {
  const { active } = usePresentation();
  return (
    <button
      onClick={() => (active ? closePresentation() : presentation.set({ active: true }))}
      className={cn(
        'flex items-center gap-1.5 rounded-full transition-colors text-sm font-semibold',
        compact ? 'p-2' : 'px-3 py-1.5',
        active ? 'bg-white text-polyform-blue' : 'bg-white/10 hover:bg-white/20 text-white',
      )}
      title="Presentation mode: show the model off to a client"
      aria-pressed={active}
    >
      <Presentation size={16} />
      {!compact && <span>Present</span>}
    </button>
  );
}

function closePresentation() {
  presentation.reset(false);
}

const CUT_MODES: { id: CutMode; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'plan', label: 'Plan' },
  { id: 'section-x', label: 'Section ↔' },
  { id: 'section-z', label: 'Section ↕' },
];

/**
 * Presentation mode's floating control strip, over the 3D view. Every effect runs in the
 * browser from the model itself; nothing is sent anywhere unless the designer shares a link.
 */
export default function PresentationPanel() {
  const s = usePresentation();
  const app = useApp();
  const [recording, setRecording] = useState<Recording | null>(null);
  const [showcaseStep, setShowcaseStep] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [open, setOpen] = useState<'explode' | 'cut' | 'stages' | null>(null);
  const abort = useRef<AbortController | null>(null);
  const orbitBefore = useRef<boolean | null>(null);

  const setOrbit = (on: boolean) => {
    if (on && orbitBefore.current === null) orbitBefore.current = app.autoOrbitEnabled;
    app.setAutoOrbitEnabled(on);
  };

  // Leaving presentation mode stops everything and puts the orbit setting back.
  useEffect(() => {
    if (s.active) return;
    abort.current?.abort();
    if (orbitBefore.current !== null) { app.setAutoOrbitEnabled(orbitBefore.current); orbitBefore.current = null; }
    setOpen(null);
  }, [s.active]);

  useEffect(() => {
    if (!s.active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !shareOpen) closePresentation();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s.active, shareOpen]);

  if (!s.active) return null;

  const building = s.storeys > 0;
  const range = cutRange(s);

  const toggleRecord = async () => {
    try {
      if (recording) {
        const blob = await recording.stop();
        setRecording(null);
        downloadBlob(blob, videoFileName(app.currentModelName, recording.mimeType));
      } else {
        setRecording(startRecording());
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const showcase = async (record: boolean) => {
    if (showcaseStep) { abort.current?.abort(); return; }
    const ctrl = new AbortController();
    abort.current = ctrl;
    let rec: Recording | null = null;
    try {
      if (record) rec = startRecording();
      if (rec) setRecording(rec);
      await runShowcase({ frame: () => frameModel(app.shapes), orbit: setOrbit, signal: ctrl.signal }, setShowcaseStep);
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') alert(err instanceof Error ? err.message : String(err));
    } finally {
      setShowcaseStep(null);
      if (rec) {
        const blob = await rec.stop();
        setRecording(null);
        if (!ctrl.signal.aborted) downloadBlob(blob, videoFileName(app.currentModelName, rec.mimeType));
      }
    }
  };

  return (
    <>
      <div
        id="presentation-panel"
        className="fixed left-1/2 -translate-x-1/2 bottom-6 z-[80] max-w-[calc(100vw-16px)]"
        onPointerDown={e => e.stopPropagation()}
      >
        {open === 'stages' && <StageTimeline className="mb-2 mx-auto w-[min(560px,calc(100vw-16px))]" />}
        {open === 'explode' && (
          <Popover title="Exploded view" hint={building ? 'Lift floors and roof apart' : 'Add walls to explode a building'}>
            <Slider label="Spread" value={s.explode} min={0} max={1} step={0.01} onChange={v => presentation.set({ explode: v })} format={v => `${Math.round(v * 100)}%`} />
          </Popover>
        )}
        {open === 'cut' && (
          <Popover title="Cut view" hint="Slice through the building to show inside">
            <div className="flex gap-1 mb-3">
              {CUT_MODES.map(m => (
                <button key={m.id} onClick={() => presentation.set({ cut: m.id })}
                  className={cn('flex-1 px-2 py-1 rounded-md text-xs font-semibold', s.cut === m.id ? 'bg-polyform-blue text-white' : 'bg-white/10 text-white/80 hover:bg-white/20')}>
                  {m.label}
                </button>
              ))}
            </div>
            {s.cut !== 'off' && (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Slider label={s.cut === 'plan' ? 'Height' : 'Position'} value={s.cutAt} min={range[0]} max={range[1]} step={0.01}
                    onChange={v => presentation.set({ cutAt: v })} format={v => `${v.toFixed(2)} m`} />
                </div>
                <IconButton title="Show the other side" active={s.cutFlip} onClick={() => presentation.set({ cutFlip: !s.cutFlip })}>
                  <FlipHorizontal2 size={16} />
                </IconButton>
              </div>
            )}
          </Popover>
        )}

        <div className="flex items-center gap-1 rounded-2xl bg-slate-900/85 backdrop-blur-md px-2 py-2 shadow-2xl border border-white/10 text-white overflow-x-auto">
          <Tool icon={<PenLine size={18} />} label="Stages" active={open === 'stages' || s.stage < 3 || s.dusk} onClick={() => {
            if (open !== 'stages') { setOpen('stages'); if (s.stage >= 3) playStages(); } else { setOpen(null); presentation.set({ stage: 3, stagePlaying: false, dusk: false }); }
          }} disabled={!!showcaseStep} title="Sketch → White model → Detailed → Built, and evening light" />
          <Tool icon={<Hammer size={18} />} label="Build" active={s.buildPlaying} onClick={() => (s.buildPlaying ? presentation.set({ buildPlaying: false, build: 1 }) : playBuild())} disabled={!!showcaseStep} />
          <Tool icon={<Layers size={18} />} label="Explode" active={s.explode > 0 || open === 'explode'} onClick={() => {
            if (open !== 'explode') { setOpen('explode'); if (s.explode === 0) presentation.set({ explode: 1 }); } else { setOpen(null); presentation.set({ explode: 0 }); }
          }} disabled={!!showcaseStep} />
          <Tool icon={<Scissors size={18} />} label="Cut" active={s.cut !== 'off' || open === 'cut'} onClick={() => {
            if (open !== 'cut') { setOpen('cut'); if (s.cut === 'off') presentation.set({ cut: 'plan' }); } else { setOpen(null); presentation.set({ cut: 'off' }); }
          }} disabled={!!showcaseStep} />
          <Tool icon={<ScanEye size={18} />} label="X-ray" active={s.xray} onClick={() => presentation.set({ xray: !s.xray })} disabled={!!showcaseStep} />
          <Tool icon={<RotateCw size={18} />} label="Orbit" active={app.autoOrbitEnabled} onClick={() => setOrbit(!app.autoOrbitEnabled)} disabled={!!showcaseStep} />
          <Divider />
          <Tool icon={showcaseStep ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
            label={showcaseStep ? `${showcaseStep}… (stop)` : 'Showcase'} active={!!showcaseStep} onClick={() => showcase(false)} />
          {recordingSupported() && (
            <Tool
              icon={recording ? <Square size={16} className="fill-red-500 text-red-500" /> : <Circle size={16} className="fill-red-500 text-red-500" />}
              label={recording ? 'Stop & save' : 'Record'}
              active={!!recording}
              onClick={() => (showcaseStep ? abort.current?.abort() : toggleRecord())}
              title={recording ? 'Stop recording and download the video' : 'Record the 3D view to a video file'}
            />
          )}
          {recordingSupported() && !showcaseStep && !recording && (
            <Tool icon={<Sparkles size={16} className="text-red-400" />} label="Record showcase" onClick={() => showcase(true)}
              title={`Plays ${SHOWCASE_STEPS.join(' → ')} and saves it as a video`} />
          )}
          <Divider />
          <Tool icon={<Share2 size={18} />} label="Client page" onClick={() => setShareOpen(true)} />
          <button onClick={closePresentation} className="ml-1 p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10" title="Leave presentation mode (Esc)">
            <X size={18} />
          </button>
        </div>
      </div>
      {(open === 'stages' || showcaseStep === 'Stages') && <StageCaption className="fixed left-6 bottom-28 z-[79]" dark={s.dusk} />}
      {shareOpen && <ShareWithClientDialog onClose={() => setShareOpen(false)} />}
    </>
  );
}

export function cutRange(s: { cut: CutMode; bounds: { min: [number, number, number]; max: [number, number, number] } | null }): [number, number] {
  const b = s.bounds;
  if (!b) return [0, 10];
  const axis = s.cut === 'section-x' ? 0 : s.cut === 'section-z' ? 2 : 1;
  return [+(b.min[axis] - 0.1).toFixed(2), +(b.max[axis] + 0.1).toFixed(2)];
}

export function Tool({ icon, label, active, onClick, disabled, title }: {
  icon: React.ReactNode; label: string; active?: boolean; onClick: () => void; disabled?: boolean; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-pressed={active}
      className={cn(
        'flex flex-col items-center justify-center gap-0.5 min-w-[60px] px-2 py-1.5 rounded-xl text-[11px] font-semibold transition-colors whitespace-nowrap',
        active ? 'bg-polyform-blue text-white' : 'text-white/85 hover:bg-white/10',
        disabled && 'opacity-40 pointer-events-none',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function Divider() {
  return <div className="w-px self-stretch bg-white/15 mx-1" />;
}

export function Popover({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 mx-auto w-[min(360px,calc(100vw-16px))] rounded-2xl bg-slate-900/85 backdrop-blur-md border border-white/10 shadow-2xl p-4 text-white">
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-sm font-bold">{title}</span>
        {hint && <span className="text-[11px] text-white/50">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function Slider({ label, value, min, max, step, onChange, format }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string;
}) {
  return (
    <label className="block">
      <div className="flex justify-between text-[11px] text-white/70 mb-1">
        <span>{label}</span><span className="tabular-nums">{format(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(+e.target.value)}
        className="w-full accent-sky-400" />
    </label>
  );
}

function IconButton({ children, title, active, onClick }: { children: React.ReactNode; title: string; active?: boolean; onClick: () => void }) {
  return (
    <button title={title} onClick={onClick} className={cn('p-2 rounded-lg', active ? 'bg-polyform-blue' : 'bg-white/10 hover:bg-white/20')}>
      {children}
    </button>
  );
}
