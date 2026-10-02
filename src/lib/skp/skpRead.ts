import { buildInstancedScene, buildScene, toGLB, toInstancedGLB } from 'openskp';
import { isOutOfMemoryError } from './outOfMemory';
import { diagnoseSkp } from './skpDiagnostics';
import { LeanSkpEmpty, LeanSkpUnsupported, readSkpToGlbLean } from './skpLeanReader';
import type { LeanSkpOptions } from './skpLeanReader';

/**
 * Reads a .skp into a GLB. The low-memory reader goes first. OpenSKP's own reader is the fallback for the pre-2021
 * format and for files the low-memory reader cannot read or finds nothing in; running out of memory is never retried
 * with it, because it needs far more.
 */
export function readSkpToGlb(buffer: ArrayBuffer, options: LeanSkpOptions): Uint8Array {
  let layout = '';
  try {
    return readSkpToGlbLean(buffer, options);
  } catch (leanError) {
    if (isOutOfMemoryError(leanError)) throw leanError;
    if (leanError instanceof LeanSkpEmpty) {
      try {
        layout = diagnoseSkp(buffer);
      } catch (diagnosticError) {
        layout = `(could not describe the file: ${diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)})`;
      }
      console.warn(`[skp] The low-memory reader found nothing to draw (${leanError.message}). File layout:\n${layout}`);
    } else if (!(leanError instanceof LeanSkpUnsupported)) {
      console.warn('[skp] The low-memory reader could not read this file, trying the standard reader', leanError);
    }
  }
  try {
    try {
      return toInstancedGLB(buildInstancedScene(buffer, options));
    } catch (instancedError) {
      if (isOutOfMemoryError(instancedError)) throw instancedError;
      console.warn('[skp] Instanced read failed, falling back to the flattened reader', instancedError);
      return toGLB(buildScene(buffer, options));
    }
  } catch (fallbackError) {
    if (layout && isOutOfMemoryError(fallbackError)) {
      throw new Error(`The file opened but no geometry was found in it, and the standard reader could not take over. File layout: ${layout.slice(0, 1400)}`);
    }
    throw fallbackError;
  }
}
