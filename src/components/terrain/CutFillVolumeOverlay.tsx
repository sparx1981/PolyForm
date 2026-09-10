/**
 * PolyForm Terrain Studio - Cut & Fill Volumetric Overlay
 * Renders translucent cut (orange) and fill (cyan) earthwork volume columns
 * based on active civil terrain modifiers (pads, roads) evaluated against the terrain.
 */

import React, { useMemo, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { useApp } from '../../AppContext';
import { TerrainRasterWorkerInput, TerrainRasterWorkerOutput } from '../../workers/terrainRasterWorker';
import { dispatchTerrainRasterWithWatchdog } from '../../lib/terrain/workerWatchdog';

export default function CutFillVolumeOverlay() {
  const { 
    terrainModifiers, 
    shapes, 
    cutFillMetrics, 
    setCutFillMetrics, 
    setViewportToast,
    showCutFillOverlay
  } = useApp();

  if (!showCutFillOverlay) {
    return null;
  }

  // Find terrain mesh if one exists in the scene
  const terrainShape = useMemo(() => {
    return shapes.find((s) => s.type === 'terrain' && !s.hidden);
  }, [shapes]);

  // Determine computation grid bounds and base elevations
  const rasterInput = useMemo<TerrainRasterWorkerInput | null>(() => {
    const activeMods = terrainModifiers.filter((m) => m.enabled);
    if (activeMods.length === 0) return null;

    if (terrainShape && terrainShape.terrainData) {
      const td = terrainShape.terrainData;
      const gridX = Math.min(64, Math.max(16, td.gridX || 40));
      const gridY = Math.min(64, Math.max(16, td.gridY || 40));
      const width = td.width || 40;
      const depth = td.depth || 40;
      const heights = td.heights || new Float32Array(gridX * gridY);

      return {
        gridWidth: gridX,
        gridDepth: gridY,
        bounds: {
          minX: -width / 2,
          maxX: width / 2,
          minZ: -depth / 2,
          maxZ: depth / 2,
        },
        baseHeights: heights,
        modifiers: activeMods,
      };
    }

    // Default fallback grid if no terrain shape exists yet
    const defaultGrid = 40;
    const defaultExtent = 40;
    const baseH = new Float32Array(defaultGrid * defaultGrid);

    return {
      gridWidth: defaultGrid,
      gridDepth: defaultGrid,
      bounds: {
        minX: -defaultExtent / 2,
        maxX: defaultExtent / 2,
        minZ: -defaultExtent / 2,
        maxZ: defaultExtent / 2,
      },
      baseHeights: baseH,
      modifiers: activeMods,
    };
  }, [terrainShape, terrainModifiers]);

  // Compute terrain rasterization using 4-second watchdog
  const [rasterResult, setRasterResult] = useState<TerrainRasterWorkerOutput | null>(null);

  useEffect(() => {
    if (!rasterInput) {
      setRasterResult(null);
      return;
    }

    let isMounted = true;
    dispatchTerrainRasterWithWatchdog(rasterInput, (warningMsg) => {
      if (isMounted) {
        setViewportToast(warningMsg);
      }
    }).then((result) => {
      if (isMounted) {
        setRasterResult(result);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [rasterInput, setViewportToast]);

  // Update AppContext metrics whenever raster changes
  const prevMetricsRef = useRef<string>('');
  useEffect(() => {
    if (!rasterResult) {
      const emptyMetrics = {
        cutVolumeM3: 0,
        fillVolumeM3: 0,
        netVolumeM3: 0,
        cutAreaM2: 0,
        fillAreaM2: 0,
      };
      const key = JSON.stringify(emptyMetrics);
      if (prevMetricsRef.current !== key) {
        prevMetricsRef.current = key;
        setCutFillMetrics(emptyMetrics);
      }
      return;
    }

    const key = JSON.stringify(rasterResult.metrics);
    if (prevMetricsRef.current !== key) {
      prevMetricsRef.current = key;
      setCutFillMetrics(rasterResult.metrics);
    }
  }, [rasterResult, setCutFillMetrics]);

  // Generate 3D Volumetric Meshes for Cut (Orange) and Fill (Cyan)
  const { cutGeo, fillGeo, cutCentroid, fillCentroid } = useMemo(() => {
    if (!rasterInput || !rasterResult) {
      return { cutGeo: null, fillGeo: null, cutCentroid: null, fillCentroid: null };
    }

    const { gridWidth, gridDepth, bounds, baseHeights } = rasterInput;
    const { modifiedHeights, diffHeights } = rasterResult;

    const rangeX = bounds.maxX - bounds.minX;
    const rangeZ = bounds.maxZ - bounds.minZ;
    const stepX = rangeX / Math.max(1, gridWidth - 1);
    const stepZ = rangeZ / Math.max(1, gridDepth - 1);

    const cutPos: number[] = [];
    const fillPos: number[] = [];

    let cutSumX = 0, cutSumY = 0, cutSumZ = 0, cutCount = 0;
    let fillSumX = 0, fillSumY = 0, fillSumZ = 0, fillCount = 0;

    // Helper to push a quad (two triangles)
    const addQuad = (
      arr: number[],
      p1: [number, number, number],
      p2: [number, number, number],
      p3: [number, number, number],
      p4: [number, number, number]
    ) => {
      // Tri 1: p1, p2, p3
      arr.push(p1[0], p1[1], p1[2]);
      arr.push(p2[0], p2[1], p2[2]);
      arr.push(p3[0], p3[1], p3[2]);
      // Tri 2: p1, p3, p4
      arr.push(p1[0], p1[1], p1[2]);
      arr.push(p3[0], p3[1], p3[2]);
      arr.push(p4[0], p4[1], p4[2]);
    };

    const threshold = 0.02;

    for (let iz = 0; iz < gridDepth - 1; iz++) {
      const z0 = bounds.minZ + iz * stepZ;
      const z1 = z0 + stepZ;
      const row0 = iz * gridWidth;
      const row1 = (iz + 1) * gridWidth;

      for (let ix = 0; ix < gridWidth - 1; ix++) {
        const x0 = bounds.minX + ix * stepX;
        const x1 = x0 + stepX;

        const i00 = row0 + ix;
        const i10 = row0 + (ix + 1);
        const i01 = row1 + ix;
        const i11 = row1 + (ix + 1);

        const diffAvg = (diffHeights[i00] + diffHeights[i10] + diffHeights[i01] + diffHeights[i11]) / 4;

        if (diffAvg < -threshold) {
          // CUT VOLUME: existing ground is higher than graded ground
          const base00 = baseHeights[i00] ?? 0;
          const base10 = baseHeights[i10] ?? 0;
          const base01 = baseHeights[i01] ?? 0;
          const base11 = baseHeights[i11] ?? 0;

          const mod00 = modifiedHeights[i00] ?? base00;
          const mod10 = modifiedHeights[i10] ?? base10;
          const mod01 = modifiedHeights[i01] ?? base01;
          const mod11 = modifiedHeights[i11] ?? base11;

          // Top face (original terrain surface)
          addQuad(
            cutPos,
            [x0, base00, z0],
            [x1, base10, z0],
            [x1, base11, z1],
            [x0, base01, z1]
          );

          // Bottom face (excavated pad/road surface)
          addQuad(
            cutPos,
            [x0, mod01, z1],
            [x1, mod11, z1],
            [x1, mod10, z0],
            [x0, mod00, z0]
          );

          // Skirt side faces connecting upper & lower surfaces
          addQuad(cutPos, [x0, mod00, z0], [x1, mod10, z0], [x1, base10, z0], [x0, base00, z0]); // North
          addQuad(cutPos, [x1, mod10, z0], [x1, mod11, z1], [x1, base11, z1], [x1, base10, z0]); // East
          addQuad(cutPos, [x1, mod11, z1], [x0, mod01, z1], [x0, base01, z1], [x1, base11, z1]); // South
          addQuad(cutPos, [x0, mod01, z1], [x0, mod00, z0], [x0, base00, z0], [x0, base01, z1]); // West

          const avgX = (x0 + x1) * 0.5;
          const avgZ = (z0 + z1) * 0.5;
          const avgY = (base00 + mod00) * 0.5;
          cutSumX += avgX;
          cutSumY += avgY;
          cutSumZ += avgZ;
          cutCount++;
        } else if (diffAvg > threshold) {
          // FILL VOLUME: graded ground is higher than existing ground
          const base00 = baseHeights[i00] ?? 0;
          const base10 = baseHeights[i10] ?? 0;
          const base01 = baseHeights[i01] ?? 0;
          const base11 = baseHeights[i11] ?? 0;

          const mod00 = modifiedHeights[i00] ?? base00;
          const mod10 = modifiedHeights[i10] ?? base10;
          const mod01 = modifiedHeights[i01] ?? base01;
          const mod11 = modifiedHeights[i11] ?? base11;

          // Top face (fill embankment surface)
          addQuad(
            fillPos,
            [x0, mod00, z0],
            [x1, mod10, z0],
            [x1, mod11, z1],
            [x0, mod01, z1]
          );

          // Bottom face (original terrain surface)
          addQuad(
            fillPos,
            [x0, base01, z1],
            [x1, base11, z1],
            [x1, base10, z0],
            [x0, base00, z0]
          );

          // Skirt side faces
          addQuad(fillPos, [x0, base00, z0], [x1, base10, z0], [x1, mod10, z0], [x0, mod00, z0]); // North
          addQuad(fillPos, [x1, base10, z0], [x1, base11, z1], [x1, mod11, z1], [x1, mod10, z0]); // East
          addQuad(fillPos, [x1, base11, z1], [x0, base01, z1], [x0, mod01, z1], [x1, mod11, z1]); // South
          addQuad(fillPos, [x0, base01, z1], [x0, base00, z0], [x0, mod00, z0], [x0, mod01, z1]); // West

          const avgX = (x0 + x1) * 0.5;
          const avgZ = (z0 + z1) * 0.5;
          const avgY = (base00 + mod00) * 0.5;
          fillSumX += avgX;
          fillSumY += avgY;
          fillSumZ += avgZ;
          fillCount++;
        }
      }
    }

    let cutGeometry: THREE.BufferGeometry | null = null;
    if (cutPos.length > 0) {
      cutGeometry = new THREE.BufferGeometry();
      cutGeometry.setAttribute('position', new THREE.Float32BufferAttribute(cutPos, 3));
      cutGeometry.computeVertexNormals();
    }

    let fillGeometry: THREE.BufferGeometry | null = null;
    if (fillPos.length > 0) {
      fillGeometry = new THREE.BufferGeometry();
      fillGeometry.setAttribute('position', new THREE.Float32BufferAttribute(fillPos, 3));
      fillGeometry.computeVertexNormals();
    }

    const cutC: [number, number, number] | null =
      cutCount > 0 ? [cutSumX / cutCount, cutSumY / cutCount + 0.8, cutSumZ / cutCount] : null;
    const fillC: [number, number, number] | null =
      fillCount > 0 ? [fillSumX / fillCount, fillSumY / fillCount + 0.8, fillSumZ / fillCount] : null;

    return {
      cutGeo: cutGeometry,
      fillGeo: fillGeometry,
      cutCentroid: cutC,
      fillCentroid: fillC,
    };
  }, [rasterInput, rasterResult]);

  const terrainPos: [number, number, number] = terrainShape
    ? [terrainShape.position[0], terrainShape.position[1], terrainShape.position[2]]
    : [0, 0, 0];

  if (!cutGeo && !fillGeo) {
    return null;
  }

  return (
    <group name="cut-fill-volume-overlay" position={terrainPos}>
      {/* Cut Volume: Translucent Orange (#f97316) */}
      {cutGeo && (
        <group>
          <mesh geometry={cutGeo}>
            <meshStandardMaterial
              color="#f97316"
              emissive="#c2410c"
              emissiveIntensity={0.25}
              roughness={0.4}
              metalness={0.1}
              transparent
              opacity={0.55}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
          {/* Subtle Wireframe Skirt Edges */}
          <mesh geometry={cutGeo}>
            <meshBasicMaterial
              color="#ea580c"
              wireframe
              transparent
              opacity={0.3}
              depthWrite={false}
            />
          </mesh>
        </group>
      )}

      {/* Fill Volume: Translucent Cyan (#06b6d4) */}
      {fillGeo && (
        <group>
          <mesh geometry={fillGeo}>
            <meshStandardMaterial
              color="#06b6d4"
              emissive="#0891b2"
              emissiveIntensity={0.25}
              roughness={0.4}
              metalness={0.1}
              transparent
              opacity={0.55}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
          {/* Subtle Wireframe Skirt Edges */}
          <mesh geometry={fillGeo}>
            <meshBasicMaterial
              color="#0284c7"
              wireframe
              transparent
              opacity={0.3}
              depthWrite={false}
            />
          </mesh>
        </group>
      )}

      {/* Centroid Earthwork HUD Badges */}
      {cutCentroid && cutFillMetrics?.cutVolumeM3 > 0.5 && (
        <Html position={cutCentroid} center distanceFactor={16} occlude={false}>
          <div className="bg-amber-950/80 backdrop-blur-md text-amber-300 border border-amber-500/60 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold shadow-lg whitespace-nowrap pointer-events-none select-none flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            <span>Cut: {cutFillMetrics.cutVolumeM3.toFixed(1)} m³</span>
          </div>
        </Html>
      )}

      {fillCentroid && cutFillMetrics?.fillVolumeM3 > 0.5 && (
        <Html position={fillCentroid} center distanceFactor={16} occlude={false}>
          <div className="bg-cyan-950/80 backdrop-blur-md text-cyan-300 border border-cyan-500/60 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold shadow-lg whitespace-nowrap pointer-events-none select-none flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
            <span>Fill: {cutFillMetrics.fillVolumeM3.toFixed(1)} m³</span>
          </div>
        </Html>
      )}
    </group>
  );
}
