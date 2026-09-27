import React, { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Crosshair, ChevronUp, ChevronDown, Eye, Camera } from 'lucide-react';
import { useApp } from '../../AppContext';
import { cn } from '../../lib/utils';
import { currentView, flyTo, pickPoint } from '../../lib/presentation/camera';
import { canvasRef } from '../../lib/presentation/recorder';
import { newContentId } from '../../lib/presentation/content';
import type { PresentationContent, PresentationLabel, TourStop } from '../../types';
import { Popover } from './PresentationPanel';

const field = 'w-full min-w-0 rounded-md bg-white/10 px-2 py-1 text-xs text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-sky-400';

/**
 * While `active`, the next click on the model (not a drag) reports the point clicked; nothing
 * else in the editor sees that click.
 */
/** A press on the 3D view itself or on a caption over it - not on a button, field or panel. */
function overModel(e: PointerEvent): boolean {
  const canvas = canvasRef.current;
  if (!canvas) return false;
  const r = canvas.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return false;
  const t = e.target as Element | null;
  return t === canvas || !t?.closest?.('button, a, input, textarea, select, [role="slider"], [role="dialog"], #presentation-panel');
}

export function usePickOnModel(active: boolean, onPick: (point: [number, number, number]) => void, onCancel?: () => void) {
  const pick = useRef(onPick);
  pick.current = onPick;
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  useEffect(() => {
    if (!active) return;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !overModel(e)) return;
      down = { x: e.clientX, y: e.clientY };
      e.stopImmediatePropagation();
    };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      e.stopImmediatePropagation();
      if (moved > 6) return;
      const p = pickPoint(e.clientX, e.clientY);
      if (p) pick.current(p);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      cancel.current?.();
    };
    window.addEventListener('keydown', onKey, true);
    const canvas = canvasRef.current;
    const prev = canvas?.style.cursor;
    if (canvas) canvas.style.cursor = 'crosshair';
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('keydown', onKey, true);
      if (canvas) canvas.style.cursor = prev ?? '';
    };
  }, [active]);
}

function useContent() {
  const { presentationContent, setPresentationContent } = useApp();
  const update = (fn: (c: PresentationContent) => PresentationContent) => setPresentationContent(prev => fn(prev));
  return { content: presentationContent, update };
}

export function LabelsEditor() {
  const { content, update } = useContent();
  const [placing, setPlacing] = useState<string | null>(null);

  usePickOnModel(placing !== null, point => {
    const id = placing!;
    update(c => {
      const exists = c.labels.some(l => l.id === id);
      const label: PresentationLabel = { id, text: 'New label', position: point };
      return { ...c, labels: exists ? c.labels.map(l => (l.id === id ? { ...l, position: point } : l)) : [...c.labels, label] };
    });
    setPlacing(null);
  }, () => setPlacing(null));

  const set = (id: string, patch: Partial<PresentationLabel>) =>
    update(c => ({ ...c, labels: c.labels.map(l => (l.id === id ? { ...l, ...patch } : l)) }));

  return (
    <Popover title="Labels" hint={placing ? 'Click the model to place it (Esc to cancel)' : 'Pinned notes the client sees in 3D'}>
      <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
        {content.labels.length === 0 && <p className="text-xs text-white/60">No labels yet. Add one, then click where it belongs on the model.</p>}
        {content.labels.map(l => (
          <div key={l.id} className="rounded-lg bg-white/5 p-2 space-y-1">
            <div className="flex gap-1">
              <input value={l.text} onChange={e => set(l.id, { text: e.target.value.slice(0, 80) })} className={field} placeholder="Label" aria-label="Label text" />
              <button title="Move: click a new spot on the model" onClick={() => setPlacing(l.id)}
                className={cn('p-1.5 rounded-md', placing === l.id ? 'bg-sky-500' : 'bg-white/10 hover:bg-white/20')}><Crosshair size={13} /></button>
              <button title="Delete" onClick={() => update(c => ({ ...c, labels: c.labels.filter(x => x.id !== l.id) }))}
                className="p-1.5 rounded-md bg-white/10 hover:bg-red-500/70"><Trash2 size={13} /></button>
            </div>
            <input value={l.detail ?? ''} onChange={e => set(l.id, { detail: e.target.value.slice(0, 120) || undefined })} className={field} placeholder="Detail (optional)" aria-label="Label detail" />
          </div>
        ))}
      </div>
      <button onClick={() => setPlacing(placing ? null : newContentId())}
        className={cn('mt-3 w-full flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold', placing ? 'bg-sky-500' : 'bg-white/10 hover:bg-white/20')}>
        <Plus size={14} /> {placing ? 'Click the model… (cancel)' : 'Add label'}
      </button>
    </Popover>
  );
}

export function TourEditor() {
  const { content, update } = useContent();
  const set = (id: string, patch: Partial<TourStop>) =>
    update(c => ({ ...c, tour: c.tour.map(t => (t.id === id ? { ...t, ...patch } : t)) }));
  const move = (i: number, d: number) => update(c => {
    const tour = [...c.tour];
    const j = i + d;
    if (j < 0 || j >= tour.length) return c;
    [tour[i], tour[j]] = [tour[j], tour[i]];
    return { ...c, tour };
  });
  const add = () => {
    const v = currentView();
    if (!v) return;
    update(c => ({ ...c, tour: [...c.tour, { id: newContentId(), title: `Stop ${c.tour.length + 1}`, ...v }] }));
  };

  return (
    <Popover title="Guided tour" hint="Frame a view, then add it as a stop">
      <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
        {content.tour.length === 0 && <p className="text-xs text-white/60">No stops yet. Move the camera to a view you like and press "Add this view".</p>}
        {content.tour.map((t, i) => (
          <div key={t.id} className="rounded-lg bg-white/5 p-2 space-y-1">
            <div className="flex gap-1 items-center">
              <span className="text-[10px] text-white/50 w-4 text-right">{i + 1}</span>
              <input value={t.title} onChange={e => set(t.id, { title: e.target.value.slice(0, 60) })} className={field} aria-label="Stop title" />
              <button title="Show this view" onClick={() => flyTo(t.position, t.target)} className="p-1.5 rounded-md bg-white/10 hover:bg-white/20"><Eye size={13} /></button>
              <button title="Replace with the current view" onClick={() => { const v = currentView(); if (v) set(t.id, v); }} className="p-1.5 rounded-md bg-white/10 hover:bg-white/20"><Camera size={13} /></button>
              <button title="Earlier" onClick={() => move(i, -1)} className="p-1 rounded-md bg-white/10 hover:bg-white/20"><ChevronUp size={13} /></button>
              <button title="Later" onClick={() => move(i, 1)} className="p-1 rounded-md bg-white/10 hover:bg-white/20"><ChevronDown size={13} /></button>
              <button title="Delete" onClick={() => update(c => ({ ...c, tour: c.tour.filter(x => x.id !== t.id) }))} className="p-1.5 rounded-md bg-white/10 hover:bg-red-500/70"><Trash2 size={13} /></button>
            </div>
            <textarea value={t.caption ?? ''} rows={2} onChange={e => set(t.id, { caption: e.target.value.slice(0, 400) || undefined })}
              className={cn(field, 'resize-none')} placeholder="What the client should notice here (optional)" aria-label="Stop caption" />
          </div>
        ))}
      </div>
      <button onClick={add} className="mt-3 w-full flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold bg-white/10 hover:bg-white/20">
        <Plus size={14} /> Add this view
      </button>
    </Popover>
  );
}
