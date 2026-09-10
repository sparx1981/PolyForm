/**
 * PolyForm Terrain Studio - Civil 3D Exporter
 * Implements full baking and export to standard 3D formats (GLB & OBJ wavefront)
 * with vertex normal recalculation and civil planar UV projection mapping.
 */

import * as THREE from 'three';
// @ts-ignore
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';
// @ts-ignore
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter';
import type { TerrainModifier, RoadModifier, PadModifier } from '../../types';
import { generateRoadRibbonGeometry } from './roadGeometry';
import { sanitizeElevation } from './math';

export interface TerrainExportOptions {
  includeCutFill?: boolean;
  uvScaleMeters?: number;
}

/**
 * Applies civil planar projection mapping (XZ plane) to geometry UV attribute.
 * Maps coordinates so 1 UV tile spans uvScaleMeters (default 10.0m).
 */
export function applyCivilUVProjection(
  geometry: THREE.BufferGeometry,
  uvScaleMeters: number = 10.0
): void {
  const posAttr = geometry.getAttribute('position');
  if (!posAttr) return;

  const count = posAttr.count;
  const uvs = new Float32Array(count * 2);
  const scale = Math.max(0.1, uvScaleMeters);

  for (let i = 0; i < count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    uvs[i * 2] = x / scale;
    uvs[i * 2 + 1] = z / scale;
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
}

/**
 * Prepares evaluated terrain geometry with clean vertex normals, sanitized elevations,
 * and civil planar UV coordinates.
 */
export function prepareTerrainGeometry(
  evaluatedGeometry: THREE.BufferGeometry,
  uvScaleMeters: number = 10.0
): THREE.BufferGeometry {
  const geo = evaluatedGeometry.clone();

  // Sanitize vertex elevations if necessary
  const posAttr = geo.getAttribute('position');
  if (posAttr) {
    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i);
      posAttr.setY(i, sanitizeElevation(y));
    }
    posAttr.needsUpdate = true;
  }

  geo.computeVertexNormals();
  applyCivilUVProjection(geo, uvScaleMeters);
  return geo;
}

/**
 * Exports evaluated civil terrain mesh as an OBJ wavefront string.
 * Uses Three.js OBJExporter with vertex normals and civil UV coordinates.
 */
export function exportTerrainToOBJ(evaluatedGeometry: THREE.BufferGeometry): string {
  const cleanGeo = prepareTerrainGeometry(evaluatedGeometry, 10.0);
  const terrainMaterial = new THREE.MeshStandardMaterial({
    name: 'Civil_Terrain_Surface',
    color: 0x64748b,
    roughness: 0.9,
    metalness: 0.05,
  });

  const terrainMesh = new THREE.Mesh(cleanGeo, terrainMaterial);
  terrainMesh.name = 'Civil_Terrain_Mesh';

  const exporter = new OBJExporter();
  return exporter.parse(terrainMesh);
}

/**
 * Exports evaluated civil terrain and active modifiers into a standard binary GLB container.
 * Optionally includes volumetric cut/fill inspection solids and road ribbons.
 */
export async function exportTerrainToGLB(
  evaluatedGeometry: THREE.BufferGeometry,
  modifiers: TerrainModifier[] = [],
  options: TerrainExportOptions = { includeCutFill: false }
): Promise<Blob> {
  const cleanGeo = prepareTerrainGeometry(evaluatedGeometry, options.uvScaleMeters || 10.0);

  const rootGroup = new THREE.Group();
  rootGroup.name = 'PolyForm_Civil_Terrain_Project';

  // 1. Base Terrain Mesh
  const terrainMaterial = new THREE.MeshStandardMaterial({
    name: 'Terrain_Base_Surface',
    color: 0x71717a,
    roughness: 0.88,
    metalness: 0.05,
  });
  const terrainMesh = new THREE.Mesh(cleanGeo, terrainMaterial);
  terrainMesh.name = 'Evaluated_Civil_Surface';
  rootGroup.add(terrainMesh);

  // 2. Active Road Corridors
  const activeRoads = modifiers.filter(
    (m): m is RoadModifier => m.enabled && m.type === 'road' && m.points.length >= 2
  );

  const roadMaterial = new THREE.MeshStandardMaterial({
    name: 'Civil_Asphalt_Pavement',
    color: 0x334155,
    roughness: 0.7,
    metalness: 0.1,
  });

  for (const road of activeRoads) {
    try {
      const ribbonGeo = generateRoadRibbonGeometry(road.points, road.width, road.profile);
      ribbonGeo.computeVertexNormals();
      const roadMesh = new THREE.Mesh(ribbonGeo, roadMaterial);
      roadMesh.name = `Road_${road.name.replace(/\s+/g, '_')}`;
      rootGroup.add(roadMesh);
    } catch (err) {
      console.warn(`[TerrainExporter] Failed to build road ribbon for ${road.name}:`, err);
    }
  }

  // 3. Optional Cut/Fill Inspection Solids
  if (options.includeCutFill) {
    const cutFillGroup = new THREE.Group();
    cutFillGroup.name = 'Earthwork_Cut_Fill_Inspection';

    const cutMaterial = new THREE.MeshStandardMaterial({
      name: 'Inspection_Cut_Volume',
      color: 0xf97316,
      roughness: 0.6,
      transparent: true,
      opacity: 0.75,
    });

    const fillMaterial = new THREE.MeshStandardMaterial({
      name: 'Inspection_Fill_Volume',
      color: 0x06b6d4,
      roughness: 0.6,
      transparent: true,
      opacity: 0.75,
    });

    const activePads = modifiers.filter(
      (m): m is PadModifier => m.enabled && m.type === 'pad'
    );

    for (const pad of activePads) {
      const isRect = pad.primitive !== 'circle';
      const padWidth = Math.max(1, pad.dimensions[0]);
      const padDepth = Math.max(1, pad.dimensions[1]);
      const padHeight = 1.0;

      let geom: THREE.BufferGeometry;
      if (isRect) {
        geom = new THREE.BoxGeometry(padWidth, padHeight, padDepth);
      } else {
        geom = new THREE.CylinderGeometry(padWidth / 2, padWidth / 2, padHeight, 32);
      }
      geom.computeVertexNormals();

      const padMesh = new THREE.Mesh(geom, fillMaterial);
      padMesh.position.set(pad.center[0], pad.targetElevation, pad.center[2]);
      padMesh.rotation.y = pad.rotationY || 0;
      padMesh.name = `Pad_Inspection_${pad.name.replace(/\s+/g, '_')}`;
      cutFillGroup.add(padMesh);
    }

    rootGroup.add(cutFillGroup);
  }

  // 4. Export scene graph with GLTFExporter
  const exporter = new GLTFExporter();

  return new Promise<Blob>((resolve, reject) => {
    exporter.parse(
      rootGroup,
      (gltf: any) => {
        if (gltf instanceof ArrayBuffer) {
          resolve(new Blob([gltf], { type: 'model/gltf-binary' }));
        } else {
          const jsonStr = JSON.stringify(gltf, null, 2);
          resolve(new Blob([jsonStr], { type: 'application/json' }));
        }
      },
      (error: any) => {
        console.error('[TerrainExporter] GLTFExporter failed:', error);
        reject(error);
      },
      { binary: true }
    );
  });
}

/**
 * Triggers a browser download of a generated Blob payload.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Triggers a browser download of text content (e.g. Wavefront OBJ).
 */
export function downloadText(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  downloadBlob(blob, filename);
}
