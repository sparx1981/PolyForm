import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../AppContext';

const SAMPLE_INTERVAL_MS = 250;

/** Scene Helpers debug overlay: current/min/max FPS, sampled from the render loop's own rAF cadence. */
export default function FpsCounter() {
  const { fpsCounterEnabled } = useApp();
  const [stats, setStats] = useState({ current: 0, min: 0, max: 0 });
  const frameCountRef = useRef(0);
  const lastSampleRef = useRef(0);
  const minRef = useRef(Infinity);
  const maxRef = useRef(0);

  useEffect(() => {
    if (!fpsCounterEnabled) return;
    frameCountRef.current = 0;
    lastSampleRef.current = performance.now();
    minRef.current = Infinity;
    maxRef.current = 0;
    setStats({ current: 0, min: 0, max: 0 });

    let rafId: number;
    const tick = (now: number) => {
      frameCountRef.current += 1;
      const elapsed = now - lastSampleRef.current;
      if (elapsed >= SAMPLE_INTERVAL_MS) {
        const fps = Math.round((frameCountRef.current * 1000) / elapsed);
        frameCountRef.current = 0;
        lastSampleRef.current = now;
        minRef.current = Math.min(minRef.current, fps);
        maxRef.current = Math.max(maxRef.current, fps);
        setStats({ current: fps, min: minRef.current, max: maxRef.current });
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [fpsCounterEnabled]);

  if (!fpsCounterEnabled) return null;

  return (
    <div className="fixed bottom-12 left-4 z-[60] pointer-events-none select-none">
      <div className="bg-gray-900/85 text-white text-[11px] font-mono rounded-lg shadow-xl border border-gray-700 px-2.5 py-1.5 flex gap-3">
        <span>FPS <span className="font-bold text-emerald-400">{stats.current}</span></span>
        <span>Min <span className="font-bold text-amber-400">{stats.min}</span></span>
        <span>Max <span className="font-bold text-sky-400">{stats.max}</span></span>
      </div>
    </div>
  );
}
