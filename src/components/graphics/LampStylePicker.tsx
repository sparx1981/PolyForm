import React from 'react';
import { X } from 'lucide-react';
import { LAMP_STYLES } from '../../lib/lampStyles';
import { LampStyleThumbnail } from './LampStyleThumbnail';
import type { Shape } from '../../types';

export function LampStylePicker({ isOpen, targetShape, onClose, onApplyStyle, theme = 'light' }: {
  isOpen: boolean; targetShape: Shape | null; onClose: () => void; onApplyStyle: (styleId: string) => void; theme?: 'light' | 'dark';
}) {
  if (!isOpen || !targetShape) return null;
  const currentStyleId = targetShape.archStyle || 'classic';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className={`w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-lg shadow-xl p-4 space-y-4 ${theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">Street Light Style</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700">
            <X size={16} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {LAMP_STYLES.map(style => {
            const active = currentStyleId === style.id;
            return (
              <button
                key={style.id}
                onClick={() => { onApplyStyle(style.id); onClose(); }}
                title={style.description}
                className={`flex flex-col items-center gap-2 p-2 rounded-lg border text-left transition-colors ${
                  active ? 'border-trimble-blue ring-1 ring-trimble-blue bg-trimble-blue/5' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
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
