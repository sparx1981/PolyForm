# Phase 3b — containers and R8

**422 tests passing** (32 new). Kernel and tools strict-clean; the React bridge still typechecks against real three/React/R3F.

This closes the last substantial kernel gap. Before it, all drawn geometry stuck to all other drawn geometry.

## Files

`lib/geometry/context.ts` + `context.test.ts`.

## The rule

> **R8 — stickiness stops at a container boundary.** R1–R7 apply only between entities in the same graph. Two edges that coincide exactly but sit in different containers do not merge, do not split each other, and do not together bound a face.

The test that makes the point draws the *same square at the same coordinates* in two containers and asserts each keeps its own four vertices and its own face. The companion test draws the same two squares loose in one graph and asserts they weld and cut. **The difference is containment, not dimensionality** — there is no separate rule for solids, and a solid is just a closed shell of the faces the Line tool already makes.

## What's in it

**Transforms**, composed down the nesting chain and cached, with `M⁻¹` for points and `M⁻ᵀ` for normals. Setting a transform invalidates the whole subtree — there's a test for the child cache specifically, since that's the easy one to miss.

**Edit context**: enter, exit, breadcrumb path, and `graphsForHitTesting()` which returns every graph with its world matrix and flags the active one. That asymmetry — hit-test everywhere, insert only into the active context — is what lets a user draw a wall inside one container aligned exactly to a window in another.

**Entry warnings.** Opening a non-uniformly scaled container warns, because under one, "perpendicular in world space" and "perpendicular in this container" are genuinely different constraints and axis locks will visibly not align. `normaliseScale()` bakes the scale into the geometry and resets the matrix — the fix users actually want, tested to confirm nothing moves in world space. Mirrored containers warn separately.

**Explode** transforms geometry into the parent's frame on the way across (carrying local coordinates over unchanged would move everything), and re-parents children with composed transforms so they stay put. There's a test that two touching boxes weld and cut once exploded — the operation that retroactively makes independent objects interact.

**Group** duplicates any edge shared with geometry left behind, because R8 forbids one edge spanning two graphs. Users read this as "grouping left a copy of my lines behind" and it surprises them, so tell them at the time.

## One addition beyond the spec

R8 was upheld *structurally* — each container owns a separate `Graph`, and insertion is handed one of them — rather than by any check. That's the right design, but it means a future change could violate it silently: pass two graphs' edges to one derivation and they would weld with nothing to complain.

`assertSingleContext()` makes that loud, with `checkSingleContext()` as a non-throwing form for diagnostics. Worth calling at any boundary that accepts geometry.

## Kernel status

Every kernel phase is now complete: 0b, 1, 2, 2b, 3, **3b**, 4, 4b, 5, 6, 7, 8, 9, 9b, 10, 11, 12, 14, 15, 16, 18.

Remaining: **13 (rendering cues)** and **17 (touch)** — the two genuinely visual phases, which belong in AI Studio where you can see them. Plus the tuning pass over snap radii, hover dwell, cue colours and arc drag feel that no test can settle.
