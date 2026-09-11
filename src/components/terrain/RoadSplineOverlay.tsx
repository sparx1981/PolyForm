/**
 * PolyForm Terrain Studio - Road Spline & Alignment Overlay
 * Renders interactive road ribbon geometry, alignment spline knots, elevation handles,
 * road markings presets, and real-time longitudinal grade warning badges.
 */

import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Html, Line } from '@react-three/drei';
import { useApp } from '../../AppContext';
import { RoadModifier, RoadMarkingPreset } from '../../types';
import { generateRoadRibbonGeometry, applyRoadGradingToTerrain } from '../../lib/terrain/roadGeometry';
import { evaluateCatmullRomSpline, calculateGradePercentage, validateSplineAlignment } from '../../lib/terrain/math';
import { getRoadMaterial, getCachedRoadTexture } from '../../lib/terrain/roadMaterials';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

export default function RoadSplineOverlay() {
  const {
    activeTool,
    setActiveTool,
    activeSplineDraft,
    terrainModifiers,
    selectedModifierId,
    setSelectedModifierId,
    setSelectedId,
    setSelectedIds,
    civilRoadSettings,
    updateTerrainModifier,
    shapes,
    setShapes,
  } = useApp();

  const activeRoads = useMemo(() => {
    return terrainModifiers.filter((m): m is RoadModifier => m.type === 'road' && m.enabled);
  }, [terrainModifiers]);

  // Generate road ribbon geometry for active spline draft
  const draftRibbonGeometry = useMemo(() => {
    if (activeTool !== 'road' || activeSplineDraft.length < 2) return null;
    const sampled = evaluateCatmullRomSpline(activeSplineDraft, 8, false);
    return generateRoadRibbonGeometry(sampled, civilRoadSettings.width, {
      width: civilRoadSettings.curbWidth,
      height: civilRoadSettings.curbHeight,
      ditchWidth: civilRoadSettings.ditchWidth,
      ditchDepth: civilRoadSettings.ditchDepth,
      hasCurb: civilRoadSettings.hasCurb,
      hasDitch: civilRoadSettings.hasDitch,
    });
  }, [activeTool, activeSplineDraft, civilRoadSettings]);

  // Compute grade metrics along active spline draft
  const draftGradeSegments = useMemo(() => {
    if (activeTool !== 'road' || activeSplineDraft.length < 2) return [];
    const segments: Array<{
      p1: [number, number, number];
      p2: [number, number, number];
      mid: [number, number, number];
      grade: number;
      isViolated: boolean;
    }> = [];

    for (let i = 0; i < activeSplineDraft.length - 1; i++) {
      const p1 = activeSplineDraft[i];
      const p2 = activeSplineDraft[i + 1];
      const grade = calculateGradePercentage(p1, p2);
      const isViolated = Math.abs(grade) > civilRoadSettings.maxGradePercent;
      const mid: [number, number, number] = [
        (p1[0] + p2[0]) * 0.5,
        (p1[1] + p2[1]) * 0.5 + 0.4,
        (p1[2] + p2[2]) * 0.5,
      ];
      segments.push({ p1, p2, mid, grade, isViolated });
    }
    return segments;
  }, [activeTool, activeSplineDraft, civilRoadSettings]);

  const draftValidation = useMemo(() => {
    if (activeTool !== 'road' || activeSplineDraft.length < 3) return null;
    return validateSplineAlignment(activeSplineDraft, civilRoadSettings.width);
  }, [activeTool, activeSplineDraft, civilRoadSettings.width]);

  return (
    <group name="road-spline-overlay">
      {/* 1. Existing Committed Road Modifiers */}
      {activeRoads.map((road) => {
        const isSelected = selectedModifierId === road.id;
        const sampledPoints = evaluateCatmullRomSpline(road.points, 10, false);
        const roadGeo = generateRoadRibbonGeometry(sampledPoints, road.width, road.profile);
        const validation = validateSplineAlignment(road.points, road.width);

        // Grade calculation for each knot span
        const segments: Array<{
          p1: [number, number, number];
          p2: [number, number, number];
          mid: [number, number, number];
          grade: number;
          isViolated: boolean;
        }> = [];

        for (let i = 0; i < road.points.length - 1; i++) {
          const p1 = road.points[i];
          const p2 = road.points[i + 1];
          const grade = calculateGradePercentage(p1, p2);
          const isViolated = Math.abs(grade) > road.maxGradePercent;
          const mid: [number, number, number] = [
            (p1[0] + p2[0]) * 0.5,
            (p1[1] + p2[1]) * 0.5 + 0.35,
            (p1[2] + p2[2]) * 0.5,
          ];
          segments.push({ p1, p2, mid, grade, isViolated });
        }

        return (
          <group
            key={road.id}
            onClick={(e) => {
              e.stopPropagation();
              const nextId = selectedModifierId === road.id ? null : road.id;
              setSelectedModifierId(nextId);
              setSelectedId(null);
              setSelectedIds([]);
              if (nextId) {
                setActiveTool('road');
              }
            }}
          >
            {/* Road Corridor Surface Mesh */}
            {(() => {
              const roadMat = getRoadMaterial(road.material);
              const roadTexture = getCachedRoadTexture(road.material);
              if (roadTexture) {
                // UVs are physically scaled: u spans 0..1 across road.width, v is cumulative
                // station distance in meters - so repeat directly yields real-world tiling.
                roadTexture.repeat.set(
                  road.width / roadMat.tileSizeMeters,
                  1 / roadMat.tileSizeMeters
                );
              }
              return (
                <mesh geometry={roadGeo}>
                  <meshStandardMaterial
                    map={roadTexture || undefined}
                    color={roadTexture ? '#ffffff' : roadMat.color}
                    roughness={roadMat.roughness}
                    metalness={roadMat.metalness}
                    emissive={isSelected ? '#0284c7' : '#000000'}
                    emissiveIntensity={isSelected ? 0.3 : 0}
                    side={THREE.DoubleSide}
                    polygonOffset={true}
                    polygonOffsetFactor={-2}
                    polygonOffsetUnits={-2}
                  />
                </mesh>
              );
            })()}

            {/* Road Markings Visualization */}
            <RoadMarkingsOverlay
              sampledPoints={sampledPoints}
              width={road.width}
              preset={road.markings}
            />

            {/* Centerline Alignment Spline */}
            <Line
              points={sampledPoints}
              color={isSelected ? '#38bdf8' : '#71717a'}
              lineWidth={isSelected ? 3.5 : 1.5}
            />

            {/* Selected Alignment Handles, Knots, and Grade HUD Badges */}
            {isSelected && (
              <group>
                {/* Control Point Knot Markers */}
                {road.points.map((pt, idx) => (
                  <group key={idx} position={pt}>
                    <mesh>
                      <sphereGeometry args={[0.22, 16, 16]} />
                      <meshStandardMaterial
                        color="#0284c7"
                        emissive="#38bdf8"
                        emissiveIntensity={0.6}
                        roughness={0.2}
                      />
                    </mesh>
                    <mesh position={[0, 0.5, 0]}>
                      <cylinderGeometry args={[0.03, 0.03, 1.0, 8]} />
                      <meshBasicMaterial color="#38bdf8" transparent opacity={0.6} />
                    </mesh>
                    {/* Vertical Elevation Adjust Arrows */}
                    <group position={[0, 1.0, 0]}>
                      <mesh
                        onClick={(e) => {
                          e.stopPropagation();
                          const updated = [...road.points];
                          updated[idx] = [pt[0], pt[1] + 0.5, pt[2]];
                          updateTerrainModifier(road.id, { points: updated });
                          const terrainShape = shapes.find(s => s.type === 'terrain' && s.terrainData);
                          if (terrainShape) {
                            const regraded = applyRoadGradingToTerrain(terrainShape, { ...road, points: updated });
                            if (regraded) {
                              setShapes(prev => prev.map(s => s.id === terrainShape.id ? { ...s, terrainData: regraded } : s));
                            }
                          }
                        }}
                      >
                        <coneGeometry args={[0.15, 0.25, 12]} />
                        <meshBasicMaterial color="#38bdf8" />
                      </mesh>
                      <mesh
                        position={[0, -0.4, 0]}
                        rotation={[Math.PI, 0, 0]}
                        onClick={(e) => {
                          e.stopPropagation();
                          const updated = [...road.points];
                          updated[idx] = [pt[0], pt[1] - 0.5, pt[2]];
                          updateTerrainModifier(road.id, { points: updated });
                          const terrainShape = shapes.find(s => s.type === 'terrain' && s.terrainData);
                          if (terrainShape) {
                            const regraded = applyRoadGradingToTerrain(terrainShape, { ...road, points: updated });
                            if (regraded) {
                              setShapes(prev => prev.map(s => s.id === terrainShape.id ? { ...s, terrainData: regraded } : s));
                            }
                          }
                        }}
                      >
                        <coneGeometry args={[0.15, 0.25, 12]} />
                        <meshBasicMaterial color="#38bdf8" />
                      </mesh>
                    </group>
                    {/* Elevation Label */}
                    <Html position={[0, -0.3, 0]} center distanceFactor={14} occlude={false}>
                      <div className="bg-black/80 text-white font-mono text-[9px] px-1.5 py-0.5 rounded border border-sky-500/50 shadow whitespace-nowrap select-none">
                        EL: {pt[1] >= 0 ? `+${pt[1].toFixed(2)}` : pt[1].toFixed(2)}m
                      </div>
                    </Html>
                  </group>
                ))}

                {/* Grade Segments & Warning Badges */}
                {segments.map((seg, sIdx) => (
                  <group key={sIdx}>
                    <Line
                      points={[seg.p1, seg.p2]}
                      color={seg.isViolated ? '#ef4444' : '#0ea5e9'}
                      lineWidth={seg.isViolated ? 4 : 2}
                    />
                    <Html position={seg.mid} center distanceFactor={16} occlude={false}>
                      <div
                        className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold shadow-xl border flex items-center gap-1 whitespace-nowrap select-none pointer-events-none transition-transform ${
                          seg.isViolated
                            ? 'bg-amber-950/90 text-amber-300 border-amber-500 animate-pulse ring-2 ring-amber-500/30'
                            : 'bg-zinc-900/85 text-emerald-400 border-emerald-500/40'
                        }`}
                      >
                        {seg.isViolated ? (
                          <AlertTriangle size={11} className="text-amber-400" />
                        ) : (
                          <CheckCircle2 size={11} className="text-emerald-400" />
                        )}
                        <span>{seg.grade.toFixed(1)}%</span>
                        {seg.isViolated && (
                          <span className="text-[9px] opacity-80 text-amber-200">
                            (Max {road.maxGradePercent}%)
                          </span>
                        )}
                      </div>
                    </Html>
                  </group>
                ))}

                {/* Bowtie / Hairpin Alignment Warnings */}
                {validation.warnings.length > 0 && road.points.length > 0 && (
                  <Html
                    position={[
                      road.points[0][0],
                      road.points[0][1] + 1.2,
                      road.points[0][2],
                    ]}
                    center
                    distanceFactor={16}
                  >
                    <div className="bg-red-950/95 text-red-200 border border-red-500/80 px-2.5 py-1 rounded-md text-[10px] font-medium shadow-2xl flex items-center gap-1.5 whitespace-nowrap animate-bounce">
                      <AlertTriangle size={12} className="text-red-400 shrink-0" />
                      <span>{validation.warnings[0]}</span>
                    </div>
                  </Html>
                )}
              </group>
            )}
          </group>
        );
      })}

      {/* 2. Active Spline Road Placement Draft */}
      {activeTool === 'road' && activeSplineDraft.length > 0 && (
        <group name="active-road-draft">
          {/* Real-time Swept Road Ribbon Preview */}
          {draftRibbonGeometry && (
            <mesh geometry={draftRibbonGeometry}>
              <meshStandardMaterial
                color="#0284c7"
                transparent
                opacity={0.65}
                roughness={0.4}
                side={THREE.DoubleSide}
              />
            </mesh>
          )}

          {/* Draft Spline Knots */}
          {activeSplineDraft.map((pt, idx) => (
            <group key={idx} position={pt}>
              <mesh>
                <sphereGeometry args={[0.2, 16, 16]} />
                <meshStandardMaterial
                  color={idx === 0 ? '#10b981' : '#0284c7'}
                  emissive={idx === 0 ? '#34d399' : '#38bdf8'}
                  emissiveIntensity={0.8}
                />
              </mesh>
              <Html position={[0, -0.3, 0]} center distanceFactor={14} occlude={false}>
                <div className="bg-zinc-900/90 text-cyan-300 font-mono text-[9px] px-1.5 py-0.5 rounded border border-cyan-500/60 shadow whitespace-nowrap select-none">
                  Knot {idx + 1}
                </div>
              </Html>
            </group>
          ))}

          {/* Draft Centerline Spline */}
          {activeSplineDraft.length >= 2 && (
            <Line
              points={evaluateCatmullRomSpline(activeSplineDraft, 12, false)}
              color="#38bdf8"
              lineWidth={3.5}
            />
          )}

          {/* Draft Road Markings Visualization */}
          {activeSplineDraft.length >= 2 && civilRoadSettings.markings !== 'none' && (
            <RoadMarkingsOverlay
              sampledPoints={evaluateCatmullRomSpline(activeSplineDraft, 12, false)}
              width={civilRoadSettings.width}
              preset={civilRoadSettings.markings}
            />
          )}

          {/* Grade Warning Badges between Placed Draft Knots */}
          {draftGradeSegments.map((seg, sIdx) => (
            <group key={sIdx}>
              <Html position={seg.mid} center distanceFactor={16} occlude={false}>
                <div
                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold shadow-xl border flex items-center gap-1 whitespace-nowrap select-none pointer-events-none ${
                    seg.isViolated
                      ? 'bg-amber-950/90 text-amber-300 border-amber-500 animate-pulse'
                      : 'bg-zinc-900/90 text-emerald-400 border-emerald-500/40'
                  }`}
                >
                  {seg.isViolated ? (
                    <AlertTriangle size={11} className="text-amber-400" />
                  ) : (
                    <CheckCircle2 size={11} className="text-emerald-400" />
                  )}
                  <span>Slope: {seg.grade.toFixed(1)}%</span>
                  {seg.isViolated && (
                    <span className="text-[9px] opacity-80 text-amber-200">
                      (Exceeds {civilRoadSettings.maxGradePercent}%)
                    </span>
                  )}
                </div>
              </Html>
            </group>
          ))}

          {/* User Guide Pill at Last Placed Knot */}
          {activeSplineDraft.length > 0 && (
            <Html
              position={[
                activeSplineDraft[activeSplineDraft.length - 1][0],
                activeSplineDraft[activeSplineDraft.length - 1][1] + 0.8,
                activeSplineDraft[activeSplineDraft.length - 1][2],
              ]}
              center
              distanceFactor={18}
              occlude={false}
            >
              <div className={`px-2.5 py-1 rounded-full text-[11px] shadow-2xl flex items-center gap-2 whitespace-nowrap select-none border ${
                draftValidation && !draftValidation.isValid
                  ? 'bg-amber-950/95 text-amber-200 border-amber-500/80'
                  : 'bg-zinc-900/95 text-zinc-200 border-zinc-700/80'
              }`}>
                {draftValidation && !draftValidation.isValid ? (
                  <AlertTriangle size={12} className="text-amber-400 shrink-0 animate-pulse" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                )}
                <span>
                  {draftValidation && !draftValidation.isValid
                    ? draftValidation.warnings[0]
                    : activeSplineDraft.length === 1
                    ? 'Click to place next road knot'
                    : 'Click to extend • Double-click / Enter to finish'}
                </span>
              </div>
            </Html>
          )}
        </group>
      )}
    </group>
  );
}

/**
 * Procedural Road Markings (Center dashed, solid, bike lanes, pedestrian walkway)
 * Enhanced with 3D normal frame alignment, physical offset, and dual line + ribbon geometry
 * to guarantee high visibility across all zoom levels and angles without z-fighting.
 */
function RoadMarkingsOverlay({
  sampledPoints,
  width,
  preset,
}: {
  sampledPoints: [number, number, number][];
  width: number;
  preset: RoadMarkingPreset;
}) {
  if (preset === 'none' || !sampledPoints || sampledPoints.length < 2) return null;

  const halfW = width * 0.5;
  const up = new THREE.Vector3(0, 1, 0);

  // Compute 3D frames (tangent, right, normal) and cumulative distance along spline
  const { frames } = useMemo(() => {
    const list: Array<{
      pos: THREE.Vector3;
      tangent: THREE.Vector3;
      right: THREE.Vector3;
      normal: THREE.Vector3;
      s: number;
    }> = [];

    let cumDist = 0;
    for (let i = 0; i < sampledPoints.length; i++) {
      const pos = new THREE.Vector3(...sampledPoints[i]);
      const tangent = new THREE.Vector3();

      if (i === 0) {
        tangent.subVectors(new THREE.Vector3(...sampledPoints[1]), pos);
      } else if (i === sampledPoints.length - 1) {
        tangent.subVectors(pos, new THREE.Vector3(...sampledPoints[i - 1]));
      } else {
        tangent.subVectors(new THREE.Vector3(...sampledPoints[i + 1]), new THREE.Vector3(...sampledPoints[i - 1]));
      }
      tangent.normalize();

      // Right vector perpendicular to tangent and world up
      let right = new THREE.Vector3().crossVectors(up, tangent).normalize();
      if (right.lengthSq() < 0.001) {
        right = new THREE.Vector3(1, 0, 0);
      }
      // Normal vector perpendicular to surface
      const normal = new THREE.Vector3().crossVectors(tangent, right).normalize();

      if (i > 0) {
        const prev = new THREE.Vector3(...sampledPoints[i - 1]);
        cumDist += pos.distanceTo(prev);
      }

      list.push({ pos, tangent, right, normal, s: cumDist });
    }

    return { frames: list };
  }, [sampledPoints]);

  // Centerline points elevated above road pavement (45mm above subgrade)
  const centerlinePoints = useMemo(() => {
    return frames.map(f => {
      const p = f.pos.clone().addScaledVector(f.normal, 0.045);
      return [p.x, p.y, p.z] as [number, number, number];
    });
  }, [frames]);

  // Generate dashed segments (2.0m dash, 1.4m gap)
  const dashedSegments = useMemo(() => {
    if (preset !== 'center-dashed' && preset !== 'bike-lanes') return [];
    const segments: Array<[number, number, number][]> = [];
    let currentSeg: [number, number, number][] = [];
    const cycle = 3.4;
    const dashLen = 2.0;

    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const modS = f.s % cycle;
      const isDash = modS <= dashLen;
      const pt = f.pos.clone().addScaledVector(f.normal, 0.045);
      const coord: [number, number, number] = [pt.x, pt.y, pt.z];

      if (isDash) {
        currentSeg.push(coord);
      } else {
        if (currentSeg.length >= 2) {
          segments.push(currentSeg);
        }
        currentSeg = [];
      }
    }
    if (currentSeg.length >= 2) {
      segments.push(currentSeg);
    }
    return segments;
  }, [frames, preset]);

  // Lane offsets for bike lanes and walkways
  const { leftLane, rightLane } = useMemo(() => {
    const ll: [number, number, number][] = [];
    const rl: [number, number, number][] = [];
    for (const f of frames) {
      const pLeft = f.pos.clone().addScaledVector(f.right, -halfW * 0.78).addScaledVector(f.normal, 0.045);
      const pRight = f.pos.clone().addScaledVector(f.right, halfW * 0.78).addScaledVector(f.normal, 0.045);
      ll.push([pLeft.x, pLeft.y, pLeft.z]);
      rl.push([pRight.x, pRight.y, pRight.z]);
    }
    return { leftLane: ll, rightLane: rl };
  }, [frames, halfW]);

  // Center solid ribbon mesh geometry (18cm wide painted line)
  const centerStripeMesh = useMemo(() => {
    if (preset !== 'center-solid') return null;
    const geom = new THREE.BufferGeometry();
    const positions: number[] = [];
    const stripeHalfW = 0.09;

    for (const f of frames) {
      const p1 = f.pos.clone().addScaledVector(f.right, -stripeHalfW).addScaledVector(f.normal, 0.04);
      const p2 = f.pos.clone().addScaledVector(f.right, stripeHalfW).addScaledVector(f.normal, 0.04);
      positions.push(p1.x, p1.y, p1.z);
      positions.push(p2.x, p2.y, p2.z);
    }

    const indices: number[] = [];
    for (let i = 0; i < frames.length - 1; i++) {
      const p00 = i * 2;
      const p01 = i * 2 + 1;
      const p10 = (i + 1) * 2;
      const p11 = (i + 1) * 2 + 1;
      indices.push(p00, p01, p11);
      indices.push(p00, p11, p10);
    }

    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    return geom;
  }, [frames, preset]);

  // Bike lane ribbon meshes
  const { leftBikeGeom, rightBikeGeom } = useMemo(() => {
    if (preset !== 'bike-lanes') return { leftBikeGeom: null, rightBikeGeom: null };
    const bikeW = Math.min(1.0, halfW * 0.28);
    const lg = new THREE.BufferGeometry();
    const rg = new THREE.BufferGeometry();
    const lPos: number[] = [];
    const rPos: number[] = [];

    for (const f of frames) {
      const lp1 = f.pos.clone().addScaledVector(f.right, -halfW + 0.05).addScaledVector(f.normal, 0.038);
      const lp2 = f.pos.clone().addScaledVector(f.right, -halfW + 0.05 + bikeW).addScaledVector(f.normal, 0.038);
      lPos.push(lp1.x, lp1.y, lp1.z, lp2.x, lp2.y, lp2.z);

      const rp1 = f.pos.clone().addScaledVector(f.right, halfW - 0.05 - bikeW).addScaledVector(f.normal, 0.038);
      const rp2 = f.pos.clone().addScaledVector(f.right, halfW - 0.05).addScaledVector(f.normal, 0.038);
      rPos.push(rp1.x, rp1.y, rp1.z, rp2.x, rp2.y, rp2.z);
    }

    const indices: number[] = [];
    for (let i = 0; i < frames.length - 1; i++) {
      indices.push(i * 2, i * 2 + 1, (i + 1) * 2 + 1);
      indices.push(i * 2, (i + 1) * 2 + 1, (i + 1) * 2);
    }

    lg.setAttribute('position', new THREE.Float32BufferAttribute(lPos, 3));
    lg.setIndex(indices);
    lg.computeVertexNormals();

    rg.setAttribute('position', new THREE.Float32BufferAttribute(rPos, 3));
    rg.setIndex(indices);
    rg.computeVertexNormals();

    return { leftBikeGeom: lg, rightBikeGeom: rg };
  }, [frames, halfW, preset]);

  // Pedestrian walkway ribbon mesh
  const walkwayGeom = useMemo(() => {
    if (preset !== 'pedestrian-walkway') return null;
    const walkW = Math.min(1.4, halfW * 0.35);
    const wg = new THREE.BufferGeometry();
    const pos: number[] = [];

    for (const f of frames) {
      const p1 = f.pos.clone().addScaledVector(f.right, halfW - 0.05 - walkW).addScaledVector(f.normal, 0.038);
      const p2 = f.pos.clone().addScaledVector(f.right, halfW - 0.05).addScaledVector(f.normal, 0.038);
      pos.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }

    const indices: number[] = [];
    for (let i = 0; i < frames.length - 1; i++) {
      indices.push(i * 2, i * 2 + 1, (i + 1) * 2 + 1);
      indices.push(i * 2, (i + 1) * 2 + 1, (i + 1) * 2);
    }

    wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    wg.setIndex(indices);
    wg.computeVertexNormals();
    return wg;
  }, [frames, halfW, preset]);

  return (
    <group name="road-markings-overlay">
      {/* 1. Center Dashed Marking */}
      {preset === 'center-dashed' && (
        <group>
          {dashedSegments.map((seg, idx) => (
            <Line
              key={idx}
              points={seg}
              color="#fbbf24"
              lineWidth={4.5}
              polygonOffset
              polygonOffsetFactor={-8}
              polygonOffsetUnits={-8}
            />
          ))}
        </group>
      )}

      {/* 2. Center Solid Marking */}
      {preset === 'center-solid' && (
        <group>
          {centerStripeMesh && (
            <mesh geometry={centerStripeMesh}>
              <meshStandardMaterial
                color="#facc15"
                emissive="#ca8a04"
                emissiveIntensity={0.35}
                roughness={0.4}
                polygonOffset
                polygonOffsetFactor={-6}
                polygonOffsetUnits={-6}
                side={THREE.DoubleSide}
              />
            </mesh>
          )}
          <Line
            points={centerlinePoints}
            color="#fbbf24"
            lineWidth={4.5}
            polygonOffset
            polygonOffsetFactor={-8}
            polygonOffsetUnits={-8}
          />
        </group>
      )}

      {/* 3. Dual Bike Lanes Marking */}
      {preset === 'bike-lanes' && (
        <group>
          {dashedSegments.map((seg, idx) => (
            <Line
              key={idx}
              points={seg}
              color="#ffffff"
              lineWidth={3.5}
              polygonOffset
              polygonOffsetFactor={-8}
              polygonOffsetUnits={-8}
            />
          ))}
          {leftBikeGeom && (
            <mesh geometry={leftBikeGeom}>
              <meshStandardMaterial
                color="#059669"
                emissive="#065f46"
                emissiveIntensity={0.25}
                roughness={0.5}
                polygonOffset
                polygonOffsetFactor={-4}
                polygonOffsetUnits={-4}
                side={THREE.DoubleSide}
              />
            </mesh>
          )}
          {rightBikeGeom && (
            <mesh geometry={rightBikeGeom}>
              <meshStandardMaterial
                color="#059669"
                emissive="#065f46"
                emissiveIntensity={0.25}
                roughness={0.5}
                polygonOffset
                polygonOffsetFactor={-4}
                polygonOffsetUnits={-4}
                side={THREE.DoubleSide}
              />
            </mesh>
          )}
          <Line points={leftLane} color="#10b981" lineWidth={4} polygonOffset polygonOffsetFactor={-8} polygonOffsetUnits={-8} />
          <Line points={rightLane} color="#10b981" lineWidth={4} polygonOffset polygonOffsetFactor={-8} polygonOffsetUnits={-8} />
        </group>
      )}

      {/* 4. Pedestrian Walkway Ribbon Marking */}
      {preset === 'pedestrian-walkway' && (
        <group>
          <Line points={centerlinePoints} color="#fbbf24" lineWidth={3.5} polygonOffset polygonOffsetFactor={-8} polygonOffsetUnits={-8} />
          {walkwayGeom && (
            <mesh geometry={walkwayGeom}>
              <meshStandardMaterial
                color="#0284c7"
                emissive="#0369a1"
                emissiveIntensity={0.25}
                roughness={0.5}
                polygonOffset
                polygonOffsetFactor={-4}
                polygonOffsetUnits={-4}
                side={THREE.DoubleSide}
              />
            </mesh>
          )}
          <Line points={rightLane} color="#38bdf8" lineWidth={5} polygonOffset polygonOffsetFactor={-8} polygonOffsetUnits={-8} />
        </group>
      )}
    </group>
  );
}
