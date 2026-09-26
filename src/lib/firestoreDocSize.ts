// Firestore rejects a document over 1 MiB (1,048,576 bytes, counted its own
// way: string bytes + 1, 8 per number, field names included). Checking before
// writing turns that into a message naming what to trim, instead of a save
// that fails, retries with the same data and fails again.

/** Leaves room for the document name and fields the save adds on its own. */
export const MAX_MODEL_DOC_BYTES = 1_000_000;

const utf8 = (s: string) => new TextEncoder().encode(s).length;

/** Roughly how many bytes Firestore counts for this value. */
export function firestoreSize(value: unknown): number {
  if (value === null || value === undefined || typeof value === 'boolean') return 1;
  if (typeof value === 'number') return 8;
  if (typeof value === 'string') return utf8(value) + 1;
  if (value instanceof Uint8Array) return value.length;
  if (Array.isArray(value)) return value.reduce((n: number, v) => n + firestoreSize(v), 0);
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return 16; // timestamps, sentinels
    let n = 32;
    for (const [k, v] of Object.entries(value)) n += utf8(k) + 1 + firestoreSize(v);
    return n;
  }
  return 8;
}

export class ModelTooLargeError extends Error {
  constructor(message: string, readonly bytes: number) {
    super(message);
    this.name = 'ModelTooLargeError';
  }
}

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(2)} MB`;

/**
 * Throws a ModelTooLargeError naming the largest objects when `doc` (a model
 * document about to be written) would be over the limit.
 */
export function assertModelFits(doc: Record<string, unknown>) {
  const bytes = firestoreSize(doc);
  if (bytes <= MAX_MODEL_DOC_BYTES) return;
  const shapes = Array.isArray(doc.shapes) ? doc.shapes as any[] : [];
  const parts = [
    ...shapes.map(s => ({ name: String(s?.name || s?.type || 'object'), bytes: firestoreSize(s) })),
    ...Object.entries(doc).filter(([k]) => k !== 'shapes').map(([k, v]) => ({ name: `model ${k}`, bytes: firestoreSize(v) })),
  ].sort((a, b) => b.bytes - a.bytes).slice(0, 3);
  throw new ModelTooLargeError(
    `This model is too large to save to the cloud (${mb(bytes)}; the limit is about ${mb(MAX_MODEL_DOC_BYTES)}). `
      + `Largest parts: ${parts.map(p => `${p.name} (${mb(p.bytes)})`).join(', ')}.`,
    bytes,
  );
}
