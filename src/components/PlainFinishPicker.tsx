import React from 'react';
import { type PlainFinish } from '../lib/materials/plainFinishes';

/** A swatch that hints at the finish: a highlight for shiny ones, a checker behind see-through ones. */
export function FinishSwatch({ finish }: { finish: PlainFinish }) {
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
