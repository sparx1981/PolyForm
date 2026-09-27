/**
 * PolyForm — LineToolHost backed by the real kernel.
 *
 * The state machine in lineTool.ts is deliberately kernel-free so it can be
 * tested with fakes. This is the adapter that connects it to a real graph,
 * and it is where the transaction and undo semantics of §7.0 live.
 */

import type { EdgeId, Graph, Tolerances, Vec3 } from '../lib/geometry/types';
import { DEFAULT_TOLERANCES } from '../lib/geometry/types';
import { createGraph } from '../lib/geometry/topology';
import { createEdgeIndex, insertEdge, insertIsolatedEdge, type InsertContext } from '../lib/geometry/insert';
import { derive, type DeriveResult } from '../lib/geometry/derive';
import { snapshot, restore, type Snapshot } from '../lib/geometry/heal';
import { SpatialIndex } from '../lib/geometry/spatialIndex';
import { distance } from '../lib/geometry/math';
import type { CommitOutcome, LineToolHost } from './lineTool';
import { ISOLATED_SHAPE_KEY } from './kernelPushPull';

export interface KernelHostOptions {
  readonly tolerances?: Tolerances;
  readonly cameraDirection?: Vec3;
  /** Host up axis. three.js defaults to Y-up; the kernel defaults to Z. §6.4 */
  readonly upAxis?: Vec3;
  readonly cellSize?: number;
  /** Called after every successful commit, so the renderer can invalidate. */
  readonly onChange?: (result: DeriveResult) => void;
  /**
   * Called with the new entry's id each time an undo entry is recorded, so
   * the app can interleave kernel steps with its own history (one Ctrl+Z).
   */
  readonly onUndoRecorded?: (id: number) => void;
}

export class KernelLineHost implements LineToolHost {
  readonly graph: Graph;
  readonly tolerances: Tolerances;
  /** protected: KernelArcHost extends this and needs the same index. */
  protected index: SpatialIndex<EdgeId>;
  protected undoStack: Snapshot[] = [];
  protected redoStack: Snapshot[] = [];
  /** An id per undo/redo entry (parallel to the stacks), so a shared history can tell which entry is on top. */
  protected undoIds: number[] = [];
  protected redoIds: number[] = [];
  private nextUndoId = 1;
  private readonly onUndoRecorded: ((id: number) => void) | undefined;
  private batchDepth = 0;
  private batchBefore: Snapshot | null = null;
  private readonly cameraDirection: Vec3 | undefined;
  private readonly upAxis: Vec3 | undefined;
  protected readonly onChange: ((r: DeriveResult) => void) | undefined;

  constructor(opts: KernelHostOptions = {}, graph?: Graph) {
    this.graph = graph ?? createGraph();
    this.tolerances = opts.tolerances ?? DEFAULT_TOLERANCES;
    this.index = createEdgeIndex(this.graph, opts.cellSize ?? 1);
    this.cameraDirection = opts.cameraDirection;
    this.upAxis = opts.upAxis;
    this.onChange = opts.onChange;
    this.onUndoRecorded = opts.onUndoRecorded;
  }

  protected get ctx(): InsertContext {
    return { graph: this.graph, tolerances: this.tolerances, index: this.index };
  }

  protected get deriveOpts() {
    return {
      tolerances: this.tolerances,
      ...(this.cameraDirection ? { cameraDirection: this.cameraDirection } : {}),
      ...(this.upAxis ? { upAxis: this.upAxis } : {}),
    };
  }

  /**
   * Records an undo entry and clears redo. Shared with subclasses. Inside a
   * batch, only the state before the batch's first change is kept, and the
   * whole batch becomes one entry when it ends.
   */
  protected pushUndo(before: Snapshot): void {
    if (this.batchDepth > 0) {
      if (!this.batchBefore) this.batchBefore = before;
      return;
    }
    const id = this.nextUndoId++;
    this.undoStack.push(before);
    this.undoIds.push(id);
    this.redoStack = [];
    this.redoIds = [];
    this.onUndoRecorded?.(id);
  }

  /** Groups several commits (e.g. the sides of one rectangle) into one undo entry. */
  beginBatch(): void {
    this.batchDepth++;
  }

  endBatch(): void {
    if (this.batchDepth === 0) return;
    this.batchDepth--;
    if (this.batchDepth === 0 && this.batchBefore) {
      const before = this.batchBefore;
      this.batchBefore = null;
      this.pushUndo(before);
    }
  }

  /**
   * Runs an edit made directly on the graph (delete, paint, hide...) as one
   * undo entry. `edit` returns whether it changed anything.
   */
  transact(edit: () => boolean): boolean {
    const before = snapshot(this.graph);
    let changed = false;
    try {
      changed = edit();
    } catch (err) {
      restore(this.graph, before);
      this.rebuildIndex();
      throw err;
    }
    if (changed) this.pushUndo(before);
    return changed;
  }

  /** Id of the entry Ctrl+Z would undo next, or null. */
  get topUndoId(): number | null {
    return this.undoIds.length ? this.undoIds[this.undoIds.length - 1]! : null;
  }

  /** Id of the entry redo would restore next, or null. */
  get topRedoId(): number | null {
    return this.redoIds.length ? this.redoIds[this.redoIds.length - 1]! : null;
  }

  protected notify(result: DeriveResult): void {
    this.onChange?.(result);
  }

  /** The spatial index is derived state; rebuild after any restore. */
  protected rebuildIndex(): void {
    this.index = createEdgeIndex(this.graph, this.index.cellSize);
  }

  /**
   * Rebuilds derived state after the graph's CONTENTS are replaced wholesale,
   * as happens when a document is loaded. The Graph object identity survives —
   * the index and every consumer hold a reference to it — so only its
   * contents change, and the index must be rebuilt against them.
   *
   * Also clears history: undoing into a previous document's geometry would be
   * worse than having no history at all.
   */
  /** For operations that drive the kernel directly, such as push/pull. */
  get spatialIndex(): SpatialIndex<EdgeId> {
    return this.index;
  }

  get deriveOptions() {
    return this.deriveOpts;
  }

  /** Records an undo entry for an externally applied change. */
  recordUndo(before: Snapshot): void {
    this.pushUndo(before);
  }

  /**
   * Rebuilds the spatial index after the graph was restored from a
   * snapshot outside this host (e.g. undoing a Convert To Wall). Unlike
   * reindex(), history is kept: it is still the same document.
   */
  refreshIndex(): void {
    this.rebuildIndex();
  }

  reindex(): void {
    this.rebuildIndex();
    this.undoStack = [];
    this.redoStack = [];
    this.undoIds = [];
    this.redoIds = [];
  }

  /**
   * One segment, one transaction, one undo entry.
   *
   * Validation rejects geometry that CANNOT EXIST. It must not reject an edit
   * that merely ADDS NOTHING: a retrace creates no edge, is entirely valid,
   * and is what brings a deleted face back. §7.0
   */
  commitSegment(from: Vec3, to: Vec3): CommitOutcome {
    if (distance(from, to) < this.tolerances.MIN_EDGE_LENGTH) {
      return { ok: false, edges: [], wasOverdraw: false, reason: 'zero-length segment' };
    }

    const before = snapshot(this.graph);
    let result: DeriveResult;
    let edges: readonly EdgeId[];
    let wasOverdraw: boolean;

    try {
      const inserted = insertEdge(this.ctx, from, to);
      edges = inserted.edges;
      wasOverdraw = inserted.wasOverdraw;
      result = derive(this.graph, inserted.touched, this.deriveOpts);
    } catch (err) {
      restore(this.graph, before);
      this.rebuildIndex();
      return {
        ok: false, edges: [], wasOverdraw: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    this.pushUndo(before);
    this.notify(result);
    return { ok: true, edges, wasOverdraw };
  }

  /**
   * A whole closed outline (a Polyline or closed Bézier shape) as one
   * transaction and one undo entry, drawn with isolated edges like
   * Rectangle/Circle/Triangle so it neither splits nor is split by other
   * shapes it happens to cross. Faces it creates are marked as isolated
   * shapes, so extruding them stays isolated too (see kernelPushPull.ts).
   */
  commitIsolatedRing(points: readonly Vec3[]): { ok: boolean; faces: number[]; reason?: string } {
    const ring = points.filter((p, i) => distance(p, points[(i + 1) % points.length]!) >= this.tolerances.MIN_EDGE_LENGTH);
    if (ring.length < 3) return { ok: false, faces: [], reason: 'too few points' };
    const before = snapshot(this.graph);
    const facesBefore = new Set(this.graph.faces.keys());
    let result: DeriveResult;
    try {
      const touched = new Set<EdgeId>();
      for (let i = 0; i < ring.length; i++) {
        for (const t of insertIsolatedEdge(this.ctx, ring[i]!, ring[(i + 1) % ring.length]!).touched) touched.add(t);
      }
      result = derive(this.graph, touched, this.deriveOpts);
    } catch (err) {
      restore(this.graph, before);
      this.rebuildIndex();
      return { ok: false, faces: [], reason: err instanceof Error ? err.message : String(err) };
    }
    const faces: number[] = [];
    for (const [id, face] of this.graph.faces) {
      if (facesBefore.has(id)) continue;
      face.attributes.custom[ISOLATED_SHAPE_KEY] = true;
      faces.push(id);
    }
    this.pushUndo(before);
    this.notify(result);
    return { ok: true, faces };
  }

  /**
   * The same one-segment, one-transaction, one-undo-entry shape as
   * commitSegment, but using insertIsolatedEdge instead of insertEdge —
   * see that function's own doc comment for the full reasoning. Used by
   * Rectangle/Circle/Triangle (a single shape drawn as one gesture),
   * never by the Line/Arc tool, which keeps the original sticky
   * behaviour: those tools ARE the deliberate "connect into/divide an
   * existing surface" action.
   */
  commitIsolatedSegment(from: Vec3, to: Vec3): CommitOutcome {
    if (distance(from, to) < this.tolerances.MIN_EDGE_LENGTH) {
      return { ok: false, edges: [], wasOverdraw: false, reason: 'zero-length segment' };
    }

    const before = snapshot(this.graph);
    let result: DeriveResult;
    let edges: readonly EdgeId[];
    let wasOverdraw: boolean;

    try {
      const inserted = insertIsolatedEdge(this.ctx, from, to);
      edges = inserted.edges;
      wasOverdraw = inserted.wasOverdraw;
      result = derive(this.graph, inserted.touched, this.deriveOpts);
    } catch (err) {
      restore(this.graph, before);
      this.rebuildIndex();
      return {
        ok: false, edges: [], wasOverdraw: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    this.pushUndo(before);
    this.notify(result);
    return { ok: true, edges, wasOverdraw };
  }

  /**
   * Rolls the last commit back completely, and rebuilds the spatial index
   * from the restored graph — the index is derived state and cannot be
   * snapshotted meaningfully alongside it.
   */
  rollbackLast(): void {
    const snap = this.undoStack.pop();
    this.undoIds.pop();
    if (!snap) return;
    restore(this.graph, snap);
    this.rebuildIndex();
  }

  /**
   * Discards the top undo entry, so a re-solve leaves ONE entry rather than
   * two. The user drew one segment and corrected it; Ctrl-Z should remove the
   * segment, not step backwards through their typing. §4.3
   */
  replaceUndoEntry(): void {
    if (this.undoStack.length >= 2) {
      const latest = this.undoStack.pop()!;
      this.undoStack.pop();
      this.undoStack.push(latest);
      // The surviving entry keeps the older id: that is the one a shared history recorded first.
      this.undoIds.pop();
    }
  }

  undo(): boolean {
    const snap = this.undoStack.pop();
    if (!snap) return false;
    this.redoIds.push(this.undoIds.pop() ?? 0);
    this.redoStack.push(snapshot(this.graph));
    restore(this.graph, snap);
    this.rebuildIndex();
    return true;
  }

  redo(): boolean {
    const snap = this.redoStack.pop();
    if (!snap) return false;
    this.undoIds.push(this.redoIds.pop() ?? 0);
    this.undoStack.push(snapshot(this.graph));
    restore(this.graph, snap);
    this.rebuildIndex();
    return true;
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get undoDepth(): number { return this.undoStack.length; }

  trimHistory(maxEntries = 200): void {
    if (this.undoStack.length > maxEntries) {
      this.undoStack = this.undoStack.slice(-maxEntries);
      this.undoIds = this.undoIds.slice(-maxEntries);
    }
  }
}
