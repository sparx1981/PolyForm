import React, { useState } from 'react';
import { cn } from '../lib/utils';
import { FINISH_FAMILIES, PLAIN_FINISHES, type FinishFamily, type PlainFinish } from '../lib/materials/plainFinishes';

/** A swatch that hints at the finish: a highlight for shiny ones, a checker behind see-through ones. */
function Swatch({ finish }: { finish: PlainFinish }) {
  const shine = 1 - finish.roughness;
  const background = finish.opacity < 1
    ? `linear-gradient(${finish.color}${Math.round(finish.opacity * 255).toString(16).padStart(2, '0')}, ${finish.color}${Math.round(finish.opacity * 255).toString(16).padStart(2, '0')}), repeating-conic-gradient(#cbd5e1 0% 25%, #f8fafc 0% 50%) 50% / 10px 10px`
    : finish.color;
  return (
    <span className="relative block aspect-square w-full overflow-hidden rounded-sm" style={{ background }}>
      <span className="absolute inset-0" style={{
        background: `radial-gradient(circle at 30% 25%, rgba(255,255,255,${0.15 + shine * 0.6}) 0%, rgba(255,255,255,0) ${25 + finish.roughness * 45}%)`,
      }} />
      {finish.metalness > 0.5 && (
        <span className="absolute inset-0" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,0.35), rgba(0,0,0,0.25))' }} />
      )}
    </span>
  );
}

/** Plain PBR finishes (plastics, metals, glass and others) for the paint tool. */
export function PlainFinishPicker({ onPick, activeColor }: { onPick: (finish: PlainFinish) => void; activeColor: string }) {
  const [family, setFamily] = useState<FinishFamily>('plastic');
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Plain finishes</span>
      </div>
      <div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
        {FINISH_FAMILIES.map(f => (
          <button key={f.id} type="button" onClick={() => setFamily(f.id)}
            className={cn('flex-1 rounded-md py-1 text-[10px] font-semibold transition-colors',
              family === f.id ? 'bg-white text-polyform-blue shadow-sm dark:bg-gray-700' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400')}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-6 gap-1.5">
        {PLAIN_FINISHES[family].map(finish => (
          <button key={finish.id} type="button" title={finish.name}
            onClick={() => { setPicked(finish.id); onPick(finish); }}
            className={cn('rounded-sm border p-0 transition-transform hover:scale-110',
              picked === finish.id && activeColor === finish.color ? 'border-polyform-blue ring-1 ring-polyform-blue' : 'border-gray-300 dark:border-gray-600')}>
            <Swatch finish={finish} />
          </button>
        ))}
      </div>
    </div>
  );
}
