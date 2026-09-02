import React, { useMemo } from 'react';
import * as THREE from 'three';
import { PolygonState } from '../tools/polygon/types';
import { generatePolygonVertices } from '../tools/polygon/math';

interface PolygonOverlayProps {
  state: PolygonState;
}

export const PolygonOverlay: React.FC<PolygonOverlayProps> = ({ state }) => {
  const { center, radiusPoint, sides, activePlane, isCommitted } = state;

  // 1. Polygon Perimeter Geometry
  const perimeterGeometry = useMemo(() => {
    if (!center || !radiusPoint || !activePlane || isCommitted) return null;
    const vertices = generatePolygonVertices(center, radiusPoint, sides, activePlane);
    if (vertices.length === 0) return null;
    return new THREE.BufferGeometry().setFromPoints(vertices);
  }, [center, radiusPoint, sides, activePlane, isCommitted]);

  // 2. Dashed Radius Reference Line Geometry
  const radiusLineGeometry = useMemo(() => {
    if (!center || !radiusPoint || isCommitted) return null;
    return new THREE.BufferGeometry().setFromPoints([center, radiusPoint]);
  }, [center, radiusPoint, isCommitted]);

  if (isCommitted || !center || !radiusPoint) return null;

  return (
    <group>
      {/* Perimeter Outline */}
      {perimeterGeometry && (
        <line geometry={perimeterGeometry}>
          <lineBasicMaterial color="#0063A3" linewidth={2} depthTest={false} transparent opacity={0.8} />
        </line>
      )}

      {/* Faint Dashed Radius Indicator */}
      {radiusLineGeometry && (
        <line geometry={radiusLineGeometry}>
          <lineDashedMaterial 
            color="#6A6E79" 
            dashSize={0.1} 
            gapSize={0.1} 
            depthTest={false} 
            transparent 
            opacity={0.6} 
          />
        </line>
      )}
    </group>
  );
};
