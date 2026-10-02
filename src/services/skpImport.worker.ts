import { buildInstancedScene, buildScene, toGLB, toInstancedGLB } from 'openskp';

/**
 * Reads a SketchUp file off the main thread, so a big file does not freeze the page and the page can
 * show progress while it works. Components placed many times are kept as shared meshes (a chair placed a
 * thousand times is stored once), which is what keeps a large file within the browser's memory.
 */
export interface SkpWorkerRequest { buffer: ArrayBuffer }
export type SkpWorkerMessage =
  | { type: 'progress'; stage: string; current: number; total: number }
  | { type: 'done'; glb: ArrayBuffer }
  | { type: 'error'; message: string };

const post = (message: SkpWorkerMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer);

self.onmessage = (event: MessageEvent<SkpWorkerRequest>) => {
  const { buffer } = event.data;
  const options = {
    // Faces SketchUp itself hides stay hidden.
    respectEdgeVisibility: true,
    onProgress: (info: { stage: string; current: number; total: number }) => post({ type: 'progress', ...info }),
  };
  try {
    let glb: Uint8Array;
    try {
      glb = toInstancedGLB(buildInstancedScene(buffer, options));
    } catch (instancedError) {
      // Fall back to the flattened reader, which handles files the instanced one cannot.
      console.warn('[skpImport] Instanced read failed, falling back to the flattened reader', instancedError);
      glb = toGLB(buildScene(buffer, options));
    }
    const whole = glb.byteOffset === 0 && glb.byteLength === glb.buffer.byteLength;
    const out = (whole ? glb.buffer : glb.slice().buffer) as ArrayBuffer;
    post({ type: 'done', glb: out }, [out]);
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
