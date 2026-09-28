import React, { useRef } from 'react';
import { Pause, Play, Sun, Moon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { playStages, presentation, STAGES, usePresentation } from '../../lib/presentation/store';

export const SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif";

/**
 * The stage timeline: Sketch → Massing → Detailed → Built. Drag or click to scrub, or press play
 * to watch the design come to life. Styled as a frosted card to sit over the 3D view.
 */
export function StageTimeline({ className }: { className?: string }) {
  const s = usePresentation();
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const scrub = (clientX: number) => {
    const el = track.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width)));
    presentation.set({ stage: t * 3, stagePlaying: false, build: 1, buildPlaying: false });
  };

  const current = Math.min(3, Math.max(0, Math.round(s.stage)));
  return (
    <div className={cn('rounded-2xl bg-[#f7f5f0]/90 backdrop-blur-md shadow-xl ring-1 ring-black/5 px-4 py-3 text-[#3a342d]', className)}
      onPointerDown={e => e.stopPropagation()}>
      <div className="flex items-center gap-4">
        <button
          onClick={() => (s.stagePlaying ? presentation.set({ stagePlaying: false }) : s.stage >= 2.99 ? playStages() : presentation.set({ stagePlaying: true }))}
          className="shrink-0 w-9 h-9 rounded-full bg-[#2f3a33] text-white flex items-center justify-center hover:bg-[#1f2722]"
          aria-label={s.stagePlaying ? 'Pause' : 'Play from sketch to built'}
          title={s.stagePlaying ? 'Pause' : 'Play from sketch to built'}
        >
          {s.stagePlaying ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="grid grid-cols-4 gap-2">
            {STAGES.map((st, i) => (
              <button key={st.n} onClick={() => presentation.set({ stage: i, stagePlaying: false, build: 1, buildPlaying: false })}
                className={cn('text-left min-w-0', i === current ? 'text-[#2a241e]' : 'text-[#8b8177] hover:text-[#4a4239]')}>
                <span className="block text-[9px] tracking-widest">{st.n}</span>
                <span className={cn('block text-[11px] sm:text-xs truncate', i === current && 'font-semibold')}>{st.name}</span>
              </button>
            ))}
          </div>
          <div
            ref={track}
            className="relative mt-2 h-4 cursor-pointer touch-none"
            onPointerDown={e => { dragging.current = true; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); scrub(e.clientX); }}
            onPointerMove={e => { if (dragging.current) scrub(e.clientX); }}
            onPointerUp={() => { dragging.current = false; }}
            onPointerCancel={() => { dragging.current = false; }}
            onLostPointerCapture={() => { dragging.current = false; }}
            role="slider"
            aria-label="Design stage"
            aria-valuemin={0}
            aria-valuemax={3}
            aria-valuenow={Number(s.stage.toFixed(2))}
            aria-valuetext={STAGES[current].name}
            tabIndex={0}
            onKeyDown={e => {
              if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) e.preventDefault();
              if (e.key === 'Home') presentation.set({ stage: 0, stagePlaying: false });
              if (e.key === 'End') presentation.set({ stage: 3, stagePlaying: false });
              if (e.key === 'ArrowRight') presentation.set({ stage: Math.min(3, s.stage + 0.1), stagePlaying: false });
              if (e.key === 'ArrowLeft') presentation.set({ stage: Math.max(0, s.stage - 0.1), stagePlaying: false });
            }}
          >
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px bg-[#cfc7bb]" />
            <div className="absolute left-0 top-1/2 -translate-y-1/2 h-px bg-[#b4553a]" style={{ width: `${(s.stage / 3) * 100}%` }} />
            <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-[#b4553a] ring-2 ring-[#f7f5f0]"
              style={{ left: `${(s.stage / 3) * 100}%` }} />
          </div>
        </div>
        <button
          onClick={() => presentation.set({ dusk: !s.dusk })}
          className={cn('shrink-0 w-9 h-9 rounded-full flex items-center justify-center', s.dusk ? 'bg-[#2f3a55] text-amber-200' : 'bg-white ring-1 ring-black/10 text-[#b4553a]')}
          aria-pressed={s.dusk}
          title={s.dusk ? 'Back to daylight' : 'Evening light'}
        >
          {s.dusk ? <Moon size={15} /> : <Sun size={15} />}
        </button>
      </div>
      <p className="mt-2 text-[10px] text-[#70675e]">Line drawing → white volumes → glass, structure and fittings → finished materials. Use Build for construction order.</p>
    </div>
  );
}

/** The big stage number and caption, bottom left of the 3D view, as in an architectural study. */
export function StageCaption({ className, dark }: { className?: string; dark?: boolean }) {
  const s = usePresentation();
  const i = Math.min(3, Math.max(0, Math.round(s.stage)));
  const st = STAGES[i];
  return (
    <div className={cn('pointer-events-none select-none flex items-end gap-3', className)} aria-live="polite">
      <span className={cn('text-3xl sm:text-4xl italic leading-none', dark ? 'text-amber-200/90' : 'text-[#b4553a]')} style={{ fontFamily: SERIF }}>{st.n}</span>
      <span className={cn('pb-0.5', dark ? 'text-white/85' : 'text-[#3a342d]')}>
        <span className="block text-xs sm:text-sm">{st.caption}</span>
        <span className={cn('block text-[10px] tracking-wide', dark ? 'text-white/60' : 'text-[#8b8177]')}>{st.detail}</span>
      </span>
    </div>
  );
}
