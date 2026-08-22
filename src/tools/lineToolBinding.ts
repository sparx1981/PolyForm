/**
 * PolyForm — Line tool binding.
 *
 * Bridges Viewport's pointer handling to the geometry kernel.
 *
 * A note on interaction models, because they differ and the difference is a
 * product decision rather than a technical one:
 *
 *   PolyForm's line tool is DRAG-based — pointer down sets the start, pointer
 *   up commits one segment. The geometry spec (§4.1) describes a CHAINED
 *   click-click tool that continues from the end of each segment until the
 *   user terminates, which is what LineTool in ./lineTool.ts implements.
 *
 * This binding supports both, and defaults to drag so that adopting the
 * kernel changes no user-facing behaviour:
 *
 *   - `commitDrag(from, to)` routes the existing drag interaction into the
 *     kernel. One segment, one undo entry. Nothing else about the tool
 *     changes.
 *   - `tool` exposes the full chained state machine for when you decide to
 *     move to click-click. Switching is then a Viewport change, not a
 *     rewrite, and the kernel side is already proven either way.
 */

import { useCallback, useMemo } from 'react';
import type { Vec3 } from '../lib/geometry/types';
import { LineTool, type LineToolState } from './lineTool';
import type { KernelArcHost } from './kernelArcHost';

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

const toVec3 = (v: Vector3Like): Vec3 => ({ x: v.x, y: v.y, z: v.z });

export interface LineBinding {
  /**
   * Commits one drag as a kernel edge. Returns true when geometry changed.
   *
   * A false result is not an error worth surfacing: a zero-length drag is
   * overwhelmingly a slip (a click that registered as a drag), and
   * interrupting the gesture to announce a slip is worse than absorbing it.
   */
  commitDrag: (from: Vector3Like, to: Vector3Like) => boolean;
  /** The chained state machine, for a future click-click mode. §4.1 */
  tool: LineTool;
  state: LineToolState;
  undo: () => boolean;
  redo: () => boolean;
}

export function useLineBinding(
  kernelHost: KernelArcHost,
  bumpKernel: () => void,
): LineBinding {
  const tool = useMemo(() => new LineTool(kernelHost), [kernelHost]);

  const commitDrag = useCallback(
    (from: Vector3Like, to: Vector3Like): boolean => {
      const result = kernelHost.commitSegment(toVec3(from), toVec3(to));
      // Bump even for an overdraw that created no edge: retracing an existing
      // edge is what brings a deleted face back, and skipping the render
      // invalidation would leave the screen out of step with the model.
      if (result.ok) bumpKernel();
      return result.ok;
    },
    [kernelHost, bumpKernel],
  );

  const undo = useCallback(() => {
    const ok = kernelHost.undo();
    if (ok) bumpKernel();
    return ok;
  }, [kernelHost, bumpKernel]);

  const redo = useCallback(() => {
    const ok = kernelHost.redo();
    if (ok) bumpKernel();
    return ok;
  }, [kernelHost, bumpKernel]);

  return { commitDrag, tool, state: tool.current, undo, redo };
}
