# Phases 14, 15, 16, 18 — curves, arcs, diagnostics

**354 tests passing** (66 new). Strict typecheck clean across `src/lib/geometry/**` and `src/tools/**`; the React bridge still typechecks against real three/React/R3F.

## Files

| Phase | File | What |
|---|---|---|
| 14 | `lib/geometry/curve.ts` | Analytic arcs, tessellation, splitting, sagitta demotion, Ns re-solve |
| 15/16 | `tools/arcTool.ts` | Four modes, analytic tangency, degeneracy branching |
| 15/16 | `tools/kernelArcHost.ts` | Arc adapter (extends `KernelLineHost`) |
| 18 | `lib/geometry/diagnostics.ts` | Stray edges, non-manifold, near-coplanar hints, auto-flatten |

## Three bugs the tests caught

**Curve edge order was lost on split.** `insertEdge` appended the two halves to `curve.edges` instead of splicing in place. Every arc operation downstream — splitting, `Ns` re-solve, tangency — walks that order, so an arc crossed by a line would have quietly mis-ordered itself. Fixed in `insert.ts`, with a test that a mid-curve split leaves the walk intact.

**Tangency kept the user's bulge.** I took the constrained *direction* but the cursor's *magnitude*, which leaves the curve visibly non-tangent while the cyan cue claims otherwise. A chord plus a tangent fully determines the arc — the radius follows from the tangent-chord angle. Both now come from the constraint. The cursor decides *which* constraint applies, never the geometry.

**The tangency sign convention was inverted in the host.** §5.2 defines `t = -normalize(d_edge)`, so `d_edge` must point *away* from the shared vertex. My host returned the *arriving* direction, which reverses every tangency: continuing straight on read as anti-aligned and got suppressed, while doubling back read as a straight line. One-line fix, heavily commented, because it is exactly the kind of thing that gets "tidied" back.

**Near-coplanar detection tested the wrong thing.** I walked each vertex's 1-ring; the actual condition is that a *closed loop* just missed coplanarity. A near-planar square has only three points per 1-ring so was never flagged, while a corner where three axes meet was falsely flagged. Rewritten around a bounded DFS cycle search.

## Behaviour worth knowing

**Sagitta demotion works as specified.** A 5° sweep at 50 m radius does *not* demote (4.4 m of visible curvature); the same 5° at 1 mm does. Tested both ways.

**`Ns` re-solve refuses on a truncated curve** and says why, rather than failing silently. It also refuses when other geometry is attached partway along, which would otherwise be orphaned.

**Demotion never moves a vertex** — metadata only. There is a test asserting every position is unchanged to 12 decimal places after a stub demotes.

**One arc is one undo entry**, not twelve.

**Auto-flatten is off by default** and behind an explicit threshold. It moves the user's geometry, so it belongs behind a visible setting, not as a silent correction.

## Still outstanding

- **Phase 11 (inference).** Extends your existing `PolyformInferenceEngine.ts` rather than replacing it — precedence reconciliation, kernel-sourced candidates, missing linear inferences. Needs to be done against the real file.
- **Phase 3b (containers, R8).** Without it, all drawn geometry sticks to all other drawn geometry.
- **Phase 13 (rendering cues)** and **17 (touch)** — the two genuinely visual phases.
