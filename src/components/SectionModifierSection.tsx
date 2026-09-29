import React from 'react';
import { useApp } from '../AppContext';
import { cn } from '../lib/utils';
import { actionLabel } from '../lib/macroRecorder';
import { isSectionShape, type SectionArgs } from '../tools/sectionPlanes';

/**
 * Section tool modifiers: whether the orange plane is drawn, and the colour and opacity of the
 * edge lines on the cut-away side (the see-through "x-ray" lines). The settings apply to every
 * section plane in the model, so they read the same whichever plane is cutting.
 */
export const SectionModifierSection: React.FC<{ idPrefix?: string; className?: string }> = ({ idPrefix = 'section', className }) => {
  const { shapes, setShapes, recordAction, edgeLinesColor, edgeLinesOpacity } = useApp();
  const planes = shapes.filter(isSectionShape);
  const lead = (planes.find(s => (s.args as SectionArgs).active) ?? planes[0])?.args as SectionArgs | undefined;

  const showPlane = lead?.showPlane !== false;
  const color = lead?.xrayColor ?? edgeLinesColor;
  const opacity = lead?.xrayOpacity ?? edgeLinesOpacity;

  const set = (what: string, patch: Partial<SectionArgs>) => {
    setShapes(prev => prev.map(s => (isSectionShape(s) ? { ...s, args: { ...(s.args as SectionArgs), ...patch } } : s)));
    recordAction(actionLabel(what));
  };

  // With no plane yet, the Section tool panel above already says how to place one.
  if (!lead) return null;

  return (
    <div className={cn('space-y-3 px-1 py-1', className)}>
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-[10px] font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Show section plane</span>
          <span className="text-[9px] text-gray-400">The orange square. It still cuts when hidden.</span>
        </div>
        <button
          id={`${idPrefix}-toggle-plane`}
          onClick={() => set(showPlane ? 'Hide section plane' : 'Show section plane', { showPlane: !showPlane })}
          className={cn('w-8 h-4 rounded-full relative transition-colors cursor-pointer', showPlane ? 'bg-polyform-blue' : 'bg-gray-300 dark:bg-gray-600')}
          title={showPlane ? 'Hide the section plane' : 'Show the section plane'}
        >
          <div className={cn('absolute top-0.5 w-3 h-3 bg-white rounded-full shadow-sm transition-all', showPlane ? 'left-4.5' : 'left-0.5')} />
        </button>
      </div>

      <div className="space-y-2 pt-1 border-t border-gray-200/60 dark:border-gray-700/60">
        <div className="flex flex-col pt-2">
          <span className="text-[10px] font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">X-ray lines</span>
          <span className="text-[9px] text-gray-400">The lines on the cut-away side of the plane.</span>
        </div>
        <div className="flex items-center justify-between">
          <label htmlFor={`${idPrefix}-xray-color`} className="text-[10px] font-bold text-gray-400 uppercase">Colour</label>
          <input
            id={`${idPrefix}-xray-color`}
            type="color"
            value={color}
            onChange={e => set('Set section line colour', { xrayColor: e.target.value })}
            className="w-6 h-6 rounded cursor-pointer border-none p-0"
          />
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label htmlFor={`${idPrefix}-xray-opacity`} className="text-[10px] font-bold text-gray-400 uppercase">Opacity</label>
            <span className="text-[10px] text-gray-400">{Math.round(opacity * 100)}%</span>
          </div>
          <input
            id={`${idPrefix}-xray-opacity`}
            type="range" min="0" max="1" step="0.05"
            value={opacity}
            onChange={e => set('Set section line opacity', { xrayOpacity: parseFloat(e.target.value) })}
            className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-polyform-blue"
          />
        </div>
        {(lead.xrayColor !== undefined || lead.xrayOpacity !== undefined) && (
          <button
            className="text-[10px] text-polyform-blue hover:underline cursor-pointer"
            onClick={() => set('Reset section line style', { xrayColor: undefined, xrayOpacity: undefined })}
          >
            Match edge-line style
          </button>
        )}
      </div>
    </div>
  );
};
