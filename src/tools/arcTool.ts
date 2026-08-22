/**
 * PolyForm — Arc tool state machine. §5.1-§5.4, §5.2 tangency
 *
 * Four modes on one grammar. Keeping them under a single tool matters: the
 * user learns click, click, move, optionally type, and picks the mode that
 * matches the constraint they already know. Mode B adds exactly one extra
 * move-and-click over the Line tool.
 *
 * Pure, like lineTool.ts — events in, state and intents out.
 */

import type { CurveId, EdgeId, Tolerances, Vec3 } from '../lib/geometry/types';
import { DEFAULT_TOLERANCES } from '../lib/geometry/types';
import {
  add, cross, distance, dot, length, normalize, scale, sub, tryNormalize,
} from '../lib/geometry/math';
import {
  arcFromCentreStartSweep, arcFromChordBulge, arcFromThreePoints,
  DEFAULT_SEGMENTS, type ArcSpec,
} from '../lib/geometry/curve';
import { parseMeasurement, type DocumentUnit, type Measurement } from './measurement';

export type ArcMode =
  /** A: centre, radius, angle. §5.1 */
  | 'centre'
  /** B: chord and bulge. The default. §5.2 */
  | 'twoPoint'
  /** C: three points. §5.3 */
  | 'threePoint'
  /** D: pie — arc plus two radii, so a face derives on commit. §5.4 */
  | 'pie';

export type ArcPhase = 'inactive' | 'ready' | 'first' | 'second';

export interface ArcCommitOutcome {
  readonly ok: boolean;
  readonly curveId?: CurveId | null;
  readonly edges?: readonly EdgeId[];
  readonly demoted?: boolean;
  readonly reason?: string;
}

export interface ArcToolHost {
  commitArc(spec: ArcSpec, anchors: { start?: Vec3; end?: Vec3 }): ArcCommitOutcome;
  /** Pie mode also closes the two radii, so a face derives. §5.4 */
  commitPie(spec: ArcSpec, centre: Vec3): ArcCommitOutcome;
  /** Emitted when a tangency constraint degenerates to a straight line. §5.2 */
  commitLine(from: Vec3, to: Vec3): ArcCommitOutcome;
  /**
   * Direction of the edge arriving at `point`, if the point is an edge
   * endpoint. Supplied by the inference engine; drives tangency.
   */
  incomingEdgeDirection?(point: Vec3): Vec3 | null;
}

export interface ArcToolState {
  readonly phase: ArcPhase;
  readonly mode: ArcMode;
  readonly p0: Vec3 | null;
  readonly p1: Vec3 | null;
  readonly cursor: Vec3 | null;
  readonly segments: number;
  /** Live preview, null while the arc is under-determined. */
  readonly preview: ArcSpec | null;
  /** True while the tangency constraint is active and being honoured. */
  readonly tangentActive: boolean;
  /** True when bulge is exactly half the chord. §5.2 */
  readonly halfCircle: boolean;
  readonly fieldText: string;
  readonly lastError: string | null;
  /** Set when tangency collapsed and the tool degraded to a line. §5.2 */
  readonly degradedToLine: boolean;
}

const EMPTY: ArcToolState = {
  phase: 'inactive',
  mode: 'twoPoint',
  p0: null,
  p1: null,
  cursor: null,
  segments: DEFAULT_SEGMENTS,
  preview: null,
  tangentActive: false,
  halfCircle: false,
  fieldText: '',
  lastError: null,
  degradedToLine: false,
};

export class ArcTool {
  private state: ArcToolState = EMPTY;
  private lastBulge: number | null = null;
  private tangentDirection: Vec3 | null = null;

  constructor(
    private readonly host: ArcToolHost,
    private readonly tolerances: Tolerances = DEFAULT_TOLERANCES,
    private readonly docUnit: DocumentUnit = 'm',
  ) {}

  get current(): ArcToolState {
    return this.state;
  }

  private set(patch: Partial<ArcToolState>): ArcToolState {
    this.state = { ...this.state, ...patch };
    return this.state;
  }

  activate(mode: ArcMode = 'twoPoint'): ArcToolState {
    this.tangentDirection = null;
    return this.set({ ...EMPTY, phase: 'ready', mode, segments: this.state.segments });
  }

  setMode(mode: ArcMode): ArcToolState {
    return this.activate(mode);
  }

  deactivate(): ArcToolState {
    this.tangentDirection = null;
    return this.set(EMPTY);
  }

  escape(): ArcToolState {
    this.tangentDirection = null;
    return this.set({
      phase: 'ready', p0: null, p1: null, preview: null,
      fieldText: '', tangentActive: false, halfCircle: false, degradedToLine: false,
    });
  }

  // -------------------------------------------------------------------------
  // Pointer
  // -------------------------------------------------------------------------

  click(point: Vec3): ArcToolState {
    switch (this.state.phase) {
      case 'inactive':
        return this.state;

      case 'ready': {
        // Acquire the tangency constraint at the moment the chord starts.
        this.tangentDirection = this.host.incomingEdgeDirection?.(point) ?? null;
        return this.set({ phase: 'first', p0: point, cursor: point, degradedToLine: false });
      }

      case 'first':
        return this.set({ phase: 'second', p1: point, cursor: point });

      case 'second': {
        const committed = this.commitFromCursor(point);
        return committed;
      }
    }
  }

  move(point: Vec3): ArcToolState {
    if (this.state.phase === 'inactive' || this.state.phase === 'ready') {
      return this.set({ cursor: point });
    }
    const preview = this.solve(point);
    return this.set({
      cursor: point,
      preview: preview.spec,
      tangentActive: preview.tangentActive,
      halfCircle: preview.halfCircle,
    });
  }

  // -------------------------------------------------------------------------
  // Solving
  // -------------------------------------------------------------------------

  private solve(cursor: Vec3): {
    spec: ArcSpec | null;
    tangentActive: boolean;
    halfCircle: boolean;
    straight?: { from: Vec3; to: Vec3 };
  } {
    const { mode, p0, p1, segments } = this.state;

    if (mode === 'centre' || mode === 'pie') {
      if (!p0) return { spec: null, tangentActive: false, halfCircle: false };
      if (this.state.phase === 'first') return { spec: null, tangentActive: false, halfCircle: false };
      if (!p1) return { spec: null, tangentActive: false, halfCircle: false };
      const startVec = sub(p1, p0);
      const cursorVec = sub(cursor, p0);
      const normal = tryNormalize(cross(startVec, cursorVec)) ?? vecFallbackNormal(startVec);
      if (!normal) return { spec: null, tangentActive: false, halfCircle: false };
      const basis = orthonormal(startVec, normal);
      const sweep = Math.atan2(dot(cursorVec, basis.v), dot(cursorVec, basis.u));
      const spec = arcFromCentreStartSweep(p0, p1, sweep, normal, segments);
      return { spec, tangentActive: false, halfCircle: false };
    }

    if (mode === 'threePoint') {
      if (!p0 || !p1) return { spec: null, tangentActive: false, halfCircle: false };
      const spec = arcFromThreePoints(p0, p1, cursor, segments);
      return { spec, tangentActive: false, halfCircle: false };
    }

    // Mode B: chord and bulge.
    if (!p0) return { spec: null, tangentActive: false, halfCircle: false };
    if (!p1) return { spec: null, tangentActive: false, halfCircle: false };

    const chord = sub(p1, p0);
    const chordLen = length(chord);
    if (!(chordLen > 0)) return { spec: null, tangentActive: false, halfCircle: false };

    const chordDir = normalize(chord, 'arc chord');
    const toCursor = sub(cursor, p0);
    // Component of the cursor perpendicular to the chord, in the drag plane.
    const perp = sub(toCursor, scale(chordDir, dot(toCursor, chordDir)));
    let bulgeDir = tryNormalize(perp);
    let bulge = bulgeDir ? dot(perp, bulgeDir) : 0;

    if (this.tangentDirection) {
      const solved = this.solveTangent(p0, p1, chordDir, chordLen);
      if (solved.straight) {
        return { spec: null, tangentActive: false, halfCircle: false, straight: solved.straight };
      }
      if (solved.suppress) {
        // Anti-aligned: no sensible arc. Drop the constraint for this drag
        // and let the cursor define the plane. The cyan cue disappearing is
        // the correct signal. §5.2
        this.tangentDirection = null;
      } else if (solved.bulgeDirection && solved.bulge !== undefined) {
        // Take BOTH the direction and the magnitude from the constraint.
        // Tangency plus a chord fully determines the arc — the radius follows
        // from the tangent-chord angle — so keeping the cursor's bulge would
        // leave the curve visibly non-tangent while the cue claimed otherwise.
        // The cursor decides WHICH constraint applies, never the geometry. §5.2
        bulgeDir = solved.bulgeDirection;
        bulge = solved.bulge;
      }
    }

    if (!bulgeDir || Math.abs(bulge) < 1e-9) {
      return { spec: null, tangentActive: this.tangentDirection !== null, halfCircle: false };
    }

    const spec = arcFromChordBulge(p0, p1, bulge, bulgeDir, segments);
    this.lastBulge = Math.abs(bulge);
    return {
      spec,
      tangentActive: this.tangentDirection !== null,
      halfCircle: Math.abs(Math.abs(bulge) - chordLen / 2) < chordLen * 1e-3,
    };
  }

  /**
   * Tangency, solved analytically. §5.2
   *
   * Once the inference is active the cursor's contribution to the start
   * direction is discarded entirely: t = -normalize(d_edge) exactly. Letting
   * a screen-space snap supply a direction tangent to within ~1e-5 rad looks
   * identical and then fails COPLANARITY_TOLERANCE downstream — a
   * smooth-looking curve that refuses to make a surface.
   */
  private solveTangent(
    p0: Vec3,
    p1: Vec3,
    chordDir: Vec3,
    chordLen: number,
  ): {
    bulgeDirection?: Vec3;
    bulge?: number;
    straight?: { from: Vec3; to: Vec3 };
    suppress?: boolean;
  } {
    const t = normalize(scale(this.tangentDirection!, -1), 'arc tangent');
    const c = cross(t, chordDir);
    const mag = length(c); // |t x chord| / (|t||chord|) — both unit, so a sine

    if (mag < this.tolerances.MIN_CROSS_MAGNITUDE) {
      // Branch on WHY it collapsed rather than substituting a plane. §5.2
      if (dot(t, chordDir) > 0) {
        // Aligned: the constraint describes a straight line. Degrade
        // gracefully into the Line tool — almost always what was wanted.
        return { straight: { from: p0, to: p1 } };
      }
      // Anti-aligned: the arc would double back through 360 degrees. There is
      // no sensible answer, so suppress the inference for this drag.
      return { suppress: true };
    }

    const normal = normalize(c, 'arc tangent normal');
    // Perpendicular to the chord, in the tangent's plane, on the tangent side.
    const bulgeDirection = normalize(cross(normal, chordDir), 'arc bulge dir');
    const signed = dot(t, bulgeDirection) >= 0 ? bulgeDirection : scale(bulgeDirection, -1);

    // Radius from the tangent-chord angle: L = 2R sin(theta).
    const theta = Math.asin(Math.min(1, Math.max(-1, mag)));
    const radius = chordLen / (2 * Math.sin(theta || 1e-9));
    const bulge = radius - Math.sqrt(Math.max(0, radius * radius - (chordLen / 2) ** 2));

    return { bulgeDirection: signed, bulge };
  }

  // -------------------------------------------------------------------------
  // Commit
  // -------------------------------------------------------------------------

  private commitFromCursor(point: Vec3): ArcToolState {
    const solved = this.solve(point);

    if (solved.straight) {
      const r = this.host.commitLine(solved.straight.from, solved.straight.to);
      const s = this.escape();
      return { ...s, degradedToLine: r.ok };
    }

    if (!solved.spec) return this.set({ lastError: 'arc is under-determined' });

    const outcome =
      this.state.mode === 'pie' && this.state.p0
        ? this.host.commitPie(solved.spec, this.state.p0)
        : this.host.commitArc(solved.spec, {
            ...(this.state.p0 ? { start: this.state.p0 } : {}),
            ...(this.state.mode === 'twoPoint' && this.state.p1 ? { end: this.state.p1 } : {}),
          });

    if (!outcome.ok) return this.set({ lastError: outcome.reason ?? 'rejected' });
    return this.escape();
  }

  // -------------------------------------------------------------------------
  // Measurement field
  // -------------------------------------------------------------------------

  type(char: string): ArcToolState {
    if (char === 'Backspace') {
      return this.set({ fieldText: this.state.fieldText.slice(0, -1), lastError: null });
    }
    return this.set({ fieldText: this.state.fieldText + char, lastError: null });
  }

  /**
   * Applies a typed value. `12s` changes the segment count and re-solves in
   * place; `24r` sets the radius; a plain number is the bulge. §5.2
   */
  enter(): ArcToolState {
    const text = this.state.fieldText;
    if (text === '') return this.state;
    const parsed = parseMeasurement(text, this.docUnit);
    if (!parsed.ok) return this.set({ lastError: parsed.reason });
    return this.apply(parsed.value);
  }

  private apply(m: Measurement): ArcToolState {
    if (m.kind === 'segments') {
      const s = this.set({ segments: m.count, fieldText: '' });
      return this.state.cursor ? this.move(this.state.cursor) : s;
    }

    const { p0, p1, cursor } = this.state;
    if (!p0 || !p1 || !cursor) return this.set({ lastError: 'set the chord first', fieldText: '' });

    const chord = sub(p1, p0);
    const chordLen = length(chord);
    const chordDir = normalize(chord, 'arc chord');
    const toCursor = sub(cursor, p0);
    const perp = sub(toCursor, scale(chordDir, dot(toCursor, chordDir)));
    const bulgeDir = tryNormalize(perp);
    if (!bulgeDir) return this.set({ lastError: 'move the cursor off the chord first', fieldText: '' });

    let bulge: number;
    if (m.kind === 'radius') {
      if (m.value < chordLen / 2) {
        return this.set({
          lastError: `radius must be at least half the chord (${(chordLen / 2).toFixed(3)})`,
          fieldText: '',
        });
      }
      bulge = m.value - Math.sqrt(m.value * m.value - (chordLen / 2) ** 2);
    } else if (m.kind === 'length') {
      bulge = m.value;
    } else {
      return this.set({ lastError: 'value does not apply to an arc', fieldText: '' });
    }

    const spec = arcFromChordBulge(p0, p1, bulge, bulgeDir, this.state.segments);
    if (!spec) return this.set({ lastError: 'degenerate arc', fieldText: '' });

    const outcome =
      this.state.mode === 'pie'
        ? this.host.commitPie(spec, p0)
        : this.host.commitArc(spec, { start: p0, end: p1 });
    if (!outcome.ok) return this.set({ lastError: outcome.reason ?? 'rejected', fieldText: '' });
    return this.escape();
  }

  /** Snaps to the previous arc's bulge, for repeating profiles. §5.2 */
  get equalBulge(): number | null {
    return this.lastBulge;
  }
}

// ---------------------------------------------------------------------------

function orthonormal(reference: Vec3, normal: Vec3): { u: Vec3; v: Vec3 } {
  const u = normalize(reference, 'arc basis u');
  const v = normalize(cross(normal, u), 'arc basis v');
  return { u, v };
}

/** A usable plane normal when the drag has not yet left the radius line. */
function vecFallbackNormal(reference: Vec3): Vec3 | null {
  const u = tryNormalize(reference);
  if (!u) return null;
  const seed = Math.abs(u.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  return tryNormalize(cross(u, seed));
}

export { distance, add };
