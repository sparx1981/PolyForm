import { buildFence } from './fenceBuild';
import type { FenceData, TerrainSnapshot } from './fenceTypes';

/** Builds fences off the main thread: the split-rail audit can take up to a second. */
self.onmessage = (event: MessageEvent<{ id: number; data: FenceData; snapshot: TerrainSnapshot | null; baseY: number }>) => {
  const { id, data, snapshot, baseY } = event.data;
  const result = buildFence(data, snapshot, baseY);
  const transfer = result.ok ? result.batches.flatMap(batch => [batch.positions.buffer, batch.uvs.buffer, batch.colors.buffer]) : [];
  (self as unknown as Worker).postMessage({ id, result }, transfer as Transferable[]);
};
