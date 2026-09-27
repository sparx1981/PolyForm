import {
  addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { db } from '../../firebase';

/**
 * Comments on a client page: `presentations/{shareId}/comments/{id}`. Anyone with the link can
 * read them and add one (with a name, no account); only the page's owner can reply as the
 * designer, mark them read or delete them. Pinned comments carry the point on the model.
 */
export interface PresentationComment {
  id: string;
  authorName: string;
  text: string;
  /** Milliseconds; null for a moment while the server stamps a new comment. */
  createdAt: number | null;
  fromDesigner: boolean;
  /** Seen by the designer (their own replies are born read). */
  read: boolean;
  /** Where on the model it's pinned, if anywhere. */
  anchor: [number, number, number] | null;
  /** The comment this answers, for replies. */
  replyTo: string | null;
}

export const COMMENT_MAX = 2000;
export const NAME_MAX = 60;

const commentsOf = (shareId: string) => collection(db, 'presentations', shareId, 'comments');

function fromDoc(id: string, d: Record<string, any>): PresentationComment {
  const t = d.createdAt;
  return {
    id,
    authorName: String(d.authorName ?? ''),
    text: String(d.text ?? ''),
    createdAt: t && typeof t.toMillis === 'function' ? t.toMillis() : typeof t === 'number' ? t : null,
    fromDesigner: d.fromDesigner === true,
    read: d.read === true,
    anchor: Array.isArray(d.anchor) && d.anchor.length === 3 ? (d.anchor as [number, number, number]) : null,
    replyTo: typeof d.replyTo === 'string' ? d.replyTo : null,
  };
}

/** Live comments, oldest first. Returns the unsubscribe function. */
export function watchComments(shareId: string, onChange: (comments: PresentationComment[]) => void, onError?: (e: Error) => void) {
  return onSnapshot(query(commentsOf(shareId), orderBy('createdAt', 'asc')), snap => {
    onChange(snap.docs.map(d => fromDoc(d.id, d.data())));
  }, err => onError?.(err));
}

export async function postComment(shareId: string, c: {
  authorName: string; text: string; fromDesigner?: boolean; anchor?: [number, number, number] | null; replyTo?: string | null;
}) {
  const authorName = c.authorName.trim().slice(0, NAME_MAX);
  const text = c.text.trim().slice(0, COMMENT_MAX);
  if (!authorName || !text) throw new Error('Add your name and a comment.');
  await addDoc(commentsOf(shareId), {
    authorName,
    text,
    createdAt: serverTimestamp(),
    fromDesigner: c.fromDesigner === true,
    read: c.fromDesigner === true,
    anchor: c.anchor ? c.anchor.map(n => Math.round(n * 1000) / 1000) : null,
    replyTo: c.replyTo ?? null,
  });
}

export async function markRead(shareId: string, ids: string[]) {
  if (!ids.length) return;
  const batch = writeBatch(db);
  for (const id of ids) batch.update(doc(db, 'presentations', shareId, 'comments', id), { read: true });
  await batch.commit();
}

export async function deleteComment(shareId: string, id: string) {
  await deleteDoc(doc(db, 'presentations', shareId, 'comments', id));
}

/** Removes every comment on a page (when its link is turned off). */
export async function deleteAllComments(shareId: string) {
  const snap = await getDocs(commentsOf(shareId));
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = writeBatch(db);
    snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

/** Threads: top-level comments, each followed by its replies, oldest first. */
export function threads(comments: PresentationComment[]): { root: PresentationComment; replies: PresentationComment[] }[] {
  const byId = new Map(comments.map(c => [c.id, c]));
  const roots = comments.filter(c => !c.replyTo || !byId.has(c.replyTo));
  return roots.map(root => ({ root, replies: comments.filter(c => c.replyTo === root.id) }));
}

export function unreadCount(comments: PresentationComment[]) {
  return comments.filter(c => !c.fromDesigner && !c.read).length;
}

