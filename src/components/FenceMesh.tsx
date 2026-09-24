import React, { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { Shape } from '../types';
import { useApp } from '../AppContext';
import { sampleTerrainElevation } from '../lib/archRoomAssembly';
import { fenceMaterials } from '../lib/fence/splitRail/zaun-material.js';
import { requestFenceBuild } from '../lib/fence/fenceWorkerClient';
import { PathEditHandles } from './PathEditHandles';
import type { FenceBatch, TerrainSnapshot } from '../lib/fence/fenceTypes';

type Materials = Record<FenceBatch['kind'], THREE.MeshStandardMaterial>;
let sharedMaterials: Materials | null = null;
let highlightMaterials: Materials | null = null;

/** Procedural timber, end grain, stone and metal, created once and shared by every fence. */
function materials(selected: boolean): Materials {
  if (!sharedMaterials) {
    sharedMaterials = fenceMaterials(THREE) as Materials;
    highlightMaterials = Object.fromEntries(Object.entries(sharedMaterials).map(([kind, material]) => {
      const clone = material.clone();
      clone.emissive.set('#0063A3'); clone.emissiveIntensity = 0.35;
      return [kind, clone];
    })) as Materials;
  }
  return selected ? highlightMaterials! : sharedMaterials;
}

/** The fence's transform; its saved points are relative to it. */
export function fenceMatrix(shape: Shape): THREE.Matrix4 {
  const quaternion = shape.quaternion ? new THREE.Quaternion(...shape.quaternion)
    : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(shape.rotation || [0, 0, 0])));
  return new THREE.Matrix4().compose(new THREE.Vector3(...shape.position), quaternion, new THREE.Vector3(...(shape.scale || [1, 1, 1])));
}

export function fenceWorldPoints(shape: Shape): [number, number][] {
  const matrix = fenceMatrix(shape), p = new THREE.Vector3();
  return (shape.fenceData?.points ?? []).map(([x, z]) => {
    p.set(x, 0, z).applyMatrix4(matrix);
    return [p.x, p.z];
  });
}

/** Terrain heights on a square grid around the fence (4 m margin), for the builder. */
export function fenceTerrainSnapshot(points: [number, number][], terrain: Shape | undefined): TerrainSnapshot | null {
  if (!terrain?.terrainData || points.length === 0) return null;
  const margin = 4;
  const xs = points.map(p => p[0]), zs = points.map(p => p[1]);
  const x = Math.min(...xs) - margin, z = Math.min(...zs) - margin;
  const width = Math.max(...xs) + margin - x, depth = Math.max(...zs) + margin - z;
  // Half-metre cells, coarser only for very large fences (the builder caps at 300k samples).
  const step = Math.max(0.5, Math.sqrt((width * depth) / 200_000));
  const columns = Math.ceil(width / step) + 1, rows = Math.ceil(depth / step) + 1;
  const heights = new Float32Array(columns * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    heights[j * columns + i] = sampleTerrainElevation(x + i * step, z + j * step, terrain);
  }
  return { x, z, step, columns, rows, heights };
}

/** The terrain a fence stands on: the one whose footprint contains its first point. */
export function terrainUnder(points: [number, number][], shapes: Shape[]): Shape | undefined {
  const [px, pz] = points[0] ?? [0, 0];
  return shapes.find(s => s.type === 'terrain' && !s.hidden && s.terrainData
    && Math.abs(px - s.position[0]) <= (s.terrainData.width ?? 0) / 2
    && Math.abs(pz - s.position[2]) <= (s.terrainData.depth ?? 0) / 2);
}

interface Props {
  shape: Shape;
  terrain: Shape | undefined;
  selected: boolean;
  meshProps: any;
  selectionHighlight?: React.ReactNode;
}

/**
 * A whole fence run built by the fence generator. Geometry is built in world space (so posts
 * and rails meet the real terrain) and shown inside the shape's transform, so moving or
 * rotating the fence works with the usual gizmo and rebuilds it against the new ground.
 */
export function FenceMesh({ shape, terrain, selected, meshProps, selectionHighlight }: Props) {
  const { diagLog } = useApp();
  const [batches, setBatches] = useState<FenceBatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = shape.fenceData!;
  const buildKey = JSON.stringify([data, shape.position, shape.rotation, shape.quaternion, shape.scale]);
  const worldPoints = useMemo(() => fenceWorldPoints(shape), [buildKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    const snapshot = fenceTerrainSnapshot(worldPoints, terrain);
    requestFenceBuild(data, snapshot, terrain?.position[1] ?? 0).then(result => {
      if (cancelled) return;
      if (result.ok) {
        setBatches(result.batches); setError(null);
        diagLog('RENDER', `Fence built: ${shape.name || shape.id}`, { style: data.style, length: Math.round(result.length * 10) / 10, ms: Math.round(result.ms) });
      } else {
        // Keep the last good fence on screen; show why the new one couldn't be built.
        setError(result.error);
        diagLog('ERROR', `Fence could not be built: ${result.error}`, { shapeId: shape.id, style: data.style });
      }
    });
    return () => { cancelled = true; };
  }, [buildKey, terrain?.terrainData?.heights, terrain?.position]); // eslint-disable-line react-hooks/exhaustive-deps

  const meshes = useMemo(() => (batches ?? []).map(batch => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(batch.positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(batch.uvs, 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(batch.colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return { kind: batch.kind, geometry };
  }), [batches]);
  useEffect(() => () => meshes.forEach(mesh => mesh.geometry.dispose()), [meshes]);

  // Before the first build finishes (or if it fails), show the path so the fence is still visible and selectable.
  const outline = useMemo(() => {
    if (meshes.length && !error) return null;
    const inverse = fenceMatrix(shape).invert();
    const pts = worldPoints.map(([x, z]) => new THREE.Vector3(x, sampleTerrainElevation(x, z, terrain ?? shape) + 0.05, z).applyMatrix4(inverse));
    if (data.closed && pts.length > 2) pts.push(pts[0].clone());
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: error ? '#ef4444' : '#854d0e' }));
    line.userData = { isShape: true, id: shape.id };
    return line;
  }, [meshes.length, error, worldPoints]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { outline?.geometry.dispose(); (outline?.material as THREE.Material | undefined)?.dispose(); }, [outline]);

  // The triangles stay in world space and this undoes the fence's own transform, so a build
  // made for an earlier path still shows where it was built (never shifted by a moved centre)
  // until the new one replaces it, while dragging the fence still carries it along.
  const worldToLocal = useMemo(() => fenceMatrix(shape).invert(), [buildKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = materials(selected);
  return (
    <group {...meshProps}>
      <group matrixAutoUpdate={false} matrix={worldToLocal}>
        {meshes.map(mesh => (
          <mesh key={mesh.kind} geometry={mesh.geometry} material={set[mesh.kind]}
            castShadow={meshProps.castShadow} receiveShadow={meshProps.receiveShadow}
            userData={{ isShape: true, id: shape.id }} />
        ))}
      </group>
      {outline && <primitive object={outline} />}
      {selectionHighlight}
    </group>
  );
}

/** Corner handles for a selected fence; see PathEditHandles. */
export function FenceEditHandles({ shape, terrain }: { shape: Shape; terrain: Shape | undefined }) {
  const { setShapes } = useApp();
  const data = shape.fenceData!;
  return (
    <PathEditHandles
      points={fenceWorldPoints(shape)}
      closed={Boolean(data.closed)}
      minPoints={2}
      groundAt={(x, z) => sampleTerrainElevation(x, z, terrain ?? shape)}
      onCommit={(points, closed) => {
        const inverse = fenceMatrix(shape).invert(), p = new THREE.Vector3();
        const local = points.map(([x, z]) => { p.set(x, 0, z).applyMatrix4(inverse); return [p.x, p.z] as [number, number]; });
        setShapes(prev => prev.map(s => s.id === shape.id ? { ...s, fenceData: { ...data, points: local, closed } } : s));
      }}
    />
  );
}
