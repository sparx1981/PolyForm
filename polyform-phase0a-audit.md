# PolyForm — Phase 0a audit

Assessment of `github.com/sparx1981/PolyForm` against `polyform-line-and-arc-tools-spec.md`. Written before any code, as §10 requires.

**Stack:** React 19, three.js 0.183, @react-three/fiber 9, Vite 6, TypeScript 5.8, Firebase, `three-bvh-csg`, `openskp`. 45 source files, ~1.4 MB of source, 43 MB of assets in `public/`.

---

## 1. Headline finding

**PolyForm has no boundary representation, and no topology of any kind.** The geometry model is a flat array of parametric primitives:

```ts
// src/types.ts
interface Shape {
  id: string;
  type: 'box' | 'rect' | 'circle' | 'line' | 'poly' | 'arc' | ... ;
  position: [number, number, number];
  quaternion?: [number, number, number, number];
  args: any;
  surfaceMaterials?: Record<number, string>;   // face INDEX -> material
  geometryData?: any;                          // baked BufferGeometry JSON
}
```

`AppState.shapes: Shape[]` is the entire model. There are no vertices, no edges, no faces, no loops, no adjacency — nothing the spec's §2 describes.

**The current Line tool does not create an edge. It creates a thin cylinder.** From `Viewport.tsx:3448`:

```ts
} else if (activeTool === 'line') {
  const dist = drawingStart.distanceTo(target);
  setPreviewShape({
    type: 'line',
    args: [0.01, 0.01, dist, 8]     // CylinderGeometry: r, r, height, segments
  });
```

That is a rendered stick with a radius, not a topological edge. Consequently **none of the spec's core behaviour exists today**: drawing four lines in a closed loop produces four cylinders and no surface. R1 through R8 have no counterpart in the current code — there is nothing to extend.

This is good news for risk, and bad news for scope. There is no existing topology to conflict with, so the kernel is purely additive and Phases 0b–9 can be built with zero chance of breaking what works. But it also means the kernel is not an enhancement to PolyForm's geometry — it *is* PolyForm's geometry, newly introduced alongside the primitives.

---

## 2. Answers to the four Phase 0a questions

### Is there existing topology, or render meshes only?

**Render meshes only**, with three variants:

| Kind | Where | Notes |
|---|---|---|
| Parametric primitives | `Shape.type` + `Shape.args` | Rebuilt by three.js on every render from args |
| Polygon faces | `type: 'poly'`, `args: { vertices, height, holes }` | The closest thing to a real face — see below |
| Baked meshes | `Shape.geometryData` (BufferGeometry JSON) | Output of CSG and vertex edits. Triangle soup, no identity |

The `poly` type is worth calling out because it is *nearly* a face: it carries a 2D vertex list, an optional `holes` array, and `PolyGeometry` triangulates it via `THREE.Shape` with `normalizePolyWinding(filtered, true)`. So the concepts of an outer loop, inner loops and winding already exist in miniature. But they exist as **rendering input**, produced by tools and consumed by the renderer, with no shared edges between neighbouring polys and no derivation. Two adjacent `poly` shapes sharing a boundary do not share a single edge object; they have independent coordinate lists that happen to coincide.

### What has to change for the kernel to become the source of truth?

**Do not make it the source of truth for everything.** That is the most important recommendation in this document.

Most of what PolyForm models has no business in a B-rep: spheres, cones, domes, trees, bushes, rocks, lamps, benches, plant FBX models, terrain heightfields. These are correctly parametric, and forcing them through a half-edge kernel would be a large regression for no gain.

The kernel should own **drawn geometry only** — what comes out of the Line, Arc, Rectangle, Polygon, Push/Pull, Offset and Follow-Me tools. Everything else stays as `Shape`. Concretely:

```ts
interface AppState {
  shapes: Shape[];          // unchanged — primitives, plants, terrain
  kernel: KernelModel;      // new — vertices, edges, faces, containers
}
```

Two representations coexisting, with one rule: **a given piece of geometry belongs to exactly one of them.** The renderer draws both. The inference engine snaps to both. Selection understands both.

The migration path for `poly` is then obvious and low-risk: `poly` shapes are the only existing type whose semantics the kernel genuinely subsumes, and a converter from `{ vertices, holes }` to kernel edges plus derived faces is straightforward. Migrate `poly` when you are ready, leave everything else alone permanently.

### Which files change, and in what order?

| File | Lines | Role | Change |
|---|---|---|---|
| `src/lib/geometry/**` | new | The kernel | Additive, zero risk |
| `src/types.ts` | 500 | `Shape`, `AppState` | Add `kernel: KernelModel` to `AppState`. Do not touch `Shape` |
| `src/AppContext.tsx` | 1,245 | State, undo | Add kernel state and transaction-aware undo |
| `src/lib/PolyformInferenceEngine.ts` | 1,365 | Snapping | **Adapt, do not replace** — see §3 |
| `src/components/Viewport.tsx` | **8,531** | Everything else | The problem — see §4 |

Order: kernel in isolation → wire a read-only renderer path → move the Line tool → move the Arc tool → migrate `poly` → consider push/pull.

### What conflicts with the spec?

Four things, in descending severity.

**1. CSG is incompatible with derivation.** `Viewport.tsx:4795` runs `three-bvh-csg` SUBTRACTION and bakes the result to `geometryData: resultBrush.geometry.toJSON()`. This is exactly what §10.3 forbids for face derivation: it returns new coordinates, not your edges, so edge identity, the edge-set hash, preserve-or-create and UV reattachment all evaporate. CSG-produced shapes can remain as baked `Shape.geometryData` primitives, but they can never participate in kernel derivation. Anything the kernel owns must be cut by drawing edges, not by boolean.

**2. `surfaceMaterials: Record<number, string>` keys on face index.** A positional index into a triangle list. It survives only as long as the geometry is regenerated identically, and it is precisely the failure mode §6.3 exists to prevent. Kernel faces must key materials on face ID, and the two schemes cannot be unified — `surfaceMaterials` stays with `Shape`, face IDs come with the kernel.

**3. Groups are a flat string tag.** `Shape.groupId?: string`, referenced twice in the whole codebase. §2.5 needs containers with local transform frames, arbitrary nesting, an active edit context, and `M⁻¹`/`M⁻ᵀ` caching. Essentially none of that exists. **Phase 3b is substantially larger than the spec's table implies** — budget for it accordingly, and note it is a prerequisite for R8, which is what stops drawn geometry welding to everything it touches.

**4. No test infrastructure.** `package.json` has no vitest, no jest; `npm run lint` is `tsc --noEmit`. The Phase 5 and Phase 9 gates are the backbone of the build plan and they need a runner. This is a new Phase 0c below.

---

## 3. The inference engine is a genuine asset — adapt it

`src/lib/PolyformInferenceEngine.ts` is 1,365 lines and considerably better than average. It already implements:

- A priority hierarchy: `ENDPOINT=1, CURVE_CENTER=2, MIDPOINT=3, FACE_CENTROID=4, INTERSECTION=5, GUIDE_POINT=6, ON_EDGE=7, ON_FACE=8`
- Inference locking (`ActiveLock`), tracked points, secondary orthogonal guides
- Analytical ray-to-skew-line and ray-to-plane solvers with numerical guards
- Green's-theorem polygon centroids
- Hysteresis on snap acquisition — which the spec does not even mention and should

**Do not rebuild this as Phase 11.** Three changes are needed instead:

- **Reconcile the precedence order.** The engine puts `CURVE_CENTER` second and `INTERSECTION` fifth; the spec (§4.2) orders it Endpoint → Intersection → Midpoint → Centre → On Edge → On Face. Pick one deliberately. I would keep the spec's order — an intersection is a more specific user intent than a curve centre — but the existing order is defensible and the code is already written around it. Decide, then make both documents agree.
- **Change what feeds it.** It currently receives candidates assembled from `Shape` meshes in `Viewport.tsx` (~line 3254 onward). It needs to also receive kernel vertices, edges and faces, and — per §2.5 — to hit-test *across* contexts while insertion writes only to the active one.
- **Add what's missing:** the from-point linear inference, edge-extension inference, and parallel/perpendicular-to-edge, if they aren't already covered by `SecondarySnapGuide`.

Revised Phase 11 is therefore "extend and re-source the existing engine", not "write a new one". That is a meaningful reduction in scope and risk.

---

## 4. The real risk is `Viewport.tsx`

**8,531 lines and 362 KB in one file.** It contains tool dispatch, preview construction, commit logic, keyboard handling, CSG, geometry builders, and the R3F scene graph. Every drawing tool's behaviour lives in one `else if` chain.

This matters for three reasons:

1. **It exceeds what any model regenerates reliably.** It is roughly 90,000 tokens. Asking for edits to it — in AI Studio or here — risks silent damage to unrelated tools, and diffs that large are not reviewable in practice.
2. **The spec's file discipline cannot be applied to it.** §10.1's "generate only the named file" assumes files of a few hundred lines.
3. **It is where the kernel must eventually integrate**, so it cannot be left alone forever.

**Recommendation: carve out before integrating, and do it by extraction rather than rewrite.** Pull the per-tool blocks into `src/tools/<name>Tool.ts` modules one at a time, each a pure function over the same inputs the `else if` branch received, verified by running the app after each extraction. This is mechanical, individually reversible, and does not require understanding the whole file at once. Start with `line` and `arc`, since those are the ones being replaced anyway — extraction and replacement become the same task.

Do not attempt a Viewport rewrite. The cost is high, the risk is total, and none of it is on the critical path for the kernel.

---

## 5. Revised phase plan

Changes to `polyform-build-prompts.md` in light of the above.

| Phase | Change |
|---|---|
| **0c (new)** | **Add test tooling** — vitest + config, `npm test`, one trivial passing test. Must come before Phase 1 or every gate is decorative. Small, do it first. |
| 0b | Unchanged. New `src/lib/geometry/types.ts`, no conflict with `src/types.ts`. |
| 1–2b | Unchanged. Purely additive. |
| 3 | Unchanged. |
| **3b** | **Larger than specified.** Containers do not exist; `groupId` is a flat tag. Includes a migration path from `groupId` to real containers. Consider splitting into 3b-i (container graphs + transforms) and 3b-ii (explode/group/migration). |
| 4–9 | Unchanged. The kernel is standalone; nothing in PolyForm can break it or be broken by it. |
| **9b (new)** | **Read-only render bridge.** Build kernel faces into a `BufferGeometry` and render alongside `Shape`s. No tools yet. This is where the kernel first becomes visible and is the natural end of Block A. |
| 10 | Unchanged, but pair it with extracting the `line` branch out of `Viewport.tsx`. |
| **11** | **Rescoped: extend `PolyformInferenceEngine`, don't rewrite it.** Reconcile precedence, re-source candidates from the kernel, add missing linear inferences. |
| 12 | Unchanged. Note `Viewport.tsx:2075` already has a `typedLength` path for lines to learn from — and to replace, since it edits in place rather than rolling back (§4.3). |
| 13 | Unchanged, but depends on 9b existing. |
| 14–16 | Unchanged. |
| 17 | Unchanged. Existing touch handling in `Viewport.tsx` is worth auditing first. |
| 18 | Unchanged. |

**Net effect:** two small new phases (0c, 9b), one phase materially larger (3b), one materially smaller (11).

---

## 6. Three decisions to make before Phase 0c

**1. Coexistence or replacement?** My strong recommendation is coexistence: kernel owns drawn geometry, `Shape[]` keeps primitives, plants and terrain. Replacement is months of work with a large regression surface and no user-visible benefit for a sphere. This decision shapes everything downstream, so make it explicitly rather than by drift.

**2. Inference precedence — spec order or engine order?** Both are defensible; having two is not. Decide now, while only one caller exists.

**3. What happens to push/pull?** It is the tool that turns a face into a solid, and in a derived-face model it is a kernel operation (extrude a face, generate side faces, re-derive). Currently it is a primitive-args mutation. It is out of scope for this spec, but the kernel design should not preclude it — and it will be the first thing users try after drawing a closed shape and seeing a surface appear.

---

## 7. What I'd do next

1. **Phase 0c** — vitest, ~15 minutes.
2. **Decide the three questions in §6.**
3. **Phases 0b → 9** — the kernel, built and tested in isolation. Nothing in PolyForm changes; nothing can break.
4. **Phase 9b** — the render bridge. First point where you see a kernel-derived surface on screen.
5. **Extract `line` from `Viewport.tsx`, then Phase 10** — first real integration, smallest possible blast radius.

The kernel work is genuinely low-risk because of how cleanly it is isolated. The risk in this project is concentrated in exactly two places: the cycle finder at Phase 5, and `Viewport.tsx` at integration time. Both are known, and both have a stated approach.
