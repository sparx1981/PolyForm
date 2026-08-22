# Phases 10 & 12 — Line tool and measurement field

**288 tests passing** (71 new). Strict typecheck clean across `src/lib/geometry/**` and `src/tools/**`.

## Files

| File | Where | What |
|---|---|---|
| `measurement.ts` | `src/tools/` | Field parser: lengths, units, imperial, coordinates, arc suffixes |
| `lineTool.ts` | `src/tools/` | Pure state machine. No rendering, no DOM, no three |
| `kernelLineHost.ts` | `src/tools/` | Adapter binding the tool to a real graph, with undo |
| + three test files | | 71 tests |

## Wiring

```ts
import { KernelLineHost } from '@/tools/kernelLineHost';
import { LineTool } from '@/tools/lineTool';

const host = new KernelLineHost({
  cameraDirection: camera.getWorldDirection(new THREE.Vector3()),
  onChange: () => bumpKernel(),          // the Phase 9b revision signal
});
const tool = new LineTool(host, 'm');

// From your pointer handlers, feeding SNAPPED points from the inference engine:
tool.activate();
tool.move(snappedPoint);
tool.click(snappedPoint);
tool.escape();

// Keystrokes route to the field automatically:
if (isMeasurementKey(e.key)) tool.type(e.key === 'Backspace' ? 'Backspace' : e.key);
if (e.key === 'Enter') tool.enter();
```

`tool.current` gives you everything the overlay needs: `start`, `cursor`, `previewLength`, `chain`, `fieldText`, `lastError`.

## The bug worth knowing about

**Re-solve was checked after the phase, and never fired.** After a commit the tool is still in `drawing` — the chain continues from the new anchor — so `submitField` started a *new* segment instead of correcting the one just drawn. The spec says the value stays editable "until any other action is taken", and moving the cursor is that action. `canResolve` must be checked **first**. Three tests cover it now, including that the window closes on pointer movement.

## Decisions

**Re-solve is rollback-and-recommit.** The tests assert the exact host call sequence: `rollback` → `commit` → `replaceUndo`. Not an endpoint edit — the commit being revised may have split edges, cut a face or absorbed an overdraw, none of which unwinds by moving a vertex.

**A re-solve leaves one undo entry.** `replaceUndoEntry` discards the intermediate snapshot. `Ctrl-Z` removes the segment, not the typing.

**The chain follows a revised endpoint,** because the next segment's start point *is* the endpoint being revised.

**A failed re-solve restores the original commit** rather than leaving the user with nothing.

**Rejected commits are silent.** No dialog, no error state, the gesture continues, and no undo entry is consumed. Degenerate commits are overwhelmingly slips.

**The spatial index is rebuilt after any rollback** — it is derived state, and a stale one would offer candidates for edges that no longer exist.

## Not done

`tool.move()` and `tool.click()` expect points **already snapped** by the inference engine. Phase 11 supplies those. Until then the tool works against raw cursor positions, which is fine for testing and wrong for use.

Arc suffixes (`24r`, `12s`) and angles parse correctly but the line tool ignores them — they belong to Phases 15 and 16.
