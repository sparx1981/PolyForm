import { useMemo } from 'react';
import { KernelGeometry, type KernelFaceBinding } from './KernelGeometry';
import { deserializeGraph, type SerializedGraph } from '../lib/geometry/serialize';
import type { Shape } from '../types';

/**
 * A group or component of drawn geometry (tools/kernelGroups.ts), drawn as one object: its
 * faces, in the group's own frame, inside the object's group - which carries the position,
 * rotation, scale, selection and clicks like every other object's.
 */
export function KernelGroupMesh({
  shape, groupProps, showEdges, edgeColor, edgeOpacity, edgeLineWidth, bindingFor, opacity = 1,
}: {
  shape: Shape;
  groupProps: Record<string, unknown>;
  showEdges?: boolean;
  edgeColor?: string;
  edgeOpacity?: number;
  edgeLineWidth?: number;
  bindingFor?: (bindingId: string) => KernelFaceBinding | undefined;
  opacity?: number;
}) {
  const graph = useMemo(() => deserializeGraph(shape.kernelGraph as SerializedGraph), [shape.kernelGraph]);
  return (
    <group {...groupProps}>
      <KernelGeometry graph={graph} revision={0} asObject opacity={opacity}
        showEdges={showEdges} edgeColor={edgeColor} edgeOpacity={edgeOpacity} edgeLineWidth={edgeLineWidth} bindingFor={bindingFor} />
    </group>
  );
}
