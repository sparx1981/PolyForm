import { describe, it, expect } from 'vitest';
import { LineTool, type LineToolHost, type CommitOutcome } from './lineTool';
import { vec3, distance } from '../lib/geometry/math';
import type { EdgeId, Vec3 } from '../lib/geometry/types';

/** Records every host call so the test can assert the sequence. */
function fakeHost(opts: { reject?: (from: Vec3, to: Vec3) => string | null } = {}) {
  const calls: string[] = [];
  const commits: { from: Vec3; to: Vec3 }[] = [];
  let nextId = 1;
  const host: LineToolHost = {
    commitSegment(from, to): CommitOutcome {
      const reason = opts.reject?.(from, to) ?? null;
      if (reason) {
        calls.push(`reject(${reason})`);
        return { ok: false, edges: [], wasOverdraw: false, reason };
      }
      calls.push(`commit(${fmt(from)}->${fmt(to)})`);
      commits.push({ from, to });
      return { ok: true, edges: [nextId++ as EdgeId], wasOverdraw: false };
    },
    rollbackLast() { calls.push('rollback'); commits.pop(); },
    replaceUndoEntry() { calls.push('replaceUndo'); },
  };
  return { host, calls, commits };
}

const fmt = (v: Vec3) => `${round(v.x)},${round(v.y)},${round(v.z)}`;
const round = (n: number) => Math.round(n * 1000) / 1000;

describe('lifecycle', () => {
  it('starts inactive and becomes ready on activate', () => {
    const { host } = fakeHost();
    const t = new LineTool(host);
    expect(t.current.phase).toBe('inactive');
    expect(t.activate().phase).toBe('ready');
  });

  it('ignores input while inactive', () => {
    const { host, calls } = fakeHost();
    const t = new LineTool(host);
    t.click(vec3(0, 0, 0));
    t.move(vec3(1, 0, 0));
    expect(calls).toEqual([]);
  });
});

describe('chained drawing (§4.1)', () => {
  it('first click sets the anchor without committing', () => {
    const { host, calls } = fakeHost();
    const t = new LineTool(host);
    t.activate();
    const s = t.click(vec3(0, 0, 0));
    expect(s.phase).toBe('drawing');
    expect(calls).toEqual([]);
  });

  it('second click commits and the tool continues from the endpoint', () => {
    const { host, calls } = fakeHost();
    const t = new LineTool(host);
    t.activate();
    t.click(vec3(0, 0, 0));
    const s = t.click(vec3(2, 0, 0));
    expect(calls).toEqual(['commit(0,0,0->2,0,0)']);
    expect(s.phase).toBe('drawing');
    expect(s.start).toEqual(vec3(2, 0, 0));
  });

  it('produces one commit per segment in a chain', () => {
    const { host, calls } = fakeHost();
    const t = new LineTool(host);
    t.activate();
    for (const p of [vec3(0,0,0), vec3(2,0,0), vec3(2,2,0), vec3(0,2,0)]) t.click(p);
    expect(calls).toEqual([
      'commit(0,0,0->2,0,0)',
      'commit(2,0,0->2,2,0)',
      'commit(2,2,0->0,2,0)',
    ]);
  });

  it('clicking the chain start closes the loop and ends the chain', () => {
    const { host, calls } = fakeHost();
    const t = new LineTool(host);
    t.activate();
    t.click(vec3(0,0,0)); t.click(vec3(2,0,0)); t.click(vec3(2,2,0));
    const s = t.click(vec3(0,0,0));
    expect(calls).toHaveLength(3);
    expect(calls[2]).toBe('commit(2,2,0->0,0,0)');
    expect(s.phase).toBe('ready');
  });

  it('tracks the live preview length', () => {
    const { host } = fakeHost();
    const t = new LineTool(host);
    t.activate();
    t.click(vec3(0, 0, 0));
    expect(t.move(vec3(3, 4, 0)).previewLength).toBeCloseTo(5, 9);
  });
});

describe('termination', () => {
  it('Esc ends the chain but keeps committed segments', () => {
    // "Esc cancels only the in-progress segment, not the chain drawn so far."
    const { host, calls } = fakeHost();
    const t = new LineTool(host);
    t.activate();
    t.click(vec3(0,0,0)); t.click(vec3(2,0,0));
    t.move(vec3(5, 0, 0));
    const s = t.escape();
    expect(s.phase).toBe('ready');
    expect(calls).toEqual(['commit(0,0,0->2,0,0)']); // the preview never committed
  });

  it('double-click ends the chain', () => {
    const { host } = fakeHost();
    const t = new LineTool(host);
    t.activate();
    t.click(vec3(0,0,0)); t.click(vec3(2,0,0));
    expect(t.doubleClick().phase).toBe('ready');
  });

  it('Enter with an empty field ends the chain', () => {
    const { host } = fakeHost();
    const t = new LineTool(host);
    t.activate();
    t.click(vec3(0,0,0)); t.click(vec3(2,0,0));
    expect(t.enter().phase).toBe('ready');
  });
});

describe('inference locking', () => {
  it('projects the cursor onto the locked direction', () => {
    const { host, commits } = fakeHost();
    const t = new LineTool(host);
    t.activate();
    t.click(vec3(0, 0, 0));
    t.lockDirection(vec3(1, 0, 0));
    // Cursor well off-axis; the commit must land on the lock.
    t.click(vec3(3, 9, 0));
    expect(commits[0]!.to.x).toBeCloseTo(3, 9);
    expect(commits[0]!.to.y).toBeCloseTo(0, 9);
  });

  it('releases the lock when passed null', () => {
    const { host, commits } = fakeHost();
    const t = new LineTool(host);
    t.activate();
    t.click(vec3(0, 0, 0));
    t.lockDirection(vec3(1, 0, 0));
    t.lockDirection(null);
    t.click(vec3(3, 9, 0));
    expect(commits[0]!.to.y).toBeCloseTo(9, 9);
  });
});

describe('measurement field (§4.3)', () => {
  it('typing a length commits at that distance along the cursor direction', () => {
    const { host, commits } = fakeHost();
    const t = new LineTool(host);
    t.activate();
    t.click(vec3(0, 0, 0));
    t.move(vec3(1, 0, 0));
    for (const c of '2.4') t.type(c);
    t.enter();
    expect(distance(commits[0]!.from, commits[0]!.to)).toBeCloseTo(2.4, 9);
  });

  it('accepts relative coordinates', () => {
    const { host, commits } = fakeHost();
    const t = new LineTool(host);
    t.activate();
    t.click(vec3(1, 1, 0));
    for (const c of '<0,0,5>') t.type(c);
    t.enter();
    expect(commits[0]!.to).toEqual(vec3(1, 1, 5));
  });

  it('accepts absolute coordinates', () => {
    const { host, commits } = fakeHost();
    const t = new LineTool(host);
    t.activate();
    t.click(vec3(1, 1, 0));
    for (const c of '[9,9,9]') t.type(c);
    t.enter();
    expect(commits[0]!.to).toEqual(vec3(9, 9, 9));
  });

  it('reports a parse error without committing', () => {
    const { host, calls } = fakeHost();
    const t = new LineTool(host);
    t.activate();
    t.click(vec3(0, 0, 0));
    for (const c of 'garbage') t.type(c);
    const s = t.enter();
    expect(s.lastError).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it('backspace edits the field', () => {
    const { host } = fakeHost();
    const t = new LineTool(host);
    t.activate();
    t.type('1'); t.type('2'); t.type('Backspace');
    expect(t.current.fieldText).toBe('1');
  });
});

describe('post-commit re-solve (§4.3)', () => {
  it('is rollback-and-recommit, not an endpoint edit', () => {
    // The commit being revised may have split edges or cut a face; none of
    // that can be unwound by moving a vertex.
    const { host, calls } = fakeHost();
    const t = new LineTool(host);
    t.activate();
    t.click(vec3(0, 0, 0));
    t.click(vec3(1, 0, 0));
    calls.length = 0;

    for (const c of '5') t.type(c);
    t.enter();

    expect(calls).toEqual(['rollback', 'commit(0,0,0->5,0,0)', 'replaceUndo']);
  });

  it('replaces the undo entry rather than pushing a second', () => {
    const { host, calls } = fakeHost();
    const t = new LineTool(host);
    t.activate();
    t.click(vec3(0, 0, 0));
    t.click(vec3(1, 0, 0));
    for (const c of '5') t.type(c);
    t.enter();
    expect(calls.filter(c => c === 'replaceUndo')).toHaveLength(1);
  });

  it('the chain follows the revised endpoint', () => {
    // The next segment's start point IS the endpoint being revised.
    const { host } = fakeHost();
    const t = new LineTool(host);
    t.activate();
    t.click(vec3(0, 0, 0));
    t.click(vec3(1, 0, 0));
    for (const c of '5') t.type(c);
    const s = t.enter();
    expect(s.start).toEqual(vec3(5, 0, 0));
    expect(s.chain[s.chain.length - 1]).toEqual(vec3(5, 0, 0));
  });

  it('a failed re-solve restores the original commit', () => {
    let calls = 0;
    const { host, commits } = fakeHost({
      reject: (_f, to) => (++calls > 1 && to.x === 99 ? 'too long' : null),
    });
    const t = new LineTool(host);
    t.activate();
    t.click(vec3(0, 0, 0));
    t.click(vec3(1, 0, 0));

    for (const c of '99') t.type(c);
    const s = t.enter();

    expect(s.lastError).toBeTruthy();
    // The original 0->1 segment is back, not lost.
    expect(commits).toHaveLength(1);
    expect(commits[0]!.to.x).toBeCloseTo(1, 9);
  });

  it('the window closes on pointer movement', () => {
    const { host, calls } = fakeHost();
    const t = new LineTool(host);
    t.activate();
    t.click(vec3(0, 0, 0));
    t.click(vec3(1, 0, 0));
    expect(t.current.canResolve).toBe(true);

    t.move(vec3(2, 2, 0));
    expect(t.current.canResolve).toBe(false);

    calls.length = 0;
    for (const c of '5') t.type(c);
    t.enter();
    // Solves the NEW segment in progress; does not re-solve the old one.
    expect(calls).not.toContain('rollback');
  });

  it('survives ending the chain — the user may still correct the last segment', () => {
    const { host, calls } = fakeHost();
    const t = new LineTool(host);
    t.activate();
    t.click(vec3(0, 0, 0));
    t.click(vec3(1, 0, 0));
    t.escape();
    calls.length = 0;
    for (const c of '5') t.type(c);
    t.enter();
    expect(calls).toContain('rollback');
  });
});

describe('rejected commits', () => {
  it('do not interrupt the gesture', () => {
    // Degenerate commits are overwhelmingly slips; announcing one is worse
    // than absorbing it. §7.0
    const { host } = fakeHost({ reject: () => 'zero-length' });
    const t = new LineTool(host);
    t.activate();
    t.click(vec3(0, 0, 0));
    const s = t.click(vec3(0, 0, 0));
    expect(s.phase).toBe('drawing');
    expect(s.start).toEqual(vec3(0, 0, 0));
    expect(s.lastError).toBeNull();
  });
});
