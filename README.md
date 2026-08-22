# PolyForm geometry kernel — Block A + render bridge

**217 tests passing. Kernel clean under full strict mode. Phase 9 gate green. The React bridge typechecks against real three, React 19 and R3F 9.**

Everything here was built and run in a real test environment. Five genuine bugs were caught and fixed along the way — see *What the tests caught*, because several passed casual inspection before their test went red.

---

## Install

```bash
npm install -D vitest
```

Copy `src/lib/geometry/` and `src/components/KernelGeometry.tsx` into your repo at those paths, plus `vitest.config.ts` and `tsconfig.kernel.json` at the root.

Add to `package.json`:

```json
"test": "vitest run",
"test:watch": "vitest",
"lint:kernel": "tsc -p tsconfig.kernel.json --noEmit"
```

Verify — both must stay green, at every future phase gate:

```bash
npm test          # 217 passed
npm run lint:kernel
```

`PHASE9B.md` has the wiring steps for `AppContext` and `Viewport`.

---

## What's here

| Phase | File | What |
|---|---|---|
| 0b | `types.ts` | Frozen type contract |
| 1 | `math.ts`, `polygon.ts`, `mat4.ts` | Vectors, planes, polygons, affine transforms |
| 2 / 2b | `spatialIndex.ts`, `planeIndex.ts` | Hash grid; quantised plane hash + union-find |
| 3 | `topology.ts` | Half-edge store, edge-uses, integrity checks |
| 4 / 4b | `insert.ts` | R1/R2 intersection, R2b colinear overlap |
| 5 | `cycles.ts` | Pruning, minimal-turn traversal, winding, slivers |
| 6 / 7 | `derive.ts` | Preserve-or-create, attributes, orientation |
| 8 | `heal.ts` | Merge, dissolve, transactions, rollback |
| 9 | `kernel.test.ts` | The integration gate |
| 9b | `tessellate.ts`, `KernelGeometry.tsx` | Render bridge |
| — | `index.ts` | Public API + `KernelSession` |

```ts
import { KernelSession, vec3 } from '@/lib/geometry';

const s = new KernelSession({ cameraDirection: vec3(0, 0, -1) });
s.drawChain([vec3(0,0,0), vec3(2,0,0), vec3(2,2,0), vec3(0,2,0), vec3(0,0,0)]);
s.stats;            // { vertices: 4, edges: 4, faces: 1, area: 4 }
s.drawLine(vec3(0,0,0), vec3(2,2,0));
s.stats.faces;      // 2 — split, area unchanged
s.undo();           // face ids restored identically
```

---

## What the tests caught

**1. "Preserved" faces were getting new IDs.** Derivation deleted every face then re-created, so a hash match set `keep = true` but `addFace` allocated a fresh id. Fixed by finding cycles *before* touching any face. A face's identity also has to include its holes — an outer face whose island just appeared has the same outer hash but is no longer the same face.

**2. The UV origin was the region centroid, which moves.** So the texture anchor shifted whenever the region's edge set changed — the bounds-normalisation failure §6.3 warns about, reached by a different route. Now anchored at the point on the plane closest to the **world** origin.

**3. Winding measured in the wrong basis.** Cycles are found in the derivation basis; each face's normal is re-oriented independently by §6.4. When those disagreed the stored loop read clockwise from the face's own front. Small squares hid it; the 6×6 grid exposed it.

**4. Newell's method applied to an unordered point cloud.** `newellNormal` treats input as an ordered polygon. Four vertices in near-loop order gave the right answer by luck; the grid scattered 84 edges across 43 "planes". Added `bestFitPlane` (covariance, determinant-selected normal) for clouds.

**5. `THREE.Event` where R3F needs `ThreeEvent`,** plus a nullable `faceIndex`. Caught by typechecking the component against the real libraries rather than assuming it compiled.

**The cycle finder was never wrong.** Given the whole grid it returned exactly 36 unit cells first time, figure-eight included. Phase 5 was sound; Phase 6 was feeding it rubble. That is the argument for gating the phases separately.

---

## Two divergences from the spec

**Regions span components, not just connected sub-graphs.** §6.5 defines a derivation region as edge-*connected*, but a face and the island inside it share no edge, so a strictly connected region derives the outer face with **no hole**. Nesting resolves per plane bucket, across components. Worth folding back into the spec.

**`mat4.ts` arrived in Phase 1, not 3b** — pure maths with no topology dependency, and it shrinks a phase the audit already flagged as oversized.

---

## Not yet built

**`context.ts` (Phase 3b — containers, R8, edit context).** `types.ts` defines `Container`, `Graph` and `KernelModel`, and the transform maths is ready in `mat4.ts`, but the container graph itself is not built. **Without R8, all drawn geometry sticks to all other drawn geometry.** For a single drawing context that is correct; it is the prerequisite for coexisting with grouped objects.

Also outstanding: Phases 10–18 (tool state machines, inference, measurement parser, rendering cues, curves, arcs, touch, diagnostics). Phases 10, 11, 12, 14, 15, 16 and 18 are all headless and testable.

Materials, front/back shading and instanced edge picking are noted as follow-ons in `PHASE9B.md`.

---

## Suggested next steps

1. Install, confirm both commands pass on your machine, wire up per `PHASE9B.md`, and watch a surface appear.
2. **Extract the `line` branch from `Viewport.tsx`, then Phase 10.** Smallest blast radius, and the point where drawing in the app produces a real surface.
3. **Phase 3b (containers)** before drawn geometry needs to coexist with groups.

---

## One standing caution

Do not let anything regenerate `derive.ts` or `cycles.ts` wholesale. Between them they carry four of the five fixes above, and every one of those bugs passed casual inspection before its test went red. If a later change breaks something, fix the specific function against the failing test rather than regenerating the file.
