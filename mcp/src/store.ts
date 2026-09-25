import type { Shape } from '../../src/types';
import { cleanFirestoreDataForSave, restoreFirestoreArraysAfterLoad } from '../../src/lib/firestoreArrayCodec';
import { offloadLargeGeometryForSave, type GeometryOffloadIO } from '../../src/lib/firestoreGeometryOffload';
import { defaultGraphicsSettings, normalizeGraphicsSettings, type GraphicsSettings } from '../../src/lib/graphics/graphicsSettings';

/** The signed-in person a request acts for. */
export interface Caller {
  uid: string;
  email: string;
  name?: string;
}

/** A problem to report back to Claude as a tool error, in plain words. */
export class ToolError extends Error {}

export interface ModelRow {
  id: string;
  name: string;
  updatedAt?: string;
  /** Set when the model's content lives in the user's Google Drive or Trimble Connect. */
  storedIn?: string;
}

const EXTERNAL_LABELS: Record<string, string> = { 'google-drive': 'Google Drive', 'trimble-connect': 'Trimble Connect' };

/** Models kept in Drive / Connect hold only an index entry here; the connector can't reach the file. */
export function externalStorageError(name: string, storage: any): ToolError | null {
  if (!storage?.fileId) return null;
  const where = EXTERNAL_LABELS[storage.provider] ?? 'external storage';
  return new ToolError(`"${name}" is stored in ${where}, which this connector can't open yet. It works on models saved to PolyForm cloud.`);
}

export interface LoadedModel {
  id: string;
  name: string;
  userId: string;
  shapes: Shape[];
  graphicsSettings: GraphicsSettings;
  updatedAt?: string;
}

/** Firestore rules cap a model at this many objects. */
export const MAX_SHAPES = 5000;
/** How many connector changes can be undone per model. */
export const HISTORY_LIMIT = 20;

/**
 * Where models live. The connector only ever changes a model's `shapes` (and `updatedAt`),
 * leaving the drawn-surface kernel, scenes, materials and settings exactly as the app saved
 * them, and keeps the previous `shapes` so a change can be undone.
 */
export interface ModelStore {
  listModels(caller: Caller): Promise<ModelRow[]>;
  /** A model by id or by name (exact, then unique partial match, ignoring case). */
  loadModel(caller: Caller, ref: string): Promise<LoadedModel>;
  /** Applies `mutate` to the model's objects in one transaction and records the old list for undo. */
  changeShapes(caller: Caller, modelId: string, note: string, mutate: (shapes: Shape[]) => Shape[]): Promise<Shape[]>;
  /** Applies `mutate` to the model's graphics settings (weather, vegetation wind) and records the old value for undo. */
  changeGraphicsSettings(caller: Caller, modelId: string, note: string, mutate: (settings: GraphicsSettings) => GraphicsSettings): Promise<GraphicsSettings>;
  /** Restores whichever of the objects or graphics settings changed most recently; returns its note. */
  undo(caller: Caller, modelId: string): Promise<string | null>;
  createModel(caller: Caller, name: string): Promise<string>;
}

export function decodeShapes(raw: unknown): Shape[] {
  return Array.isArray(raw) ? (restoreFirestoreArraysAfterLoad(raw) as Shape[]) : [];
}

export function encodeShapes(shapes: Shape[]): unknown[] {
  return cleanFirestoreDataForSave(shapes);
}

/** Picks a model from a list by id or name, or explains why it can't. */
export function matchModel(rows: ModelRow[], ref: string): ModelRow {
  const byId = rows.find(r => r.id === ref);
  if (byId) return byId;
  const wanted = ref.trim().toLowerCase();
  const exact = rows.filter(r => r.name.trim().toLowerCase() === wanted);
  if (exact.length === 1) return exact[0];
  const partial = exact.length ? exact : rows.filter(r => r.name.toLowerCase().includes(wanted));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new ToolError(`More than one model matches "${ref}": ${partial.slice(0, 8).map(r => `"${r.name}" (${r.id})`).join(', ')}. Use the id.`);
  }
  throw new ToolError(`No model called "${ref}". Use list_models to see your models.`);
}

function checkSize(shapes: Shape[]) {
  if (shapes.length > MAX_SHAPES) throw new ToolError(`A model can hold at most ${MAX_SHAPES} objects.`);
}

/** In-memory store for tests and local trials. */
export class MemoryStore implements ModelStore {
  models = new Map<string, { name: string; userId: string; shapes: unknown[]; graphicsSettings: unknown; updatedAt: string; collaborators: string[] }>();
  history = new Map<string, { shapes: unknown[]; graphicsSettings: unknown; note: string }[]>();
  private next = 1;

  async listModels(caller: Caller): Promise<ModelRow[]> {
    return [...this.models.entries()]
      .filter(([, m]) => m.userId === caller.uid)
      .map(([id, m]) => ({ id, name: m.name, updatedAt: m.updatedAt }));
  }

  private access(caller: Caller, id: string) {
    const m = this.models.get(id);
    if (!m) return null;
    if (m.userId !== caller.uid && !m.collaborators.includes(caller.email.toLowerCase())) return null;
    return m;
  }

  async loadModel(caller: Caller, ref: string): Promise<LoadedModel> {
    const direct = this.access(caller, ref);
    const id = direct ? ref : matchModel(await this.listModels(caller), ref).id;
    const m = this.access(caller, id)!;
    return { id, name: m.name, userId: m.userId, shapes: decodeShapes(m.shapes), graphicsSettings: normalizeGraphicsSettings(m.graphicsSettings), updatedAt: m.updatedAt };
  }

  async changeShapes(caller: Caller, modelId: string, note: string, mutate: (shapes: Shape[]) => Shape[]) {
    const m = this.access(caller, modelId);
    if (!m) throw new ToolError('Model not found.');
    const next = mutate(decodeShapes(m.shapes));
    checkSize(next);
    const list = this.history.get(modelId) ?? [];
    list.push({ shapes: m.shapes, graphicsSettings: m.graphicsSettings, note });
    this.history.set(modelId, list.slice(-HISTORY_LIMIT));
    m.shapes = encodeShapes(next);
    m.updatedAt = new Date().toISOString();
    return next;
  }

  async changeGraphicsSettings(caller: Caller, modelId: string, note: string, mutate: (settings: GraphicsSettings) => GraphicsSettings) {
    const m = this.access(caller, modelId);
    if (!m) throw new ToolError('Model not found.');
    const next = mutate(normalizeGraphicsSettings(m.graphicsSettings));
    const list = this.history.get(modelId) ?? [];
    list.push({ shapes: m.shapes, graphicsSettings: m.graphicsSettings, note });
    this.history.set(modelId, list.slice(-HISTORY_LIMIT));
    m.graphicsSettings = next;
    m.updatedAt = new Date().toISOString();
    return next;
  }

  async undo(caller: Caller, modelId: string) {
    const m = this.access(caller, modelId);
    if (!m) throw new ToolError('Model not found.');
    const entry = this.history.get(modelId)?.pop();
    if (!entry) return null;
    m.shapes = entry.shapes;
    m.graphicsSettings = entry.graphicsSettings;
    return entry.note;
  }

  async createModel(caller: Caller, name: string) {
    const id = `m${this.next++}`;
    this.models.set(id, { name, userId: caller.uid, shapes: [], graphicsSettings: null, updatedAt: new Date().toISOString(), collaborators: [] });
    return id;
  }
}

/** Minimal slice of the firebase-admin Firestore API the store uses (keeps this file testable). */
type Firestore = import('firebase-admin/firestore').Firestore;

export class FirestoreStore implements ModelStore {
  constructor(private db: Firestore, private serverTimestamp: () => unknown) {}

  private geometryIO(uid: string): GeometryOffloadIO {
    return {
      upload: async (docId, jsonText) => {
        await this.db.collection('geometryOverflow').doc(docId).set({ userId: uid, data: jsonText, createdAt: Date.now() });
      },
      fetch: async docId => {
        const snap = await this.db.collection('geometryOverflow').doc(docId).get();
        if (!snap.exists) throw new Error(`Offloaded geometry not found: ${docId}`);
        return snap.data()!.data as string;
      },
    };
  }

  private async canAccess(caller: Caller, modelId: string, data: FirebaseFirestore.DocumentData | undefined) {
    if (!data) return false;
    if (data.userId === caller.uid) return true;
    const refs = [`${modelId}_${caller.email.toLowerCase()}`, `${modelId}_${caller.uid}`]
      .map(id => this.db.collection('collaborations').doc(id));
    const snaps = await this.db.getAll(...refs);
    return snaps.some(s => s.exists);
  }

  async listModels(caller: Caller): Promise<ModelRow[]> {
    const snap = await this.db.collection('models').where('userId', '==', caller.uid).select('name', 'updatedAt', 'storage').get();
    return snap.docs
      .map(d => ({
        id: d.id,
        name: String(d.get('name') ?? 'Untitled'),
        updatedAt: toIso(d.get('updatedAt')),
        storedIn: d.get('storage')?.fileId ? EXTERNAL_LABELS[d.get('storage').provider] ?? 'external storage' : undefined,
      }))
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }

  async loadModel(caller: Caller, ref: string): Promise<LoadedModel> {
    let snap = /^[A-Za-z0-9_-]{8,}$/.test(ref) ? await this.db.collection('models').doc(ref).get() : null;
    if (!snap?.exists || !(await this.canAccess(caller, snap.id, snap.data()))) {
      const row = matchModel(await this.listModels(caller), ref);
      snap = await this.db.collection('models').doc(row.id).get();
    }
    const data = snap.data();
    if (!data || !(await this.canAccess(caller, snap.id, data))) throw new ToolError('Model not found.');
    const external = externalStorageError(String(data.name ?? 'This model'), data.storage);
    if (external) throw external;
    return {
      id: snap.id, name: String(data.name ?? 'Untitled'), userId: data.userId, shapes: decodeShapes(data.shapes),
      graphicsSettings: normalizeGraphicsSettings(data.graphicsSettings), updatedAt: toIso(data.updatedAt),
    };
  }

  async changeShapes(caller: Caller, modelId: string, note: string, mutate: (shapes: Shape[]) => Shape[]) {
    const ref = this.db.collection('models').doc(modelId);
    const first = await ref.get();
    if (!(await this.canAccess(caller, modelId, first.data()))) throw new ToolError('Model not found.');
    const io = this.geometryIO(caller.uid);
    const next = await this.db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const data = snap.data();
      if (!data) throw new ToolError('Model not found.');
      const external = externalStorageError(String(data.name ?? 'This model'), data.storage);
      if (external) throw external;
      const result = mutate(decodeShapes(data.shapes));
      checkSize(result);
      // Same as the app's save: oversized geometry goes to its own document first.
      const stored = encodeShapes(await offloadLargeGeometryForSave(result, caller.uid, io));
      tx.update(ref, { shapes: stored, updatedAt: this.serverTimestamp() });
      tx.set(ref.collection('mcpHistory').doc(), {
        shapes: data.shapes ?? [], graphicsSettings: data.graphicsSettings ?? null, note, uid: caller.uid, createdAt: Date.now(),
      });
      return result;
    });
    await this.pruneHistory(modelId);
    return next;
  }

  async changeGraphicsSettings(caller: Caller, modelId: string, note: string, mutate: (settings: GraphicsSettings) => GraphicsSettings) {
    const ref = this.db.collection('models').doc(modelId);
    const first = await ref.get();
    if (!(await this.canAccess(caller, modelId, first.data()))) throw new ToolError('Model not found.');
    const next = await this.db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const data = snap.data();
      if (!data) throw new ToolError('Model not found.');
      const external = externalStorageError(String(data.name ?? 'This model'), data.storage);
      if (external) throw external;
      const result = mutate(normalizeGraphicsSettings(data.graphicsSettings));
      tx.update(ref, { graphicsSettings: result, updatedAt: this.serverTimestamp() });
      tx.set(ref.collection('mcpHistory').doc(), {
        shapes: data.shapes ?? [], graphicsSettings: data.graphicsSettings ?? null, note, uid: caller.uid, createdAt: Date.now(),
      });
      return result;
    });
    await this.pruneHistory(modelId);
    return next;
  }

  private async pruneHistory(modelId: string) {
    const old = await this.db.collection('models').doc(modelId).collection('mcpHistory')
      .orderBy('createdAt', 'desc').offset(HISTORY_LIMIT).select().get();
    await Promise.all(old.docs.map(d => d.ref.delete()));
  }

  async undo(caller: Caller, modelId: string) {
    const ref = this.db.collection('models').doc(modelId);
    const snap = await ref.get();
    if (!(await this.canAccess(caller, modelId, snap.data()))) throw new ToolError('Model not found.');
    const last = await ref.collection('mcpHistory').orderBy('createdAt', 'desc').limit(1).get();
    if (last.empty) return null;
    const entry = last.docs[0];
    await this.db.runTransaction(async tx => {
      tx.update(ref, { shapes: entry.get('shapes') ?? [], graphicsSettings: entry.get('graphicsSettings') ?? null, updatedAt: this.serverTimestamp() });
      tx.delete(entry.ref);
    });
    return String(entry.get('note') ?? 'last change');
  }

  async createModel(caller: Caller, name: string) {
    const ref = this.db.collection('models').doc();
    // Same fields the app writes for a new model (minus the password fields its rules forbid).
    await ref.set({
      id: ref.id,
      name,
      userId: caller.uid,
      userName: caller.name || caller.email,
      shapes: [],
      tags: [],
      scenes: [],
      customMaterials: [],
      animations: [],
      notes: [],
      customLights: [],
      graphicsSettings: defaultGraphicsSettings(),
      assetSchemaVersion: 1,
      updatedAt: this.serverTimestamp(),
      createdAt: this.serverTimestamp(),
      previewUrl: '',
      isPublic: false,
      hasPassword: false,
    });
    return ref.id;
  }
}

function toIso(value: any): string | undefined {
  if (!value) return undefined;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  if (typeof value === 'string') return value;
  return undefined;
}
