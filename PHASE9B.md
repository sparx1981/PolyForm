# Phase 9b — render bridge

**217 tests passing** (15 new). Kernel strict typecheck clean, and the React component typechecks against real `three@0.183.2`, `@types/three`, `react@19` and `@react-three/fiber@9` — installed and verified, not assumed.

This is the first point where a kernel-derived surface appears on screen.

---

## Files

| File | Where it goes | What |
|---|---|---|
| `tessellate.ts` | `src/lib/geometry/` | Faces → triangles and lines. Pure, no three, no React |
| `tessellate.test.ts` | `src/lib/geometry/` | 15 tests |
| `KernelGeometry.tsx` | `src/components/` | R3F component |

## Wiring, in three steps

**1. Add kernel state to `AppContext.tsx`:**

```ts
import { KernelSession } from '@/lib/geometry';

const kernelRef = useRef(new KernelSession({ tolerances: DEFAULT_TOLERANCES }));
const [kernelRevision, setKernelRevision] = useState(0);
const bumpKernel = useCallback(() => setKernelRevision(r => r + 1), []);
```

**2. Mount inside your existing `<Canvas>` in `Viewport.tsx`,** next to the `Shape[]` rendering, not replacing it:

```tsx
<KernelGeometry
  graph={kernelRef.current.graph}
  revision={kernelRevision}
  selectedFaces={selectedKernelFaces}
  onFaceClick={(faceId) => selectKernelFace(faceId)}
/>
```

**3. Prove it works** before touching any tool. In a dev console or a temporary button:

```ts
const s = kernelRef.current;
s.drawChain([vec3(0,0,0), vec3(4,0,0), vec3(4,4,0), vec3(0,4,0), vec3(0,0,0)]);
bumpKernel();                      // a surface appears
s.drawLine(vec3(0,0,0), vec3(4,4,0));
bumpKernel();                      // it becomes two, area unchanged
```

If that behaves, the kernel is live in your app and Phase 10 has somewhere to land.

---

## Three things worth knowing

**`revision` is the invalidation signal, and it is not optional.** `Graph` is mutated in place, so React's identity check on the object would never fire. Every mutation must be followed by a revision bump or the screen silently stops matching the model. If you would rather not manage that by hand, make `KernelSession` emit an event and subscribe.

**Raycasts return a triangle; the user selected a face.** `mergeBuffers` returns `faceOfTriangle`, mapping each triangle back to its `FaceId`, and the click handler uses it. Without that map, clicking a wall selects one triangle of it.

**Edge picking has its own invisible proxy geometry.** Raw `<lineSegments>` are close to unclickable at any sensible zoom. The proxy cylinders are separate from the visible lines so hit radius and render weight tune independently — the hit radius should track `SNAP_RADIUS_PX`, and needs to roughly double on touch.

---

## On the triangulator

I wrote ear clipping with hole bridging rather than using `THREE.ShapeUtils.triangulateShape`, for the same reason §10.3 bans clipping libraries in derivation: this consumes the kernel's loops directly, in their existing winding, with no round trip through a foreign representation. It also keeps `tessellate.ts` free of three, so it is testable headless — which matters, because the thing most likely to break here is a hole that quietly fills in, and that is invisible in a screenshot until you look at exactly the wrong pixel.

The test asserts it directly: **no triangle centroid falls inside the hole**, and the tessellated area equals the face area minus its holes. There is a two-hole case as well.

If you would rather drop my triangulator for `ShapeUtils` later, keep those tests — they are the useful part.

---

## Not yet done

- **Materials.** `resolveMaterial` is a hook, currently unused; every face renders with one default material. Wiring it to PolyForm's material system is a small follow-on, and it needs a decision about how kernel material names relate to `Shape.surfaceMaterials` (which keys on three's face index and cannot be shared — see the Phase 0a audit).
- **Front/back shading.** The kernel tracks orientation and stores `materialBack`, but the component renders `DoubleSide` with a single material. `backFaceColor` is a placeholder.
- **Instanced edge picking.** One mesh per edge is fine into the low thousands and should become instanced beyond that.

Next: **Phase 3b (containers)**, or **extract the `line` branch from `Viewport.tsx` and do Phase 10**. Phase 10 is the more satisfying one — it is the point where drawing a line in the app produces a real surface.
