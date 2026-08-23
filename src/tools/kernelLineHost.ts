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
import { createEdgeIndex, insertEdge, type InsertContext } from '../lib/geometry/insert';
import { derive, type DeriveResult } from '../lib/geometry/derive';
import { snapshot, restore, type Snapshot } from '../lib/geometry/heal';
import { SpatialIndex } from '../lib/geometry/spatialIndex';
import { distance } from '../lib/geometry/math';
import type { CommitOutcome, LineToolHost } from './lineTool';

export interface KernelHostOptions {
  readonly tolerances?: Tolerances;
  readonly cameraDirection?: Vec3;
  /** Host up axis. three.js defaults to Y-up; the kernel defaults to Z. §6.4 */
  readonly upAxis?: Vec3;
  readonly cellSize?: number;
  /** Called after every successful commit, so the renderer can invalidate. */
  readonly onChange?: (result: DeriveResult) => void;
}

export class KernelLineHost implements LineToolHost {
  readonly graph: Graph;
  readonly tolerances: Tolerances;
  /** protected: KernelArcHost extends this and needs the same index. */
  protected index: SpatialIndex<EdgeId>;
  protected undoStack: Snapshot[] = [];
  protected redoStack: Snapshot[] = [];
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

  /** Records an undo entry and clears redo. Shared with subclasses. */
  protected pushUndo(before: Snapshot): void {
    this.undoStack.push(before);
    this.redoStack = [];
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
  reindex(): void {
    this.rebuildIndex();
    this.undoStack = [];
    this.redoStack = [];
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
   * Rolls the last commit back completely, and rebuilds the spatial index
   * from the restored graph — the index is derived state and cannot be
   * snapshotted meaningfully alongside it.
   */
  rollbackLast(): void {
    const snap = this.undoStack.pop();
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
    }
  }

  undo(): boolean {
    const snap = this.undoStack.pop();
    if (!snap) return false;
    this.redoStack.push(snapshot(this.graph));
    restore(this.graph, snap);
    this.rebuildIndex();
    return true;
  }

  redo(): boolean {
    const snap = this.redoStack.pop();
    if (!snap) return false;
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
    }
  }
}
