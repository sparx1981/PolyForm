import { useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import type { Shape, TextData } from '../types';
import { editTextShape } from '../lib/textShapes';
import { actionLabel } from '../lib/macroRecorder';

// Entity Info fields for a text object: its words, letter height, depth (3D text), weight and
// alignment. Each change is one undo step and is recorded as sdk.text.edit.

const toMetres = (v: number, unit: 'm' | 'cm' | 'mm') => (unit === 'mm' ? v / 1000 : unit === 'cm' ? v / 100 : v);
const fromMetres = (v: number, unit: 'm' | 'cm' | 'mm') => +(unit === 'mm' ? v * 1000 : unit === 'cm' ? v * 100 : v).toFixed(3);

export function TextEntityFields({ shape }: { shape: Shape }) {
  const { setShapes, commitHistory, recordAction, unit } = useApp();
  const data = shape.textData!;
  const [text, setText] = useState(data.text);
  const [size, setSize] = useState(String(fromMetres(data.size, unit)));
  const [depth, setDepth] = useState(String(fromMetres(data.depth ?? 0.1, unit)));
  useEffect(() => {
    setText(data.text);
    setSize(String(fromMetres(data.size, unit)));
    setDepth(String(fromMetres(data.depth ?? 0.1, unit)));
  }, [shape.id, data.text, data.size, data.depth, unit]);

  const apply = (changes: Partial<TextData>) => {
    let edited: Shape;
    try {
      edited = editTextShape(shape, changes);
    } catch {
      setText(data.text);
      return;
    }
    if (JSON.stringify(edited.textData) === JSON.stringify(shape.textData)) return;
    setShapes(prev => prev.map(s => (s.id === shape.id ? edited : s)));
    commitHistory();
    recordAction(actionLabel(`Edit ${edited.name}`), { sdk: `sdk.text.edit(${JSON.stringify(shape.id)}, ${JSON.stringify(changes)});` });
  };
  const number = (value: string, fallback: number) => {
    const n = toMetres(parseFloat(value), unit);
    return n > 0 ? n : fallback;
  };

  const field = 'w-full px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-polyform-blue';
  const label = 'text-[9px] font-bold text-gray-400 uppercase tracking-wider';
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <label className={label}>Text</label>
        <input value={text} onChange={e => setText(e.target.value)} onBlur={() => apply({ text })}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} className={field} />
      </div>
      <div className="flex gap-2">
        <div className="flex-1 space-y-1">
          <label className={label}>Letter height ({unit})</label>
          <input inputMode="decimal" value={size} onChange={e => setSize(e.target.value)}
            onBlur={() => apply({ size: number(size, data.size) })}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} className={field} />
        </div>
        {shape.type === 'text3d' && (
          <div className="flex-1 space-y-1">
            <label className={label}>Depth ({unit})</label>
            <input inputMode="decimal" value={depth} onChange={e => setDepth(e.target.value)}
              onBlur={() => apply({ depth: number(depth, data.depth ?? 0.1) })}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} className={field} />
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={!!data.bold} onChange={e => apply({ bold: e.target.checked })} /> Bold
        </label>
        <select value={data.align} onChange={e => apply({ align: e.target.value as TextData['align'] })}
          className="px-1 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-transparent" aria-label="Alignment">
          <option value="left">Left</option>
          <option value="center">Centre</option>
          <option value="right">Right</option>
        </select>
      </div>
    </div>
  );
}
