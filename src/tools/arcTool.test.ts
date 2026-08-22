import { describe, it, expect } from 'vitest';
import { ArcTool, type ArcToolHost, type ArcCommitOutcome } from './arcTool';
import { vec3, normalize, dot, length, cross, sub, distance } from '../lib/geometry/math';
import { arcPointAt } from '../lib/geometry/curve';
import type { ArcSpec } from '../lib/geometry/curve';
import type { Vec3 } from '../lib/geometry/types';

function fakeHost(tangentAt?: (p: Vec3) => Vec3 | null) {
  const arcs: ArcSpec[] = [];
  const pies: ArcSpec[] = [];
  const lines: { from: Vec3; to: Vec3 }[] = [];
  const host: ArcToolHost = {
    commitArc(spec): ArcCommitOutcome { arcs.push(spec); return { ok: true }; },
    commitPie(spec): ArcCommitOutcome { pies.push(spec); return { ok: true }; },
    commitLine(from, to): ArcCommitOutcome { lines.push({ from, to }); return { ok: true }; },
    ...(tangentAt ? { incomingEdgeDirection: tangentAt } : {}),
  };
  return { host, arcs, pies, lines };
}

describe('mode B — chord and bulge (§5.2)', () => {
  it('click, click, move, click produces an arc', () => {
    const { host, arcs } = fakeHost();
    const t = new ArcTool(host);
    t.activate('twoPoint');
    t.click(vec3(0,0,0));
    t.click(vec3(2,0,0));
    t.move(vec3(1,1,0));
    t.click(vec3(1,1,0));
    expect(arcs).toHaveLength(1);
    expect(arcs[0]!.radius).toBeCloseTo(1, 6);
  });

  it('flags a half circle when bulge equals half the chord', () => {
    const { host } = fakeHost();
    const t = new ArcTool(host);
    t.activate('twoPoint');
    t.click(vec3(0,0,0)); t.click(vec3(2,0,0));
    expect(t.move(vec3(1, 1, 0)).halfCircle).toBe(true);
    expect(t.move(vec3(1, 0.2, 0)).halfCircle).toBe(false);
  });

  it('remembers the last bulge for repeating profiles', () => {
    const { host } = fakeHost();
    const t = new ArcTool(host);
    t.activate('twoPoint');
    t.click(vec3(0,0,0)); t.click(vec3(2,0,0));
    t.move(vec3(1, 0.5, 0));
    expect(t.equalBulge).toBeCloseTo(0.5, 6);
  });

  it('the preview passes through the cursor apex', () => {
    const { host } = fakeHost();
    const t = new ArcTool(host);
    t.activate('twoPoint');
    t.click(vec3(0,0,0)); t.click(vec3(2,0,0));
    const s = t.move(vec3(1, 0.6, 0));
    const apex = arcPointAt(s.preview!, 0.5);
    expect(apex.y).toBeCloseTo(0.6, 6);
  });
});

describe('mode C — three points', () => {
  it('produces an arc through all three', () => {
    const { host, arcs } = fakeHost();
    const t = new ArcTool(host);
    t.activate('threePoint');
    t.click(vec3(1,0,0));
    t.click(vec3(0,1,0));
    t.move(vec3(-1,0,0));
    t.click(vec3(-1,0,0));
    expect(arcs).toHaveLength(1);
    expect(arcs[0]!.radius).toBeCloseTo(1, 6);
    expect(distance(arcPointAt(arcs[0]!, 0.5), vec3(0,1,0))).toBeCloseTo(0, 5);
  });
});

describe('mode A and D — centre based', () => {
  it('centre mode sets radius from the second click', () => {
    const { host, arcs } = fakeHost();
    const t = new ArcTool(host);
    t.activate('centre');
    t.click(vec3(0,0,0));
    t.click(vec3(2,0,0));
    t.move(vec3(0,2,0));
    t.click(vec3(0,2,0));
    expect(arcs[0]!.radius).toBeCloseTo(2, 6);
    expect(Math.abs(arcs[0]!.sweep)).toBeCloseTo(Math.PI/2, 5);
  });

  it('pie mode commits through commitPie so a face derives', () => {
    const { host, pies, arcs } = fakeHost();
    const t = new ArcTool(host);
    t.activate('pie');
    t.click(vec3(0,0,0)); t.click(vec3(2,0,0));
    t.move(vec3(0,2,0)); t.click(vec3(0,2,0));
    expect(pies).toHaveLength(1);
    expect(arcs).toHaveLength(0);
  });
});

describe('analytic tangency (§5.2)', () => {
  // An edge travelling in -y arrives at the origin, so the outgoing tangent
  // the arc must honour is +y. The chord runs along +x, giving a genuine
  // quarter-turn — NOT aligned with the tangent, which would be the
  // straight-line degeneracy tested further down.
  const incoming = vec3(0, -1, 0);

  it('uses the exact negated edge direction, ignoring cursor position', () => {
    // A screen-space snap tangent to within 1e-5 rad looks identical and then
    // fails COPLANARITY_TOLERANCE downstream. Compute from the constraint.
    const { host, arcs } = fakeHost(() => incoming);
    const t = new ArcTool(host);
    t.activate('twoPoint');
    t.click(vec3(0,0,0));
    t.click(vec3(2,0,0));
    // Cursor deliberately sloppy.
    t.move(vec3(1.03, 0.47, 0));
    t.click(vec3(1.03, 0.47, 0));

    expect(arcs).toHaveLength(1);
    const spec = arcs[0]!;
    // Tangent at the start must be exactly perpendicular to the radius.
    const start = arcPointAt(spec, 0);
    const radial = normalize(sub(start, spec.centre));
    const t0 = normalize(sub(arcPointAt(spec, 1e-6), start));
    expect(Math.abs(dot(radial, t0))).toBeLessThan(1e-4);
    // And aligned with -incoming, to machine precision.
    const expected = normalize(vec3(0, 1, 0));
    expect(Math.abs(dot(t0, expected))).toBeCloseTo(1, 5);
  });

  it('marks tangency active in the state so the cue can show', () => {
    const { host } = fakeHost(() => incoming);
    const t = new ArcTool(host);
    t.activate('twoPoint');
    t.click(vec3(0,0,0)); t.click(vec3(2,0,0));
    expect(t.move(vec3(1, 0.5, 0)).tangentActive).toBe(true);
  });

  it('is inactive when the chord start is not an edge endpoint', () => {
    const { host } = fakeHost(() => null);
    const t = new ArcTool(host);
    t.activate('twoPoint');
    t.click(vec3(5,5,0)); t.click(vec3(7,5,0));
    expect(t.move(vec3(6, 0.5, 0)).tangentActive).toBe(false);
  });
});

describe('degenerate tangency guard (§5.2)', () => {
  it('aligned tangent and chord emit a straight line, not a flipping arc', () => {
    // Dragging along the incoming edge. The constraint describes a straight
    // line, so tangent mode degrades gracefully into the Line tool.
    const { host, lines, arcs } = fakeHost(() => vec3(-1, 0, 0));
    const t = new ArcTool(host);
    t.activate('twoPoint');
    t.click(vec3(0,0,0));
    t.click(vec3(2,0,0));       // chord exactly along +x; -incoming is +x
    t.move(vec3(3, 0, 0));
    t.click(vec3(3, 0, 0));

    expect(lines).toHaveLength(1);
    expect(arcs).toHaveLength(0);
    expect(lines[0]).toEqual({ from: vec3(0,0,0), to: vec3(2,0,0) });
  });

  it('anti-aligned suppresses the inference rather than inventing a plane', () => {
    // The arc would double back through 360 degrees. No sensible answer, so
    // drop the constraint and let the cursor define the plane.
    const { host, arcs, lines } = fakeHost(() => vec3(1, 0, 0));
    const t = new ArcTool(host);
    t.activate('twoPoint');
    t.click(vec3(0,0,0));
    t.click(vec3(2,0,0));       // -incoming is -x, chord is +x: anti-aligned
    const s = t.move(vec3(1, 0.5, 0));
    t.click(vec3(1, 0.5, 0));

    expect(lines).toHaveLength(0);
    expect(arcs).toHaveLength(1);
    expect(s.tangentActive).toBe(false);   // the cyan cue is gone
    expect(arcs[0]!.radius).toBeCloseTo(1.25, 4); // cursor-defined, sane
  });

  it('never produces a NaN plane', () => {
    for (const dir of [vec3(-1,0,0), vec3(1,0,0), vec3(0,1,0)]) {
      const { host, arcs } = fakeHost(() => dir);
      const t = new ArcTool(host);
      t.activate('twoPoint');
      t.click(vec3(0,0,0)); t.click(vec3(2,0,0));
      t.move(vec3(1, 0.4, 0)); t.click(vec3(1, 0.4, 0));
      for (const a of arcs) {
        expect(Number.isFinite(a.radius)).toBe(true);
        expect(Number.isFinite(a.centre.x + a.centre.y + a.centre.z)).toBe(true);
        expect(Math.abs(length(a.normal) - 1)).toBeLessThan(1e-9);
      }
    }
  });
});

describe('measurement field', () => {
  it('12s changes the segment count and re-solves in place', () => {
    const { host, arcs } = fakeHost();
    const t = new ArcTool(host);
    t.activate('twoPoint');
    t.click(vec3(0,0,0)); t.click(vec3(2,0,0));
    t.move(vec3(1, 0.5, 0));
    for (const c of '24s') t.type(c);
    t.enter();
    expect(t.current.segments).toBe(24);
    expect(arcs).toHaveLength(0);   // segment count alone does not commit
    t.click(vec3(1, 0.5, 0));
    expect(arcs[0]!.segments).toBe(24);
  });

  it('24r sets the radius', () => {
    const { host, arcs } = fakeHost();
    const t = new ArcTool(host);
    t.activate('twoPoint');
    t.click(vec3(0,0,0)); t.click(vec3(2,0,0));
    t.move(vec3(1, 0.5, 0));
    for (const c of '5r') t.type(c);
    t.enter();
    expect(arcs).toHaveLength(1);
    expect(arcs[0]!.radius).toBeCloseTo(5, 6);
  });

  it('rejects a radius smaller than half the chord', () => {
    const { host, arcs } = fakeHost();
    const t = new ArcTool(host);
    t.activate('twoPoint');
    t.click(vec3(0,0,0)); t.click(vec3(4,0,0));
    t.move(vec3(2, 0.5, 0));
    for (const c of '1r') t.type(c);
    const s = t.enter();
    expect(s.lastError).toMatch(/half the chord/);
    expect(arcs).toHaveLength(0);
  });

  it('a plain number is the bulge', () => {
    const { host, arcs } = fakeHost();
    const t = new ArcTool(host);
    t.activate('twoPoint');
    t.click(vec3(0,0,0)); t.click(vec3(2,0,0));
    t.move(vec3(1, 0.1, 0));
    for (const c of '1') t.type(c);
    t.enter();
    expect(arcs[0]!.radius).toBeCloseTo(1, 6);   // bulge 1 on chord 2
  });
});

describe('lifecycle', () => {
  it('escape resets without committing', () => {
    const { host, arcs } = fakeHost();
    const t = new ArcTool(host);
    t.activate('twoPoint');
    t.click(vec3(0,0,0)); t.click(vec3(2,0,0));
    const s = t.escape();
    expect(s.phase).toBe('ready');
    expect(arcs).toHaveLength(0);
  });

  it('switching mode resets the in-progress arc', () => {
    const { host } = fakeHost();
    const t = new ArcTool(host);
    t.activate('twoPoint');
    t.click(vec3(0,0,0));
    const s = t.setMode('threePoint');
    expect(s.mode).toBe('threePoint');
    expect(s.p0).toBeNull();
  });

  it('ignores input while inactive', () => {
    const { host, arcs } = fakeHost();
    const t = new ArcTool(host);
    t.click(vec3(0,0,0));
    expect(arcs).toHaveLength(0);
  });
});
