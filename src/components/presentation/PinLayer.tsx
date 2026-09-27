import React, { useEffect, useRef } from 'react';
import { hidden, project } from '../../lib/presentation/camera';
import { canvasRef } from '../../lib/presentation/recorder';

export interface Pin {
  id: string;
  position: [number, number, number];
  node: React.ReactNode;
}

/**
 * HTML pins that follow points on the model: moved every frame straight on the DOM (no React
 * re-render), faded when something solid stands in front, and hidden off the 3D view.
 */
export function PinLayer({ pins, hide = false }: { pins: Pin[]; hide?: boolean }) {
  const refs = useRef(new Map<string, HTMLDivElement>());
  const occluded = useRef(new Map<string, boolean>());
  const latest = useRef(pins);
  latest.current = pins;

  useEffect(() => {
    let raf = 0, last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const canvas = canvasRef.current;
      const box = canvas?.getBoundingClientRect();
      const checkOcclusion = now - last > 300;
      if (checkOcclusion) last = now;
      for (const pin of latest.current) {
        const el = refs.current.get(pin.id);
        if (!el) continue;
        const p = hide || !box ? null : project(pin.position);
        const inside = p && box && p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom;
        if (!p || !inside) { el.style.opacity = '0'; el.style.pointerEvents = 'none'; continue; }
        if (checkOcclusion) occluded.current.set(pin.id, hidden(pin.position));
        const behind = occluded.current.get(pin.id);
        el.style.transform = `translate(${p.x}px, ${p.y}px)`;
        el.style.opacity = behind ? '0.35' : '1';
        el.style.pointerEvents = 'auto';
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hide]);

  return (
    <>
      {pins.map(pin => (
        <div
          key={pin.id}
          ref={el => { if (el) refs.current.set(pin.id, el); else refs.current.delete(pin.id); }}
          className="fixed left-0 top-0 z-[5] transition-opacity duration-200"
          style={{ opacity: 0, willChange: 'transform' }}
        >
          {pin.node}
        </div>
      ))}
    </>
  );
}

/** A label callout: a dot on the model and a card above it on a thin leader line. */
export function LabelCallout({ text, detail, serif, onClick, active }: {
  text: string; detail?: string; serif?: string; onClick?: () => void; active?: boolean;
}) {
  return (
    <div className="relative -translate-x-1/2 -translate-y-full flex flex-col items-center pointer-events-auto" onClick={onClick}>
      <div className={`max-w-[220px] rounded-lg px-3 py-1.5 shadow-lg ring-1 ring-black/5 text-left ${active ? 'bg-[#2f3a33] text-white' : 'bg-[#f7f5f0]/95 text-[#2a241e]'} ${onClick ? 'cursor-pointer' : ''}`}>
        <div className="text-[13px] leading-snug" style={serif ? { fontFamily: serif } : undefined}>{text}</div>
        {detail && <div className={`text-[10px] leading-snug ${active ? 'text-white/70' : 'text-[#8b8177]'}`}>{detail}</div>}
      </div>
      <div className="w-px h-6 bg-[#2a241e]/50" />
      <div className="w-2.5 h-2.5 -mb-[5px] rounded-full bg-[#b4553a] ring-2 ring-white" />
    </div>
  );
}
