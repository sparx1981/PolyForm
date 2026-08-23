/**
 * PolyForm geometry kernel — public entry point.
 *
 * Import from here rather than reaching into individual modules; this is the
 * surface the tool layer (Phases 10+) and the render bridge (Phase 9b) are
 * written against.
 *
 * The kernel owns DRAWN geometry only. Parametric primitives, plants and
 * terrain stay in `Shape[]`. A given object lives in exactly one of the two.
 */

export * from './types';
export * from './math';
export * from './polygon';
export * from './mat4';
export * from './spatialIndex';
export * from './planeIndex';
export * from './topology';
export * from './context';
export * from './insert';
export * from './cycles';
export * from './derive';
export * from './pushpull';
export * from './curve';
export * from './tessellate';
export * from './diagnostics';
// heal.ts defines a runtime Transaction class; types.ts defines a Transaction
// record shape. Re-export the class under an unambiguous name rather than
// renaming either — both are load-bearing and the collision is nominal.
export {
  snapshot, restore, runTransaction, deleteEdge, dissolveRedundantVertices,
  cleanupOrphans, manifoldReport,
  Transaction as KernelTransaction,
} from './heal';
export type { Snapshot, CommitResult, DeleteEdgeResult } from './heal';

import type { EdgeId, FaceId, Graph, Tolerances, Vec3 } from './types';
import type { DeriveResult } from './derive';
import { DEFAULT_TOLERANCES } from './types';
import { createGraph, loopPoints } from './topology';
import { createEdgeIndex, insertEdge, type InsertContext } from './insert';
import { derive } from './derive';
import { deleteEdge, restore, snapshot, type Snapshot } from './heal';
import { SpatialIndex } from './spatialIndex';
import { planeBasis, projectToBasis } from './math';
import { signedArea } from './polygon';

export interface SessionOptions {
  readonly tolerances?: Tolerances;
  /** Fixed camera keeps orientation reproducible. Omit for headless. §6.4 */
  readonly cameraDirection?: Vec3;
  /** Host up axis. three.js defaults to Y-up; the kernel defaults to Z. §6.4 */
  readonly upAxis?: Vec3;
  readonly cellSize?: number;
}

/**
 * A convenience wrapper bundling the graph, its spatial index, the touched
 * set and an undo stack.
 *
 * Deliberately thin: everything here is available as free functions, and the
 * tool layer may prefer to drive those directly once it needs finer control
 * over transaction boundaries.
 */
export class KernelSession {
  readonly graph: Graph;
  readonly tolerances: Tolerances;
  private readonly index: SpatialIndex<EdgeId>;
  private readonly cameraDirection: Vec3 | undefined;
  private readonly upAxis: Vec3 | undefined;
  private touched = new Set<EdgeId>();
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];

  constructor(opts: SessionOptions = {}) {
    this.graph = createGraph();
    this.tolerances = opts.tolerances ?? DEFAULT_TOLERANCES;
    this.index = createEdgeIndex(this.graph, opts.cellSize ?? 1);
    this.cameraDirection = opts.cameraDirection;
    this.upAxis = opts.upAxis;
  }

  private get ctx(): InsertContext {
    return { graph: this.graph, tolerances: this.tolerances, index: this.index };
  }

  private get deriveOpts() {
    return {
      tolerances: this.tolerances,
      ...(this.cameraDirection ? { cameraDirection: this.cameraDirection } : {}),
      ...(this.upAxis ? { upAxis: this.upAxis } : {}),
    };
  }

  /**
   * Draws one segment. One call = one user action = one undo entry (§7.0).
   *
   * A retrace legitimately creates no edge and still derives — that is what
   * brings a deleted face back, so do not add a fast path that skips
   * derivation when nothing was created. §6.2 Phase 1b
   */
  drawLine(from: Vec3, to: Vec3): DeriveResult {
    const before = snapshot(this.graph);
    const r = insertEdge(this.ctx, from, to);
    for (const t of r.touched) this.touched.add(t);
    const result = derive(this.graph, this.touched, this.deriveOpts);
    this.touched.clear();
    this.undoStack.push(before);
    this.redoStack = [];
    return result;
  }

  /** Draws a connected chain as a single undo entry. */
  drawChain(points: readonly Vec3[]): DeriveResult {
    const before = snapshot(this.graph);
    for (let i = 0; i + 1 < points.length; i++) {
      const r = insertEdge(this.ctx, points[i]!, points[i + 1]!);
      for (const t of r.touched) this.touched.add(t);
    }
    const result = derive(this.graph, this.touched, this.deriveOpts);
    this.touched.clear();
    this.undoStack.push(before);
    this.redoStack = [];
    return result;
  }

  eraseEdge(id: EdgeId): DeriveResult {
    const before = snapshot(this.graph);
    const r = deleteEdge(this.graph, id, this.tolerances);
    for (const t of r.touched) this.touched.add(t);
    const result = derive(this.graph, this.touched, this.deriveOpts);
    this.touched.clear();
    this.undoStack.push(before);
    this.redoStack = [];
    return result;
  }

  /**
   * Undo restores a snapshot and does NOT re-derive. Derivation is
   * deterministic in geometry but not in face IDENTITY, and selection state
   * and external references key on face id. §7.0
   */
  undo(): boolean {
    const snap = this.undoStack.pop();
    if (!snap) return false;
    this.redoStack.push(snapshot(this.graph));
    restore(this.graph, snap);
    return true;
  }

  redo(): boolean {
    const snap = this.redoStack.pop();
    if (!snap) return false;
    this.undoStack.push(snapshot(this.graph));
    restore(this.graph, snap);
    return true;
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  /** Cap the stack by entry count so long sessions cannot grow without bound. */
  trimHistory(maxEntries = 200): void {
    if (this.undoStack.length > maxEntries) {
      this.undoStack = this.undoStack.slice(-maxEntries);
    }
  }

  /** Net surface area, holes subtracted. Useful as a test fingerprint. */
  totalArea(): number {
    let sum = 0;
    for (const f of this.graph.faces.values()) {
      const b = planeBasis(f.plane);
      sum += Math.abs(signedArea(loopPoints(this.graph, f.outerLoop).map((p) => projectToBasis(p, b))));
      for (const l of f.innerLoops) {
        sum -= Math.abs(signedArea(loopPoints(this.graph, l).map((p) => projectToBasis(p, b))));
      }
    }
    return sum;
  }

  get faceIds(): FaceId[] {
    return [...this.graph.faces.keys()].sort((a, b) => a - b);
  }

  get stats() {
    return {
      vertices: this.graph.vertices.size,
      edges: this.graph.edges.size,
      faces: this.graph.faces.size,
      area: this.totalArea(),
    };
  }
}
