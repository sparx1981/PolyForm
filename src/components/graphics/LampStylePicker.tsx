import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { LAMP_STYLES, findLampStyle, type LampStyleDef } from '../../lib/lampStyles';
import { LampStyleThumbnail } from './LampStyleThumbnail';
import type { Shape } from '../../types';

type Category = LampStyleDef['category'];

export function LampStylePicker({ isOpen, targetShape, onClose, onApplyStyle, theme = 'light' }: {
  isOpen: boolean; targetShape: Shape | null; onClose: () => void; onApplyStyle: (styleId: string) => void; theme?: 'light' | 'dark';
}) {
  const currentStyleId = targetShape?.archStyle || 'classic';
  // Defaults to whichever category the shape's current style belongs to, so
  // reopening the picker on an existing fixture starts on the relevant tab
  // instead of always resetting to exterior.
  const [category, setCategory] = useState<Category>(() => findLampStyle(currentStyleId).category);
  useEffect(() => { if (isOpen) setCategory(findLampStyle(currentStyleId).category); }, [isOpen, currentStyleId]);

  if (!isOpen || !targetShape) return null;
  const visibleStyles = LAMP_STYLES.filter(s => s.category === category);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className={`w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-lg shadow-xl p-4 space-y-4 ${theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">Light Fixture Style</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700">
            <X size={16} />
          </button>
        </div>

        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700" role="tablist">
          {([['exterior', 'Exterior'], ['interior', 'Interior']] as [Category, string][]).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={category === key}
              onClick={() => setCategory(key)}
              className={`px-3 py-1.5 text-xs font-bold -mb-px border-b-2 transition-colors ${
                category === key ? 'border-polyform-blue text-polyform-blue' : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3">
          {visibleStyles.map(style => {
            const active = currentStyleId === style.id;
            return (
              <button
                key={style.id}
                onClick={() => { onApplyStyle(style.id); onClose(); }}
                title={style.description}
                className={`flex flex-col items-center gap-2 p-2 rounded-lg border text-left transition-colors ${
                  active ? 'border-polyform-blue ring-1 ring-polyform-blue bg-polyform-blue/5' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                }`}
              >
                <LampStyleThumbnail styleId={style.id} size={110} />
                <div>
                  <div className="text-xs font-bold">{style.name}</div>
                  <div className="text-[10px] text-gray-500 leading-snug">{style.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
