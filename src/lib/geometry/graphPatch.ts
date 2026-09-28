/**
 * PolyForm geometry kernel — change sets.
 *
 * What the action recorder writes for drawn geometry, and what
 * `sdk.drawing.applyChanges` replays: the vertices, edges, loops, faces and
 * curves a step added, changed or removed, plus the id counters after it.
 * Ids are handed out in order, so replaying the same steps on the same
 * starting drawing reproduces the same ids and later steps find their faces.
 *
 * Built on the storage format (serialize.ts), plus each face's `custom`
 * attributes, which that format does not keep but which change behaviour
 * (a drawn shape's isolation marker, bezier knots, surface depth).
 */

import { serializeGraph, deserializeGraph, type SerializedGraph } from './serialize';
import type { FaceId, Graph, IdCounters } from './types';

const KINDS = ['vertices', 'edges', 'loops', 'faces', 'curves'] as const;
type Kind = typeof KINDS[number];
type Rec = { id: number } & Record<string, unknown>;

export interface KernelState {
  nextId: IdCounters;
  records: Record<Kind, Map<number, Rec>>;
}

export interface KernelPatch {
  nextId: IdCounters;
  set?: Partial<Record<Kind, Rec[]>>;
  remove?: Partial<Record<Kind, number[]>>;
}

/** Stable JSON: plain data only, so two captures of the same drawing compare equal. */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null));

export function captureKernelState(g: Graph): KernelState {
  const data = serializeGraph(g);
  const records = {} as KernelState['records'];
  for (const kind of KINDS) {
    records[kind] = new Map((data[kind] as unknown as Rec[]).map(r => [r.id, r]));
  }
  for (const [id, rec] of records.faces) {
    const custom = g.faces.get(id as FaceId)?.attributes.custom;
    if (custom && Object.keys(custom).length > 0) records.faces.set(id, { ...rec, custom: plain(custom) });
  }
  return { nextId: { ...data.nextId }, records };
}

/** What changed between two captures, or null when nothing did. */
export function diffKernelStates(before: KernelState, after: KernelState): KernelPatch | null {
  const set: Partial<Record<Kind, Rec[]>> = {};
  const remove: Partial<Record<Kind, number[]>> = {};
  let changed = JSON.stringify(before.nextId) !== JSON.stringify(after.nextId);
  for (const kind of KINDS) {
    const a = before.records[kind];
    const b = after.records[kind];
    const added: Rec[] = [];
    for (const [id, rec] of b) {
      const old = a.get(id);
      if (!old || JSON.stringify(old) !== JSON.stringify(rec)) added.push(rec);
    }
    const gone = [...a.keys()].filter(id => !b.has(id));
    if (added.length) { set[kind] = added; changed = true; }
    if (gone.length) { remove[kind] = gone; changed = true; }
  }
  if (!changed) return null;
  const patch: KernelPatch = { nextId: { ...after.nextId } };
  if (Object.keys(set).length) patch.set = set;
  if (Object.keys(remove).length) patch.remove = remove;
  return patch;
}

/**
 * Applies a change set to the graph in place. The Graph object keeps its
 * identity (the spatial index and every consumer hold it); the caller
 * rebuilds the index and records undo.
 */
export function applyKernelPatch(g: Graph, patch: KernelPatch): void {
  const state = captureKernelState(g);
  for (const kind of KINDS) {
    for (const id of patch.remove?.[kind] ?? []) state.records[kind].delete(id);
    for (const rec of patch.set?.[kind] ?? []) state.records[kind].set(rec.id, rec);
  }
  const data = { version: 1, nextId: { ...patch.nextId } } as SerializedGraph;
  for (const kind of KINDS) {
    (data as unknown as Record<Kind, Rec[]>)[kind] = [...state.records[kind].values()].sort((x, y) => x.id - y.id);
  }
  const next = deserializeGraph(data);
  for (const rec of state.records.faces.values()) {
    const face = next.faces.get(rec.id as FaceId);
    if (face && rec.custom && typeof rec.custom === 'object') {
      face.attributes.custom = plain(rec.custom) as Record<string, unknown>;
    }
  }
  g.vertices = next.vertices;
  g.edges = next.edges;
  g.loops = next.loops;
  g.faces = next.faces;
  g.curves = next.curves;
  g.components = next.components;
  g.nextId = next.nextId;
}
