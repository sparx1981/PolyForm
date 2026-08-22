# PolyForm — build prompt pack

Companion to `polyform-line-and-arc-tools-spec.md`. That document is the *specification*; this one is the **prompts you actually paste**, in order.

§10 of the spec gives you a reusable header and a phase table. That is a template plus its variables, not a set of prompts — this file is those two things already combined.

---

## Which phases go where

This build splits cleanly across two tools, because the spec forbids the kernel from importing React, the renderer, or anything in the UI layer. That constraint was written for testability; it also means `geometry/` and most of `tools/` can be built and verified in complete isolation from PolyForm.

| | **Claude** (zip or Claude Code) | **AI Studio** |
|---|---|---|
| **Phases** | 0a–12, 14–16, 18 | 13, 17, plus visual tuning |
| **What** | Kernel, state machines, parsers, curve maths | Rendering overlay, touch layer, anything you judge by looking at it |
| **Why** | Tests actually execute, so the Phase 5 and 9 gates are real rather than aspirational | Needs a running viewport, a real canvas, and a real finger on a tablet |

**The reason for the split is test execution.** A wrong cycle finder passes visual inspection — that is the entire point of §10.4. In AI Studio the acceptance criteria are prose that nothing checks; the model writes tests it cannot run, and you discover the failure at Phase 12. Run those phases where the suite actually executes and the gates hold.

**Recommended run order**

1. **Claude — Block A, phases 0a → 9.** The kernel. Ends at the integration gate. Nothing renders yet.
2. **Claude — Block B, phases 10, 11, 12, 14, 15, 16, 18.** Tool state machines, inference, the measurement parser, curves and arcs. All headless and all testable.
3. **AI Studio — Block C, phases 13 and 17,** plus tuning passes over inference feel, arc drag behaviour and snap radii.

*Optional early handoff:* if you want something on screen sooner, stop after Phase 10, do a cut-down Phase 13, and get a line drawing on the canvas. Then come back for Block B. Costs one extra handoff; worth it if seeing it move keeps the project moving.

---

## Running the Claude phases

**Give Claude the project.** Either export PolyForm as a zip and upload it, or — better if a local setup is workable — run the project locally with Claude Code, which reads and writes your filesystem directly and skips the zip round-trip entirely.

**The prompts below work as written**, with two differences from AI Studio:

- **Drop the defensive scaffolding.** "Generate only this file", "do not refactor neighbours", "do not re-emit other files" exist because Build mode rewrites things behind your back. Keep the substantive constraints — double precision, no clipping libraries, tests required, no UI imports in the kernel.
- **Acceptance criteria become gates, not checklists.** Claude runs the suite, sees failures, and iterates before handing anything back. Where a prompt below lists tests, expect them green rather than written.

**Sessions are bounded**, so expect several. Re-upload the current zip at the start of each, or use Claude Code and skip the problem.

## Running the AI Studio phases

**Attach the spec as a file** so it stays in context. Put the System Instructions block below in the System Instructions field once. Temperature 0–0.2. One phase per turn.

**Check the diff every time.** Build mode is designed to regenerate whole applications, and it will occasionally rewrite a neighbouring file despite being told not to. A silent rewrite of `derive.ts` while you are working on the touch layer costs you every guarantee Phase 9 bought.

**Keep your repo as the source of truth**, not the AI Studio workspace.

---

## System Instructions — AI Studio (paste once, verbatim)

```
You are helping build PolyForm, a 3D design application. I am adding a Line
tool and an Arc tool backed by a boundary-representation geometry kernel.

The attached specification is authoritative. When my instruction and the spec
disagree, follow the spec and tell me about the conflict.

Core concept: faces are never drawn directly. They are DERIVED from closed
planar cycles of edges, re-derived after every edit. Read §6 before writing
any derivation code.

Rules for every response:
- Generate ONLY the file I name. Do not create, rewrite, refactor or re-emit
  any other file. If you believe another file must change, say so and stop.
- Treat geometry/types.ts as a frozen contract. Do not change any exported
  type or signature in it unless I explicitly ask.
- Double precision only in the kernel. No Float32Array, no gl-matrix with
  its default array type. Typed arrays appear only at the GPU buffer boundary.
- No polygon-clipping or computational-geometry libraries for face derivation
  (no Clipper, Turf, martinez, polygon-clipping). Face derivation must be a
  direct angular-sort minimal-turn half-edge traversal, because downstream
  code depends on edge identity surviving derivation.
- The kernel must not import React, the renderer, or anything from the UI
  layer. Pure functions over plain data.
- No Math.random and no Date anywhere in the kernel. Output must be
  deterministic run to run.
- Include unit tests in a companion test file in the same response.
- Keep files under ~400 lines. If a file would exceed that, stop and tell me
  the phase needs splitting.
- TypeScript, strict mode.
```

---

## Phase 0a — Audit the existing app

**Run in: Claude** — reads your actual project files.

*PolyForm already exists, so start here rather than at the spec's Phase 0.*

```
Before we build anything: I want an audit, not code.

Describe how PolyForm currently represents 3D geometry — what data structures
hold vertices, edges, faces or meshes, where they live, and which modules
read or write them. Then tell me:

1. Is there any existing edge/face topology, or is geometry currently stored
   as render meshes only?
2. What would have to change for the kernel in §6 of the spec to become the
   source of truth, with the renderer consuming it?
3. Which existing files would need to be touched, and in what order?
4. Anything in the current architecture that conflicts with the spec.

No code. A written assessment and a recommended integration order.
```

*Read the answer carefully. If PolyForm currently stores only render meshes, the kernel is additive and low risk. If it already has partial topology, decide now whether you are replacing it or bridging to it — deciding later is much worse.*

---

## Phase 0b — Types and contract

**Run in: Claude**

```
Create geometry/types.ts.

Implement every entity in §2.1 of the spec: Vertex, Edge, EdgeUse, Loop,
Face, Curve, Plane, plus Container/context types from §2.5 and the tolerance
constants from §3.

Requirements:
- Types and constants only. No logic, no functions with bodies.
- MIN_FACE_AREA must be DERIVED from MIN_EDGE_LENGTH squared, per §3, not
  set as an independent literal.
- Include MIN_CROSS_MAGNITUDE, MIN_ARC_SWEEP, COLINEARITY_TOLERANCE.
- Edge.uses is an array of EdgeUse with no upper bound (§2.4).
- Curve carries analytic parameters plus startTruncated/endTruncated (§5.5).
- Add a short comment on each type saying which spec section defines it.

This file becomes a frozen contract for every later phase.
```

---

## Phase 1 — Math utilities

**Run in: Claude** — tests must execute here.

```
Create geometry/math.ts and geometry/math.test.ts.

Vector and plane operations needed by the kernel: dot, cross, normalize,
add/sub/scale, distance, plane fitting from points, plane basis (2D
projection and unprojection), 3D segment-segment intersection, colinearity
test, coplanarity test, shoelace signed area, point-in-polygon, and
interior-point-of-polygon (a point guaranteed inside a concave polygon —
NOT the centroid).

Critical:
- normalize() must throw on a zero-length vector, never return NaN. §10.3
  explains why.
- Double precision throughout.
- Segment intersection must return null for colinear pairs rather than
  attempting a solve — colinear overlap is handled separately in Phase 4b.

Tests must include: near-tolerance cases either side of each threshold; a
concave polygon whose centroid falls outside it; a plane built 10^6 units
from the origin still passing coplanarity; normalize(0,0,0) throwing.
```

---

## Phase 2 — Spatial index

**Run in: Claude**

```
Create geometry/spatialIndex.ts and its test file.

A BVH or octree over edges and faces supporting insert, remove, update, query
by bounding box, and query by ray. Used by §6.2 Phase 1a to find intersection
candidates without scanning the model.

Tests: 10,000 random edges; bounding-box query returns exactly the correct
candidate set and is measurably faster than a linear scan; removal leaves no
stale entries.
```

---

## Phase 2b — Plane–component index

**Run in: Claude**

```
Create geometry/planeIndex.ts and its test file.

Implement the plane-component index from §6.5:
- Quantised plane hash: unit normal and signed offset snapped to
  COPLANARITY_TOLERANCE, sign-canonicalised so a plane and its reverse land
  in the same bucket.
- Within each plane bucket, union-find over the edges on that plane, giving
  connected components. Each component caches its edge set, face set, cached
  2D basis and bounds.
- Components merge on union. Deletion cannot be expressed by union-find, so
  mark the component dirty and recompute connectivity lazily on next access.

Tests: 200 disconnected coplanar rectangles on one plane produce 200
components; bridging two merges them; deleting the bridge splits them again;
lookup cost does not grow with plane population.
```

---

## Phase 3 — Topology store

**Run in: Claude**

```
Create geometry/topology.ts and its test file.

The half-edge graph from §2.4: add and remove vertices and edges, EdgeUse
management, and edge classification as boundary / manifold / non-manifold.
No faces and no derivation yet.

An edge may be used by any number of faces — do not cap edge-use count.

Tests: build a cube wireframe, every edge reports 0 uses; adding a fin to a
face produces a non-manifold edge; removing an edge cleans up its uses with
no dangling references.
```

---

## Phase 3b — Containers and context

**Run in: Claude**

```
Create geometry/context.ts and its test file.

Implement §2.5 in full:
- Container graphs with local-to-parent transforms and arbitrary nesting.
- Active-context tracking: enter, exit, and which graph writes go to.
- Cross-context transforms: cached M inverse for points and directions,
  cached M inverse-transpose for normals and planes. Invalidate on transform
  change.
- Determinant sign tracking for mirrored containers.
- Explode: merge a container's geometry into its parent.
- Group: move a selection into a new container, DUPLICATING any edge shared
  with geometry left behind.

Tests: two geometrically coincident edges in different containers never
interact; a point snapped from world space into a doubly-nested container
round-trips exactly; under a 2:1:1 ancestor scale an On-Face normal computed
with the inverse-transpose stays perpendicular to the face while one computed
with the plain inverse does not — assert the difference; grouping a face
duplicates its shared edges.
```

---

## Phase 4 — Insertion

**Run in: Claude**

```
Create geometry/insert.ts and its test file.

Implement §6.2 Phase 1a: insertEdge with point intersection, edge splitting
at intersections, vertex merging within VERTEX_MERGE_TOLERANCE, and discard
of edges below MIN_EDGE_LENGTH.

Colinear overlapping pairs must be SKIPPED here — filtered out before
intersect() is called, not after. Phase 4b handles them.

Everything is scoped to one active context graph (§2.5).

Tests: two crossing lines give 4 edges and 5 vertices; an endpoint landing
within tolerance of an existing vertex merges rather than duplicating; a
sub-MIN_EDGE_LENGTH edge is discarded; a colinear pair never reaches
intersect().
```

---

## Phase 4b — Overlap resolution

**Run in: Claude**

```
Create geometry/overlap.ts and its test file.

Implement §6.2 Phase 1b and rule R2b: colinear overlap detection, projection
of all four endpoints onto the shared 1D span, subdivision at every interior
parameter, and deduplication of the shared span.

Three requirements that are easy to get wrong and are load-bearing:
1. Where a span is occupied by both, KEEP THE EXISTING sub-edge and discard
   the new one. The existing edge carries curve membership, attributes and
   EdgeUses that live faces reference.
2. Set the change flag UNCONDITIONALLY, even when every new sub-edge was
   discarded and nothing was created. Skipping derivation on a "no-op" edit
   breaks retrace-to-heal. Do not add a fast path here.
3. Handle full overlap, partial overlap extending past an end, and fully
   contained overlap.

Tests: drawing exactly over an existing edge leaves the edge count unchanged,
preserves the existing edge's object identity, and still sets the change
flag; half-overlap extending past the end yields 3 edges; fully contained
overlap yields 3 edges with no duplicates.
```

---

## Phase 5 — Planar cycle finder

**Run in: Claude** — the gate. Do not run this anywhere the tests cannot execute.

*The most important phase in the build. Do not rush it and do not accept it without the figure-eight test passing.*

```
Create geometry/cycles.ts and its test file.

Implement §6.2 Phase 3a and the cycle-finding part of 3b:

1. Pruning: iterative degree-1 leaf removal until stable, then bridge
   detection and exclusion. Pruned edges are RETAINED in the model and only
   excluded from derivation.
2. Cycle finding: project to the plane's 2D basis, sort incident half-edges
   by angle at each vertex, and traverse taking the IMMEDIATELY ADJACENT
   half-edge — the minimal turn — consistently in one rotational direction.
3. Discard the infinite-face cycle, cycles with fewer than 3 vertices, and
   cycles whose absolute shoelace area is below MIN_FACE_AREA. Discard the
   CYCLE only — its edges stay in the graph and may belong to other cycles.
4. Classify cycles as outer or inner by signed area and containment nesting.
5. Enforce winding: outer loops counter-clockwise from the front, inner loops
   clockwise. Assert outer area > 0, every inner area < 0, and areas summing
   to the true face area.

Implement the traversal directly. Do not use a polygon clipping library.

Tests, all of which must pass:
- rectangle -> 1 cycle
- rectangle plus a diagonal -> 2
- rectangle with an inner square -> outer with one hole, plus the inner face
- inner square bisected -> outer with two holes
- concave L-shape
- FIGURE-EIGHT: two triangles sharing one degree-4 vertex -> exactly 2 faces,
  neither self-intersecting. This is the minimal-turn check.
- lollipop (closed loop plus an antenna) -> 1 face, antenna pruned but still
  present in the model
- branching antenna -> pruning iterates to stable
- two closed loops joined by a single stick -> 2 faces, bridge excluded, no
  pinched zero-area spur
- a needle sliver -> rejected by area, but its edges survive
Every case must also assert the winding invariants above.
```

---

## Phase 6 — Derivation pipeline

**Run in: Claude**

```
Create geometry/derive.ts and its test file.

Implement §6.2 Phases 2 and 3, wiring together Phases 2b, 4, 4b and 5:
- Collect affected planes, deduplicated within COPLANARITY_TOLERANCE.
- Resolve to affected COMPONENTS via the plane index, never whole planes.
- Snapshot existing faces, delete them, re-derive.
- Preserve-or-create (§7.4): a derived cycle yields a face if EITHER a face
  existed on that exact cycle in the snapshot, OR at least one of its edges
  was touched this transaction. A cycle of untouched edges that carried no
  face carries none afterwards. This is what keeps a deleted face deleted.
- Cycle edge-set hash: order-independent, invariant to start edge and
  direction. Sort canonical edge IDs then hash, or mix each ID then XOR.
  NEVER XOR raw IDs. Confirm every hash match by comparing actual edge sets
  before carrying a face forward.

Tests: a line across a face gives two faces with the same total area; a
closed cycle inside a face gives a face-with-hole plus an island face, and
passing those loops to earcut produces no triangles inside the hole; drawing
on one of 200 coplanar panels rebuilds exactly one component; untouched faces
keep their face IDs across an unrelated rebuild in the same component; the
same cycle hashes identically from a different start edge and in reverse; a
deliberately constructed hash collision is rejected by set comparison.
```

---

## Phase 7 — Attributes and normals

**Run in: Claude**

```
Create geometry/attributes.ts and its test file.

Implement §6.3 and §6.4:
- Fast path: hash match means the same face — carry the whole object forward
  including its face ID, do not rebuild and copy fields.
- For unmatched faces: snapshot material, UV basis, layer and attributes;
  reattach by testing which old polygon contains the new face's interior
  point.
- UV basis is an origin plus two in-plane vectors in WORLD coordinates. Never
  per-vertex UVs, never normalised to the face's bounding box.
- Merge direction inherits from the LARGER contributing face by area.
- Normal orientation in this order: neighbour consistency across manifold
  edges only; snapshot consistency; horizontal planes face up; camera-facing;
  canonical sign as a headless fallback. The deterministic rules come BEFORE
  the camera rule.

Tests: paint a face and split it — both halves keep the material, and
sampling the texture either side of the cut at equal world distance gives the
same UV, with no shift and no rescale; splitting a wall flips neither half; a
rectangle drawn on the ground plane comes out facing up; with no camera
supplied, orientation is still deterministic.
```

---

## Phase 8 — Deletion and healing

**Run in: Claude**

```
Create geometry/heal.ts and its test file.

Implement §7 in full:
- 7.0 transactions: snapshot before the pipeline runs; undo RESTORES the
  snapshot and must not re-derive; one transaction per user action;
  validate-then-mutate with atomic rollback on degenerate input; a rejected
  commit consumes no undo entry.
- 7.1 face merging on edge deletion, with the non-merge cases.
- 7.2 colinear vertex dissolution, running LAST, splicing loops in place
  without re-deriving, with provenance tracking so only deletion-created
  vertices dissolve.
- 7.3 orphan cleanup.
- 7.4 deleted faces staying deleted via preserve-or-create.

Use a straightforward structural deep copy for snapshots. Do not implement
copy-on-write or delta patching — I will decide later if profiling requires
it.

Tests: erasing a dividing edge merges the faces with area preserved; erasing
a boundary edge deletes the face and opens a hole; deleting a face leaves a
void that survives an unrelated edit elsewhere in the component; retracing
one boundary edge brings that face back; drawing across the void fills it as
two faces; deleting an island face leaves the outer face's inner loop intact;
a zero-length commit leaves the graph bit-identical with no orphan vertices
and consumes no undo entry; undo restores face IDs identically.
```

---

## Phase 9 — Kernel integration gate

**Run in: Claude** — the gate. End of Block A.

*Do not proceed past this until it is green. Everything after this point is much harder to debug if the kernel is wrong.*

```
Create geometry/kernel.test.ts. No new implementation — tests only.

A scripted session of at least 40 operations exercising: draw a rectangle,
split it, draw an island, delete the island, delete a face, retrace to heal,
draw across a void, erase a dividing edge to merge, erase a boundary edge,
group, explode, then undo all the way to empty and redo forward.

Assert at every step: face count, edge count, vertex count, total area, and
face IDs.

Inject a fixed camera so orientation is reproducible. Then assert the entire
session is deterministic across repeated runs and across a serialise/
deserialise round-trip.
```

---

## Handoff — end of Block A

At this point you have a tested `geometry/` folder with no dependency on PolyForm's UI. Nothing renders yet, and that is expected.

**What to move across:** the whole `geometry/` folder plus its tests. Drop it into your AI Studio project as-is. Do not let AI Studio reformat, restructure or "integrate" it — it is deliberately standalone, and the Phase 9 guarantees only hold while it stays that way.

**Wire it up minimally, then stop.** Have your existing renderer read faces from the kernel rather than from whatever mesh structure it uses now. Phase 0a's audit told you where that seam is. Resist doing anything else in this pass; the tool layer is Block B.

**Keep the kernel out of Build mode's reach.** If AI Studio has a habit of rewriting files it wasn't asked about, `geometry/` is where that hurts most. Check its diffs against your repo copy after every Build turn.

---

## Phase 10 — Line tool state machine

**Run in: Claude** — pure state machine, no rendering.

```
Create tools/lineTool.ts and its test file.

A pure state machine implementing §4.1 — no rendering, no DOM. States and
transitions for: idle, awaiting first point, rubber-band preview, commit,
chain continuation, and termination via Esc, double-click, Enter, or closing
on the start point. Each committed segment is one transaction and one undo
step. Esc during a preview cancels only the segment in progress.

Tests: a simulated event sequence produces the expected sequence of kernel
calls; Esc mid-preview leaves the chain intact; clicking the start point
closes the loop.
```

---

## Phase 11 — Inference engine

**Run in: Claude** for the logic; tune snap radii and cue timing in AI Studio afterwards.

```
Create tools/inference.ts and its test file.

Implement §4.2: point inferences (endpoint, midpoint, intersection, on-edge,
on-face, centre), linear inferences (axis, parallel, perpendicular, edge
extension, from-point), and planar inference. Precedence order exactly as the
spec gives it. Inference locking via modifier hold and arrow keys.

Hit-testing runs ACROSS contexts; insertion targets only the active one
(§2.5). Constraints are evaluated in the active context's local space.

Tests: fixtures where several inferences compete confirm the correct winner
per the precedence table; a lock survives the cursor moving away from the
source; a snap acquired in a parent context converts correctly into an active
nested container.
```

---

## Phase 12 — Measurement field

**Run in: Claude** — a parser, ideal for headless testing.

```
Create tools/measurement.ts and its test file.

Implement §4.3: parsing of plain lengths, explicit units (2400mm, 8'6"),
absolute [x,y,z] and relative <x,y,z> coordinates, and the arc suffixes 24r
and 12s. Keystrokes route to the field automatically.

Post-commit re-solve is ROLLBACK-AND-RECOMMIT, not an endpoint edit: roll the
segment's transaction back in full, re-solve from the same start point and
locked direction with the new value, then re-run the commit as a fresh
transaction. Replace the undo entry rather than pushing a second one.
Re-anchor the live chain, since its start point is the endpoint being
revised. A failed re-solve restores the original commit.

Tests: a parser table covering every accepted format and several rejected
ones; re-solving a segment that split a face produces exactly the geometry
the new value implies with one undo entry; re-solving to an invalid value
leaves the original commit standing.
```

---

## Handoff — end of Block B

Everything headless is now built and tested: the kernel, both tool state machines, inference, the measurement parser, curves and arcs. What remains genuinely needs eyes on a running canvas.

**Move across:** the `tools/` folder and its tests, alongside the `geometry/` folder already there.

**The remaining work is tuning, not construction.** Phases 13 and 17 build the two things that must be seen and touched. Beyond those, expect a few passes over values that no test can settle:

- `SNAP_RADIUS_PX` for mouse and for touch — the spec's suggestions are starting points, not answers.
- `HOVER_DWELL_MS` before a reference point is acquired.
- Whether inference cue colours read clearly against your viewport background.
- Arc drag feel in Mode B — how far the cursor travels per unit of bulge.
- Whether the measurement field is noticeable enough that users find it without being told.

Change these in AI Studio where you can see the effect immediately. If a change turns out to need logic rather than a constant, bring that file back to Claude rather than editing kernel or tool logic in Build mode.

---

## Phase 13 — Rendering and cues

**Run in: AI Studio** — you judge this by looking at it.

```
Create render/drawingOverlay.ts.

Draw the rubber-band preview, snap markers, inference colours, tooltips and
the live length readout, per the tables in §4.2. Preview geometry lives
entirely outside the model — it must not open a transaction or touch the
kernel graph.

This is the boundary where Float32Array is permitted: convert kernel f64
coordinates into GPU buffers here and nowhere earlier.
```

---

## Phase 14 — Curve entity

**Run in: Claude**

```
Create geometry/curve.ts and its test file.

Implement §5.5 and §5.7: analytic storage (centre, normal, radius, start
angle, sweep, segment count), tessellation, Ns re-solve, and splitting.

- Tessellation computes interior vertices only. The first and last vertex
  REUSE the existing Vertex objects the arc was snapped to — never evaluate
  the trigonometric formula at the end angles.
- Splitting: snap to a nearby existing vertex first; otherwise split into TWO
  Curve entities that each keep the analytic parameters; set truncation flags
  when the cut lands mid-segment and disable Ns re-solve on a truncated
  curve.
- Demotion to plain edges when fewer than 2 segments remain, when sweep is
  below MIN_ARC_SWEEP, or when the sagitta r*(1-cos(sweep/2)) is below
  VERTEX_MERGE_TOLERANCE. Demotion is metadata-only — never move a vertex.

Tests: splitting at a vertex gives two curves with parameters intact;
splitting mid-segment sets truncation flags and disables Ns; splitting near
an endpoint demotes the stub to a plain edge with no vertex moving; a 5-degree
sweep at 50m radius does NOT demote while a 5-degree sweep at 1mm radius does;
Ns re-solve leaves the shared end vertices in place.
```

---

## Phase 15 — Arc tool

**Run in: Claude** for the four modes; tune drag feel in AI Studio afterwards.

```
Create tools/arcTool.ts and its test file.

Four modes on the Phase 10 state machine, per §5.1 to §5.4: centre-radius-
angle, two-point chord-and-bulge (the default), three-point, and pie. Pie
also creates the two radii as edges so a face derives on commit.

Tests: each mode produces the correct analytic parameters from a simulated
event sequence; pie mode yields a filled wedge on commit.
```

---

## Phase 16 — Arc inference

**Run in: Claude** — tangency is exact maths, not feel.

```
Extend tools/inference.ts with arc-specific inferences from §5.2: tangent at
vertex, half circle, and equal bulge.

Tangency must be solved ANALYTICALLY. When the inference is active, discard
the cursor's contribution to the start direction entirely and set the tangent
to -normalize(d_edge) exactly, derive the plane from that vector and the
chord, then re-orthogonalise before tessellating.

Guard the cross product. When |cross(t, chord)| < MIN_CROSS_MAGNITUDE, branch
on cause: aligned means the constraint describes a straight line, so emit an
ordinary edge; anti-aligned means suppress the tangent inference and let the
cursor define the plane; only as a last resort fall back to the active
context's drawing plane normal, never a world axis.

Tests: the tangent snap fires only when the chord start is an edge endpoint;
with tangency active the start tangent equals -normalize(d_edge) to machine
precision regardless of cursor position, and a closing chord derives a face
on the first attempt; dragging along the incoming edge produces a straight
segment rather than a flipping arc.
```

---

## Phase 17 — Touch layer

**Run in: AI Studio** — needs a real finger on a real tablet.

```
Create tools/touchAdapter.ts and its test file.

Implement the touch section at the end of §8: enlarged snap radius, snap
preview offset above the fingertip, tap-and-hold to acquire a reference point
in place of hover, on-screen axis lock buttons, an on-screen numeric pad
bound to the measurement field, and an explicit Done affordance alongside
double-tap.

Tests: touch event fixtures drive every interaction; assert that no code path
requires a hover state.
```

---

## Phase 18 — Diagnostics

**Run in: Claude** for detection; surface the hints in AI Studio.

```
Create geometry/diagnostics.ts and its test file.

Report: stray edges pruned in Phase 3a, cycles that failed coplanarity by a
small margin, rejected slivers, newly non-manifold edges, and non-manifold
vertices. Include the optional auto-flatten-on-close behaviour from §3 behind
a setting.

A near-coplanar cycle must produce a visible hint, not silence.
```

---

## When a phase fails

**In Claude**, just say what broke — it can run the suite, reproduce the failure and iterate. Paste the failing output if you have it, but you rarely need to construct the fixture yourself.

**In AI Studio**, do not regenerate the file from scratch — you will lose the parts that worked. Instead:

```
Test [name] is failing. Input geometry:

[paste the fixture]

Expected: [x]
Got: [y]

Fix only this. Do not restructure the file or change any other behaviour.
Show me the changed function, not the whole file.
```

**Either way:** if a phase fails three times on the same test, the problem is usually the phase before it, not this one. Go back and check the earlier phase's assumptions before continuing to patch forward.

**If a Block C phase turns out to need logic changes** — not a constant, but a real behavioural fix in inference, the tool state machine, or the kernel — take that file back to Claude rather than fixing it in Build mode. That is the boundary the whole split exists to protect.
