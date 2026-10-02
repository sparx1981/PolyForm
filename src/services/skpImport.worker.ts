import { readSkpToGlb } from '../lib/skp/skpRead';

/**
 * Reads a SketchUp file off the main thread, so a big file does not freeze the page and the page can
 * show progress while it works. Components placed many times are kept as shared meshes (a chair placed a
 * thousand times is stored once), which is what keeps a large file within the browser's memory.
 *
 * Files from SketchUp 2021 and newer go through the low-memory reader first, which inflates the file a piece
 * at a time and keeps only compact meshes. OpenSKP's own reader keeps an object for every record in the file,
 * which needs about thirty times the file's size in memory and fails on big models. It is still used for the
 * older file format, and for any file the low-memory reader cannot make sense of.
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
    appearance: 'polyform' as const,
    onProgress: (info: { stage: string; current: number; total: number }) => post({ type: 'progress', ...info }),
  };
  try {
    const glb = readSkpToGlb(buffer, options);
    const whole = glb.byteOffset === 0 && glb.byteLength === glb.buffer.byteLength;
    const out = (whole ? glb.buffer : glb.slice().buffer) as ArrayBuffer;
    post({ type: 'done', glb: out }, [out]);
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
