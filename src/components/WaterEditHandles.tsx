import React from 'react';
import type { Shape } from '../types';
import { useApp } from '../AppContext';
import { PathEditHandles } from './PathEditHandles';

/** Outline handles for a selected pond or lake. Handles sit on the water surface. */
export function WaterEditHandles({ shape }: { shape: Shape; terrain?: Shape }) {
  const { setShapes } = useApp();
  const data = shape.waterData!;
  const [px, level, pz] = shape.position;
  return (
    <PathEditHandles
      points={data.points.map(([x, z]) => [px + x, pz + z])}
      closed
      minPoints={3}
      groundAt={() => level}
      onCommit={points => {
        const local = points.map(([x, z]) => [x - px, z - pz] as [number, number]);
        setShapes(prev => prev.map(s => s.id === shape.id ? { ...s, waterData: { ...data, points: local } } : s));
      }}
    />
  );
}
