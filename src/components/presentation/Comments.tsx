import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { MapPin, Send, Trash2, Loader2, Reply } from 'lucide-react';
import { useApp } from '../../AppContext';
import { cn } from '../../lib/utils';
import {
  deleteComment, markRead, postComment, threads, unreadCount, watchComments, COMMENT_MAX, NAME_MAX,
  type PresentationComment,
} from '../../lib/presentation/comments';
import { findShareForModel } from '../../lib/presentation/share';
import { flyTo, orbitControls } from '../../lib/presentation/camera';

// --- The designer's live comments for the open model ------------------------------------------

interface DesignerComments {
  shareId: string | null;
  designerName: string;
  comments: PresentationComment[];
}

let designerState: DesignerComments = { shareId: null, designerName: '', comments: [] };
const designerListeners = new Set<() => void>();
const setDesigner = (next: Partial<DesignerComments>) => {
  designerState = { ...designerState, ...next };
  designerListeners.forEach(l => l());
};
let refreshTick = 0;
const refreshListeners = new Set<() => void>();

/** Look again for the open model's client page (after publishing or turning it off). */
export function refreshDesignerComments() {
  refreshTick++;
  refreshListeners.forEach(l => l());
}

export function useDesignerComments(): DesignerComments {
  return useSyncExternalStore(
    l => { designerListeners.add(l); return () => { designerListeners.delete(l); }; },
    () => designerState,
    () => designerState,
  );
}

/** Keeps the open model's client comments live in the editor. Mount once. */
export function DesignerCommentsSync() {
  const { user, currentModelId } = useApp();
  const tick = useSyncExternalStore(
    l => { refreshListeners.add(l); return () => { refreshListeners.delete(l); }; },
    () => refreshTick,
    () => refreshTick,
  );
  useEffect(() => {
    setDesigner({ shareId: null, comments: [] });
    if (!user || !currentModelId) return;
    let unsub: (() => void) | null = null;
    let live = true;
    findShareForModel(user.uid, currentModelId).then(found => {
      if (!live || !found) return;
      setDesigner({ shareId: found.id, designerName: found.data.designerName || user.displayName || 'Designer' });
      unsub = watchComments(found.id, comments => setDesigner({ comments }), () => {});
    }).catch(() => {});
    return () => { live = false; unsub?.(); };
  }, [user?.uid, currentModelId, tick]);
  return null;
}

export function useUnreadComments() {
  return unreadCount(useDesignerComments().comments);
}

// --- Shared pieces ------------------------------------------------------------------------------

const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'just now');

/** Numbers for pinned comments, in the order they were left. */
export function pinNumbers(comments: PresentationComment[]) {
  const out = new Map<string, number>();
  let n = 0;
  for (const c of comments) if (c.anchor && !c.replyTo) out.set(c.id, ++n);
  return out;
}

export function CommentPinMarker({ n, active, onClick }: { n: number; active?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} className={cn(
      '-translate-x-1/2 -translate-y-full flex items-center justify-center min-w-7 h-7 px-1.5 rounded-full rounded-bl-none text-xs font-bold shadow-lg ring-2 ring-white',
      active ? 'bg-[#b4553a] text-white' : 'bg-[#2f3a33] text-white',
    )} aria-label={`Comment ${n}`}>
      {n}
    </button>
  );
}

function Bubble({ c, pin, dark, onDelete, onShow }: { c: PresentationComment; pin?: number; dark?: boolean; onDelete?: () => void; onShow?: () => void }) {
  return (
    <div className={cn('rounded-xl px-3 py-2', c.fromDesigner
      ? (dark ? 'bg-sky-500/20' : 'bg-[#eef3f0] ring-1 ring-[#cfe0d6]')
      : (dark ? 'bg-white/10' : 'bg-white ring-1 ring-black/5'))}>
      <div className={cn('flex items-center gap-2 text-[11px]', dark ? 'text-white/60' : 'text-slate-500')}>
        {pin && <button onClick={onShow} className="flex items-center gap-0.5 font-bold text-[#b4553a]" title="Show on the model"><MapPin size={11} />{pin}</button>}
        <span className={cn('font-semibold', dark ? 'text-white' : 'text-slate-800')}>{c.authorName}</span>
        {c.fromDesigner && <span className="rounded bg-[#2f3a33] text-white px-1 text-[9px] uppercase tracking-wide">Designer</span>}
        {!c.fromDesigner && !c.read && dark && <span className="rounded bg-amber-400 text-black px-1 text-[9px] font-bold">NEW</span>}
        <span className="ml-auto">{when(c.createdAt)}</span>
        {onDelete && <button onClick={onDelete} className="opacity-60 hover:opacity-100 hover:text-red-400" title="Delete"><Trash2 size={11} /></button>}
      </div>
      <p className={cn('mt-0.5 text-sm whitespace-pre-line break-words', dark ? 'text-white/90' : 'text-slate-700')}>{c.text}</p>
    </div>
  );
}

/** Glide the camera to look at a pinned point from where it is now. */
export function lookAtPoint(point: [number, number, number]) {
  const c = orbitControls();
  if (!c) return;
  const offset = c.object.position.clone().sub(c.target);
  const d = Math.min(Math.max(offset.length() * 0.6, 6), 25);
  offset.setLength(d);
  flyTo([point[0] + offset.x, point[1] + offset.y, point[2] + offset.z], point, 1.2);
}

export function CommentThreads({ comments, dark, canReply, onReply, onDelete, emptyText, highlight }: {
  comments: PresentationComment[];
  dark?: boolean;
  canReply?: boolean;
  onReply: (text: string, replyTo: string) => Promise<void>;
  onDelete?: (id: string) => void;
  emptyText: string;
  highlight?: string | null;
}) {
  const pins = pinNumbers(comments);
  const all = threads(comments);
  const [replying, setReplying] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  if (!all.length) return <p className={cn('text-sm', dark ? 'text-white/60' : 'text-slate-500')}>{emptyText}</p>;
  return (
    <div className="space-y-3">
      {all.map(({ root, replies }) => (
        <div key={root.id} id={`comment-${root.id}`} className={cn('space-y-1.5 rounded-2xl transition-shadow', highlight === root.id && 'ring-2 ring-[#b4553a] ring-offset-2')}>
          <Bubble c={root} dark={dark} pin={pins.get(root.id)} onShow={() => root.anchor && lookAtPoint(root.anchor)} onDelete={onDelete && (() => onDelete(root.id))} />
          {replies.map(r => (
            <div key={r.id} className="pl-5"><Bubble c={r} dark={dark} onDelete={onDelete && (() => onDelete(r.id))} /></div>
          ))}
          {canReply && (replying === root.id ? (
            <form className="pl-5 flex gap-1.5" onSubmit={async e => {
              e.preventDefault();
              if (!text.trim()) return;
              setBusy(true);
              try { await onReply(text, root.id); setText(''); setReplying(null); } finally { setBusy(false); }
            }}>
              <input autoFocus value={text} maxLength={COMMENT_MAX} onChange={e => setText(e.target.value)} placeholder="Write a reply…"
                className={cn('flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400', dark ? 'bg-white/10 text-white placeholder:text-white/40' : 'bg-white ring-1 ring-black/10')} />
              <button disabled={busy} className="px-2.5 rounded-lg bg-[#2f3a33] text-white disabled:opacity-50" aria-label="Send reply">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </form>
          ) : (
            <button onClick={() => { setReplying(root.id); setText(''); }} className={cn('pl-5 flex items-center gap-1 text-xs font-semibold', dark ? 'text-white/60 hover:text-white' : 'text-slate-500 hover:text-slate-800')}>
              <Reply size={12} /> Reply
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// --- The client's composer ------------------------------------------------------------------------

const NAME_KEY = 'polyform_comment_name';
const savedName = () => { try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; } };

export function CommentComposer({ onSend, anchor, onClearAnchor, placeholder, compact }: {
  onSend: (name: string, text: string) => Promise<void>;
  anchor?: [number, number, number] | null;
  onClearAnchor?: () => void;
  placeholder?: string;
  compact?: boolean;
}) {
  const [name, setName] = useState(savedName);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form className="space-y-2" onSubmit={async e => {
      e.preventDefault();
      setError('');
      if (!name.trim() || !text.trim()) { setError('Add your name and a comment.'); return; }
      setBusy(true);
      try {
        await onSend(name, text);
        try { localStorage.setItem(NAME_KEY, name.trim()); } catch { /* private mode */ }
        setText('');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    }}>
      {anchor && (
        <div className="flex items-center gap-2 text-xs text-[#b4553a]">
          <MapPin size={13} /> Pinned to the spot you clicked
          {onClearAnchor && <button type="button" onClick={onClearAnchor} className="underline text-slate-500">remove pin</button>}
        </div>
      )}
      <div className={cn('grid gap-2', compact ? '' : 'sm:grid-cols-[180px_1fr]')}>
        <input value={name} maxLength={NAME_MAX} onChange={e => setName(e.target.value)} placeholder="Your name" aria-label="Your name"
          className="rounded-xl bg-white ring-1 ring-black/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
        <textarea value={text} maxLength={COMMENT_MAX} rows={compact ? 3 : 2} onChange={e => setText(e.target.value)} placeholder={placeholder ?? 'Your comment or question…'} aria-label="Comment"
          className="rounded-xl bg-white ring-1 ring-black/10 px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-sky-400" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-red-600">{error}</span>
        <button disabled={busy} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2f3a33] text-white text-sm font-semibold disabled:opacity-50">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send
        </button>
      </div>
    </form>
  );
}

// --- The designer's comments popover ---------------------------------------------------------------

export function DesignerCommentsList() {
  const { shareId, designerName, comments } = useDesignerComments();
  // Opening the list counts as reading them.
  useEffect(() => {
    if (!shareId) return;
    const unread = comments.filter(c => !c.fromDesigner && !c.read).map(c => c.id);
    if (unread.length) {
      const t = setTimeout(() => markRead(shareId, unread).catch(() => {}), 1500);
      return () => clearTimeout(t);
    }
  }, [shareId, comments]);
  if (!shareId) return <p className="text-xs text-white/60">Comments appear here once you've created a client page link for this design.</p>;
  return (
    <div className="max-h-72 overflow-y-auto pr-1">
      <CommentThreads
        dark
        comments={comments}
        canReply
        emptyText="No comments from your client yet."
        onReply={(text, replyTo) => postComment(shareId, { authorName: designerName, text, fromDesigner: true, replyTo })}
        onDelete={id => { if (window.confirm('Delete this comment?')) deleteComment(shareId, id).catch(err => alert(err.message)); }}
      />
    </div>
  );
}
