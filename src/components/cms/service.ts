import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, db, storage } from '../../firebase';
import { isCmsAdmin } from './access';
export { isCmsAdmin } from './access';
import { defaultContent, validateContent, type Revision, type SiteContent } from './model';
export function requireAdmin() { if (!isCmsAdmin(auth.currentUser)) throw new Error('Sign in with the verified administrator account.'); return auth.currentUser!; }
export async function loadDraft(): Promise<Revision> {
  requireAdmin();
  const snapshot = await getDoc(doc(db, 'marketingCms', 'draft'));
  if (snapshot.exists()) { const result = snapshot.data() as Revision; validateContent(result.content); return result; }
  const live = await getDoc(doc(db, 'marketingCms', 'published'));
  return { revision: 0, updatedBy: '', content: live.exists() ? live.data().content : defaultContent() };
}
export async function saveDraft(content: SiteContent, expected: number): Promise<number> {
  const user = requireAdmin(); validateContent(content);
  return runTransaction(db, async tx => {
    const target = doc(db, 'marketingCms', 'draft'), current = await tx.get(target);
    if ((current.data()?.revision ?? 0) !== expected) throw new Error('Another session saved this draft. Export your changes, then reload the latest draft.');
    tx.set(target, { content, revision: expected + 1, updatedBy: user.uid, updatedAt: serverTimestamp() });
    return expected + 1;
  });
}
export async function publishDraft(expectedDraft: number, expectedPublished: number): Promise<number> {
  const user = requireAdmin();
  return runTransaction(db, async tx => {
    const draftRef = doc(db, 'marketingCms', 'draft'), liveRef = doc(db, 'marketingCms', 'published');
    const draft = await tx.get(draftRef), live = await tx.get(liveRef);
    if (!draft.exists() || draft.data().revision !== expectedDraft || (live.data()?.revision ?? 0) !== expectedPublished) throw new Error('The saved draft or published site changed. Reload before publishing.');
    validateContent(draft.data().content);
    const revision = expectedPublished + 1;
    const entry = { content: draft.data().content, revision, draftRevision: expectedDraft, updatedBy: user.uid, updatedAt: serverTimestamp() };
    tx.set(liveRef, entry);
    tx.set(doc(db, 'marketingCmsHistory', String(revision)), entry);
    return revision;
  });
}
// Realtime listeners are intentional: open previews and admin sessions must see publications and concurrent revisions immediately.
export function watchPublished(next: (revision: Revision | null) => void, error: (error: Error) => void) {
  return onSnapshot(doc(db, 'marketingCms', 'published'), snapshot => {
    try { const value = snapshot.exists() ? snapshot.data() as Revision : null; if (value) validateContent(value.content); next(value); } catch (e) { error(e as Error); }
  }, error);
}
export function watchHistory(next: (revisions: Revision[]) => void, error: (error: Error) => void) {
  requireAdmin();
  return onSnapshot(query(collection(db, 'marketingCmsHistory'), orderBy('revision', 'desc'), limit(30)), snapshot => next(snapshot.docs.map(d => d.data() as Revision)), error);
}
export async function uploadImage(file: File): Promise<string> {
  requireAdmin();
  if (!['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('Choose a JPEG, PNG, WebP, GIF or AVIF image smaller than 10 MB.');
  const target = ref(storage, `marketing-media/${crypto.randomUUID()}/${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
  await uploadBytes(target, file, { contentType: file.type });
  return getDownloadURL(target);
}
