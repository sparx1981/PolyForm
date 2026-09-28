import { useState } from 'react';
import { useApp } from '../AppContext';
import type { Shape } from '../types';
import { actionLabel } from '../lib/macroRecorder';
import { flipSection, isSectionShape, moveSection, type SectionArgs } from '../tools/sectionPlanes';
import { parseTypedLength } from '../tools/typedEntry';

// Entity Info for a section plane: turn its cut on or off (one plane cuts at a time), flip
// which side is cut away, or move it a typed distance along its direction. Each change is one
// undo step. Dragging the plane with the Section tool moves it too.

export function SectionPlaneFields({ shape }: { shape: Shape }) {
  const { setShapes, recordAction, unit } = useApp();
  const args = shape.args as SectionArgs;
  const [distance, setDistance] = useState('');
  const field = 'w-full px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-polyform-blue';
  const label = 'text-[9px] font-bold text-gray-400 uppercase tracking-wider';
  const button = 'flex-1 text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 hover:border-polyform-blue transition-colors';

  const change = (what: string, update: (s: Shape) => Shape) => {
    setShapes(prev => prev.map(update)); // one undo step
    recordAction(actionLabel(what));
  };

  const setActive = (active: boolean) => change(active ? 'Turn section on' : 'Turn section off', s => {
    if (s.id === shape.id) return { ...s, args: { ...args, active } };
    // Turning one on turns the others off.
    if (active && isSectionShape(s) && (s.args as SectionArgs).active) return { ...s, args: { ...(s.args as SectionArgs), active: false } };
    return s;
  });

  const move = () => {
    const d = parseTypedLength(distance, unit);
    if (d === null) return;
    const moved = moveSection(args, d);
    change('Move section plane', s => (s.id === shape.id ? { ...s, args: moved, position: moved.point } : s));
    setDistance('');
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className={label}>Cutting</span>
        <button
          onClick={() => setActive(!args.active)}
          className={`w-8 h-4 rounded-full relative transition-colors ${args.active ? 'bg-polyform-blue' : 'bg-gray-300'}`}
          title={args.active ? 'Stop this plane cutting the model' : 'Cut the model with this plane (others stop cutting)'}
        >
          <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all ${args.active ? 'left-4.5' : 'left-0.5'}`} />
        </button>
      </div>
      <div className="flex gap-2">
        <button className={button} onClick={() => change('Flip section plane', s => (s.id === shape.id ? { ...s, args: flipSection(args) } : s))}
          title="Cut away the other side">
          Flip
        </button>
      </div>
      <div className="space-y-1">
        <label className={label}>Move along its direction</label>
        <div className="flex gap-2">
          <input value={distance} onChange={e => setDistance(e.target.value)} placeholder="e.g. 1.2 or -300mm"
            onKeyDown={e => { if (e.key === 'Enter') move(); }} className={field} />
          <button className={button} onClick={move}>Move</button>
        </div>
      </div>
    </div>
  );
}
