import { describe, expect, it } from 'vitest';
import { FirestoreStore, externalStorageError } from '../src/store';

describe('models kept in Drive or Trimble Connect', () => {
  it('are explained, not opened', () => {
    expect(externalStorageError('House', { provider: 'google-drive', fileId: 'f' })?.message).toMatch(/stored in Google Drive/);
    expect(externalStorageError('House', { provider: 'trimble-connect', fileId: 'f' })?.message).toMatch(/Trimble Connect/);
    expect(externalStorageError('House', undefined)).toBeNull();
  });
});

/** Just enough of firebase-admin's Firestore to run FirestoreStore, counting billed reads. */
function fakeFirestore() {
  const docs = new Map<string, Record<string, any>>();
  let reads = 0;
  let auto = 0;
  const newId = () => `generated${String(auto++).padStart(11, '0')}`;
  const isChild = (prefix: string, key: string) => key.startsWith(`${prefix}/`) && !key.slice(prefix.length + 1).includes('/');
  const snap = (path: string) => {
    const data = docs.get(path);
    return { id: path.split('/').pop()!, exists: !!data, data: () => data && { ...data }, get: (k: string) => data?.[k], ref: docRef(path) };
  };
  function docRef(path: string): any {
    return {
      path,
      id: path.split('/').pop(),
      get: async () => { reads++; return snap(path); },
      set: async (d: any) => { docs.set(path, { ...d }); },
      collection: (name: string) => collectionRef(`${path}/${name}`),
    };
  }
  function query(prefix: string, filter: (d: any) => boolean, order?: string, lim?: number): any {
    return {
      where: (f: string, _op: string, v: unknown) => query(prefix, d => filter(d) && d[f] === v, order, lim),
      select: () => query(prefix, filter, order, lim),
      orderBy: (f: string) => query(prefix, filter, f, lim),
      limit: (n: number) => query(prefix, filter, order, n),
      get: async () => {
        let hits = [...docs.keys()].filter(k => isChild(prefix, k) && filter(docs.get(k)));
        if (order) hits.sort((x, y) => docs.get(y)![order] - docs.get(x)![order]);
        if (lim) hits = hits.slice(0, lim);
        reads += Math.max(1, hits.length); // an empty query is still billed one read
        const list = hits.map(snap);
        return { empty: !list.length, docs: list };
      },
    };
  }
  function collectionRef(path: string): any {
    return { ...query(path, () => true), doc: (id?: string) => docRef(`${path}/${id ?? newId()}`) };
  }
  const db: any = {
    collection: collectionRef,
    getAll: async (...refs: any[]) => Promise.all(refs.map(r => r.get())),
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => {
      const writes: (() => void)[] = [];
      const out = await fn({
        get: (r: any) => r.get(),
        set: (r: any, d: any) => writes.push(() => docs.set(r.path, { ...d })),
        update: (r: any, d: any) => writes.push(() => docs.set(r.path, { ...docs.get(r.path), ...d })),
        delete: (r: any) => writes.push(() => docs.delete(r.path)),
      });
      writes.forEach(w => w());
      return out;
    },
  };
  return { db, docs, reads: () => reads, resetReads: () => { reads = 0; } };
}

describe('FirestoreStore reads and undo history', () => {
  const caller = { uid: 'u1', email: 'me@example.com' };
  const box = (id: string) => ({ id, type: 'box', position: [0, 0, 0] }) as any;

  it('reads the model once per change, keeps at most 20 undo entries, and undoes in order', async () => {
    const fake = fakeFirestore();
    const store = new FirestoreStore(fake.db, () => Date.now());
    const id = await store.createModel(caller, 'House');

    fake.resetReads();
    const changed = await store.changeShapes(caller, id, 'first', s => [...s, box('a')]);
    expect(changed).toEqual({ id, name: 'House' });
    expect(fake.reads()).toBe(1);

    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1));
      await store.changeShapes(caller, id, `add ${i}`, s => [...s, box(`b${i}`)]);
    }
    const history = [...fake.docs.keys()].filter(k => k.startsWith(`models/${id}/mcpHistory/`));
    expect(history.length).toBe(20);

    fake.resetReads();
    const undone = await store.undo(caller, id);
    expect(undone.note).toBe('add 29');
    expect(fake.reads()).toBe(2);
    expect((await store.loadModel(caller, id)).shapes.map(s => s.id)).not.toContain('b29');
    expect((await store.undo(caller, id)).note).toBe('add 28');
  });

  it('still finds a model by name, and refuses other people’s models', async () => {
    const fake = fakeFirestore();
    const store = new FirestoreStore(fake.db, () => Date.now());
    const id = await store.createModel(caller, 'My Garden');
    expect((await store.changeShapes(caller, 'my garden', 'add', s => [...s, box('a')])).id).toBe(id);
    await expect(store.changeShapes({ uid: 'u2', email: 'x@example.com' }, id, 'add', s => s)).rejects.toThrow(/No model called/);
  });
});

describe('FirestoreStore large values', () => {
  const caller = { uid: 'u1', email: 'me@example.com' };
  const docSize = (fields: Record<string, any>) => JSON.stringify(fields, (_k, v) => (v instanceof Uint8Array ? `${v.length}b` : v)).length;

  it('saves a mesh far over 1 MB compressed, and a big terrain grid that the tools can still read', async () => {
    const fake = fakeFirestore();
    const store = new FirestoreStore(fake.db, () => Date.now());
    const id = await store.createModel(caller, 'House');
    // Roof-tile-like mesh: ~6 MB of JSON.
    const positions = Array.from({ length: 400000 }, (_, i) => ((i * 7) % 1000) * 0.0123456789);
    const n = 150 * 150;
    const heights = Array.from({ length: n }, (_, i) => Math.sin(i / 50) * 2);
    await store.changeShapes(caller, id, 'add', s => [
      ...s,
      { id: 'tiles', type: 'custom', position: [0, 0, 0], geometryData: { positions } } as any,
      { id: 'ground', type: 'terrain', position: [0, 0, 0], terrainData: { gridX: 150, gridY: 150, width: 60, depth: 60, heights } } as any,
    ]);

    const model = fake.docs.get(`models/${id}`)!;
    expect(docSize(model)).toBeLessThan(5000);
    const overflow = [...fake.docs.entries()].filter(([k]) => k.startsWith('geometryOverflow/'));
    expect(overflow.length).toBeGreaterThan(0);
    for (const [, fields] of overflow) expect(fields.data.length).toBeLessThanOrEqual(900_000);

    const loaded = await store.loadModel(caller, id);
    expect(loaded.shapes.find(s => s.id === 'ground')!.terrainData!.heights).toEqual(heights);

    // A later change keeps both stored as they were, without writing them again.
    const before = overflow.length;
    await store.changeShapes(caller, id, 'add box', s => [...s, { id: 'b', type: 'box', position: [0, 0, 0] } as any]);
    expect([...fake.docs.keys()].filter(k => k.startsWith('geometryOverflow/')).length).toBe(before);
    expect(fake.docs.get(`models/${id}`)!.shapes.find((s: any) => s.id === 'tiles').geometryData).toEqual(model.shapes.find((s: any) => s.id === 'tiles').geometryData);
  });

  it('refuses a change that would make the model too large, saying why', async () => {
    const fake = fakeFirestore();
    const store = new FirestoreStore(fake.db, () => Date.now());
    const id = await store.createModel(caller, 'House');
    const walls = Array.from({ length: 4000 }, (_, i) => ({ id: `w${i}`, type: 'wall', name: `Wall ${i}`, position: [i, 0, 0], args: [1, 2, 3], customData: { note: 'x'.repeat(250) } }));
    await expect(store.changeShapes(caller, id, 'add', s => [...s, ...walls as any])).rejects.toThrow(/too large to save.*not saved/);
  });
});
