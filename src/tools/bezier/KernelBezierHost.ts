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
    
    // PolyForm pattern: If replaceUndo is true, rollback intermediate state first
    if (replaceUndo && this.session.canUndo) {
      this.session.undo();
    }

    this.session.drawChain(points.map(p => ({ x: p.x, y: p.y, z: p.z })));

    if (replaceUndo) {
      this.session.replaceUndoEntry();
    }

    this.onChange?.();
    return { ok: true, points };
  }
}
