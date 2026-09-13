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
export function dispatchTerrainRasterWithWatchdog(
  input: TerrainRasterWorkerInput,
  onWarning?: (message: string) => void
): Promise<TerrainRasterWorkerOutput> {
  return dispatchTerrainRasterCancellable(input, onWarning).promise;
}

/**
 * Same as dispatchTerrainRasterWithWatchdog, but also exposes a `cancel()`
 * handle so a caller (e.g. a React effect) can terminate the worker and
 * clear the watchdog timer immediately on unmount/re-run instead of letting
 * them keep running to completion in the background with their result
 * silently discarded.
 */
export function dispatchTerrainRasterCancellable(
  input: TerrainRasterWorkerInput,
  onWarning?: (message: string) => void
): { promise: Promise<TerrainRasterWorkerOutput>; cancel: () => void } {
  let cleanupRef: () => void = () => {};
  const promise = new Promise<TerrainRasterWorkerOutput>((resolve) => {
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
    cleanupRef = cleanup;

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

        // input.baseHeights is deliberately NOT passed in a transfer list.
        // The only current caller (CutFillVolumeOverlay) reads it again
        // itself, after dispatch, to build the cut/fill mesh geometry —
        // transferring would detach its buffer (leaving it a zero-length
        // view) the instant postMessage returns, silently corrupting that
        // read. The grid this ships is also capped small (max 64x64, i.e.
        // <=16KB of floats), so the structured-clone copy this avoids by
        // transferring is not a meaningful cost at this size anyway.
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

  return { promise, cancel: () => cleanupRef() };
}
