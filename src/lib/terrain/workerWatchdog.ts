/**
 * PolyForm Terrain Studio - Worker Watchdog
 * Wraps off-thread terrain rasterization with a 4.0-second timeout guard.
 * If the worker fails or hangs on extreme meshes, it cleanly aborts the worker,
 * falls back to synchronous low-resolution rasterization, and fires a non-blocking notification.
 */

import {
  computeTerrainRaster,
  TerrainRasterWorkerInput,
  TerrainRasterWorkerOutput,
} from '../../workers/terrainRasterWorker';

const WATCHDOG_TIMEOUT_MS = 4000;

/**
 * Dispatches rasterization to the terrain web worker with a 4-second timeout watchdog.
 * @param input Computation grid, bounds, base heights, and active modifiers.
 * @param onWarning Optional non-blocking toast callback invoked if fallback occurs.
 */
export async function dispatchTerrainRasterWithWatchdog(
  input: TerrainRasterWorkerInput,
  onWarning?: (message: string) => void
): Promise<TerrainRasterWorkerOutput> {
  return new Promise<TerrainRasterWorkerOutput>((resolve) => {
    let worker: Worker | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const cleanup = () => {
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (worker) {
        try {
          worker.terminate();
        } catch (_) {}
        worker = null;
      }
    };

    // Watchdog timer (4.0s)
    timer = setTimeout(() => {
      if (settled) return;
      cleanup();
      console.warn('[Watchdog] Terrain raster worker timed out after 4000ms. Falling back to synchronous raster.');
      if (onWarning) {
        onWarning('Terrain mesh evaluation timed out (>4s). Applied fast low-res fallback.');
      }

      // Safe low-resolution fallback
      const lowResInput: TerrainRasterWorkerInput = {
        ...input,
        gridWidth: Math.min(32, input.gridWidth),
        gridDepth: Math.min(32, input.gridDepth),
      };
      try {
        const fallbackResult = computeTerrainRaster(lowResInput);
        resolve(fallbackResult);
      } catch (err) {
        console.error('[Watchdog] Fallback raster also failed:', err);
        resolve(computeTerrainRaster({ ...input, modifiers: [] }));
      }
    }, WATCHDOG_TIMEOUT_MS);

    try {
      if (typeof Worker !== 'undefined') {
        worker = new Worker(
          new URL('../../workers/terrainRasterWorker.ts', import.meta.url),
          { type: 'module' }
        );

        worker.onmessage = (e: MessageEvent<TerrainRasterWorkerOutput>) => {
          if (settled) return;
          const result = e.data;
          cleanup();
          resolve(result);
        };

        worker.onerror = (err) => {
          if (settled) return;
          console.warn('[Watchdog] Worker execution error:', err);
          cleanup();
          if (onWarning) {
            onWarning('Terrain calculation warning: used synchronous solver.');
          }
          const result = computeTerrainRaster(input);
          resolve(result);
        };

        worker.postMessage(input);
      } else {
        // Environment without Web Workers (e.g. Node/SSR/Vitest)
        cleanup();
        const result = computeTerrainRaster(input);
        resolve(result);
      }
    } catch (err) {
      if (settled) return;
      cleanup();
      const result = computeTerrainRaster(input);
      resolve(result);
    }
  });
}
