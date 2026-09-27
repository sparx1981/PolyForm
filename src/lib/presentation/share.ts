import * as THREE from 'three';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { deleteObject, getBytes, getDownloadURL, ref, uploadBytes, uploadString } from 'firebase/storage';
import { db, storage } from '../../firebase';
import type { ProjectState } from '../storage/projectFile';
import type { Shape } from '../../types';
import type { BomLine, MeasuredArea } from './bom';
import type { RoomLabel } from './floorPlans';
import { categoryOf } from './classify';

/**
 * Client share links. Publishing takes a snapshot of the model as it is now, so the client sees
 * the version the designer chose to show, never work in progress. The snapshot sits in Storage
 * (models can be large), with a small public document holding the page's details:
 *
 *   presentations/{shareId}                          Firestore, readable by anyone with the id
 *   presentations/{ownerId}/{shareId}/project.json   Storage, the model snapshot and BOM
 *   presentations/{ownerId}/{shareId}/cover.jpg      Storage, the hero picture
 *
 * The id is 128 random bits, so the link is the secret; turning sharing off deletes all three.
 */
export interface ClientEffects {
  build: boolean;
  explode: boolean;
  cut: boolean;
  xray: boolean;
}

export interface ClientPresentationDoc {
  version: 1;
  ownerId: string;
  modelId: string | null;
  title: string;
  designerName: string;
  clientName: string;
  message: string;
  effects: ClientEffects;
  storagePath: string;
  coverUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ClientPresentationBundle {
  project: ProjectState;
  roomNames: RoomLabel[];
  bom: BomLine[];
}

export const DEFAULT_EFFECTS: ClientEffects = { build: true, explode: true, cut: true, xray: true };

export function newShareId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  // 22 base-62 characters carry 128 bits.
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  for (let i = 0; i < 22; i++) { out = alphabet[Number(n % 62n)] + out; n /= 62n; }
  return out;
}

export const SHARE_ID_PATTERN = /^[0-9A-Za-z]{20,40}$/;

export function shareUrl(shareId: string, origin = window.location.origin) {
  return `${origin}/p/${shareId}`;
}

/** The share id in a `/p/<id>` path, or null. */
export function shareIdFromPath(pathname: string): string | null {
  const m = /^\/p\/([^/]+)\/?$/.exec(pathname);
  return m && SHARE_ID_PATTERN.test(m[1]) ? m[1] : null;
}

export async function findShareForModel(ownerId: string, modelId: string): Promise<{ id: string; data: ClientPresentationDoc } | null> {
  const snap = await getDocs(query(collection(db, 'presentations'), where('ownerId', '==', ownerId), where('modelId', '==', modelId)));
  const first = snap.docs[0];
  return first ? { id: first.id, data: first.data() as ClientPresentationDoc } : null;
}

export async function publishPresentation(input: {
  shareId?: string;
  ownerId: string;
  modelId: string | null;
  title: string;
  designerName: string;
  clientName: string;
  message: string;
  effects: ClientEffects;
  bundle: ClientPresentationBundle;
  cover: Blob | null;
  createdAt?: number;
}): Promise<{ id: string; data: ClientPresentationDoc }> {
  const shareId = input.shareId ?? newShareId();
  const folder = `presentations/${input.ownerId}/${shareId}`;
  const storagePath = `${folder}/project.json`;
  await uploadString(ref(storage, storagePath), JSON.stringify(input.bundle), 'raw', { contentType: 'application/json' });
  let coverUrl: string | null = null;
  if (input.cover) {
    const coverRef = ref(storage, `${folder}/cover.jpg`);
    await uploadBytes(coverRef, input.cover, { contentType: 'image/jpeg' });
    coverUrl = await getDownloadURL(coverRef);
  }
  const now = Date.now();
  const data: ClientPresentationDoc = {
    version: 1,
    ownerId: input.ownerId,
    modelId: input.modelId,
    title: input.title.slice(0, 120),
    designerName: input.designerName.slice(0, 120),
    clientName: input.clientName.slice(0, 120),
    message: input.message.slice(0, 4000),
    effects: input.effects,
    storagePath,
    coverUrl,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
  await setDoc(doc(db, 'presentations', shareId), data);
  return { id: shareId, data };
}

export async function revokePresentation(shareId: string, ownerId: string) {
  await deleteDoc(doc(db, 'presentations', shareId));
  const folder = `presentations/${ownerId}/${shareId}`;
  await Promise.all(['project.json', 'cover.jpg'].map(f => deleteObject(ref(storage, `${folder}/${f}`)).catch(() => {})));
}

export class ShareNotFoundError extends Error {}

export async function loadPresentation(shareId: string): Promise<{ meta: ClientPresentationDoc; bundle: ClientPresentationBundle }> {
  const snap = await getDoc(doc(db, 'presentations', shareId));
  if (!snap.exists()) throw new ShareNotFoundError('This presentation link is no longer active.');
  const meta = snap.data() as ClientPresentationDoc;
  const bytes = await getBytes(ref(storage, meta.storagePath));
  const bundle = JSON.parse(new TextDecoder().decode(bytes)) as ClientPresentationBundle;
  return { meta, bundle };
}

/**
 * Roof covering and floor slab areas, taken off the drawn meshes: the area of every triangle
 * facing upwards. Tile instances are skipped (they sit on the roof surface already counted).
 */
export function measureTopAreas(scene: THREE.Object3D, shapes: Shape[]): Record<string, MeasuredArea> {
  const wanted = new Map(shapes.filter(s => {
    const c = categoryOf(s);
    return c === 'roof' || c === 'slab';
  }).map(s => [s.id, s]));
  const out: Record<string, MeasuredArea> = {};
  if (!wanted.size) return out;
  scene.updateMatrixWorld();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const counted = new Set<string>();
  scene.traverse(root => {
    const id = root.userData?.isShape ? String(root.userData.id) : null;
    if (!id || !wanted.has(id) || counted.has(root.uuid)) return;
    counted.add(root.uuid);
    let area = 0;
    root.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || !mesh.visible) return;
      const pos = mesh.geometry?.attributes?.position;
      if (!pos) return;
      const index = mesh.geometry.index;
      const count = index ? index.count : pos.count;
      for (let i = 0; i + 2 < count; i += 3) {
        const ia = index ? index.getX(i) : i, ib = index ? index.getX(i + 1) : i + 1, ic = index ? index.getX(i + 2) : i + 2;
        a.fromBufferAttribute(pos, ia).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(pos, ib).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(pos, ic).applyMatrix4(mesh.matrixWorld);
        n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
        const len = n.length();
        if (len > 0 && n.y / len > 0.2) area += len / 2;
      }
    });
    out[id] = { topArea: (out[id]?.topArea ?? 0) + area };
  });
  return out;
}

/** A JPEG of the current 3D view, for the page's hero and link previews. */
export function captureCover(canvas: HTMLCanvasElement | null, maxWidth = 1600): Promise<Blob | null> {
  if (!canvas) return Promise.resolve(null);
  const scale = Math.min(1, maxWidth / Math.max(1, canvas.width));
  const out = document.createElement('canvas');
  out.width = Math.round(canvas.width * scale);
  out.height = Math.round(canvas.height * scale);
  const ctx = out.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return new Promise(resolve => out.toBlob(b => resolve(b), 'image/jpeg', 0.86));
}
