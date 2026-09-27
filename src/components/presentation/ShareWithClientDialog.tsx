import React, { useEffect, useMemo, useState } from 'react';
import { X, Link2, Copy, Check, ExternalLink, Loader2, Trash2, Globe } from 'lucide-react';
import { useApp } from '../../AppContext';
import { cn } from '../../lib/utils';
import { floorPlans, type RoomLabel } from '../../lib/presentation/floorPlans';
import { billOfMaterials } from '../../lib/presentation/bom';
import {
  captureCover, DEFAULT_EFFECTS, findShareForModel, loadPresentation, measureTopAreas, publishPresentation, revokePresentation, shareUrl,
  type ClientEffects, type ClientPresentationDoc,
} from '../../lib/presentation/share';
import { plantName } from '../../lib/presentation/plants';
import { canvasRef } from '../../lib/presentation/recorder';
import { mainSceneRef } from '../Viewport';
import { refreshDesignerComments } from './Comments';
import type { Shape } from '../../types';

const EFFECT_LABELS: { key: keyof ClientEffects; label: string }[] = [
  { key: 'build', label: 'Build-up animation' },
  { key: 'explode', label: 'Exploded view' },
  { key: 'cut', label: 'Cut view' },
  { key: 'xray', label: 'X-ray' },
];

/**
 * Publishes (or updates, or turns off) the model's client page: a private link to a read-only
 * page with the 3D model, floor plans and quantities. The link shows a snapshot, so later edits
 * only reach the client when the designer presses Update.
 */
export default function ShareWithClientDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const { user, currentModelId, currentModelName } = app;
  const shapes = app.shapes as Shape[];
  const [existing, setExisting] = useState<{ id: string; data: ClientPresentationDoc } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'publish' | 'revoke' | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [title, setTitle] = useState(currentModelName || 'Untitled design');
  const [designerName, setDesignerName] = useState(user?.displayName || '');
  const [clientName, setClientName] = useState('');
  const [message, setMessage] = useState('');
  const [effects, setEffects] = useState<ClientEffects>(DEFAULT_EFFECTS);
  const [names, setNames] = useState<Record<string, string>>({});

  // Rooms found on the plans, so the designer can name them for the client.
  const plans = useMemo(() => floorPlans(shapes, [], 400), [shapes]);
  const roomKey = (level: number, at: [number, number]) => `${level}:${at[0]}:${at[1]}`;

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (!user || !currentModelId) return;
        const found = await findShareForModel(user.uid, currentModelId);
        if (!live || !found) return;
        setExisting(found);
        setTitle(found.data.title);
        setDesignerName(found.data.designerName);
        setClientName(found.data.clientName);
        setMessage(found.data.message);
        setEffects({ ...DEFAULT_EFFECTS, ...found.data.effects });
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [user?.uid, currentModelId]);

  // Names saved with the last publish come back with the snapshot; match them to today's rooms.
  useEffect(() => {
    if (!existing) return;
    let live = true;
    loadPresentation(existing.id).then(({ bundle }) => {
      if (!live) return;
      const next: Record<string, string> = {};
      for (const saved of bundle.roomNames ?? []) {
        const plan = plans.find(p => p.level === saved.level);
        let best: { at: [number, number]; d: number } | null = null;
        for (const r of plan?.rooms ?? []) {
          const d = Math.hypot(r.at[0] - saved.at[0], r.at[1] - saved.at[1]);
          if (d < 2 && (!best || d < best.d)) best = { at: r.at, d };
        }
        if (best) next[roomKey(saved.level, best.at)] = saved.name;
      }
      setNames(prev => ({ ...next, ...prev }));
    }).catch(() => {});
    return () => { live = false; };
  }, [existing?.id]);

  const publish = async () => {
    if (!user) { setError('Sign in to share a client page.'); return; }
    setBusy('publish');
    setError('');
    try {
      const roomNames: RoomLabel[] = [];
      for (const p of plans) for (const r of p.rooms) {
        const name = names[roomKey(p.level, r.at)]?.trim();
        if (name) roomNames.push({ level: p.level, at: r.at, name });
      }
      const measured = mainSceneRef.current ? measureTopAreas(mainSceneRef.current, shapes) : {};
      const bom = billOfMaterials(shapes, { measured, plantName });
      const cover = await captureCover(canvasRef.current);
      const published = await publishPresentation({
        shareId: existing?.id,
        createdAt: existing?.data.createdAt,
        ownerId: user.uid,
        modelId: currentModelId,
        title: title.trim() || 'Untitled design',
        designerName: designerName.trim(),
        clientName: clientName.trim(),
        message: message.trim(),
        effects,
        cover,
        bundle: { project: app.getProjectState(), roomNames, bom },
      });
      setExisting(published);
      refreshDesignerComments();
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(null);
    }
  };

  const revoke = async () => {
    if (!existing || !user) return;
    if (!window.confirm('Turn off this link? Anyone who has it will no longer be able to open the page.')) return;
    setBusy('revoke');
    setError('');
    try {
      await revokePresentation(existing.id, user.uid);
      setExisting(null);
      refreshDesignerComments();
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(null);
    }
  };

  const link = existing ? shareUrl(existing.id) : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* the link is selectable in the box */ }
  };

  const allRooms = plans.flatMap(p => p.rooms.map(r => ({ level: p.level, room: r })));

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-3"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true" aria-label="Share with client">
      <div className="w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-2xl text-slate-800">
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Client page</h2>
            <p className="text-sm text-slate-500">A private link to a read-only page: the 3D model, floor plans and quantities. No account needed to view it.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {loading && user && currentModelId ? (
            <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Checking for an existing link…</div>
          ) : existing ? (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800 mb-2"><Globe size={15} /> Link is live</div>
              <div className="flex gap-2">
                <input readOnly value={link} onFocus={e => e.currentTarget.select()} className="flex-1 min-w-0 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm" />
                <button onClick={copy} className="px-3 rounded-lg bg-emerald-600 text-white text-sm font-semibold flex items-center gap-1">
                  {copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy'}
                </button>
                <a href={link} target="_blank" rel="noreferrer" className="px-3 rounded-lg border border-emerald-300 text-emerald-800 text-sm font-semibold flex items-center gap-1">
                  <ExternalLink size={15} /> Open
                </a>
              </div>
              <p className="text-xs text-emerald-700 mt-2">The client sees the version from your last publish. Press <b>Update page</b> after making changes.</p>
            </div>
          ) : null}

          {!currentModelId && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">Save the design first so its link can be found and updated later.</p>
          )}

          <Field label="Project title"><input value={title} onChange={e => setTitle(e.target.value)} className={input} /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Prepared by"><input value={designerName} onChange={e => setDesignerName(e.target.value)} placeholder="Your name or studio" className={input} /></Field>
            <Field label="Prepared for"><input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Client name" className={input} /></Field>
          </div>
          <Field label="Message to the client (optional)">
            <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3} className={cn(input, 'resize-y')} placeholder="A few words about the design…" />
          </Field>

          <Field label="Effects the client can use">
            <div className="grid grid-cols-2 gap-2">
              {EFFECT_LABELS.map(e => (
                <label key={e.key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={effects[e.key]} onChange={ev => setEffects({ ...effects, [e.key]: ev.target.checked })} className="accent-sky-600" />
                  {e.label}
                </label>
              ))}
            </div>
          </Field>

          {allRooms.length > 0 && (
            <Field label="Room names (shown on the plans)">
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {allRooms.map(({ level, room }, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-28 shrink-0 text-xs text-slate-500">Level {level} · {room.areaM2.toFixed(1)} m²</span>
                    <input value={names[roomKey(level, room.at)] ?? room.name ?? ''} placeholder="e.g. Kitchen"
                      onChange={e => setNames({ ...names, [roomKey(level, room.at)]: e.target.value })} className={cn(input, 'py-1.5')} />
                  </div>
                ))}
              </div>
            </Field>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
          {existing ? (
            <button onClick={revoke} disabled={!!busy} className="flex items-center gap-1.5 text-sm font-semibold text-red-600 hover:text-red-700 disabled:opacity-50">
              {busy === 'revoke' ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Turn off link
            </button>
          ) : <span />}
          <button onClick={publish} disabled={!!busy || !user} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-polyform-blue text-white text-sm font-bold shadow disabled:opacity-50">
            {busy === 'publish' ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
            {existing ? 'Update page' : 'Create link'}
          </button>
        </div>
      </div>
    </div>
  );
}

const input = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-slate-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

function friendly(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/permission|unauthorized|403/i.test(msg)) return 'PolyForm could not save the client page (permission denied). The updated security rules may not be deployed yet.';
  return msg;
}
