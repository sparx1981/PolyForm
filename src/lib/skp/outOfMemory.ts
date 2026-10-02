/** True when a failure means the browser ran out of memory (as opposed to the file being unreadable). */
export function isOutOfMemoryError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return err instanceof RangeError || /out of memory|allocation failed|invalid array length|invalid typed array length|memory/i.test(message);
}
