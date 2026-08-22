# Phase 11 — inference

**390 tests passing** (36 new). Kernel and tools strict-clean.

This is the first phase that touches code your app already runs, so it is deliberately small and delivered as a **reviewable diff** rather than a rewritten file.

## What ships

| File | Where | Nature |
|---|---|---|
| `patches/01-inference-precedence.patch` | apply to `src/lib/PolyformInferenceEngine.ts` | **86 lines against a 1,365-line file** |
| `tools/inferenceCandidates.ts` | `src/tools/` | New. Kernel → `InferenceCandidate[]`, plus linear inferences |
| `tools/inferenceCandidates.test.ts` | | 22 tests |
| `tools/inferencePriority.test.ts` | | 14 tests against the patched engine |

Apply the patch with:

```bash
git apply patches/01-inference-precedence.patch
```

## The precedence change

You chose spec order with Intersection second. The engine sorted by the raw enum value, so the naive change would have been to renumber `InferenceType`. I did not do that: **those values are identifiers**, compared elsewhere in the app and potentially persisted. Renumbering them to express precedence conflates two things that should move independently.

Instead the patch adds an explicit `INFERENCE_PRIORITY` map and sorts by that. The enum values are untouched — there is a test asserting all eight still hold their original numbers.

What actually changes for the user: **an intersection now outranks a curve centre and a midpoint.** Previously `CURVE_CENTER` (enum 2) beat `INTERSECTION` (enum 5) outright.

Two tests state the change from both directions — an intersection now displaces a held midpoint, and a curve centre no longer does — so a revert is loud rather than silent.

The patch also adds a deterministic tie-break on `sourceEntityId`, so two coincident candidates of the same type and distance cannot alternate between frames.

## On the 29 strict errors

`PolyformInferenceEngine.ts` predates strict mode and has 29 strict-mode errors. **I verified the count is identical before and after the patch** by compiling both under the same config — the change introduces none.

I have not fixed them. They are worth fixing, but doing it as a side effect of a precedence change would bury an 86-line diff inside a few hundred lines of null-guarding, and you would not be able to review the part that matters. Worth its own pass.

The local copy under `src/lib/vendor/` is a **test fixture only**, carrying `@ts-nocheck`. It is not part of the delivery.

## The candidate provider

`update()` does not gather candidates — it receives them. That is the seam. `collectKernelCandidates(graph, opts)` produces them from a kernel graph in the shape the engine already consumes, so hysteresis, locking and tracking rays all carry over unchanged.

One behaviour worth knowing: **it does not emit an INTERSECTION where R2 already made a vertex.** Within one graph, crossing edges are split into a shared vertex, so the crossing *is* an endpoint — an intersection candidate there would be a duplicate competing against a higher-priority one for the same point. Intersections therefore only arise between geometry that crosses without being joined: different containers, or imported geometry. There is a test.

**Cross-context handling** is built in per §2.5: candidates carry the context they came from, and `toActiveContext()` converts on commit. Normals route through a separate inverse-transpose hook, never the point transform — with a test asserting the hook is actually called.

## Linear inferences

Added the three §4.2 items the engine lacked: **parallel to a hovered edge**, **perpendicular to it**, and **edge extension**. Axis locks and cardinal tracking rays already existed and are not duplicated.

One decision: any direction perpendicular to an edge is valid, so the perpendicular inference picks the one closest to where the user is actually pointing. Choosing an arbitrary axis would put the cue somewhere unrelated to the cursor.

## Still to wire

The engine still receives candidates from `Viewport.tsx`'s `Shape`-mesh walk. To use kernel geometry, merge both sources at the call site:

```ts
const candidates = [
  ...existingShapeCandidates,
  ...collectKernelCandidates(kernel.graph, { project, cursor, ray, snapRadiusPx }),
].map(toEngineCandidate);   // kind string -> InferenceType enum

const result = engine.update(x, y, ray, candidates, clickOrigin, viewportInfo);
```

`collectKernelCandidates` returns a `kind` string rather than importing the enum, so the kernel stays free of app imports. The mapping is eight lines at the call site.
