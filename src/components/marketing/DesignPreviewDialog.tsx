import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, AlertTriangle, Move3d } from 'lucide-react';
import type { PreviewMessage } from '../RenderView';

/**
 * A 3D look at a saved design before opening it. The model is drawn by the
 * editor's own read-only render page (`?render=1&preview=<id>`) in an iframe,
 * so it looks exactly as it does in PolyForm, and nothing is changed or saved.
 */
export default function DesignPreviewDialog({ model, onOpen, onClose }: {
  model: { id: string; name?: string; storage?: { provider?: string } | null };
  onOpen: () => void;
  onClose: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  // Designs kept in Google Drive or Trimble Connect load from there, which needs its own sign-in.
  const external = Boolean(model.storage?.provider);
  const name = model.name || 'Untitled design';

  useEffect(() => {
    const onMessage = (event: MessageEvent<PreviewMessage>) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return;
      if (event.data?.type !== 'polyform-preview') return;
      if (event.data.status === 'escape') onClose();
      else if (event.data.status === 'ready') setStatus('ready');
      else { setStatus('error'); setError(event.data.message); }
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('message', onMessage);
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  // Portalled to <body> so the site's sticky header can't sit over it.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-0 sm:p-6"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${name}`}
    >
      <div className="flex flex-col w-full h-full sm:h-[min(80vh,760px)] sm:max-w-[1100px] bg-white sm:rounded-2xl overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200">
          <p className="font-semibold text-polyform-dark-blue truncate">{name}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="relative flex-1 min-h-0 bg-slate-100">
          {!external && (
            <iframe
              ref={frameRef}
              title={`3D preview of ${name}`}
              src={`/?render=1&preview=${encodeURIComponent(model.id)}`}
              className="absolute inset-0 w-full h-full border-0"
            />
          )}
          {(status !== 'ready' || external) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-100 text-center px-6">
              {external ? (
                <p className="text-gray-500 max-w-sm">This design is kept in your own cloud storage, so it can't be previewed here. Open it in PolyForm to see it.</p>
              ) : status === 'error' ? (
                <>
                  <AlertTriangle size={22} className="text-amber-500" />
                  <p className="text-gray-600 max-w-sm">The preview couldn't load. {error}</p>
                </>
              ) : (
                <p className="flex items-center gap-2 text-gray-500">
                  <Loader2 size={16} className="animate-spin" /> Loading 3D preview...
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-t border-slate-200">
          {!external ? (
            <p className="flex items-center gap-2 text-xs text-gray-500">
              <Move3d size={14} className="shrink-0" />
              Drag to orbit · right-drag or two fingers to pan · scroll or pinch to zoom
            </p>
          ) : <span />}
          <button
            type="button"
            onClick={onOpen}
            className="text-sm font-semibold px-4 py-2 rounded-lg bg-polyform-blue text-white hover:bg-polyform-dark-blue transition-colors"
          >
            Open in PolyForm
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
