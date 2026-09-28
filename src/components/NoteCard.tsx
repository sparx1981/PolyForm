import { CheckCircle2, Eye, EyeOff, MapPin, Trash2 } from 'lucide-react';
import type { SceneNote } from '../types';
import { cn } from '../lib/utils';
import { conversationCard, conversationMeta, conversationText } from './ui/conversationStyles';

export function NoteCard({ note, number, date, onComplete, onVisible, onDelete, onShow }: {
  note: SceneNote; number: number; date: string; onComplete: () => void;
  onVisible?: () => void; onDelete?: () => void; onShow?: () => void;
}) {
  return <div className={cn(conversationCard, 'text-slate-700 dark:text-white/90 ring-1',
    note.completed ? 'bg-[#eef3f0] ring-[#cfe0d6] dark:bg-emerald-500/10 dark:ring-emerald-400/20' : 'bg-white/95 ring-black/5 dark:bg-slate-800/95 dark:ring-white/10')}>
    <div className={cn(conversationMeta, 'text-slate-500 dark:text-white/60')}>
      <button onClick={onShow} disabled={!onShow} title="Show on the model" className="flex items-center gap-0.5 font-bold text-[#b4553a]"><MapPin size={11} />{number}</button>
      <span className="font-semibold text-slate-800 dark:text-white truncate">{note.authorName || 'Note'}</span>
      <span className="ml-auto shrink-0">{date}</span>
      {onDelete && <button onClick={onDelete} aria-label="Delete note" className="opacity-60 hover:opacity-100 hover:text-red-500"><Trash2 size={12} /></button>}
    </div>
    <p className={cn(conversationText, note.completed && 'line-through opacity-60')}>{note.text}</p>
    <div className="mt-2 flex items-center gap-3 text-[11px]">
      <button onClick={onComplete} aria-pressed={!!note.completed} className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300"><CheckCircle2 size={13} />{note.completed ? 'Completed · reopen' : 'Mark complete'}</button>
      {onVisible && <button onClick={onVisible} className="ml-auto flex items-center gap-1 text-slate-500 dark:text-white/60">{note.visible === false ? <EyeOff size={13} /> : <Eye size={13} />}{note.visible === false ? 'Show pin' : 'Hide pin'}</button>}
    </div>
  </div>;
}
