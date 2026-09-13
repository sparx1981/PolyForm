import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import { PolygonState } from '../tools/polygon/types';
import { generatePolygonVertices } from '../tools/polygon/math';

interface PolygonOverlayProps {
  state: PolygonState;
}

export const PolygonOverlay: React.FC<PolygonOverlayProps> = ({ state }) => {
  const { center, radiusPoint, sides, activePlane, isCommitted } = state;

  // 1. Polygon Perimeter Points (closed loop)
  const perimeterPoints = useMemo(() => {
    if (!center || !radiusPoint || !activePlane || isCommitted) return null;
    const vertices = generatePolygonVertices(center, radiusPoint, sides, activePlane);
    if (vertices.length === 0) return null;
    return vertices;
  }, [center, radiusPoint, sides, activePlane, isCommitted]);

  // 2. Dashed Radius Reference Line Points
  const radiusLinePoints = useMemo(() => {
    if (!center || !radiusPoint || isCommitted) return null;
    return [center, radiusPoint];
  }, [center, radiusPoint, isCommitted]);

  if (isCommitted || !center || !radiusPoint) return null;

  return (
    <group>
      {/* Perimeter Outline */}
      {perimeterPoints && (
        <Line
          points={perimeterPoints}
          color="#0063A3"
          lineWidth={2}
          depthTest={false}
          transparent
          opacity={0.8}
        />
      )}

      {/* Faint Dashed Radius Indicator */}
      {radiusLinePoints && (
        <Line
          points={radiusLinePoints}
          color="#6A6E79"
          dashed
          dashSize={0.1}
          gapSize={0.1}
          depthTest={false}
          transparent
          opacity={0.6}
        />
      )}
    </group>
  );
};
