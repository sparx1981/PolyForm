# PolyForm — Line Tool & Arc Tool

## Functional specification: creating edges, generating surfaces, and splitting surfaces

**Revision 4.**
*r2:* the geometry pipeline in §6 was rewritten as a single-pass plane rebuild (the previous sequential split-then-create ordering was incorrect); topology defined in terms of edge-uses (§2.4); arc splitting defined (§5.7); deletion and healing added (§7); phased build plan for Google AI Studio added (§10).
*r3:* coplanar **connected-component** indexing specified (§6.2, §6.5); **loop winding order** defined so tessellators read inner loops as holes (§6.4).
*r4:* **colinear overdraw** resolution added as R2b and pipeline Phase 1b, including its load-bearing role in retrace-to-heal; **antenna and bridge pruning** added as Phase 3a; arc demotion now uses a radius-aware **sagitta** test rather than a fixed angle (§5.7); world-space **UV anchoring** made explicit (§2.2 R4, §6.3); sliver-cycle rejection added.
*r5:* **shared loop topology** between a face and the island inside it spelled out (§2.4); **face-deletion suppression** added (§7.4) to resolve a conflict between R3 and deleting a face whose edges survive; **analytic tangency** and **exact endpoint binding** mandated for arcs (§5.2, §5.5); **R7 ordering** fixed to run last and without re-derivation (§6.2 Phase 5, §7.2); **transactions and undo** specified (§7.0).
*r6:* r5's suppression registry is **replaced by preserve-or-create** (§6.2 Phase 3b, §7.4, R3) — a simpler rule that also preserves face identity across rebuilds and removes a whole class of stale state; the cycle **edge-set hash** now doubles as the attribute and identity fast path (§6.3); the cycle finder's **minimal-turn** requirement and the figure-eight pinch case are stated explicitly (§6.2); **validate-then-commit with atomic rollback** added for degenerate input (§7.0).
*r7:* **containers and geometry isolation** added as R8 and §2.5 — previously a silent gap, and the reason 3D objects do not cut each other while loose geometry does; the pipeline is now explicitly scoped to one active context (§6.2); erasing is distinguished from smoothing and hiding, and the merge attribute rule is justified (§7.1).
*r8:* **cross-context transform rules** added, including inverse-transpose for normals, what non-uniform scale does to the *meaning* of an inference, and mirrored containers (§2.5.2); **numeric re-solve** redefined as rollback-and-recommit, resolving a contradiction with §7.0 (§4.3); **sliver rejection** specified by shoelace area with edges retained and aspect-ratio tests forbidden (§6.2); tolerance **scale-dependence** addressed (§3); the orientation fallback chain reordered so the **deterministic rules precede the camera heuristic** (§6.4).
*r9:* `MIN_FACE_AREA` is now **derived** from `MIN_EDGE_LENGTH²` rather than set independently (§3); **edge-set hash construction** specified, with raw-ID XOR forbidden and verification on match mandated (§6.3); the **degenerate cross-product** case in arc tangency now branches on cause rather than substituting a plane (§5.2).
*r10:* **§10.3 practical execution notes** added — double precision throughout the kernel, NaN guarding at the normalise helper, iteration-order determinism, deep-copy snapshots left unoptimised through Phase 9, and a prohibition on polygon-clipping libraries in face derivation.

---

## 1. Purpose and scope

This document describes how the **Line tool** and the **Arc tool** behave in PolyForm, in enough detail to implement them.

Both tools are *drawing* tools. Neither has a "make a surface" mode, a "split this face" command, or a dialog box. The user draws edges; PolyForm decides — continuously and automatically — when those edges enclose a region and become a surface, and when they cut an existing surface in two.

That single design decision is what makes the whole system feel simple, and everything below follows from it.

**How to use this document.** Sections 2–7 are the specification. Section 9 is a checklist. **Section 10 is the build order** — do not attempt to generate this system in one pass. It is a boundary-representation kernel plus two interaction layers, and it must be built and verified in stages.

---

## 2. The geometric model

### 2.1 Entity types

| Entity | Description |
|---|---|
| **Vertex** | A point in 3D space. Never drawn directly by the user; created implicitly at the ends of edges and wherever edges cross. |
| **Edge** | A straight segment between exactly two vertices. The only primitive the user actually draws. |
| **EdgeUse** | One *use* of an edge by one loop, carrying a direction. The unit of topological connectivity. See §2.4 — this is not optional. |
| **Loop** | An ordered, closed cycle of edge-uses. A face has exactly one outer loop and zero or more inner loops (holes). |
| **Face (surface)** | A planar region bounded by loops. **Never drawn directly.** Always derived. |
| **Curve** | A named, ordered run of consecutive edges that PolyForm treats as one object for selection, moving and erasing (an arc is a curve), plus the analytic parameters that generated it. Each member edge is still a real, independent edge for face derivation. |

### 2.2 The core rules

These run automatically after **every** drawing or deletion operation. They are the heart of the feature.

**R1 — Edges are sticky.** Any two edges sharing a coincident vertex are joined at that vertex. There is no separate "weld" step.

**R2 — Crossing edges split each other.** If a new edge intersects an existing edge at a point that is not already an endpoint of both, *both* are split there and a shared vertex is created. This applies in 3D, only where edges genuinely intersect within tolerance — edges that merely appear to cross on screen do not split.

**R2b — Overlapping edges collapse into one.** If a new edge is colinear with an existing edge and their spans overlap, they are not two edges but one shared run plus up to two extensions. Subdivide at every interior endpoint and discard the duplicate over the shared span, so no two edges ever occupy the same span. **Never produce a duplicate, zero-length or zero-area edge.** Full details in §6.2, Phase 1b — this rule is what makes retrace-to-heal work, and getting it wrong produces invisible stacked geometry that corrupts every later derivation.

**R3 — Any closed, planar cycle of three or more edges bounds a face.** The instant such a cycle exists, PolyForm derives the face. No confirmation, no command. Note the wording: this is a *derivation* rule about the state of the model, not an event handler on "the user closed a loop." See §6.

One qualification, and only one: a cycle whose face the user has explicitly **deleted** does not spontaneously return. Derivation preserves existing face state and creates new faces only for cycles the current edit actually touched — the **preserve-or-create** rule (§6.2 Phase 3b, §7.4). Without it, deleting a face to make an opening would be impossible, because the next edit anywhere on the same panel would fill it back in.

**R4 — Splitting is not a separate operation.** An edge drawn across a face changes the set of planar cycles on that plane; re-deriving the plane yields two faces instead of one. There is no distinct "split" algorithm. This is the correction to r1 of this spec. Both resulting faces inherit the original's material, layer and attribute dictionary, and — critically — its **world-space UV basis**, so that a texture reads as continuous across the cut rather than shifting or restarting on either side (§6.3).

**R5 — Deleting an edge removes the faces that used it, *unless* the faces can merge.**
- If the edge is used by exactly two coplanar faces, and removing it leaves a single valid loop, **the two faces merge into one** (§7.1).
- Otherwise, every face using the edge is deleted. Remaining edges survive.

**R6 — Faces merge when the edge between them is removed.** The inverse of R4. Attributes resolve per §7.1.

**R7 — Redundant vertices dissolve.** A vertex whose only attachments are exactly two colinear edges may be dissolved, merging those edges into one. This is the inverse of R2 and prevents unbounded geometry bloat. **Conditions and the case for making it optional are in §7.2 — do not implement it unconditionally.**

**R8 — All of the above stop at a container boundary.** R1–R7 apply only between entities in the same graph. Geometry in different containers never merges, splits or bounds a face together, however exactly it coincides in space. This is what makes objects behave as objects rather than welding into one mass; see §2.5.

### 2.3 Consequences worth stating explicitly

- The user never chooses whether they are making "a line" or "a shape". They draw, and the result is whatever the geometry warrants.
- Four separate lines forming a rectangle and a rectangle drawn with a rectangle tool produce **identical** geometry. There is no privileged construction history.
- Because faces are derived, a face can be *recovered*. If a user deletes a face but leaves its boundary edges, re-drawing over any one of those edges re-triggers derivation and the face returns. This "retrace to heal" behaviour is the single most common way users repair a model — preserve it.

### 2.4 Topology representation and non-manifold geometry

**Use an edge-use (half-edge) structure.** A winged-edge or half-edge kernel is required; a naive `Edge { faceA, faceB }` model will not survive contact with real user geometry.

```
Edge {
  v0, v1: Vertex
  uses: EdgeUse[]      // unordered, length 0..n
  smooth: bool
  curve: CurveRef | null
}

EdgeUse {
  edge: Edge
  loop: Loop
  reversed: bool       // direction of travel around the loop
}
```

**Manifold rules:**

- **An edge may be used by any number of faces.** Three walls meeting at a corner, a fin protruding from a panel, or two boxes sharing an edge are all legal and common. Do not cap edge-use count globally.
- **Per plane, an edge may bound at most two faces** — one on each side. If a derivation would produce a third coplanar face using the same edge on the same side, the derivation is wrong; treat it as a bug, not a valid state.
- **Classify each edge** as `boundary` (0 or 1 use), `manifold` (exactly 2 uses), or `non-manifold` (3+ uses). Surface this in rendering: non-manifold and boundary edges are drawn heavier, so users can see holes and stray geometry without running a diagnostic.
- **Normal propagation stops at non-manifold edges.** When orienting a newly derived face by consistency with its neighbours (§6.4), only traverse across `manifold` edges. Across a non-manifold edge there is no correct answer, so fall back to the camera-facing heuristic.
- **Smoothing groups likewise only span manifold edges.** A smooth flag on a non-manifold edge is ignored for shading.

**T-junctions.** A vertex lying *on* an edge but not topologically connected to it is a T-junction, and it silently breaks face derivation (the cycle cannot close through it). R2 prevents most of these by splitting on intersection, but they still arise from imported geometry and from moved vertices. Provide a `resolveTJunctions(region)` pass that finds vertices within `VERTEX_MERGE_TOLERANCE` of an edge's interior and splits that edge to include them. Run it on import, and after any move/scale operation — not on every click, as it is more expensive than the drawing path can afford.

**Bisecting a hole.** A line drawn across an inner loop of a face must be handled by the same derivation as everything else: after insertion, the plane's cycle set now contains cycles that partition the former hole. If the line's endpoints both lie on the inner loop, the hole becomes two smaller holes *or* — if the line is drawn between an inner loop and the outer loop — the hole is "opened" and the face becomes a single simply-connected region with a slot. Both fall out of §6 correctly and neither needs special-casing, which is precisely the argument for a single-pass derivation.

**A face and the island inside it share their boundary edges.** When a closed cycle is drawn inside an existing face, derivation produces two faces: the outer face, which gains an inner loop, and the island face, whose outer loop runs around the same cycle. These are **the same Edge objects**, used twice:

- Each edge in that cycle carries exactly **two EdgeUses** — one in the outer face's inner loop, one in the island's outer loop — with **opposite `reversed` flags**, since the two loops wind in opposite senses (§6.4). The edge is therefore `manifold`, not non-manifold.
- **Deleting the island face** removes only its own EdgeUses. The edges survive because the outer face still uses them, and the outer face simply keeps its inner loop — leaving an empty void. Nothing needs to be rebuilt, and the hole's boundary is exactly where it was.
- **Deleting one of the edges** is a different operation with a different result: both faces lose a boundary, and per R5 the hole is opened into the outer face rather than left as a void.

Users read these as two distinct actions ("delete the panel" versus "erase this line") and expect two distinct outcomes, so do not collapse them into one code path.

### 2.5 Containers and geometry isolation

Everything in §2.2 describes geometry that **sticks**. Two edges that touch merge; a face drawn against another face cuts it. That is correct and desirable for the geometry a user is actively drawing, and unusable as a whole-model policy — without an isolation mechanism, every object welds to every object it touches, and a model becomes one undifferentiated graph within an afternoon.

**Containers are that mechanism, and they are a prerequisite for the drawing tools, not a later feature.** The question "does drawing this line split that surface?" cannot be answered without them.

**2.5.1 The rule**

A **container** (a group, or an instance of a reusable component) holds its own edge and face graph in its own local coordinate frame.

> **R8 — Stickiness stops at a container boundary.** R1, R2, R2b, R3 and R4 apply only between entities in the **same** graph. Two edges that are geometrically coincident but sit in different containers do not merge, do not split each other, and do not together bound a face. A face inside a container is never split by a line outside it.

This single rule is what makes 3D objects behave as objects. Two boxes built as containers and pushed together interpenetrate visually and remain wholly independent — no cut faces, no merged vertices, no shared edges. Two boxes built as loose geometry in the same graph weld together and cut each other, exactly as R2 and R4 say they must. **The difference is containment, not dimensionality.** There is no separate rule for "3D objects"; a solid is just a closed shell of the same faces the Line tool makes.

**2.5.2 Edit context**

At any moment the tools have exactly one **active context** — the top-level graph, or a container the user has opened. Drawing writes to the active context and nowhere else.

- **Entering** a container (double-click, or an explicit open) makes its graph active. **Exiting** (`Esc`, or clicking outside) returns to the parent.
- **Geometry outside the active context is visible and fully snappable, but never modified.** The inference system in §4.2 must hit-test across contexts, while insertion writes only to the active one. This combination is what makes it possible to draw a wall inside one container that aligns exactly with a window in another.
- A point snapped from an outside context is converted into the active container's local frame at commit. Store local coordinates; never leak a parent-frame point into a child graph.
- **Nesting isolates at every level.** A container inside a container is opaque to its parent's geometry until opened.
- Dim or ghost out-of-context geometry so the user can see which graph they are drawing into. This is not decoration — drawing into the wrong context is the single most common confusion in this model, and the visual state is the only cue the user gets.

**Transforms across contexts.** Each container carries a local-to-parent matrix; the active context's world matrix `M` is the product down the nesting chain. Snapping across contexts is a change of basis, and points and directions do not transform the same way:

| Quantity | Transform into the active context |
|---|---|
| Point (snapped position) | `p_local = M⁻¹ · p_world` |
| Direction (axis lock, edge direction, arc tangent) | `d_local = M⁻¹ · d_world`, renormalised |
| Normal or plane (On Face, perpendicular lock) | `n_local = (M⁻ᵀ) · n_world`, renormalised |

Cache `M⁻¹` and `M⁻ᵀ` per context and invalidate on transform change — never recompute them inside a hit-test loop, which runs on every mouse move.

**Non-uniform scale changes what an inference *means*, not just its arithmetic.** Under a non-uniform ancestor scale, angles are not preserved: two directions perpendicular in world space are not perpendicular in the container's local space, and the inverse-transpose is what keeps a plane a plane rather than a skewed surface. Because the two spaces genuinely disagree, you must choose which one the constraint refers to, and say so:

- **Evaluate constraints in the active context's local space**, and draw the on-screen cue from the local result transformed back out. A perpendicular lock then produces geometry that is perpendicular *in the container* — which is what the user is building, and what stays true if the container is later rescaled.
- **Warn on entry** to a container with a non-uniform ancestor scale. Axis locks and angle inferences will visibly not align with the world axes, and without a cue this reads as broken snapping.
- Best of all, offer to **normalise the scale** into the geometry when a container is opened for editing. A container scaled 2:1:1 can have that scale baked into its vertices and its matrix reset to identity, after which every inference behaves normally. This is the fix users actually want.

**Mirrored containers.** A transform with negative determinant flips winding, so a face whose local normal is correct appears reversed in world space. Track the determinant sign per context and account for it when rendering front/back and when propagating orientation across a container boundary (§6.4). Do not "fix" it by reversing the stored loops — the local geometry is correct and the parent's transform is the thing describing the mirror.

**2.5.3 Crossing the boundary deliberately**

Two operations move geometry between graphs, and both run the full pipeline of §6 on arrival:

- **Explode** dissolves a container and merges its geometry into the parent graph. Stickiness now applies: coincident vertices merge, crossing edges split, coplanar regions re-derive. A box exploded against another box becomes one welded mass — this is the operation that makes previously independent objects cut each other, and it is irreversible except by undo. Treat it as a single transaction (§7.0) over the union of the affected components.
- **Group / make component** does the reverse: it moves a selection into a new container. Any edge shared between the selection and geometry left behind must be **duplicated** — one copy in each graph — because R8 forbids a single edge spanning two graphs. Faces on the outside that used those edges survive against their copy. Users experience this as "grouping a face left a copy of its edges behind," and it surprises them, so say so in the UI at the time.

**2.5.4 What this spec does not cover**

Deliberate interaction *between* containers — intersecting one solid with another, subtracting, unioning, trimming, or generating edges where two containers' faces cross — is a separate feature area with its own algorithms (robust surface–surface intersection, solid classification, tolerance handling under near-tangency). It is out of scope here.

The dependency runs one way and is worth stating: those operations consume the kernel specified in §6 and add to it. They do not change any rule above. When they are specified, they should produce their results by generating edges into a target graph and letting the existing derivation build the faces — not by constructing faces directly.

---

## 3. Tolerances

Implement these as named constants; they are load-bearing for how forgiving the tools feel.

| Constant | Suggested value | Purpose |
|---|---|---|
| `VERTEX_MERGE_TOLERANCE` | 0.001 model units | Two vertices closer than this are treated as one. |
| `COPLANARITY_TOLERANCE` | 0.001 units, or ~0.05° normal deviation | Maximum deviation before a cycle is rejected as non-planar. |
| `COLINEARITY_TOLERANCE` | ~0.1° | Angle below which two edges count as colinear — for both overdraw detection (R2b) and degree-2 vertex dissolution (R7). |
| `MIN_EDGE_LENGTH` | 0.001 units | Edges shorter than this are discarded rather than created. |
| `MIN_FACE_AREA` | `MIN_EDGE_LENGTH²` | Cycles below this area are rejected as slivers rather than becoming faces. **Derive it, do not set it independently** — it is the area of the smallest square buildable from legal edges, so defining it this way keeps the two consistent by construction and makes both follow the unit binding below automatically. At 0.001 units that is 1e-6 units²; in a millimetre model it becomes 1 mm², which is correct rather than coincidental. |
| `MIN_ARC_SWEEP` | 1° | Sweep floor below which a split arc demotes to plain edges (§5.7). |
| `MIN_CROSS_MAGNITUDE` | 1e-4 | Sine of the angle below which two directions count as parallel for cross-product construction (§5.2). |

**These are absolute, and absolute tolerances are scale-dependent.** A model authored in millimetres and one authored in kilometres are not the same problem: `MIN_FACE_AREA` at 1e-6 units² is generous jewellery detail and invisible site-plan noise depending on which you are in. Two mitigations, in order of preference:

1. **Bind tolerances to the document's unit setting** at creation, so a millimetre model gets millimetre-appropriate values. This covers the overwhelming majority of cases with no user-visible complexity.
2. **Expose them in advanced settings** for the minority working at extreme scales, and make sure changing them does not retroactively invalidate existing geometry — apply new values to subsequent operations only.

Do not scale tolerances dynamically from model bounds. It seems clever and it makes derivation non-deterministic: the same drawing operation produces a different result depending on what else happens to be in the file.
| `SNAP_RADIUS_PX` | 10–14 px (mouse), 22–28 px (touch) | Screen-space radius for snap acquisition. Must scale with input type. |
| `HOVER_DWELL_MS` | 150–250 ms | Dwell before a point is "acquired" for from-point inference. |

**Note on coplanarity:** near-miss coplanarity is the number one source of "why didn't a surface appear?" confusion. Two mitigations:

1. When a cycle closes but fails the coplanarity test by a small margin (say, under 1°), show a passive hint: *"Edges don't lie on one plane — no surface created."* Do not silently do nothing.
2. Offer an optional **auto-flatten on close** setting that projects near-coplanar cycle vertices onto a best-fit plane when deviation is below a user-visible threshold.

---

## 4. The Line tool

### 4.1 Interaction loop

The tool is a chained polyline drawer:

1. **Activate.** Cursor becomes a pencil. Nothing is selected or modified.
2. **First click** sets the start point (snapped per §4.2).
3. **Move.** A rubber-band preview follows the cursor, styled distinctly from committed geometry (thinner, semi-transparent), with a live length readout.
4. **Second click** commits the edge. The pipeline in §6 runs.
5. **The tool continues from the end of the edge just drawn**, so a further move-and-click chains another segment. Every segment is a separate, independent edge.
6. **Terminate** with `Esc`, a double-click, `Enter`, or by clicking the start point of the chain (which closes the cycle and, per R3, usually produces a surface).

Each committed segment is a discrete undo step. `Esc` during a preview cancels only the in-progress segment, not the chain drawn so far.

### 4.2 The inference system

Inference is what allows precise modelling without typing. As the cursor moves, PolyForm hit-tests nearby geometry and offers a snap, indicated by a coloured marker, a tooltip and a change in the preview line's colour.

**Point inferences** (snap the endpoint to a location):

| Inference | Marker | Description |
|---|---|---|
| Endpoint | Green square | End of an existing edge. |
| Midpoint | Cyan diamond | Exact midpoint of an edge. |
| Intersection | Black cross | Where two edges cross in 3D. |
| On Edge | Red dot | Anywhere along an edge; creates a vertex there and splits the edge. |
| On Face | Blue dot | Anywhere on a surface; constrained to that surface's plane. |
| Centre | Green dot | Centre of an arc or circle. |

**Linear inferences** (constrain direction):

| Inference | Cue | Description |
|---|---|---|
| On axis | Preview turns solid red / green / blue | Parallel to a primary axis. |
| Parallel to edge | Magenta preview | Parallel to a previously hovered edge. |
| Perpendicular to edge | Magenta preview | Perpendicular to a previously hovered edge. |
| Edge extension | Dotted line in the edge's colour | Colinear with an existing edge, beyond its end. |
| From point | Dotted guide from the source point | Aligned with a previously hovered point along an axis. |

**Planar inference:** when the start point lies on an existing face, the segment is constrained to that face's plane by default. This is what makes drawing *on* a surface reliable, and it is the precondition for splitting.

**Inference locking** (essential — do not omit):

- Hold `Shift` while an inference is active to **lock** it. The preview thickens and the lock persists while held, letting the user move the cursor freely without losing the direction.
- Arrow keys lock an axis directly: `↑` = vertical, `←`/`→` = the two horizontal axes, `↓` = parallel/perpendicular to the last hovered edge. Pressing the same key again releases.

**Precedence.** When several inferences compete inside the snap radius, resolve: Endpoint → Intersection → Midpoint → Centre → On Edge → On Face → linear → free point. Snap to the highest-priority candidate, but render the others dimmed so the user can see what they are rejecting.

### 4.3 Numeric entry

A persistent **measurement field** in the viewport corner accepts typed values at any time during a drag. The user never clicks into it — keystrokes route there automatically.

| Input | Meaning |
|---|---|
| `2400` | Length in current model units, along the inferred or locked direction. |
| `2400mm`, `8'6"` | Explicit units, overriding the model default. |
| `[x, y, z]` | Absolute coordinates for the endpoint. |
| `<x, y, z>` | Coordinates relative to the segment's start point. |

`Enter` commits at the typed value. Critically, **the value stays editable after commit**: retyping a different number immediately re-solves the segment just drawn, until any other action is taken. This turns "draw roughly then correct" into a single keystroke.

**Re-solve is rollback-and-recommit, never an endpoint edit.** The commit that is being revised may have split edges under R2, cut a face under R4, absorbed an overdraw under R2b, dissolved a vertex under R7, or merged a component. None of that can be unwound by moving a vertex, and attempting it corrupts the topology that was just derived. The sequence is:

1. Roll the segment's transaction back in full (§7.0), returning the graph to its exact pre-commit state.
2. Re-solve the segment's endpoint from the same start point, the same locked direction, and the new value.
3. Re-run the commit — validation, insertion, derivation — as a fresh transaction.

Consequences worth implementing deliberately:

- **The chain follows.** If the tool has already advanced to the next segment, that segment's start point is the endpoint being revised, so it moves too. Re-solve, then re-anchor the live rubber band.
- **One undo entry, not two.** Replace the rolled-back transaction in the undo stack rather than pushing a second one. The user made one segment and corrected it; `Ctrl-Z` should remove the segment, not step backwards through their typing.
- **The window closes on any other action.** A new click, a tool change, a selection, or `Esc` ends re-solvability. After that the segment is ordinary history and the only route back is undo.
- **A failed re-solve leaves the original standing.** If the new value would produce degenerate geometry, the rollback is itself rolled back — restore the original commit rather than leaving the user with nothing.

### 4.4 Outcomes of drawing a line

| Situation | Result |
|---|---|
| Two points in empty space | A single free-floating edge. No surface. |
| A chain that closes on itself, all points coplanar | Edges plus **one new surface**. |
| A chain that closes on itself, points not coplanar | Edges only. Hint shown (§3). |
| Both endpoints on the boundary of one face, segment on its plane | The face becomes **two faces**. |
| One endpoint on a face boundary, the other in the face interior | A "stray" edge lying on the surface that bounds nothing. Legal, often intentional as construction geometry, but flag it in diagnostics. |
| Segment crosses an existing edge mid-span | Both edges split at the crossing (R2). |
| A closed cycle drawn entirely *inside* an existing face | An inner face is derived; the outer face gains an inner loop. Deleting the inner face leaves a **hole**. |
| A line drawn across an existing hole | The hole is partitioned, or opened into the outer region — falls out of §6 with no special case. |
| Endpoint within `VERTEX_MERGE_TOLERANCE` of an existing vertex | Snaps and merges — no near-duplicate vertices. |
| Segment drawn across a face that sits in a **different container** | Nothing splits. The edge is created in the active context, passing through the other object without touching it (R8, §2.5). |
| Segment snapped to a point on out-of-context geometry | Snap is honoured for position; the edge is still created in the active context, in its local frame. |

---

## 5. The Arc tool

A single tool with **four modes**, cycled with a modifier or picked from a flyout. Keeping them under one tool matters: the user learns one grammar (*click, click, move, optionally type*) and picks the mode matching the constraint they already know.

### 5.1 Mode A — Centre, radius, angle

1. Click to place the **centre**.
2. Move; a radius line rubber-bands. Click to set the **start point**, fixing radius and plane.
3. Move; the arc sweeps. Click to set the **end point** and included angle.

Measurement field: radius before the second click, included angle in degrees before the third.

**Use it when:** the centre is known — a bolt circle, a pivot, a turning radius.

### 5.2 Mode B — Two-point arc (chord and bulge)

The default, and where most users will live.

1. Click the **start** of the chord.
2. Click the **end** of the chord; a straight preview appears.
3. Move perpendicular to the chord — the arc bulges. Click to commit.

Measurement field accepts, before the final click: a plain number → **bulge** (chord midpoint to apex); `24r` → **radius**; `12s` → **segment count**.

Special inferences:
- **Tangent at vertex.** If the chord's start is the endpoint of an existing edge or arc, the preview snaps cyan when the new arc leaves tangentially. Smooth continuous curves with no construction geometry.

  **Solve tangency analytically, never by snapping the mouse.** Once the tangent inference is active, discard the cursor's contribution to the start direction entirely and set the arc's start tangent to the exact negated direction of the incoming edge, `t = -normalize(d_edge)`. Derive the arc's plane from that exact vector and the chord, `n = normalize(cross(t, chord))`, then re-orthogonalise before tessellating. Letting a screen-space snap supply a direction that is tangent to within ~10⁻⁵ rad looks identical on screen and then fails `COPLANARITY_TOLERANCE` downstream, producing the single most baffling bug in this class of tool: a smooth-looking curve that refuses to make a surface. Compute the geometry from the constraint, and use the cursor only to decide *which* constraint applies.

  **Guard the cross product.** When the tangent and the chord are near-parallel, `cross(t, chord)` collapses towards zero and normalising it yields a garbage plane — the arc flips wildly or vanishes, and it happens exactly when the user drags along the incoming edge, which is a natural thing to do. Test `|cross(t, chord)| < MIN_CROSS_MAGNITUDE` (a sine, so the constant is an angle threshold) and branch on *why* it collapsed rather than substituting a plane and continuing:

  - **Tangent and chord point the same way** — the constraint describes a straight line, not an arc. Preview a straight segment and commit an ordinary edge. This is almost always what the user wants, and it makes the tangent mode degrade gracefully into the Line tool rather than misbehaving.
  - **They point opposite ways** — the arc would double back on itself through 360°. There is no sensible answer; suppress the tangent inference for this drag and let the cursor define the plane normally. The cyan cue disappears, which is the correct signal that the constraint no longer applies.
  - **Only as a last resort**, where a plane is genuinely required and neither branch fits, fall back to the active context's drawing plane normal (§2.5.2). Never fall back silently to a world axis — inside a rotated container that produces an arc visibly out of plane.
- **Half circle.** Snap with a tooltip as bulge passes exactly half the chord length.
- **Equal bulge.** Snaps to match the previous arc's bulge, for repeating profiles.

### 5.3 Mode C — Three-point arc

1. Click the **start**. 2. Click a **point the arc must pass through**. 3. Move and click to place the **end**.

**Use it when:** tracing an existing curve, an imported image, or three known site points.

### 5.4 Mode D — Pie

Mode A, but on commit the two radii are also created as edges, closing the cycle. A **filled wedge surface** results. It is a convenience mode, not a special case — the geometry is indistinguishable from an arc plus two lines.

### 5.5 Arcs as curves

An arc is stored as a **curve**: an ordered run of straight edges (default **12 segments**) plus the analytic parameters that generated it.

```
Curve {
  edges: Edge[]              // ordered, consecutive
  kind: 'arc'
  centre, normal: Vec3
  radius: number
  startAngle, sweep: number
  segments: number
  startTruncated, endTruncated: bool   // see §5.7
}
```

Behavioural consequences:

- **Selection is unified.** Clicking any segment selects the whole arc; moving or erasing acts on the whole curve. A modifier-click isolates a single edge for advanced users.
- **Face derivation is per-edge.** Segments behave exactly like hand-drawn lines. An arc closed by a chord makes a surface. An arc crossing a face splits it, cleanly, along all 12 segments.
- **Segment count is retroactively editable.** Immediately after drawing, typing `24s` re-solves the curve. Later, an inspector field on the selection does the same. Regeneration must preserve connectivity to neighbouring geometry and re-run derivation on affected planes.
- **Smoothing.** Interior edges carry a smooth flag so adjacent faces render continuously rather than as a visible facet fan. The edges still exist, they are simply not drawn.
- **Retain the analytic definition.** Never store an arc as bare segments. Radius, centre and tangency are needed for offset, follow-me, dimensioning, and regeneration.
- **Bind the end vertices exactly; compute only the interior ones.** When tessellating, generate interior vertices from the analytic parameters, but for the first and last vertex **reuse the existing Vertex object** the arc was snapped to, rather than evaluating `C + R·û` at the end angles and landing a fraction of a unit away. A computed endpoint sitting 10⁻⁷ from its target either fails the merge test or passes it and leaves a near-degenerate edge, and in both cases the resulting cycle can miss `COPLANARITY_TOLERANCE` — a curve that visibly meets its neighbour and still refuses to close a face. This applies to **every mode**: the start point in Mode A, all three picks in Mode C, and both radii endpoints in Mode D, along with the centre point wherever it was snapped to existing geometry. It applies again after any `Ns` re-solve — the segment count changes, the shared end vertices do not move. This is the counterpart to the tangency rule in §5.2: snap decides the constraint, arithmetic never re-derives a point the model already has.

### 5.6 What arcs do to surfaces

| Situation | Result |
|---|---|
| Arc on a face, both endpoints on the face boundary | Face becomes two — one with a curved boundary. |
| Arc + chord closing the cycle | New surface (a segment/lens shape). |
| Arc corner-to-corner across a rectangle | Splits into a curved region and its complement — the standard way to model a fillet or curved wall. |
| Arc endpoints not on the face's plane | No split. Free-floating curve. |
| Arc in empty space closed by lines | Surface derived, provided all vertices are coplanar. Because arc segments are generated *on* a plane by construction, arcs are inherently coplanar — a reliability advantage over freehand chains. |
| Pie mode | Surface on commit, always. |

### 5.7 Splitting an existing arc

When a new edge intersects a curve, R2 fires on one of its member edges. The curve must be resolved explicitly — this is the case r1 of this spec left undefined.

**Rule 1 — Snap to the nearest existing vertex first.** If the intersection point falls within `VERTEX_MERGE_TOLERANCE` of an existing vertex between two segments, snap to it. This avoids the whole problem and is the common case, because users usually aim at a visible vertex. Do this before creating any new geometry.

**Rule 2 — Split into two curves, not loose edges.** Otherwise, the curve is divided at the intersection into **two Curve entities**, each inheriting `centre`, `normal` and `radius`, with recomputed `startAngle` and `sweep`. Curve identity survives the cut. Do not explode to raw edges — that would silently destroy the analytic data that offset and follow-me depend on, and it is not recoverable.

**Rule 3 — Flag truncated ends.** If the intersection lands *inside* a segment rather than at a vertex, the new vertex lies on the chord of that segment, not on the true circle. The resulting piece is therefore no longer an exact discretisation of its analytic arc. Split the segment, assign the pieces to the two curves, and set `endTruncated` / `startTruncated` on the affected side. Downstream operations then decide for themselves:
- **Offset, follow-me, dimensioning** read the analytic parameters and ignore the truncated end segment, or refuse with a clear message.
- **Segment-count re-solve (`Ns`)** is *disabled* on a truncated curve, because regenerating would move the cut vertex and break the connection to whatever edge caused the split. Grey out the control and explain why rather than failing silently.

**Rule 4 — Demote degenerate curves.** A curve wrapper that no longer describes a meaningful arc is discarded, leaving plain edges. Demote when **any** of the following holds:

- fewer than **2 segments** remain — a one-segment "arc" is a straight line carrying misleading metadata, and no offset or follow-me operation can do anything useful with it;
- the remaining sweep is below `MIN_ARC_SWEEP` (suggested **1°**) — the curve is a rounding artefact of the cut, not something the user drew;
- the piece is **visually indistinguishable from a straight line**, tested by sagitta rather than by angle alone.

**On thresholds.** A fixed angular cutoff such as 5° is the wrong test on its own, because it is radius-blind: a 5° sweep of a 50 m radius arc is a 4.4 m run with real, visible curvature, and demoting it would be plainly wrong to the user. Use the sagitta — the maximum deviation of the chord from the true arc:

```
sagitta = radius * (1 - cos(sweep / 2))
if sagitta < VERTEX_MERGE_TOLERANCE:  demote
```

This scales correctly with radius, and it says exactly the thing you mean: *this piece cannot be distinguished from a straight line at the model's own tolerance.* Keep the sweep floor as a cheap early-out alongside it.

**Demotion is metadata-only.** Never move a vertex to "straighten" a demoted piece. The vertices stay exactly where they are; only the `Curve` wrapper and its analytic parameters are dropped. A demotion that changes geometry is a bug, and it will show up as a visible kink at the joint.

**Rule 5 — Both pieces stay selectable as units.** After the split, clicking either piece selects that piece's full run of edges, not the original whole. Users read the cut as having made two arcs, and selection must agree with what they see.

---

## 6. The geometry pipeline

### 6.1 Why this is one pass

Revision 1 of this document specified face *splitting* and face *creation* as two sequential algorithms. That is wrong, and it fails on ordinary input — most visibly when a line drawn inside a face creates an enclosed island, where the split logic has no valid "boundary to boundary" case to match and the creation logic finds a cycle that overlaps a face still occupying the region.

The correct model, and the one every production B-rep kernel uses, is:

> **Insert topology first. Then re-derive all faces on every affected plane, from scratch.**

There is no "split" operation and no "create" operation. There is only *derive*. Splitting, creation, hole formation, hole bisection and hole opening are all the same code path viewed from different starting states. This collapses a large family of edge cases into one algorithm, and it is the single most important structural decision in this document.

### 6.2 The pipeline

```
onGeometryChanged(newEdges):

  # Everything below operates within ONE graph — the active context
  # (§2.5). Candidate queries, plane collection and component lookup
  # are all scoped to it. Geometry in other containers is never
  # touched, however closely it coincides.

  # ---- Phase 1a: point intersections (R1, R2) ----
  for each newEdge:
      candidates = spatialIndex.query(newEdge.bounds)
      for each existing edge E in candidates:
          if colinearAndOverlapping(newEdge, E):
              continue              # handled in Phase 1b, not here —
                                    # intersect() is undefined for
                                    # colinear pairs and will return
                                    # garbage or divide by zero
          p = intersect(newEdge, E)
          if p exists and is not an endpoint of both:
              split newEdge at p
              split E at p          # may split a Curve — apply §5.7
      merge vertices within VERTEX_MERGE_TOLERANCE
      discard edges shorter than MIN_EDGE_LENGTH

  # ---- Phase 1b: colinear overlap resolution (R2b) ----
  for each newEdge:
      overlaps = candidates filtered by colinearAndOverlapping()
      for each existing edge E in overlaps:
          d  = shared unit direction
          # project all four endpoints onto the 1D span
          ts = sorted([t(newEdge.v0), t(newEdge.v1),
                       t(E.v0),       t(E.v1)])
          subdivide both edges at every interior parameter in ts
            that is not already one of their own endpoints
          for each resulting sub-span:
              if occupied by both:
                  keep the EXISTING sub-edge, discard the new one
                  # preserves curve membership, attributes, edge-uses
                  # and the identity the user's faces already reference
              else:
                  keep whichever sub-edge exists
      changed = true   # even if every new sub-edge was discarded

  markChanged(all edges touched in Phase 1a and 1b)

  # ---- Phase 2: collect affected planes ----
  planes = {}
  for each edge touched in Phase 1:
      for each plane P supporting a face that used this edge:
          planes.add(P)
      for each plane P through this edge and any coplanar neighbour:
          planes.add(P)             # candidate new planes
  # Deduplicate planes within COPLANARITY_TOLERANCE.

  # ---- Phase 3: re-derive each affected component ----
  # NOT "each affected plane" — see §6.5. A plane may carry hundreds
  # of unrelated coplanar panels; only the touched component rebuilds.
  components = {}
  for each plane P in planes:
      for each edge touched in Phase 1 that lies on P:
          components.add(planeComponentIndex.lookup(P, edge))

  for each component C in components:
      region      = C.edges              # already a connected sub-graph
      oldFaces    = C.faces
      snapshot(oldFaces)                 # for attribute reattachment
      delete oldFaces                    # edges survive

      # ---- Phase 3a: prune what cannot bound a face ----
      loopRegion = copy(region)
      repeat until stable:               # iterative leaf pruning
          remove every vertex of degree 1 and its edge
      remove all bridge edges from loopRegion   # Tarjan; a bridge
          # lies in no cycle, so traversal would walk it twice and
          # emit a pinched, zero-area spur
      pruned = region - loopRegion       # retained in the model,
                                         # excluded from derivation,
                                         # reported as stray (§6.2 notes)
      if loopRegion is empty: continue

      # ---- Phase 3b: derive ----
      project loopRegion to 2D in C.plane's basis
      cycles = findAllMinimalCycles(loopRegion2D)  # planar embedding,
                                                  # minimal-turn rule
                                                  # at every vertex —
                                                  # see notes below
      discard the single cycle with the region's
        outermost signed area (the infinite face)
      discard any cycle whose vertex count < 3
        or whose |shoelace area| < MIN_FACE_AREA
        # edges are NOT discarded — they stay in the graph and
        # may still belong to a larger valid cycle

      # ---- preserve-or-create (§7.4) ----
      for each cycle:
          h = edgeSetHash(cycle)          # order-independent
          if snapshot.facesByHash has h:
              carry that face forward WHOLESALE — same face ID,
                material, UV basis, layer, attributes, orientation
              continue                    # nothing to rebuild
          else if any edge in cycle was marked changed in Phase 1:
              create a new face
          else:
              skip                        # untouched cycle that
                                          # carried no face — e.g. a
                                          # deliberately deleted one.
                                          # This IS the void.

      classify surviving cycles as outer or inner
        by signed area sign and containment nesting
      for each outer cycle:
          face = createFace(outerLoop = cycle)
          attach every inner cycle contained by it,
            and not contained by a nearer outer cycle,
            as an inner loop
      enforceLoopWinding(face)      # §6.4 — mandatory, not cosmetic
      orientNormals(newFaces)       # §6.4
      planeComponentIndex.update(C) # components may have split or merged

  # ---- Phase 4: reattach attributes ----
  reattachAttributes(snapshot, newFaces)          # §6.3

  # ---- Phase 5: redundant vertex dissolution (R7) ----
  # Runs last, and does NOT trigger re-derivation: merging two
  # colinear edges is geometry-preserving, so loops are spliced
  # in place. Iterate to stable, capped. See §7.2.
  dissolveRedundantVertices(candidates, maxPasses = 3)

  # ---- Phase 6: diagnostics ----
  report near-coplanar failed cycles, stray edges,
    newly non-manifold edges
```

**Notes on the cycle finder.** Use the standard planar-embedding traversal. At each vertex, sort the incident half-edges by angle in the plane's 2D basis. Arriving along a half-edge, take the **immediately adjacent** half-edge in that sort order from the reverse of the one you arrived on — the *minimal turn*, consistently clockwise or consistently counter-clockwise. Every directed half-edge belongs to exactly one cycle. The cycle with the region's outermost signed area is the infinite face and is discarded; the rest are candidate faces. This yields all minimal faces *and* all holes in one traversal, with no containment tests beyond nesting classification.

**"Minimal turn" is the whole algorithm — do not weaken it.** Taking merely *some* edge in the correct rotational direction rather than the *next* one produces plausible output on convex shapes and fails on the first pinch point. The canonical failure is the **figure-eight**: two triangles meeting at a single shared vertex of degree 4. A finder that does not take the strictly adjacent half-edge traces a self-crossing perimeter around both triangles and emits one invalid, self-intersecting face. With the minimal-turn rule, the traversal turns tightly at the pinch and the shape decomposes correctly into two separate faces sharing that vertex. Test this case explicitly (§10.2, Phase 5); it is the cheapest available check that the traversal is genuinely correct rather than accidentally working.

**Pinch vertices are legal.** Two faces meeting at a vertex but sharing no edge is valid geometry, and every edge involved stays `manifold` — the vertex is the non-manifold element, not any edge. Flag it as a **non-manifold vertex** in diagnostics, since it is often unintentional, but do not reject it and do not let it affect normal propagation, which traverses edges (§2.4).

**Notes on overdraw (Phase 1b).** Drawing over existing geometry is not an error case — it is a *feature*, and the most important instance of it is retrace-to-heal. When a user re-draws an edge to bring back a deleted face, the correct outcome is that **no new edge is created at all**, and yet the face reappears. Three consequences:

- **Always keep the existing sub-edge, never the new one.** The existing edge already carries curve membership, material, smooth flags and edge-uses that other faces reference. Swapping in a fresh duplicate silently orphans all of it.
- **Overlap must be tested before intersection, not after.** A segment-intersection routine given two colinear segments either divides by zero or returns an arbitrary point on the shared span. Filter colinear pairs out of Phase 1a first — this is the ordering bug most likely to appear in generated code.
- **A no-op edit still triggers derivation.** If every new sub-edge is discarded as a duplicate, the naive optimisation "nothing changed, skip Phase 3" breaks healing outright: the user retraces, nothing is added, and the face never comes back. Mark the *touched* edges as changed regardless of whether any edge was created, and let derivation decide. This is why `changed = true` is set unconditionally in Phase 1b.

Partial overlap is the same algorithm: a new edge covering half an existing one and extending past its end yields three sub-spans — one shared (existing kept), one existing-only, one new-only — and the shared span's duplicate is dropped.

**Notes on pruning (Phase 3a).** Not every edge can bound a face, and feeding those that cannot into the cycle finder produces garbage. Two categories:

- **Antennae.** A circle with a stick out of it — the "lollipop". A naive half-edge traversal walks the stick out and back within the same cycle, emitting a face whose boundary doubles back on itself with zero-width area. Iterative degree-1 pruning removes these before traversal. Iterative matters: a branching antenna needs several passes.
- **Bridges.** Two closed shapes joined by a single connecting edge. Both ends have degree ≥ 2, so leaf pruning misses it, but the edge still lies in no cycle and traversal walks it in both directions, producing the same pinched spur. Detect with a standard bridge-finding pass and exclude.

**Pruned edges are not deleted.** They stay in the model, remain selectable, and are exactly the "stray edge" diagnostic already described in §4.4 — construction geometry the user often placed deliberately. Pruning governs face derivation only.

**Notes on slivers.** Two nearly-colinear edges crossing at a very shallow angle produce a needle cycle: three or more real vertices, genuinely coplanar, enclosing almost no area. It passes every structural test and must be rejected on area alone. Compute the signed area by the shoelace sum over the cycle's projected 2D vertices — you need it anyway for the winding check in §6.4 — and discard the cycle when its magnitude falls below `MIN_FACE_AREA`.

Two cautions:

- **Discard the cycle, not the edges.** A rejected sliver's edges remain in the graph, remain selectable, and frequently belong to a larger valid cycle as well. Removing them would punch a hole in a legitimate neighbouring face.
- **Never reject by aspect ratio.** A needle test based on thinness is tempting and wrong: a 3 mm × 4 m reveal strip, a mullion face, or a floor threshold are all extremely thin and completely legitimate. Area is the only safe criterion, and even then it is scale-dependent (see §3).

Report rejected slivers in diagnostics. They usually mean two edges that were meant to be colinear are not, and the user would rather know.

**Bounding the region.** Restrict derivation to the connected component containing the changed edges, never the whole plane. A floor plan may put several hundred disconnected panels on one plane; rebuilding all of them because the user drew one line is a guaranteed frame drop, and it scales with model size in exactly the way that makes a modeller feel worse the more work you put into it. The index that makes this cheap is specified in §6.5.

### 6.3 Attribute reattachment

Deleting and re-deriving faces destroys materials, texture mapping, layer assignment, and per-face attributes. They must be restored, or every line the user draws will visibly strip the paint off their model.

**First, the fast path.** Most faces in a rebuilt component are untouched, and for those there is nothing to reattach. Key each snapshot face by the order-independent hash of its boundary edge set (§6.2 Phase 3b). Any derived cycle whose hash matches is **the same face**: carry the whole object forward — face ID included — rather than building a new one and copying fields onto it. This preserves identity across the rebuild, which matters well beyond attributes, since selection state, the undo stack (§7.0) and any external references all key on face ID. Only genuinely changed regions reach the steps below.

**Constructing the hash.** The same cycle can be discovered starting from any edge and in either direction, so the hash must be invariant to both rotation and reversal. Two safe constructions:

- **Sort then hash.** Collect the cycle's canonical integer edge IDs, sort ascending, hash the sorted sequence. Cycles are short, so the sort costs nothing measurable, and this is the default to reach for.
- **Commutative combine.** Apply a good 64-bit mixing function to each edge ID individually, then XOR or wrapping-add the results. Order-independent by construction and marginally faster.

**Never XOR raw edge IDs.** Unmixed XOR collides trivially — any two disjoint pairs where `a^b == c^d` produce identical hashes — and sequential IDs make exactly that pattern common. Mix each ID first, or sort.

**Verify on match.** A hash hit must be confirmed by comparing the actual edge sets before carrying a face forward. Matches are cheap to verify because loops are short, and the cost of a false positive is severe and silent: the wrong face's material, UV basis, orientation and identity transplanted onto an unrelated region. Hash to find the candidate; compare to accept it.

For faces with no hash match:

1. Before deletion, snapshot each old face's material (front and back), UV mapping basis, layer, and attribute dictionary, along with its plane and its 2D polygon.
2. After derivation, for each new face compute a representative interior point (use a point guaranteed inside a concave polygon, not the centroid).
3. Find the old face whose polygon contains that point. Copy its attributes across.
4. **The UV basis must be anchored in world space, not to the face.** Store it as an origin point plus two vectors lying in the face's plane, expressed in model coordinates — never as per-vertex UVs, and never normalised to the face's bounding box. Copying that basis to both halves then makes texture alignment **continuous across the cut** automatically: a brick wall split by a new line still lines up, with the same brick size and the same phase on both sides. Normalising to bounds is the standard mistake here, and its symptom is unmistakable — every split visibly rescales the texture on both halves, and users read it as the tool damaging their work. Verify continuity explicitly in tests; it is the most noticeable thing that can regress.
5. If no old face contains the point, the face is genuinely new: apply the default material and derive a fresh UV basis.

For the merge direction (§7.1), the rule is inverted: the merged face inherits from the **larger** contributing face by area, so that erasing a small division does not repaint the large surface.

### 6.4 Winding order and normal orientation

**Winding is a correctness requirement, not a convention.** Every downstream consumer — the tessellator, the renderer, export, and any solid-boolean work later — infers hole-versus-island from the *relative* winding of a face's loops. Get it wrong and an inner loop is treated as a second overlapping island: the hole fills in, z-fighting appears across the overlap, and the bug is easy to misdiagnose as a shading problem.

Enforce, at face creation time:

1. **The outer loop winds counter-clockwise** when viewed from the face's front side (positive signed area in the plane's 2D basis).
2. **Every inner loop winds clockwise** — counter to the outer loop (negative signed area from the same viewpoint). Reverse the cycle and flip each `EdgeUse.reversed` flag if the finder produced it the other way round.
3. **Assert, do not assume.** After building a face, check that the outer loop's signed area is positive and every inner loop's is negative, and that the sum is the face's true area. This is a cheap invariant and it catches cycle-finder regressions immediately — which matters, because those regressions are otherwise invisible until a user draws a hole.

This convention is what `earcut`, `libtess` and OpenGL's `GLU_TESS_WINDING_ODD` all expect, so with it in place a face tessellates by passing the outer ring followed by each inner ring, with no per-face special handling. Feed the tessellator loops in that order and in that winding, and holes work for free.

**Note for §7.1 merges.** After merging two faces, re-run the winding enforcement on the result. A merge can inherit inner loops from both contributors, and a loop that was correctly wound relative to a face that no longer exists may now be wrong relative to the merged one.

**Normal orientation.** Determine each new face's front side from its outer loop winding, then apply, in order:

1. **Consistency with neighbours.** Traverse across `manifold` edges only (§2.4) to adjacent faces and match their orientation. Do not traverse a container boundary; if a mirrored transform sits between, the parent's determinant sign already describes the flip (§2.5.2).
2. **Consistency with the snapshot.** If the face inherited attributes from an old face, inherit its orientation too. This is what stops a split from flipping half a wall — and under preserve-or-create (§7.4) it is usually a carry-forward rather than a copy.
3. **The horizontal rule.** If the plane is horizontal within `COPLANARITY_TOLERANCE`, the front normal points **up**. A rectangle drawn on the ground plane has an unambiguous right answer, and users notice immediately when it comes out face-down.
4. **Camera-facing.** For any other isolated face, orient the front towards the viewer.
5. **Canonical sign.** If no camera is available — batch import, a script, a headless test — pick the normal whose first non-zero component is positive.

**Steps 1–3 and 5 are deterministic; step 4 is not, and that matters.** A camera-dependent rule means the same drawing operation yields a different stored orientation depending on where the user happened to be looking, which is fine for a person and unacceptable for a test suite or a file round-trip. Two requirements follow: put the deterministic rules **before** the camera rule, not after, and have the Phase 9 integration tests (§10.2) inject a fixed camera so results are reproducible. Once orientation is decided it is stored on the face and carried forward, so a later re-derivation never silently re-decides it.

A visibly correct front face on creation saves a manual reverse later, and users will not think to check.

### 6.5 Performance guardrails

This path runs on every click, and on touch it runs during drag preview as well. It must stay inside one frame.

- Spatially index edges and faces (BVH or octree) so Phase 1 is not O(n) per stroke.

**The plane–component index.** Bounding Phase 3 to a connected component is only cheap if the component is already known. Maintain a dedicated index alongside the spatial one:

- **Key each plane by a quantised hash** of its unit normal and signed offset, snapped to `COPLANARITY_TOLERANCE`. Canonicalise sign (flip so the first non-zero normal term is positive) so a plane and its reverse hash to one bucket. Two panels that are coplanar to within tolerance must land in the same bucket or they will never merge correctly.
- **Within each plane bucket, maintain connected components with union–find** over the edges lying on that plane. Each component caches its edge set, its face set, its cached 2D basis, and its bounds.
- **Lookup is then O(α(n))**, so Phase 3 touches only the component the user actually drew in. The several hundred other panels on that floor plane are never visited.
- **Components split and merge.** Drawing an edge that bridges two components merges them (union). Deleting an edge may disconnect one, which union–find cannot express — so mark the component dirty and re-run connectivity for that component only, lazily, on next access rather than on the delete itself.
- **Bound the cache.** Store the 2D basis and bounds per component, not per plane, and invalidate on edge-set change.

Continue with:

- Cap cycle length in the finder as a guard against pathological input.
- During preview (before commit), run Phase 1 in a scratch copy for hit-testing only. **Do not derive faces on preview** except on touch where a commit preview is genuinely needed — and there, throttle it.
- Batch the pipeline: a multi-segment paste or an arc's 12 edges enter Phase 1 together and trigger **one** derivation, not twelve.

---

## 7. Deletion and healing

Every operation above has an inverse, and the inverses matter as much as the forward path. A modeller that only accumulates geometry becomes unusable within an hour.

### 7.0 Transactions and undo

Every user action — one committed segment, one arc, one deletion — runs the whole pipeline inside a **single transaction**. This is not an optimisation; undo correctness depends on it.

- **Snapshot state before the pipeline runs**, not after: topology, derived faces with their IDs, face attributes, and component index entries. Note that no separate void or suppression state needs capturing — under preserve-or-create (§7.4), a deleted face is simply absent from the snapshot, and that absence *is* the void.
- **Undo restores the snapshot directly. It must not re-derive.** Derivation is deterministic in *geometry* but not in *identity* — face IDs, and with them selection state, attribute bindings and any undo entries further up the stack, are not guaranteed to come back the same. Restoring is both cheaper and correct; re-deriving is neither.
- **One transaction per user action, not per edge.** An arc's twelve edges, or a pasted chain, enter Phase 1a together and produce one undo entry. The user drew one thing and expects one `Ctrl-Z` to remove it.
- **Preview never opens a transaction.** Rubber-band state lives outside the model entirely (§6.5); only a commit touches it.

**Validate before mutating, and roll back atomically.** A commit can be degenerate — a snap that resolves onto its own start point, numeric entry of `0`, an arc whose radius collapses, a segment below `MIN_EDGE_LENGTH`, or a chain step that produces nothing at all. Handle it as follows:

- **Validate first, mutate second.** Check the proposed geometry before touching the half-edge graph. A rejected commit must leave the graph bit-for-bit as it was — no orphaned vertices, no dangling EdgeUses, no half-updated component index, no stale entry in the spatial index.
- **Roll the whole transaction back, not part of it.** A multi-edge action (an arc, a paste) in which any edge fails validation aborts entirely. Partial application is worse than rejection, because it leaves geometry the user did not draw and cannot see.
- **Fail silently and stay in the gesture.** No dialog, no error toast. The rubber band remains live, the chain does not advance, and the user simply clicks again. Degenerate commits are overwhelmingly slips — a double-click landing as two clicks, a snap catching the start point — and interrupting the gesture to announce a slip is worse than absorbing it.
- **A rejected commit consumes no undo entry.** Nothing changed, so there is nothing to undo. Pressing `Ctrl-Z` afterwards must remove the *previous real* segment, not appear to do nothing.
- **Distinguish rejection from a legitimate no-op.** A retrace that creates no new edge is *not* degenerate — it is valid and must proceed to derivation with its change flag set (§6.2, Phase 1b). Validation rejects geometry that cannot exist; it must not reject edits that merely add nothing.

### 7.1 Face merging (R5, R6)

When an edge is deleted:

```
onEdgeDeleted(edge):
    faces = edge.uses.map(use => use.loop.face)

    if faces.length == 2
       and both are coplanar within COPLANARITY_TOLERANCE
       and removing the edge leaves one valid closed loop:
        merge into a single face
        inherit attributes from the larger face by area (§6.3)
        preserve the union of both faces' inner loops
    else:
        delete every face in faces
        # edges survive; the model may now have a hole

    remove the edge
    run R7 checks on both former endpoints (§7.2)
    re-derive the affected plane (§6.2 Phase 3)
```

The merge case is what makes erasing a dividing line feel correct rather than destructive: the user drew a line and got two panels, erases it and gets one panel back. The delete case is what makes erasing a boundary edge open a hole, which is equally expected.

**Erasing is the only thing that merges.** Two neighbouring behaviours look similar and must not be confused with it:

- **Smoothing** an edge (§5.5) hides it from rendering so that the faces either side shade as one continuous surface. The faces remain two faces, the edge remains a real edge, and area, selection and derivation are all unaffected.
- **Hiding** an edge removes it from display only. Same story.

Only deletion changes topology. A user who smooths a division and then wonders why the two halves still select separately is seeing correct behaviour, and the UI should make the distinction visible — smoothed and hidden edges want a discoverable "show hidden geometry" mode.

**On attribute inheritance in a merge.** Taking the larger face's material is a deliberate choice rather than an inevitable one: a merge has two candidate sources and no principled winner. Area is the best available proxy for "the surface the user thinks of as primary," and it means erasing a small subdivision never repaints a large wall. The alternative rules — first-created, last-selected, or lowest ID — all produce results that look random to the user.

**Do not merge when:** the two faces are non-coplanar (deleting the crease must open a hole, not produce a bent face); the edge is non-manifold; or the merge would produce a self-intersecting or disjoint loop.

### 7.2 Colinear vertex dissolution (R7)

Without this, repeated splitting and erasing leaves an ever-growing population of degree-2 vertices sitting mid-edge, each one a future T-junction and a drag on every spatial query.

**Dissolve a vertex when all of these hold:**

- degree is exactly 2 — precisely two edges attach;
- the two edges are colinear within `COLINEARITY_TOLERANCE`;
- the merged edge would not change any face's boundary geometry;
- both edges share the same layer, material, smooth flag and hidden flag;
- both belong to the same curve, or neither belongs to a curve — **never dissolve across a curve boundary**, as that would silently splice two arcs;
- no guide point, dimension, annotation or component instance is anchored to the vertex.

**Make this a setting, defaulting to on, and never run it on a vertex the user placed in the current operation.** The argument against unconditional dissolution is real: users deliberately place mid-edge vertices as snap targets for later work, and having them vanish is worse than a little bloat. The compromise that works is to dissolve only vertices that became degree-2 *as a consequence of a deletion*, and leave deliberately created ones alone. Track provenance on the vertex to distinguish the two.

**Ordering matters.** R7 runs **last** — after Phase 1b overlap resolution, after derivation, and after attribute reattachment. Three reasons:

1. Dissolving a vertex changes the edge set that derivation reads. Running it first means deriving from a graph that is still being rewritten.
2. Whether a vertex is safe to dissolve depends on which faces use its edges, and that is not known until faces exist.
3. Dissolution is **geometry-preserving** — merging two colinear edges moves nothing — so it does *not* require a re-derivation afterwards. Splice the merged edge into every loop that referenced the two originals, in place, and update the component index. Re-deriving here would be wasted work and would needlessly churn face identity and attributes.

Iterate to stable with a small cap (3 passes is ample), since dissolving one vertex can leave a neighbour at degree 2.

**The retrace case.** When a user retraces a single long line over two contiguous colinear edges, Phase 1b subdivides at the shared middle vertex and discards both new sub-edges as duplicates. The middle vertex is pre-existing and user-created, so the provenance rule above leaves it alone — correct, since the user was healing a face, not asking to simplify the boundary, and something may already be snapped to that vertex. Dissolution stays reserved for vertices that *became* redundant through deletion.

Run the check after every deletion, on the endpoints of the removed edge, and after any merge.

### 7.3 Orphan cleanup

- An edge with zero uses and no curve membership, both of whose vertices are degree 1, is a fully isolated segment — legal, and often deliberate. **Do not auto-delete it.** Report it in diagnostics only.
- A vertex with degree 0 is genuinely orphaned. Delete it silently.
- A curve whose edges have all been deleted is discarded with the last one.

### 7.4 Deleting a face without its edges

This is a distinct operation from deleting an edge, and it exposes a conflict that must be resolved explicitly.

R3 says a closed planar cycle *bounds a face* — a statement about the state of the model, not an event. Taken literally, deleting a face whose edges all survive is impossible: the next derivation on that component sees the same cycle and recreates it. But users delete faces to make openings, and expect the opening to stay open.

**Resolution — preserve-or-create (§6.2, Phase 3b).** No separate suppression registry is needed. Derivation carries face state forward rather than regenerating it from nothing:

> A derived cycle yields a face if **either** a face existed on that exact cycle before the transaction, **or** at least one of the cycle's edges was created, split, retraced or otherwise touched during it. A cycle made entirely of untouched edges that carried no face carries no face afterwards.

A deleted face is therefore absent from the snapshot, and unless the user touches one of its edges, nothing regenerates it. The void persists for free, with no extra state to store, invalidate or garbage-collect.

The behaviours this produces, all of them the expected ones:

| Action | Why | Result |
|---|---|---|
| Delete a face, then draw elsewhere in the component | No edge of the void's cycle was touched | Void survives |
| Delete a face, then **retrace** one of its edges | Phase 1b marks that edge touched even though no edge is created | **Face returns** — retrace-to-heal |
| Delete a face, then draw a line across the void | The old cycle no longer exists; both new sub-cycles contain touched edges | Void fills as two faces |
| Delete a face, then move a vertex on its boundary | Its edges were modified | Face returns |
| Draw the fourth edge of a rectangle | The new edge is in the cycle | Face created |
| Any untouched face anywhere in the component | Present in the snapshot | Preserved, with its identity and attributes intact |

**Deleting an island face needs nothing at all.** Per §2.4, the outer face retains its inner loop, so the void is expressed structurally rather than by absence. Preserve-or-create then keeps the outer face unchanged because none of its edges were touched.

**Why not a positional "no face here" flag?** Because a positional test cannot distinguish a deliberate void from a region that has been legitimately re-cut, and its failure mode is the worse one — openings that silently refuse to fill in when the user draws across them.

**One unavoidable rough edge.** A line that touches an edge of the void brings the face back, sometimes when the user only meant to draw nearby. This is inherent to derived-face modelling and is not worth engineering around: it costs one undo, whereas persistent per-region void state that survives arbitrary re-cutting produces stranger behaviour more often.

---

## 8. Why this is simple for users

The simplicity is not decoration on top of the geometry engine — it *is* the geometry engine. Five principles worth defending in review.

**1. Two tools, one grammar.** Every drawing action is *click, move, click*. The Arc tool adds exactly one extra move-and-click over the Line tool. A user who can draw a line can draw an arc without being taught anything new. No modes to enter, no shapes to configure before drawing, no "apply" step.

**2. The user states intent; the system infers structure.** Nobody has to know what a face, a loop or a normal is. They draw a shape that looks closed, and it fills. They draw a line across a panel, and the panel becomes two panels. They erase that line and get one panel back. The mental model is *drawing on paper* — a model every user already has — while the underlying representation stays a rigorous boundary rep.

**3. Precision without a dialog.** Inference plus the measurement field means exact modelling never requires leaving the drawing gesture. Type nothing, get a fast sketch; type a number, get a 2400 mm wall. Because the field stays live after commit, "I drew it roughly, then made it exact" is one keystroke — the user is never punished for drawing quickly. The fast path and the precise path are the same path.

**4. Constant, legible feedback.** Coloured snap markers, a live length readout, direction colours matched to the axes, tooltips naming each inference in plain words. The user sees what the tool will do *before* committing, so mistakes are prevented rather than corrected. This also teaches the inference system passively — nobody reads the manual, they just notice the green square keeps appearing at corners.

**5. Nothing is a dead end.** Each segment is its own undo step. `Esc` cancels the segment in progress without losing the chain. Erasing a surface leaves its edges. Retracing an edge brings the surface back. Erasing a dividing edge merges the faces. Changing an arc's segment count re-solves in place. Because every state is recoverable, exploration is cheap — and cheap exploration is what makes a modelling tool pleasant rather than tense.

### Touch and tablet considerations

- Enlarge `SNAP_RADIUS_PX` substantially, and offset the snap preview above the fingertip so it is not occluded.
- Replace hover-dependent inference (from-point, parallel-to-edge) with a **tap-and-hold to acquire a reference point** gesture, since there is no hover state.
- Surface inference locking as on-screen axis buttons, since `Shift` and arrow keys are unavailable.
- Provide an on-screen numeric pad bound to the measurement field, appearing only during an active drag.
- Never require a double-tap to terminate a chain — offer an explicit **Done** affordance alongside it.

---

## 9. Implementation checklist

**Kernel**
- [ ] Half-edge / edge-use topology with unbounded edge-use count
- [ ] Container graphs with local frames; all rules scoped to one graph (R8, §2.5)
- [ ] Active-context tracking; enter/exit, nesting, out-of-context geometry dimmed
- [ ] Cross-context snapping with local-frame conversion on commit
- [ ] Cached `M⁻¹` and `M⁻ᵀ` per context; normals and planes use the inverse-transpose
- [ ] Non-uniform scale: constraints evaluated in local space, entry warning, scale-normalisation offer
- [ ] Mirrored-container determinant tracking for front/back rendering
- [ ] Explode and group/make-component, including edge duplication on group boundaries
- [ ] Edge classification: boundary / manifold / non-manifold, surfaced in rendering
- [ ] Named, tunable tolerance constants
- [ ] Spatial index for edges and faces
- [ ] Plane–component index: quantised plane hash + union–find components, with split/merge handling
- [ ] Phase 1a insertion: intersection, splitting, vertex merging (R1, R2)
- [ ] Phase 1b overlap: colinear detection, 1D subdivision, existing-edge-wins dedup, unconditional change flag (R2b)
- [ ] Phase 3a pruning: iterative degree-1 leaf removal and bridge exclusion, pruned edges retained as stray
- [ ] Affected-plane collection with coplanar deduplication
- [ ] Planar cycle finder using the strict minimal-turn rule, returning all minimal faces and holes in one traversal
- [ ] Figure-eight / pinch-vertex decomposition, with non-manifold vertices flagged but accepted
- [ ] Order-independent cycle edge-set hash (sorted IDs or mixed-then-XOR, never raw XOR), verified by set comparison on match
- [ ] Preserve-or-create: carry untouched faces forward wholesale, create only for touched cycles
- [ ] Sliver rejection below `MIN_FACE_AREA`
- [ ] Inner/outer loop classification and nesting
- [ ] Loop winding enforcement (outer CCW, inner CW) with signed-area assertion, re-run after merges
- [ ] Attribute + UV reattachment by interior-point containment
- [ ] Normal orientation: neighbour → snapshot → horizontal-up → camera → canonical sign, with deterministic rules first
- [ ] Sliver rejection by shoelace area below `MIN_FACE_AREA`, edges retained, never by aspect ratio
- [ ] Tolerances bound to document units at creation; never derived from model bounds
- [ ] Face merging on edge deletion (R5, R6)
- [ ] Deleted faces stay deleted via preserve-or-create, with no separate suppression state (§7.4)
- [ ] Shared-edge loop topology between a face and its island, opposite EdgeUse directions
- [ ] Colinear vertex dissolution with provenance tracking, running last and splicing loops in place (R7)
- [ ] Single transaction per user action; undo restores a snapshot rather than re-deriving
- [ ] Validate-then-mutate with atomic rollback on degenerate input; no undo entry consumed, gesture uninterrupted
- [ ] T-junction resolution pass for import and transform paths
- [ ] Batched derivation (one pass per user action, not per edge)

**Line tool**
- [ ] Chained polyline with per-segment commit and undo
- [ ] Full point, linear and planar inference set with correct precedence
- [ ] Inference locking (modifier hold, axis keys, touch equivalents)
- [ ] Measurement field: length, units, absolute/relative coordinates, post-commit re-solve as rollback-and-recommit with a single undo entry
- [ ] Retrace-to-heal deleted faces
- [ ] Stray-edge and non-coplanar diagnostics

**Arc tool**
- [ ] Four modes: centre-radius-angle, two-point-bulge, three-point, pie
- [ ] Curve entity storing analytic parameters
- [ ] Default 12 segments; `Ns` override before and after commit
- [ ] Tangent, half-circle, equal-bulge inferences, with tangency solved analytically rather than from cursor position
- [ ] Degenerate cross-product guard on tangency, branching by cause (straight line / suppress inference / drawing-plane fallback)
- [ ] End vertices reused exactly on tessellation and on `Ns` re-solve
- [ ] Measurement field: bulge, `r` suffix, `s` suffix
- [ ] Unified curve selection with per-segment override
- [ ] Smooth flag on interior curve edges, ignored on non-manifold edges
- [ ] Curve splitting per §5.7: vertex snap, two curves, truncation flags, sagitta-based demotion (metadata-only, no vertex movement)

---

## 10. Build plan for Google AI Studio

This system will not generate correctly in one prompt. It is a geometry kernel plus two interaction layers, and a single-pass attempt produces plausible-looking code with a broken cycle finder — the failure is silent, because faces still appear for simple rectangles and only break on the fourth or fifth interesting case.

Build it in the order below. Each phase is one prompt (occasionally two), produces one or two files, and has an acceptance test that must pass before moving on.

### 10.1 Ground rules for every prompt

**Paste this header at the top of every prompt in the sequence:**

> You are building PolyForm, a 3D modelling app. The geometry kernel is a boundary representation using half-edges, where faces are never drawn directly but derived from closed planar cycles of edges. I am building it in phases. Attached is the current type-definitions file, which is the fixed contract — do not change any exported type or function signature in it unless I explicitly ask. Generate only the file I name. Do not refactor, rename, or re-emit any other file. Include unit tests in the same file's test companion.

Then the phase-specific instruction.

**Two standing prohibitions worth repeating in the prompt for every kernel phase:** no `Float32Array` or single-precision storage anywhere in the kernel, and no polygon-clipping or computational-geometry library for face derivation. Both are explained in §10.3; both are things a generated implementation reaches for unprompted, and neither is visible in the output until much later.

**Rules that keep the sequence from degrading:**

- **Freeze the types file after Phase 0.** It is the contract that lets every later prompt work without seeing the whole codebase. If a phase genuinely needs a new type, add it in a separate, explicit prompt so the change is visible.
- **One file per prompt.** AI Studio will happily rewrite six files and quietly change the semantics of three of them. Name the file; say "only this file."
- **The kernel must not import the renderer, React, or anything from the UI layer.** Pure functions over plain data. This is what makes each kernel phase independently testable and independently regenerable.
- **Demand tests in the same response as the implementation.** A phase without passing tests is not done, and the cost of discovering a broken cycle finder in Phase 11 is enormous compared to catching it in Phase 5.
- **Keep files under roughly 400 lines.** If a phase's file is heading past that, split the phase.
- **When a phase fails, re-prompt with the failing test case, not the whole file.** Paste the input geometry and the wrong output. Regenerating from scratch loses the parts that worked.

### 10.2 Phase sequence

| # | Phase | Deliverable | Acceptance test |
|---|---|---|---|
| **0** | Types and contract | `geometry/types.ts` — Vertex, Edge, EdgeUse, Loop, Face, Curve, Plane, tolerance constants. No logic. | Compiles. Every entity in §2.1 present. |
| **1** | Math and tolerance utilities | `geometry/math.ts` — vector ops, plane fitting, segment intersection in 3D, coplanarity test, point-in-polygon, signed area, interior-point-of-polygon. Double precision only; no `Float32Array`. | Unit tests including near-tolerance cases and a concave polygon whose centroid falls outside it. Coplanarity holds for a plane built 10⁶ units from the origin. `normalize()` of a zero vector throws rather than returning NaN. |
| **2** | Spatial index | `geometry/spatialIndex.ts` — insert, remove, query by bounds/ray. | 10,000 random edges; query returns correct candidates and beats linear scan. |
| **2b** | Plane–component index | `geometry/planeIndex.ts` — quantised plane hash, union–find components, split/merge, cached basis. | 200 disconnected coplanar rectangles on one plane → 200 components. Bridging two merges them; deleting the bridge splits them again. Lookup cost independent of plane population. |
| **3** | Topology store | `geometry/topology.ts` — add/remove vertices and edges, edge-use management, edge classification, no faces yet. | Build a cube's wireframe; every edge reports `manifold` count 0; adding a fin gives a non-manifold edge. |
| **3b** | Containers and context | `geometry/context.ts` — container graphs with local frames, active-context tracking, nesting, transforms, explode, group with boundary-edge duplication. | Two coincident edges in different containers stay separate under every rule. Drawing while a container is active writes only to that graph. A point snapped from world space into a doubly-nested container round-trips exactly. Under a 2:1:1 ancestor scale, an "On Face" normal computed with `M⁻ᵀ` stays perpendicular to the face; computed with `M⁻¹` it does not — assert the difference. Explode two touching boxes → one welded graph with cut faces. Grouping a face duplicates its shared edges. |
| **4** | Insertion (Phase 1a) | `geometry/insert.ts` — `insertEdge` with intersection, splitting, vertex merging. | Two crossing lines → 4 edges, 5 vertices. Endpoint landing within tolerance of a vertex merges. Edge below `MIN_EDGE_LENGTH` is discarded. |
| **4b** | Overlap resolution (Phase 1b) | `geometry/overlap.ts` — colinear detection, 1D projection and subdivision, dedup. | Draw exactly over an existing edge → edge count unchanged, existing edge object identity preserved, change flag still set. Half-overlap extending past the end → 3 edges. Colinear pairs never reach `intersect()`. Fully contained overlap → 3 edges, no duplicates. |
| **5** | **Planar cycle finder** | `geometry/cycles.ts` — leaf and bridge pruning, minimal-turn traversal, all minimal cycles, outer/inner classification, nesting, **winding enforcement**, sliver rejection. | **This is the phase to over-test.** Rectangle → 1 cycle. Rectangle plus a diagonal → 2. Rectangle with an inner square → outer with one hole, plus the inner face. Inner square bisected → outer with two holes. Concave L-shape. **Figure-eight (two triangles sharing one degree-4 vertex) → exactly 2 faces, neither self-intersecting** — this is the minimal-turn check and it will catch a plausible-looking wrong traversal. **Lollipop** → 1 face, antenna pruned but still in the model. **Branching antenna** → pruning iterates to stable. **Two circles joined by a stick** → 2 faces, bridge excluded, no pinched spur. **Every case must additionally assert outer signed area > 0, every inner < 0, and areas summing to the true face area.** |
| **6** | Derivation pipeline | `geometry/derive.ts` — §6.2 Phases 2–3, component lookup via Phase 2b, cycle hashing, preserve-or-create, face building. | Draw a line across a face → two faces, same total area. Draw a closed cycle inside a face → face with a hole plus an island face, and the hole **tessellates as a hole** (pass the loops to earcut and assert no triangles fall inside it). Drawing on one of 200 coplanar panels rebuilds exactly one component. **Untouched faces keep their face IDs across an unrelated rebuild in the same component.** The same cycle hashes identically when discovered from a different start edge and in the reverse direction; a deliberately constructed hash collision is rejected by set comparison. |
| **7** | Attributes and normals | `geometry/attributes.ts` — snapshot, reattachment, world-space UV basis, orientation heuristics. | Paint a face, split it: both halves keep the material, and sampling the texture either side of the cut at equal world distance gives the same UV — no shift, no rescale. Split a wall: neither half flips. |
| **8** | Deletion and healing | `geometry/heal.ts` — §7 in full, including 7.0 transactions and rollback, and 7.4 preserve-or-create behaviour. | Erase a dividing edge → faces merge, area preserved. Erase a boundary edge → face deleted, hole opens. Delete a *face* → void persists across an unrelated edit elsewhere in the component, then **retrace one boundary edge → face returns**, and **draw across the void → it fills as two faces**. Delete an island face → outer face keeps its inner loop. R7 runs after derivation and triggers no re-derive. Zero-length commit → graph unchanged, no orphan vertices, no undo entry consumed. Undo restores face IDs identically. |
| **9** | **Kernel integration test** | `geometry/kernel.test.ts` — no new implementation. | Scripted 40-operation session: draw, split, hole, island delete, face delete, retrace, erase, merge, undo to empty and redo forward. Assert face count, edge count, total area and face identity at each step. **Inject a fixed camera** so orientation is reproducible, then assert the whole session is deterministic across repeated runs and across a save/load round-trip. **Do not proceed until this is green.** |
| **10** | Line tool state machine | `tools/lineTool.ts` — pure state machine, no rendering: start, preview, commit, chain, terminate, per-segment undo. | Simulated event sequence produces the expected kernel calls. |
| **11** | Inference engine | `tools/inference.ts` — point, linear, planar inference; precedence; locking. | Hit-test fixtures: correct winner per precedence table; lock survives cursor moving away. |
| **12** | Measurement field | `tools/measurement.ts` — parsing (`2400`, `8'6"`, `[x,y,z]`, `<x,y,z>`, `24r`, `12s`), post-commit re-solve. | Parser table tests. Re-solve a segment that split a face → rollback and recommit leaves exactly the geometry the new value implies, one undo entry, and the live chain re-anchored. A re-solve to `0` restores the original commit rather than deleting it. |
| **13** | Rendering and cues | `render/drawingOverlay.ts` — rubber band, snap markers, colours, tooltips, live readout. | Visual check against the tables in §4.2. |
| **14** | Curve entity | `geometry/curve.ts` — analytic storage, tessellation, `Ns` re-solve, splitting per §5.7, sagitta demotion. | Split an arc at a vertex → two curves, parameters intact. Split mid-segment → truncation flags set, `Ns` disabled. Split near an endpoint → the stub demotes to a plain edge **without any vertex moving**. A 5° sweep at 50 m radius does *not* demote; a 5° sweep at 1 mm radius does. |
| **15** | Arc tool | `tools/arcTool.ts` — four modes on the Phase 10 state machine. | Each mode produces the correct analytic parameters from a simulated event sequence. |
| **16** | Arc inference | extend `tools/inference.ts` — tangent, half-circle, equal-bulge, degeneracy guard. | Tangent snap fires only when the chord start is an edge endpoint. With tangency active, the arc's start tangent equals `-normalize(d_edge)` to machine precision regardless of where the cursor sat, and a closing chord derives a face on the first try. Dragging along the incoming edge produces a straight segment, not a flipping arc; dragging back along it suppresses the inference rather than emitting a degenerate plane. |
| **17** | Touch layer | `tools/touchAdapter.ts` — enlarged snap radius, tap-and-hold acquire, on-screen axis locks and numeric pad, Done affordance. | Touch event fixtures; no code path requires hover. |
| **18** | Diagnostics | `geometry/diagnostics.ts` — stray edges, near-coplanar hints, optional auto-flatten, non-manifold report. | Near-coplanar cycle produces the hint, not silence. |

### 10.3 Practical execution notes

Things that are easy to get wrong during generation and expensive to discover later.

**Use double precision everywhere in the kernel.** Plain JavaScript numbers are already 64-bit, so the risk is not arithmetic — it is storage and libraries:

- **`gl-matrix` defaults to `Float32Array`.** If a generated `math.ts` imports it without overriding `glMatrix.setMatrixArrayType(Array)`, every vector in the kernel silently becomes single precision. This is the most likely way f32 enters the codebase.
- **Never store model coordinates in `Float32Array`.** Typed arrays belong at the WebGL/WebGPU buffer boundary in Phase 13 and nowhere earlier. Convert on upload, keep f64 in the graph.
- **The failure is scale-dependent and looks like a tolerance bug.** f32 carries about 7 significant digits, so at 10⁶ units from the origin its resolution is roughly 0.06 units — sixty times coarser than `COPLANARITY_TOLERANCE`. Cycles that are genuinely planar start failing to derive, and only in models built far from the origin, which makes it maddening to reproduce. f64 at the same distance still resolves to ~10⁻¹⁰.

**Guard against NaN at its source.** `normalize()` of a zero-length vector returns NaN, and NaN propagates silently through every subsequent test — comparisons against tolerances all return false, so geometry simply stops deriving with no error anywhere. Assert non-zero magnitude inside the normalise helper in Phase 1 and throw in development builds. One assertion there saves days across every later phase.

**Do not depend on object key ordering.** Iterating edges or vertices from a plain object gives integer-like keys in ascending numeric order regardless of insertion order, which is a deterministic but *unintended* ordering that will differ from the order your traversal assumes. Use arrays or `Map` for anything whose iteration order affects output, and keep the kernel free of `Math.random` and `Date` entirely — Phase 9 asserts run-to-run determinism and these are the usual reasons it fails.

**Deep-copy snapshots in Phase 8, and leave them alone.** A structural deep copy of the active component per transaction is simple, obviously correct, and fast enough for any model a user builds interactively. Copy-on-write and undo-delta patching are the right optimisation *eventually*, and exactly the kind of thing a generated implementation will volunteer prematurely — at which point undo correctness becomes hard to reason about while the kernel is still unproven. Take the memory hit through Phase 9. Cap the undo stack by entry count and total bytes rather than leaving it unbounded, and revisit only if profiling on a real model says to.

**Forbid polygon-clipping libraries in Phase 5.** Prompt explicitly for a direct angular sort and minimal-turn half-edge traversal, and state that Clipper, Turf.js, martinez, polygon-clipping and similar are not to be used. The reason is not self-containment — it is that those libraries operate on coordinate polygons and return **new coordinates, not your edges**. Everything downstream in this spec depends on topological identity surviving derivation: the edge-set hash (§6.3), preserve-or-create (§7.4), attribute and UV reattachment, and face identity across undo. A clipper returns geometrically plausible polygons with none of that, and the resulting implementation passes visual inspection while failing every identity assertion in Phase 6 and Phase 9.

### 10.4 Where this sequence usually goes wrong

- **Phase 5 is the whole project.** If the cycle finder is subtly wrong — sorting edges by angle incorrectly, picking the wrong turn direction, or skipping the pruning step — everything downstream produces faces that look right on rectangles and fail on the first L-shape or the first antenna. Test it in isolation, exhaustively, before building anything on it.
- **Phase 4b will be "optimised" away.** A generated implementation will reliably add a fast path that skips derivation when no edge was created, because that looks like an obvious win. It silently breaks retrace-to-heal, and the bug surfaces much later as "sometimes faces don't come back," which is close to undebuggable from the UI. Write the test in Phase 4b, and keep it in the Phase 9 suite.
- **Preserve-or-create gets simplified into "always create".** It reads like defensive complexity, and dropping it makes every basic test still pass — rectangles, splits and holes all behave identically. What breaks is deleting a face: the void refills the moment the user draws anywhere on the same panel. Make sure Phase 6 asserts face identity, not just face count, or this passes review.
- **Skipping Phase 9.** The temptation after Phase 8 is to jump to the visible part. Resist it: interaction bugs and kernel bugs are indistinguishable from the UI, and debugging them together costs several times what verifying the kernel alone does.
- **Letting a later prompt "improve" the kernel.** When Phase 15 hits a curve problem, the model will offer to adjust `derive.ts`. Decline, and fix it in the curve layer, or the passing tests from Phase 9 stop meaning anything.
- **Phases 10–12 in one prompt.** They look small and related. They are not — inference precedence and measurement parsing each have enough edge cases to swamp a shared prompt, and a bug in either is hard to see once they are entangled.
