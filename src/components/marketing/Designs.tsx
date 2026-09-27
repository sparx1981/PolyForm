import React, { useCallback, useEffect, useState } from 'react';
import { collection, query, where, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { FolderOpen, Trash2, Plus, Loader2, Rotate3d } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { useApp } from '../../AppContext';
import { applySavedModelToAppState } from '../../lib/loadSavedModel';
import DesignPreviewDialog from './DesignPreviewDialog';

interface SavedModel {
  id: string;
  name?: string;
  [key: string]: any;
}

/** The signed-in marketing page at /designs: lists a user's saved designs and loads one into the editor. */
export default function Designs({ onOpenDesign, onSignInRequired }: { onOpenDesign: () => void; onSignInRequired: () => void }) {
  const api = useApp();
  const { user } = api;
  const [models, setModels] = useState<SavedModel[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState<SavedModel | null>(null);
  const closePreview = useCallback(() => setPreviewing(null), []);

  useEffect(() => {
    if (!user) { setModels(null); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const q = query(collection(db, 'models'), where('userId', '==', user.uid));
        const snapshot = await getDocs(q);
        if (!cancelled) setModels(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'models');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const openDesign = (model: SavedModel) => {
    applySavedModelToAppState(model, api);
    onOpenDesign();
  };

  const deleteDesign = async (id: string) => {
    if (!window.confirm('Delete this design? This cannot be undone.')) return;
    try {
      await deleteDoc(doc(db, 'models', id));
      setModels(prev => (prev || []).filter(m => m.id !== id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `models/${id}`);
    }
  };

  if (!user) {
    return (
      <section className="max-w-[720px] mx-auto px-6 py-24 text-center">
        <h1 className="text-3xl font-bold text-polyform-dark-blue">My Designs</h1>
        <p className="mt-3 text-gray-500">Sign in to see the designs saved to your account.</p>
        <button
          type="button"
          onClick={onSignInRequired}
          className="mt-6 inline-flex items-center justify-center rounded-lg bg-polyform-blue text-white font-semibold px-5 py-3 hover:bg-polyform-dark-blue transition-colors"
        >
          Sign in
        </button>
      </section>
    );
  }

  return (
    <section className="max-w-[1080px] mx-auto px-6 py-16">
      <div className="flex items-center justify-between gap-4 mb-8">
        <h1 className="text-3xl font-bold text-polyform-dark-blue">My Designs</h1>
        <button
          type="button"
          onClick={onOpenDesign}
          className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-lg bg-polyform-blue text-white hover:bg-polyform-dark-blue transition-colors"
        >
          <Plus size={16} /> New design
        </button>
      </div>

      {loading && (
        <p className="flex items-center gap-2 text-gray-500">
          <Loader2 size={16} className="animate-spin" /> Loading your designs...
        </p>
      )}

      {!loading && models && models.length === 0 && (
        <p className="text-gray-500">You haven't saved any designs yet. Start one to see it here.</p>
      )}

      {!loading && models && models.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {models.map(model => (
            <div
              key={model.id}
              className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col hover:border-polyform-blue/40 transition-colors"
            >
              <button
                type="button"
                onClick={() => setPreviewing(model)}
                aria-label={`Preview ${model.name || 'design'} in 3D`}
                className="group relative aspect-video bg-slate-100 flex items-center justify-center overflow-hidden"
              >
                {typeof model.previewUrl === 'string' && model.previewUrl ? (
                  <img src={model.previewUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
                ) : (
                  <span className="w-10 h-10 rounded-lg bg-polyform-blue/10 text-polyform-blue flex items-center justify-center">
                    <FolderOpen size={20} />
                  </span>
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-slate-900/0 group-hover:bg-slate-900/35 group-focus-visible:bg-slate-900/35 transition-colors">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-polyform-dark-blue opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
                    <Rotate3d size={14} /> Preview in 3D
                  </span>
                </span>
              </button>
              <div className="p-4 flex flex-col gap-3 flex-1">
                <p className="font-semibold text-polyform-dark-blue truncate">{model.name || 'Untitled design'}</p>
                <div className="flex items-center gap-2 mt-auto">
                  <button
                    type="button"
                    onClick={() => setPreviewing(model)}
                    className="text-sm font-semibold px-3 py-2 rounded-lg border border-slate-200 text-polyform-dark-blue hover:bg-slate-50 transition-colors"
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => openDesign(model)}
                    className="flex-1 text-sm font-semibold px-3 py-2 rounded-lg bg-polyform-blue text-white hover:bg-polyform-dark-blue transition-colors"
                  >
                    Open in PolyForm
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteDesign(model.id)}
                    aria-label={`Delete ${model.name || 'design'}`}
                    className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {previewing && (
        <DesignPreviewDialog
          model={previewing}
          onOpen={() => { const m = previewing; setPreviewing(null); openDesign(m); }}
          onClose={closePreview}
        />
      )}
    </section>
  );
}
