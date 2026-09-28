import { SERIF } from './presentation/StageTimeline';
import { CheckCircle2, Eye, EyeOff, MapPin, Trash2 } from 'lucide-react';
import type { SceneNote } from '../types';
import { cn } from '../lib/utils';
import { conversationCard, conversationMeta, conversationText } from './ui/conversationStyles';


export function NoteCard({ note, number, date, onComplete, onVisible, onDelete, onShow }: {
  note: SceneNote; number: number; date: string; onComplete: () => void;
  onVisible?: () => void; onDelete?: () => void; onShow?: () => void;
}) {
  // Matches the presentation-mode label callout (LabelCallout in presentation/PinLayer.tsx).
  return <div className={cn(conversationCard, 'text-[#2a241e] ring-1 ring-black/5 shadow-lg',
    note.completed ? 'bg-[#eef3f0]/95' : 'bg-[#f7f5f0]/95')}>
    <div className={cn(conversationMeta, 'text-[#8b8177]')}>
      <button onClick={onShow} disabled={!onShow} title="Show on the model" className="flex items-center gap-0.5 font-bold text-[#b4553a]"><MapPin size={11} />{number}</button>
      <span className="font-semibold text-[#2a241e] truncate">{note.authorName || 'Note'}</span>
      <span className="ml-auto shrink-0">{date}</span>
      {onDelete && <button onClick={onDelete} aria-label="Delete note" className="opacity-60 hover:opacity-100 hover:text-red-500"><Trash2 size={12} /></button>}
    </div>
    <p className={cn(conversationText, 'leading-snug', note.completed && 'line-through opacity-60')} style={{ fontFamily: SERIF }}>{note.text}</p>
    <div className="mt-2 flex items-center gap-3 text-[11px]">
      <button onClick={onComplete} aria-pressed={!!note.completed} className="flex items-center gap-1 text-emerald-700"><CheckCircle2 size={13} />{note.completed ? 'Completed · reopen' : 'Mark complete'}</button>
      {onVisible && <button onClick={onVisible} className="ml-auto flex items-center gap-1 text-[#8b8177]">{note.visible === false ? <EyeOff size={13} /> : <Eye size={13} />}{note.visible === false ? 'Show pin' : 'Hide pin'}</button>}
    </div>
  </div>;
}
