import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react';
import { cancelFlight, flyTo } from '../../lib/presentation/camera';
import { canvasRef } from '../../lib/presentation/recorder';
import type { TourStop } from '../../types';
import { SERIF } from './StageTimeline';

const HOLD_SECONDS = 6;

/**
 * The client's guided tour: the camera glides from stop to stop, each with the designer's
 * caption. Next / Back step through; Play moves on by itself. Grabbing the view pauses it.
 */
export function TourPlayer({ stops, onClose, className }: { stops: TourStop[]; onClose: () => void; className?: string }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const stop = stops[Math.min(i, stops.length - 1)];
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!stop) return;
    let live = true;
    flyTo(stop.position, stop.target, 1.8).then(() => {
      if (!live || !playing) return;
      timer.current = window.setTimeout(() => {
        if (i + 1 < stops.length) setI(i + 1);
        else setPlaying(false);
      }, HOLD_SECONDS * 1000);
    });
    return () => {
      live = false;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [i, playing, stop?.id]);

  // Taking hold of the view pauses the tour.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const grab = () => { cancelFlight(); setPlaying(false); };
    canvas.addEventListener('pointerdown', grab);
    canvas.addEventListener('wheel', grab, { passive: true });
    return () => { canvas.removeEventListener('pointerdown', grab); canvas.removeEventListener('wheel', grab); };
  }, []);

  useEffect(() => () => cancelFlight(), []);

  if (!stop) return null;
  return (
    <div className={`w-[min(340px,calc(100%-32px))] rounded-2xl bg-[#f7f5f0]/92 backdrop-blur-md shadow-xl ring-1 ring-black/5 p-4 text-[#2a241e] ${className ?? ''}`}
      onPointerDown={e => e.stopPropagation()} role="region" aria-label="Guided tour">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] tracking-[0.2em] uppercase text-[#8b8177]">Guided tour · {i + 1} / {stops.length}</span>
        <button onClick={onClose} className="p-1 -m-1 rounded text-[#8b8177] hover:text-[#2a241e]" aria-label="End the tour"><X size={15} /></button>
      </div>
      <h3 className="mt-1 text-xl leading-tight" style={{ fontFamily: SERIF }}>{stop.title}</h3>
      {stop.caption && <p className="mt-1.5 text-sm text-[#4a4239] leading-relaxed whitespace-pre-line">{stop.caption}</p>}
      <div className="mt-3 flex items-center gap-2">
        <button onClick={() => { setPlaying(false); setI(Math.max(0, i - 1)); }} disabled={i === 0}
          className="p-1.5 rounded-full ring-1 ring-black/10 disabled:opacity-30" aria-label="Previous stop"><ChevronLeft size={16} /></button>
        <button onClick={() => { if (!playing && i === stops.length - 1) setI(0); setPlaying(!playing); }}
          className="px-3 py-1.5 rounded-full bg-[#2f3a33] text-white text-xs font-semibold flex items-center gap-1.5">
          {playing ? <Pause size={13} /> : <Play size={13} />}{playing ? 'Pause' : 'Play'}
        </button>
        <button onClick={() => { setPlaying(false); setI(Math.min(stops.length - 1, i + 1)); }} disabled={i === stops.length - 1}
          className="p-1.5 rounded-full ring-1 ring-black/10 disabled:opacity-30" aria-label="Next stop"><ChevronRight size={16} /></button>
        <div className="flex-1 flex gap-1 justify-end">
          {stops.map((s, n) => (
            <button key={s.id} onClick={() => { setPlaying(false); setI(n); }} aria-label={`Stop ${n + 1}: ${s.title}`}
              className={`h-1.5 rounded-full transition-all ${n === i ? 'w-5 bg-[#b4553a]' : 'w-1.5 bg-[#cfc7bb]'}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
