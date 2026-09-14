import * as THREE from 'three';
import { KernelSession } from '../../lib/geometry';
import { BezierCurveState } from './types';
import { tessellateEntireCurve } from './tessellate';

export class KernelBezierHost {
  constructor(
    public readonly session: KernelSession,
    private readonly onChange?: () => void
  ) {}

  public get undoDepth(): number {
    return this.session.undoDepth;
  }

  public commitCurve(state: BezierCurveState, replaceUndo: boolean = false): { ok: boolean; points: THREE.Vector3[] } {
    if (state.knots.length < 2) return { ok: false, points: [] };

    const points = tessellateEntireCurve(state.knots, state.isClosed, state.segmentsPerSpan);

    try {
      // PolyForm pattern: If replaceUndo is true, rollback intermediate state first.
      // Wrapped in try/catch, and replaceUndoEntry only runs when the
      // preceding undo (if requested) actually succeeded: none of these
      // three steps are expected to throw or fail today, but if the
      // session were ever left in a partial state mid-sequence (e.g. a
      // future change makes undo/drawChain throw on unusual input), the
      // previous version had no guard between them — replaceUndoEntry()
      // would still run unconditionally and could pop the wrong undo
      // entries on top of an already-inconsistent stack. Failing the
      // whole commit instead is a much safer outcome than that.
      let undone = false;
      if (replaceUndo && this.session.canUndo) {
        undone = this.session.undo();
      }

      this.session.drawChain(points.map(p => ({ x: p.x, y: p.y, z: p.z })));

      if (replaceUndo && undone) {
        this.session.replaceUndoEntry();
      }
    } catch (err) {
      console.error('[KernelBezierHost] commitCurve failed:', err);
      return { ok: false, points: [] };
    }

    this.onChange?.();
    return { ok: true, points };
  }
}
