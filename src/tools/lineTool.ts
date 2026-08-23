/**
 * PolyForm — Line tool state machine. §4.1, §4.3
 *
 * Pure: no rendering, no DOM, no three.js. Events in, state and intents out.
 * That is what makes it testable, and it is why this phase can be verified
 * before anything is drawn on screen.
 *
 * The tool is a chained polyline drawer. Every segment is a separate,
 * independent edge and a separate undo step; the tool continues from the end
 * of the segment just drawn until the user terminates.
 */

import type { EdgeId, Vec3 } from '../lib/geometry/types';
import { add, distance, dot, scale, sub, tryNormalize } from '../lib/geometry/math';
import { parseMeasurement, type DocumentUnit, type Measurement } from './measurement';

export type LineToolPhase =
  /** Tool not selected. */
  | 'inactive'
  /** Active, waiting for the first click. */
  | 'ready'
  /** Has a start point, rubber-banding to the cursor. */
  | 'drawing';

export interface CommitOutcome {
  readonly ok: boolean;
  /** Edges now covering the span. Empty for a rejected commit. */
  readonly edges: readonly EdgeId[];
  /** True when the span was already occupied — a retrace. */
  readonly wasOverdraw: boolean;
  readonly reason?: string;
}

/**
 * What the tool needs from the outside world. The kernel is reached only
 * through these, so the state machine stays testable with fakes.
 */
export interface LineToolHost {
  /** Runs one transaction: insert plus derive. §7.0 */
  commitSegment(from: Vec3, to: Vec3): CommitOutcome;
  /**
   * Rolls the last commit back completely.
   *
   * Re-solve is rollback-and-recommit, never an endpoint edit: the commit
   * being revised may have split edges, cut a face, absorbed an overdraw or
   * dissolved a vertex, and none of that can be unwound by moving a vertex.
   * §4.3
   */
  rollbackLast(): void;
  /** Replaces the top undo entry rather than pushing a second one. §4.3 */
  replaceUndoEntry(): void;
}

export interface LineToolState {
  readonly phase: LineToolPhase;
  /** Anchor of the segment in progress. */
  readonly start: Vec3 | null;
  /** Current cursor position, snapped by inference. */
  readonly cursor: Vec3 | null;
  /** Committed anchors this chain, in order. */
  readonly chain: readonly Vec3[];
  /** Live length of the segment in progress. */
  readonly previewLength: number;
  /** Locked direction, if any. Unit length. */
  readonly lockedDirection: Vec3 | null;
  /** Text currently in the measurement field. */
  readonly fieldText: string;
  /** True while the last commit can still be re-solved by typing. §4.3 */
  readonly canResolve: boolean;
  readonly lastError: string | null;
}

interface LastCommit {
  from: Vec3;
  to: Vec3;
  direction: Vec3;
}

const EMPTY: LineToolState = {
  phase: 'inactive',
  start: null,
  cursor: null,
  chain: [],
  previewLength: 0,
  lockedDirection: null,
  fieldText: '',
  canResolve: false,
  lastError: null,
};

export class LineTool {
  private state: LineToolState = EMPTY;
  private lastCommit: LastCommit | null = null;

  constructor(
    private readonly host: LineToolHost,
    private readonly docUnit: DocumentUnit = 'm',
  ) {}

  get current(): LineToolState {
    return this.state;
  }

  private set(patch: Partial<LineToolState>): LineToolState {
    this.state = { ...this.state, ...patch };
    return this.state;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  activate(): LineToolState {
    return this.set({ ...EMPTY, phase: 'ready' });
  }

  deactivate(): LineToolState {
    this.lastCommit = null;
    return this.set(EMPTY);
  }

  // -------------------------------------------------------------------------
  // Pointer
  // -------------------------------------------------------------------------

  /** `point` is already snapped by the inference engine. */
  move(point: Vec3): LineToolState {
    if (this.state.phase === 'inactive') return this.state;
    if (this.state.phase === 'ready') return this.set({ cursor: point });

    const start = this.state.start!;
    const resolved = this.applyLock(start, point);
    return this.set({
      cursor: resolved,
      previewLength: distance(start, resolved),
      // Any pointer movement ends the re-solve window: the user has moved on.
      canResolve: false,
    });
  }

  click(point: Vec3): LineToolState {
    if (this.state.phase === 'inactive') return this.state;

    if (this.state.phase === 'ready') {
      return this.set({
        phase: 'drawing',
        start: point,
        cursor: point,
        chain: [point],
        previewLength: 0,
        canResolve: false,
        lastError: null,
      });
    }

    const start = this.state.start!;
    const target = this.applyLock(start, point);

    // Clicking the chain's own start closes the loop and terminates.
    const first = this.state.chain[0];
    const closesLoop =
      first !== undefined &&
      this.state.chain.length >= 2 &&
      distance(target, first) < 1e-9;

    const outcome = this.commit(start, target);
    if (!outcome.ok) return this.state;

    if (closesLoop) return this.endChain();

    return this.set({
      start: target,
      cursor: target,
      chain: [...this.state.chain, target],
      previewLength: 0,
    });
  }

  /**
   * A double-click terminates the chain. The first click of the pair has
   * already been handled, so this only ends it.
   */
  doubleClick(): LineToolState {
    return this.state.phase === 'drawing' ? this.endChain() : this.state;
  }

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------

  /**
   * Cancels the segment in progress WITHOUT discarding the chain drawn so
   * far. Committed segments are already in the model and stay there. §4.1
   */
  escape(): LineToolState {
    if (this.state.phase !== 'drawing') return this.set({ phase: 'ready', fieldText: '' });
    return this.endChain();
  }

  enter(): LineToolState {
    if (this.state.fieldText !== '') return this.submitField();
    return this.state.phase === 'drawing' ? this.endChain() : this.state;
  }

  /** Locks the segment direction. Pass null to release. */
  lockDirection(direction: Vec3 | null): LineToolState {
    const unit = direction ? tryNormalize(direction) : null;
    return this.set({ lockedDirection: unit });
  }

  // -------------------------------------------------------------------------
  // Measurement field
  // -------------------------------------------------------------------------

  type(char: string): LineToolState {
    if (this.state.phase === 'inactive') return this.state;
    if (char === 'Backspace') {
      return this.set({ fieldText: this.state.fieldText.slice(0, -1), lastError: null });
    }
    return this.set({ fieldText: this.state.fieldText + char, lastError: null });
  }

  clearField(): LineToolState {
    return this.set({ fieldText: '', lastError: null });
  }

  /**
   * Applies the typed value.
   *
   * While drawing, it solves the segment in progress. After a commit and
   * before any other action, it RE-SOLVES the segment just drawn: roll the
   * transaction back in full, re-solve from the same start and locked
   * direction, and re-commit as a fresh transaction. §4.3
   */
  submitField(): LineToolState {
    const text = this.state.fieldText;
    if (text === '') return this.state;

    const parsed = parseMeasurement(text, this.docUnit);
    if (!parsed.ok) return this.set({ lastError: parsed.reason });

    // Re-solve takes precedence over starting a new segment. After a commit
    // the tool is still 'drawing' — the chain continues from the new anchor —
    // so checking the phase first would silently start a new segment instead
    // of correcting the one just drawn. The re-solve window is closed by any
    // other action, and move() is what closes it. §4.3
    if (this.state.canResolve && this.lastCommit) return this.resolveLast(parsed.value);

    if (this.state.phase === 'drawing' && this.state.start) {
      const target = this.targetFor(parsed.value, this.state.start);
      if (!target) return this.set({ lastError: 'value does not apply to a line' });
      const outcome = this.commit(this.state.start, target);
      if (!outcome.ok) return this.set({ lastError: outcome.reason ?? 'rejected' });
      return this.set({
        start: target,
        cursor: target,
        chain: [...this.state.chain, target],
        previewLength: 0,
        fieldText: '',
      });
    }

    return this.set({ lastError: 'nothing to apply the value to' });
  }

  /**
   * Rollback-and-recommit. Not an endpoint edit.
   *
   * The chain follows: if the tool has already advanced, the next segment's
   * start point IS the endpoint being revised, so it moves too. And a failed
   * re-solve restores the original rather than leaving the user with nothing.
   */
  private resolveLast(measurement: Measurement): LineToolState {
    const last = this.lastCommit!;
    const target = this.targetFor(measurement, last.from, last.direction);
    if (!target) return this.set({ lastError: 'value does not apply to a line' });

    this.host.rollbackLast();
    const outcome = this.host.commitSegment(last.from, target);

    if (!outcome.ok) {
      // Restore the original commit rather than leaving nothing behind.
      this.host.commitSegment(last.from, last.to);
      return this.set({ lastError: outcome.reason ?? 'rejected' });
    }

    // One undo entry, not two: the user drew one segment and corrected it.
    this.host.replaceUndoEntry();
    this.lastCommit = { from: last.from, to: target, direction: last.direction };

    const chain = [...this.state.chain];
    if (chain.length > 0) chain[chain.length - 1] = target;

    return this.set({
      chain,
      start: this.state.phase === 'drawing' ? target : this.state.start,
      cursor: target,
      fieldText: '',
      canResolve: true,
      lastError: null,
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private targetFor(
    m: Measurement,
    from: Vec3,
    preferredDirection?: Vec3,
  ): Vec3 | null {
    switch (m.kind) {
      case 'length': {
        const dir =
          preferredDirection ??
          this.state.lockedDirection ??
          (this.state.cursor ? tryNormalize(sub(this.state.cursor, from)) : null);
        if (!dir) return null;
        return add(from, scale(dir, m.value));
      }
      case 'absolute':
        return m.point;
      case 'relative':
        return add(from, m.offset);
      default:
        // radius, segments and angle belong to the arc tool.
        return null;
    }
  }

  /** Projects the cursor onto the locked direction, if one is held. */
  private applyLock(start: Vec3, point: Vec3): Vec3 {
    const lock = this.state.lockedDirection;
    if (!lock) return point;
    const t = dot(sub(point, start), lock);
    return add(start, scale(lock, t));
  }

  private commit(from: Vec3, to: Vec3): CommitOutcome {
    const outcome = this.host.commitSegment(from, to);
    if (outcome.ok) {
      const dir = tryNormalize(sub(to, from));
      this.lastCommit = dir ? { from, to, direction: dir } : null;
      this.set({ canResolve: dir !== null, lastError: null });
    } else {
      // A rejected commit does not interrupt the gesture. Degenerate commits
      // are overwhelmingly slips — a double-click landing as two clicks, a
      // snap catching the start point — and announcing a slip is worse than
      // absorbing it. §7.0
      this.set({ lastError: null });
    }
    return outcome;
  }

  private endChain(): LineToolState {
    return this.set({
      phase: 'ready',
      start: null,
      chain: [],
      previewLength: 0,
      fieldText: '',
      // The re-solve window survives ending the chain: the user may still
      // correct the last segment before doing anything else.
    });
  }
}
