import { buildFence } from './fenceBuild';
import type { FenceBuildResult, FenceData, TerrainSnapshot } from './fenceTypes';

let worker: Worker | null | undefined;
let nextId = 0;
const pending = new Map<number, (result: FenceBuildResult) => void>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./fence.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ id: number; result: FenceBuildResult }>) => {
      pending.get(event.data.id)?.(event.data.result);
      pending.delete(event.data.id);
    };
    worker.onerror = () => {
      // Fall back to building on the main thread if the worker can't start.
      for (const resolve of pending.values()) resolve({ ok: false, error: 'Fence builder unavailable' });
      pending.clear(); worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** Builds a fence in the shared worker (or synchronously where workers are unavailable). */
export function requestFenceBuild(data: FenceData, snapshot: TerrainSnapshot | null, baseY: number): Promise<FenceBuildResult> {
  const target = getWorker();
  if (!target) return Promise.resolve(buildFence(data, snapshot, baseY));
  const id = nextId++;
  return new Promise(resolve => {
    pending.set(id, resolve);
    target.postMessage({ id, data, snapshot, baseY });
  });
}
