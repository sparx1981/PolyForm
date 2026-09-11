import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useApp } from '../AppContext';
import { getBlockPart, buildBlockGeometry } from '../lib/blockKitGeometry';

/**
 * Renders the semi-transparent "ghost" preview of a block awaiting
 * placement (see the block_picker click/keyboard handling in Viewport.tsx).
 * Purely visual - no interactivity of its own.
 */
export default function BlockPickerOverlay() {
  const { activeTool, activeBlockPart, blockPlacementDraft } = useApp();

  const geometry = useMemo(() => {
    if (!activeBlockPart) return null;
    const part = getBlockPart(activeBlockPart.partId);
    if (!part) return null;
    return buildBlockGeometry(part);
  }, [activeBlockPart?.partId]);

  if (activeTool !== 'block_picker' || !blockPlacementDraft || !geometry) return null;

  return (
    <mesh
      position={blockPlacementDraft.position}
      rotation={[0, blockPlacementDraft.rotationSteps * (Math.PI / 2), 0]}
      geometry={geometry}
    >
      <meshStandardMaterial
        color={activeBlockPart?.color || '#38bdf8'}
        transparent
        opacity={0.55}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
