/**
 * The drag preview of a shape being drawn (rectangle, circle, triangle, line ...) has an outline
 * drawn with thick lines. When a dimension shrinks to nothing - a rectangle dragged to zero
 * width, so opposite edges lie on top of each other - the outline collapses to zero-length
 * segments, which the thick-line shader turns into huge flickering strokes across the whole
 * view. A preview that small has nothing to show, so it isn't drawn.
 */

/** Smaller than the kernel's shortest edge (1 mm): such a shape can't be committed either. */
export const MIN_PREVIEW_SIZE = 1e-3;

/** Which entries of a preview's `args` are lengths that must not vanish, by shape type. */
const SIZED_ARGS: Record<string, number[]> = {
  rect: [0, 2],
  box: [0, 1, 2],
  circle: [0],
  triangle: [0],
  line: [2],
  sphere: [0],
  dome: [0],
};

export function previewIsDegenerate(preview: { type: string; args?: unknown }): boolean {
  const sized = SIZED_ARGS[preview.type];
  if (!sized || !Array.isArray(preview.args)) return false;
  return sized.some(i => {
    const v = (preview.args as unknown[])[i];
    return typeof v === 'number' && !(Math.abs(v) >= MIN_PREVIEW_SIZE); // also catches NaN
  });
}

/** The same test for a ring of corners about to be committed: no two opposite sides may meet. */
export function ringIsDegenerate(ring: readonly { x: number; y: number; z: number }[]): boolean {
  if (ring.length < 3) return true;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    if (![a.x, a.y, a.z].every(Number.isFinite)) return true;
    if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < MIN_PREVIEW_SIZE) return true;
  }
  return false;
}
