import { useEffect, useRef, useState } from 'react';
import { Type } from 'lucide-react';
import { useApp } from '../AppContext';
import { buildTextShape, TEXT_DEFAULTS } from '../lib/textShapes';
import { setTextPlacement, useTextPlacement } from '../lib/textPlacement';
import { actionLabel } from '../lib/macroRecorder';

// Asks for the words (and size) after a click with the Text or 3D Text tool, then places them.

const toMetres = (value: number, unit: 'm' | 'cm' | 'mm') => (unit === 'mm' ? value / 1000 : unit === 'cm' ? value / 100 : value);
const fromMetres = (value: number, unit: 'm' | 'cm' | 'mm') => (unit === 'mm' ? value * 1000 : unit === 'cm' ? value * 100 : value);

export function TextPlacementDialog() {
  const placement = useTextPlacement();
  const { addShape, commitHistory, recordAction, setSelectedId, setSelectedIds, unit, setMeasurements } = useApp();
  const kind = placement?.kind ?? 'text';
  const [text, setText] = useState('');
  const [size, setSize] = useState('');
  const [depth, setDepth] = useState('');
  const [bold, setBold] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fresh defaults each time the dialog opens, in the display unit.
  useEffect(() => {
    if (!placement) return;
    setText('');
    setSize(String(+fromMetres(TEXT_DEFAULTS[placement.kind].size, unit).toFixed(3)));
    setDepth(String(+fromMetres(TEXT_DEFAULTS.text3d.depth, unit).toFixed(3)));
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [placement, unit]);

  if (!placement) return null;
  const close = () => setTextPlacement(null);

  const place = () => {
    const words = text.trim();
    const sizeM = toMetres(parseFloat(size), unit);
    const depthM = toMetres(parseFloat(depth), unit);
    if (!words) return;
    if (!(sizeM > 0) || (kind === 'text3d' && !(depthM > 0))) {
      setMeasurements('Enter a size (and, for 3D text, a depth) greater than 0.');
      return;
    }
    const options = {
      text: words, position: placement.point, normal: placement.normal, towardsViewer: placement.towardsViewer,
      size: sizeM, bold, ...(kind === 'text3d' ? { depth: depthM } : {}),
    };
    const shape = buildTextShape(kind, options);
    addShape(shape);
    commitHistory();
    recordAction(actionLabel(`Add ${shape.name}`), {
      sdk: `sdk.text.${kind === 'text3d' ? 'add3D' : 'add'}(${JSON.stringify({ ...options, id: shape.id, quaternion: shape.quaternion, position: shape.position, normal: undefined, towardsViewer: undefined })});`,
    });
    setSelectedId(shape.id);
    setSelectedIds([shape.id]);
    setMeasurements(`Placed ${shape.name}. Change its words and size in Entity Info.`);
    close();
  };

  const field = 'w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-polyform-blue';
  return (
    <div className="fixed inset-0 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm" style={{ zIndex: 1000 }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={kind === 'text3d' ? 'Add 3D text' : 'Add text'}
        className="w-[440px] max-w-[92vw] rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-2xl"
        onPointerDown={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); close(); }
          if (e.key === 'Enter') { e.preventDefault(); place(); }
        }}
      >
        <header className="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-gray-200 dark:border-gray-800">
          <div className="w-9 h-9 rounded-xl bg-polyform-blue/10 text-polyform-blue flex items-center justify-center"><Type size={17} /></div>
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">{kind === 'text3d' ? 'Add 3D text' : 'Add text'}</h2>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              {kind === 'text3d' ? 'Solid letters, standing where you clicked.' : 'A flat label on the surface you clicked.'}
            </p>
          </div>
        </header>
        <div className="px-5 py-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-700 dark:text-gray-300">
            Words
            <input ref={inputRef} value={text} onChange={e => setText(e.target.value)} placeholder="e.g. Kitchen" className={field} />
          </label>
          <div className="flex gap-3">
            <label className="flex-1 flex flex-col gap-1 text-xs font-medium text-gray-700 dark:text-gray-300">
              Letter height ({unit})
              <input inputMode="decimal" value={size} onChange={e => setSize(e.target.value)} className={field} />
            </label>
            {kind === 'text3d' && (
              <label className="flex-1 flex flex-col gap-1 text-xs font-medium text-gray-700 dark:text-gray-300">
                Depth ({unit})
                <input inputMode="decimal" value={depth} onChange={e => setDepth(e.target.value)} className={field} />
              </label>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={bold} onChange={e => setBold(e.target.checked)} /> Bold
          </label>
        </div>
        <footer className="flex justify-end gap-2 px-5 pb-4">
          <button type="button" onClick={close} className="px-3 py-1.5 text-sm rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">Cancel</button>
          <button type="button" onClick={place} disabled={!text.trim()} className="px-3 py-1.5 text-sm rounded-lg bg-polyform-blue text-white disabled:opacity-40">Place</button>
        </footer>
      </div>
    </div>
  );
}
