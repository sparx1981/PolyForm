/**
 * PolyForm — ArcToolHost backed by the real kernel.
 *
 * Mirrors KernelLineHost: one commit is one transaction and one undo entry.
 * Pie mode additionally closes the two radii so a face derives on commit,
 * which is a convenience, not a special case — the geometry is
 * indistinguishable from an arc plus two hand-drawn lines. §5.4
 */

import type { EdgeId, Vec3 } from '../lib/geometry/types';
import { createArc, arcPointAt, type ArcSpec } from '../lib/geometry/curve';
import { insertEdge } from '../lib/geometry/insert';
import { derive } from '../lib/geometry/derive';
import { snapshot, restore, deleteEdge } from '../lib/geometry/heal';
import { add, closestPointOnSegment, distance, dot, scale, sub, tryNormalize } from '../lib/geometry/math';
import { edgePoints, findEdgeBetween, getVertex } from '../lib/geometry/topology';
import type { ArcCommitOutcome, ArcToolHost } from './arcTool';
import { KernelLineHost } from './kernelLineHost';

export class KernelArcHost extends KernelLineHost implements ArcToolHost {
  commitArc(spec: ArcSpec, anchors: { start?: Vec3; end?: Vec3 }): ArcCommitOutcome {
    const before = snapshot(this.graph);
    try {
      const opts: { startAnchor?: Vec3; endAnchor?: Vec3 } = {};
      if (anchors.start) opts.startAnchor = anchors.start;
      if (anchors.end) opts.endAnchor = anchors.end;
      const r = createArc(this.ctx, spec, opts);
      if (r.edges.length === 0) {
        restore(this.graph, before);
        return { ok: false, reason: 'arc produced no geometry' };
      }
      const result = derive(this.graph, r.touched, this.deriveOpts);
      this.pushUndo(before);
      this.notify(result);
      return { ok: true, curveId: r.curveId, edges: r.edges, demoted: r.demoted };
    } catch (err) {
      restore(this.graph, before);
      this.rebuildIndex();
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  commitPie(spec: ArcSpec, centre: Vec3): ArcCommitOutcome {
    const before = snapshot(this.graph);
    try {
      const start = arcPointAt(spec, 0);
      const end = arcPointAt(spec, 1);
      const r = createArc(this.ctx, spec, { startAnchor: start, endAnchor: end });
      const touched = new Set<EdgeId>(r.touched);
      for (const t of insertEdge(this.ctx, centre, start).touched) touched.add(t);
      for (const t of insertEdge(this.ctx, end, centre).touched) touched.add(t);
      const result = derive(this.graph, touched, this.deriveOpts);
      this.pushUndo(before);
      this.notify(result);
      return { ok: true, curveId: r.curveId, edges: r.edges, demoted: r.demoted };
    } catch (err) {
      restore(this.graph, before);
      this.rebuildIndex();
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Tangency degenerated to a straight line. §5.2 */
  commitLine(from: Vec3, to: Vec3): ArcCommitOutcome {
    const r = this.commitSegment(from, to);
    return r.ok ? { ok: true, edges: r.edges } : { ok: false, reason: r.reason ?? 'rejected' };
  }

  /**
   * Trims a corner as the arc that rounds it goes in: draws the arc, then removes the two
   * straight pieces between it and the corner. One transaction, one undo entry.
   */
  commitFillet(spec: ArcSpec, anchors: { start: Vec3; end: Vec3 }, corner: Vec3): ArcCommitOutcome {
    const before = snapshot(this.graph);
    try {
      const r = createArc(this.ctx, spec, { startAnchor: anchors.start, endAnchor: anchors.end });
      if (r.edges.length === 0) {
        restore(this.graph, before);
        return { ok: false, reason: 'arc produced no geometry' };
      }
      const touched = new Set<EdgeId>(r.touched);
      for (const end of [anchors.start, anchors.end]) {
        const va = this.vertexAt(corner), vb = this.vertexAt(end);
        const e = va !== null && vb !== null ? findEdgeBetween(this.graph, va, vb) : null;
        if (!e) continue;
        for (const t of deleteEdge(this.graph, e.id, this.tolerances).touched) touched.add(t);
      }
      this.rebuildIndex();
      const result = derive(this.graph, touched, this.deriveOpts);
      this.pushUndo(before);
      this.notify(result);
      return { ok: true, curveId: r.curveId, edges: r.edges, demoted: r.demoted };
    } catch (err) {
      restore(this.graph, before);
      this.rebuildIndex();
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  private vertexAt(point: Vec3): import('../lib/geometry/types').VertexId | null {
    for (const v of this.graph.vertices.values()) {
      if (distance(v.position, point) <= this.tolerances.VERTEX_MERGE_TOLERANCE) return v.id;
    }
    return null;
  }

  /**
   * What an arc starting at `point` can be tangent to: the way in at the free end of a line; the
   * line itself part way along an edge; the curve's own direction at a point on an arc. Null at
   * a corner (two ways to go) and in empty space.
   */
  tangentAt(point: Vec3): { dir: Vec3; bothWays: boolean } | null {
    const tol = this.tolerances.VERTEX_MERGE_TOLERANCE;
    const vid = this.vertexAt(point);
    if (vid !== null) {
      const v = getVertex(this.graph, vid);
      const others = v.edges
        .map((id) => this.graph.edges.get(id))
        .filter((e): e is NonNullable<typeof e> => !!e)
        .map((e) => ({ e, other: getVertex(this.graph, e.v0 === vid ? e.v1 : e.v0).position }));
      if (others.length === 1) {
        const dir = tryNormalize(sub(others[0]!.other, v.position));
        return dir ? { dir, bothWays: false } : null;
      }
      if (others.length === 2) {
        const [a, b] = others as [typeof others[0], typeof others[0]];
        const da = tryNormalize(sub(a.other, v.position)), db = tryNormalize(sub(b.other, v.position));
        const smooth = (a.e.curve !== null && a.e.curve === b.e.curve) || (da && db && dot(da, db) < -0.9995);
        const through = tryNormalize(sub(b.other, a.other));
        return smooth && through ? { dir: through, bothWays: true } : null;
      }
      return null;
    }
    for (const e of this.graph.edges.values()) {
      const [a, b] = edgePoints(this.graph, e);
      if (closestPointOnSegment(point, a, b).distance > tol) continue;
      const dir = tryNormalize(sub(b, a));
      return dir ? { dir, bothWays: true } : null;
    }
    return null;
  }

  /**
   * The corners an arc starting at `start` could round: for each end of the straight edge it
   * sits on where exactly one other straight edge meets it, the point on that other edge as far
   * from the corner as `start` is. An arc from `start` to that point, tangent to the first
   * edge, is tangent to the second as well.
   */
  filletTargets(start: Vec3): { corner: Vec3; end: Vec3 }[] {
    const out: { corner: Vec3; end: Vec3 }[] = [];
    const tol = this.tolerances.VERTEX_MERGE_TOLERANCE;
    if (this.vertexAt(start) !== null) return out; // part way along an edge only
    for (const e1 of this.graph.edges.values()) {
      if (e1.curve !== null) continue;
      const [a, b] = edgePoints(this.graph, e1);
      if (closestPointOnSegment(start, a, b).distance > tol) continue;
      for (const vid of [e1.v0, e1.v1]) {
        const v = getVertex(this.graph, vid);
        if (v.edges.length !== 2) continue;
        const e2id = v.edges.find((id) => id !== e1.id);
        const e2 = e2id !== undefined ? this.graph.edges.get(e2id) : undefined;
        if (!e2 || e2.curve !== null) continue;
        const w = getVertex(this.graph, e2.v0 === vid ? e2.v1 : e2.v0).position;
        const u2 = tryNormalize(sub(w, v.position));
        const u1 = tryNormalize(sub(getVertex(this.graph, e1.v0 === vid ? e1.v1 : e1.v0).position, v.position));
        if (!u2 || !u1 || Math.abs(dot(u1, u2)) > 0.999) continue; // straight on: nothing to round
        const d = distance(start, v.position);
        if (d < tol * 10 || d >= distance(w, v.position) * 0.999) continue;
        out.push({ corner: { ...v.position }, end: add(v.position, scale(u2, d)) });
      }
    }
    return out;
  }

  /**
   * The attached edge's direction as seen LEAVING `point`, i.e.
   * normalize(other - point).
   *
   * The sign convention matters and is easy to invert. §5.2 defines the arc's
   * start tangent as t = -normalize(d_edge), so d_edge must point AWAY from
   * the shared vertex. Return the arriving direction instead and every
   * tangency is reversed: continuing straight on reads as anti-aligned and
   * gets suppressed, while doubling back reads as a straight line.
   *
   * Returns null when the point is not an edge endpoint — which is exactly
   * when tangency must not fire.
   */
  incomingEdgeDirection(point: Vec3): Vec3 | null {
    let best: Vec3 | null = null;
    let bestDist = this.tolerances.VERTEX_MERGE_TOLERANCE;
    for (const v of this.graph.vertices.values()) {
      const d = distance(v.position, point);
      if (d > bestDist) continue;
      if (v.edges.length === 0) continue;
      const e = this.graph.edges.get(v.edges[0]!);
      if (!e) continue;
      const other = e.v0 === v.id ? e.v1 : e.v0;
      const dir = tryNormalize(sub(getVertex(this.graph, other).position, v.position));
      if (!dir) continue;
      best = dir;
      bestDist = d;
    }
    return best;
  }
}
