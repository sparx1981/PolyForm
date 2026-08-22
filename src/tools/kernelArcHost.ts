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
import { snapshot, restore } from '../lib/geometry/heal';
import { distance, sub, tryNormalize } from '../lib/geometry/math';
import { getVertex } from '../lib/geometry/topology';
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
