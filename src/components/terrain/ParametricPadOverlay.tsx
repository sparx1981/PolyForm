/**
 * PolyForm Terrain Studio - Parametric Pad & Grading Footprint Overlay
 * Renders persistent building pad geometry in the 3D design space,
 * handles direct viewport selection, surface detailing (parking striping, patterns),
 * and provides transient previews during active pad placement.
 */

import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Html, Line } from '@react-three/drei';
import { useApp } from '../../AppContext';
import { PadModifier } from '../../types';

export default function ParametricPadOverlay() {
  const {
    activeTool,
    setActiveTool,
    activePadDraft,
    civilPadSettings,
    terrainModifiers,
    selectedModifierId,
    setSelectedModifierId,
    setSelectedId,
    setSelectedIds,
  } = useApp();

  // Committed building pads from terrain modifier stack
  const committedPads = useMemo(() => {
    return terrainModifiers.filter((m): m is PadModifier => m.type === 'pad' && m.enabled !== false);
  }, [terrainModifiers]);

  return (
    <group name="parametric-pad-overlay">
      {/* 1. Persistent 3D Building Pad Geometry in Design Space */}
      {committedPads.map((pad) => {
        const isSelected = selectedModifierId === pad.id;
        const [dimX, dimZ] = pad.dimensions;
        const halfX = dimX * 0.5;
        const halfZ = (dimZ || dimX) * 0.5;
        const radius = dimX * 0.5;
        const isRect = pad.primitive === 'rectangle';
        const batterDist = Math.max(0, pad.batterDistance || 0);

        return (
          <group
            key={pad.id}
            position={[pad.center[0], pad.targetElevation, pad.center[2]]}
            rotation={[0, pad.rotationY || 0, 0]}
            onClick={(e) => {
              e.stopPropagation();
              const nextId = selectedModifierId === pad.id ? null : pad.id;
              setSelectedModifierId(nextId);
              setSelectedId(null);
              setSelectedIds([]);
              if (nextId) {
                setActiveTool(pad.primitive === 'circle' ? 'pad-circle' : 'pad-rect');
              }
            }}
          >
            {/* 3D Platform Mesh (Physical Concrete Slab) */}
            {isRect ? (
              <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[dimX, dimZ]} />
                <meshStandardMaterial
                  color={isSelected ? '#f4f4f5' : '#e4e4e7'}
                  roughness={0.75}
                  metalness={0.08}
                  emissive={isSelected ? '#0284c7' : '#000000'}
                  emissiveIntensity={isSelected ? 0.3 : 0}
                  side={THREE.DoubleSide}
                  polygonOffset
                  polygonOffsetFactor={-3}
                  polygonOffsetUnits={-3}
                />
              </mesh>
            ) : (
              <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[radius, 48]} />
                <meshStandardMaterial
                  color={isSelected ? '#f4f4f5' : '#e4e4e7'}
                  roughness={0.75}
                  metalness={0.08}
                  emissive={isSelected ? '#0284c7' : '#000000'}
                  emissiveIntensity={isSelected ? 0.3 : 0}
                  side={THREE.DoubleSide}
                  polygonOffset
                  polygonOffsetFactor={-3}
                  polygonOffsetUnits={-3}
                />
              </mesh>
            )}

            {/* Perimeter Boundary Wireframe */}
            {isRect ? (
              <Line
                points={[
                  [-halfX, 0.035, -halfZ],
                  [halfX, 0.035, -halfZ],
                  [halfX, 0.035, halfZ],
                  [-halfX, 0.035, halfZ],
                  [-halfX, 0.035, -halfZ],
                ]}
                color={isSelected ? '#0284c7' : '#71717a'}
                lineWidth={isSelected ? 3.5 : 2}
                polygonOffset
                polygonOffsetFactor={-6}
                polygonOffsetUnits={-6}
              />
            ) : (
              <Line
                points={Array.from({ length: 49 }, (_, i) => {
                  const a = (i / 48) * Math.PI * 2;
                  return [Math.cos(a) * radius, 0.035, Math.sin(a) * radius] as [number, number, number];
                })}
                color={isSelected ? '#0284c7' : '#71717a'}
                lineWidth={isSelected ? 3.5 : 2}
                polygonOffset
                polygonOffsetFactor={-6}
                polygonOffsetUnits={-6}
              />
            )}

            {/* Daylight Batter Footprint (When Selected) */}
            {isSelected && batterDist > 0 && (
              isRect ? (
                <Line
                  points={[
                    [-(halfX + batterDist), 0.03, -(halfZ + batterDist)],
                    [halfX + batterDist, 0.03, -(halfZ + batterDist)],
                    [halfX + batterDist, 0.03, halfZ + batterDist],
                    [-(halfX + batterDist), 0.03, halfZ + batterDist],
                    [-(halfX + batterDist), 0.03, -(halfZ + batterDist)],
                  ]}
                  color="#06b6d4"
                  lineWidth={1.8}
                  dashed
                  dashScale={1.5}
                />
              ) : (
                <Line
                  points={Array.from({ length: 49 }, (_, i) => {
                    const a = (i / 48) * Math.PI * 2;
                    return [
                      Math.cos(a) * (radius + batterDist),
                      0.03,
                      Math.sin(a) * (radius + batterDist),
                    ] as [number, number, number];
                  })}
                  color="#06b6d4"
                  lineWidth={1.8}
                  dashed
                  dashScale={1.5}
                />
              )
            )}

            {/* Surface Detailing Overlay (Parking Stall Striping, Hatches) */}
            {pad.surfaceModifier && pad.surfaceModifier.enabled && (
              <PadSurfaceStripingOverlay pad={pad} />
            )}

            {/* Pad Information Badge when Selected */}
            {isSelected && (
              <Html position={[0, 0.45, 0]} center distanceFactor={14} occlude={false}>
                <div className="bg-zinc-900/95 text-cyan-300 border border-cyan-500/80 px-2.5 py-1 rounded-full text-[10px] font-mono shadow-2xl flex items-center gap-2 whitespace-nowrap select-none">
                  <span className="font-semibold text-white">{pad.name}</span>
                  <span className="text-zinc-400">|</span>
                  <span>{isRect ? `${dimX.toFixed(1)}m × ${dimZ.toFixed(1)}m` : `Ø${(radius * 2).toFixed(1)}m`}</span>
                  <span className="text-zinc-400">|</span>
                  <span className="text-emerald-400">EL {pad.targetElevation >= 0 ? `+${pad.targetElevation.toFixed(1)}` : pad.targetElevation.toFixed(1)}m</span>
                </div>
              </Html>
            )}
          </group>
        );
      })}

      {/* 2. Transient Stamp Placement Preview (Active Pad Tool) */}
      {activePadDraft && (activeTool === 'pad-rect' || activeTool === 'pad-circle') && (
        <group
          name="transient-pad-placement-preview"
          position={[activePadDraft.center[0], (civilPadSettings.targetElevation || 0) + 0.05, activePadDraft.center[2]]}
        >
          {(() => {
            const [dimX, dimZ] = activePadDraft.dimensions;
            const halfX = dimX * 0.5;
            const halfZ = (dimZ || dimX) * 0.5;
            const radius = dimX * 0.5;
            const batterDist = Math.max(0, civilPadSettings.batterDistance || 0);
            const targetElev = civilPadSettings.targetElevation || 0;
            const isRect = activePadDraft.primitive === 'rectangle';

            return (
              <group>
                {isRect ? (
                  <group>
                    {/* Inner Platform Stamp Footprint */}
                    <mesh rotation={[-Math.PI / 2, 0, 0]}>
                      <planeGeometry args={[dimX, dimZ]} />
                      <meshBasicMaterial
                        color="#0284c7"
                        transparent
                        opacity={0.35}
                        side={THREE.DoubleSide}
                        depthWrite={false}
                      />
                    </mesh>

                    {/* Platform Perimeter Boundary */}
                    <Line
                      points={[
                        [-halfX, 0.02, -halfZ],
                        [halfX, 0.02, -halfZ],
                        [halfX, 0.02, halfZ],
                        [-halfX, 0.02, halfZ],
                        [-halfX, 0.02, -halfZ],
                      ]}
                      color="#38bdf8"
                      lineWidth={2.5}
                    />

                    {/* Daylight Batter Falloff Footprint */}
                    {batterDist > 0 && (
                      <Line
                        points={[
                          [-(halfX + batterDist), 0.02, -(halfZ + batterDist)],
                          [halfX + batterDist, 0.02, -(halfZ + batterDist)],
                          [halfX + batterDist, 0.02, halfZ + batterDist],
                          [-(halfX + batterDist), 0.02, halfZ + batterDist],
                          [-(halfX + batterDist), 0.02, -(halfZ + batterDist)],
                        ]}
                        color="#06b6d4"
                        lineWidth={1.5}
                        dashed
                        dashScale={1.5}
                      />
                    )}
                  </group>
                ) : (
                  <group>
                    {/* Circular Stamp Footprint */}
                    <mesh rotation={[-Math.PI / 2, 0, 0]}>
                      <circleGeometry args={[radius, 48]} />
                      <meshBasicMaterial
                        color="#0284c7"
                        transparent
                        opacity={0.35}
                        side={THREE.DoubleSide}
                        depthWrite={false}
                      />
                    </mesh>

                    {/* Circle Perimeter Line */}
                    <Line
                      points={Array.from({ length: 49 }, (_, i) => {
                        const a = (i / 48) * Math.PI * 2;
                        return [Math.cos(a) * radius, 0.02, Math.sin(a) * radius] as [number, number, number];
                      })}
                      color="#38bdf8"
                      lineWidth={2.5}
                    />

                    {/* Daylight Batter Falloff Outer Ring */}
                    {batterDist > 0 && (
                      <Line
                        points={Array.from({ length: 49 }, (_, i) => {
                          const a = (i / 48) * Math.PI * 2;
                          return [
                            Math.cos(a) * (radius + batterDist),
                            0.02,
                            Math.sin(a) * (radius + batterDist),
                          ] as [number, number, number];
                        })}
                        color="#06b6d4"
                        lineWidth={1.5}
                        dashed
                        dashScale={1.5}
                      />
                    )}
                  </group>
                )}

                {/* Real-time Dimensions & Elevation Tag */}
                <Html position={[0, 0.5, 0]} center distanceFactor={14} occlude={false}>
                  <div className="bg-zinc-900/95 text-cyan-300 border border-cyan-500/80 px-2.5 py-1 rounded-full text-[10px] font-mono shadow-2xl whitespace-nowrap select-none pointer-events-none">
                    {isRect
                      ? `Pad Stamp: ${dimX.toFixed(1)}m × ${dimZ.toFixed(1)}m (EL: ${targetElev >= 0 ? '+' : ''}${targetElev.toFixed(1)}m)`
                      : `Pad Stamp: Ø${(radius * 2).toFixed(1)}m (EL: ${targetElev >= 0 ? '+' : ''}${targetElev.toFixed(1)}m)`}
                  </div>
                </Html>
              </group>
            );
          })()}
        </group>
      )}
    </group>
  );
}

/**
 * Surface Detailing Overlay for building pads (Parking bays, striping)
 */
function PadSurfaceStripingOverlay({ pad }: { pad: PadModifier }) {
  const { surfaceModifier } = pad;
  if (!surfaceModifier || !surfaceModifier.enabled) return null;

  const [dimX, dimZ] = pad.dimensions;
  const halfX = dimX * 0.5;
  const halfZ = (dimZ || dimX) * 0.5;
  const cfg = surfaceModifier.parkingConfig;

  // Generate parking stall divider lines
  const lines = useMemo(() => {
    if (!cfg || pad.primitive !== 'rectangle') return [];

    const stallW = Math.max(1.5, Math.min(4.0, cfg.stallWidth || 2.7));
    const stallDepth = Math.max(3.0, Math.min(halfZ * 0.9, cfg.stallDepth || 5.0));
    const rad = ((cfg.angle || 90) * Math.PI) / 180;
    const dx = Math.cos(rad) * stallDepth;
    const dz = Math.sin(rad) * stallDepth;

    const result: Array<[number, number, number][]> = [];

    // Margin from pad boundary
    const margin = 0.5;
    const spanX = dimX - margin * 2;
    const numStalls = Math.floor(spanX / stallW);

    if (numStalls > 0) {
      // Row 1 (Bottom side of pad)
      for (let i = 0; i <= numStalls; i++) {
        const xStart = -halfX + margin + i * stallW;
        const zStart = -halfZ + margin;
        const xEnd = xStart + dx;
        const zEnd = zStart + dz;
        result.push([
          [xStart, 0.04, zStart],
          [xEnd, 0.04, zEnd],
        ]);
      }
      // Row 1 back boundary line
      result.push([
        [-halfX + margin, 0.04, -halfZ + margin],
        [-halfX + margin + numStalls * stallW, 0.04, -halfZ + margin],
      ]);

      // Row 2 (Top side of pad if doubleRow)
      if (cfg.doubleRow && dimZ >= 12) {
        for (let i = 0; i <= numStalls; i++) {
          const xStart = -halfX + margin + i * stallW;
          const zStart = halfZ - margin;
          const xEnd = xStart + dx;
          const zEnd = zStart - dz;
          result.push([
            [xStart, 0.04, zStart],
            [xEnd, 0.04, zEnd],
          ]);
        }
        // Row 2 back boundary line
        result.push([
          [-halfX + margin, 0.04, halfZ - margin],
          [-halfX + margin + numStalls * stallW, 0.04, halfZ - margin],
        ]);
      }
    }

    return result;
  }, [cfg, dimX, dimZ, halfX, halfZ, pad.primitive]);

  return (
    <group name="pad-surface-striping">
      {lines.map((pts, idx) => (
        <Line
          key={idx}
          points={pts}
          color={cfg?.stripeColor || '#fbbf24'}
          lineWidth={3.5}
          polygonOffset
          polygonOffsetFactor={-6}
          polygonOffsetUnits={-6}
        />
      ))}
    </group>
  );
}
