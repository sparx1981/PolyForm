import type { Shape } from '../types';
import { DeveloperSDK } from '../services/developerService';
import { KernelArcHost } from '../tools/kernelArcHost';
import { createGraph } from './geometry/topology';
import { applyKernelPatch, captureKernelState, diffKernelStates, type KernelState } from './geometry/graphPatch';
import { diffShapesToSdk } from './macroRecorder';

// "Friendly, but checked": a tool can offer a readable SDK command for what it just did
// (sdk.landscape.addPond(...) rather than sdk.addObject("water", {...})). The recorder only
// writes it if running it on a scratch copy of the model, as it was before the step, gives
// exactly the model after the step; otherwise it keeps the exact generic lines.
//
// Only commands that change objects and drawn geometry (and nothing else in the app) are
// offered, so the scratch run has no side effects: the SDK here has no app setters at all.

export interface StepSnapshot {
  shapesBefore: Shape[];
  shapesAfter: Shape[];
  kernelBefore: KernelState;
  kernelAfter: KernelState;
}

/** True when `code` turns the "before" model into exactly the "after" model. */
export function commandReproducesStep(code: string, step: StepSnapshot, extra: Record<string, unknown> = {}): boolean {
  try {
    let shapes = step.shapesBefore;
    const host = new KernelArcHost({ upAxis: { x: 0, y: 1, z: 0 } });
    const fromEmpty = diffKernelStates(captureKernelState(createGraph()), step.kernelBefore);
    if (fromEmpty) applyKernelPatch(host.graph, fromEmpty);
    host.refreshIndex();
    const sdk = new DeveloperSDK(
      shapes,
      next => { shapes = typeof next === 'function' ? next(shapes) : next; },
      () => {},
      null,
      { ...extra, kernelHost: host, bumpKernel: () => {}, onLog: () => {} },
    );
    new Function('sdk', code)(sdk);
    if (diffShapesToSdk(shapes, step.shapesAfter).length > 0) return false;
    return diffKernelStates(captureKernelState(host.graph), step.kernelAfter) === null;
  } catch {
    return false;
  }
}
