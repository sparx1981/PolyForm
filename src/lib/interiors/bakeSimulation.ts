import * as THREE from 'three';
import { smoothPatchNormals } from './upholsteryNormals';
import { relaxCurtainPositions } from './curtainCloth';
import { relaxSoftParts } from './softRelax';
import { drapeSheetParts } from './drapeBake';
import type { FurniturePartRange } from './furnitureParts';
import type { Shape } from '../../types';
import type { SimulationProfile } from '../semantics/componentTypes';

function simulationOf(shape: Shape): SimulationProfile | undefined {
  return shape.customData?.semanticComponent?.simulation as SimulationProfile | undefined;
}

function rebuildNormals(positions: number[], uvs?: number[]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (uvs?.length) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  const normals = Array.from(geometry.getAttribute('normal').array as ArrayLike<number>);
  geometry.dispose();
  return normals;
}

/**
 * Saves a deterministic relaxed shape for a semantic deformation profile.
 * The legacy softbody/cloth metadata describes the profile; this is not a physical solver. This is
 * intentionally deterministic: runtime physics is optional, while saved
 * projects always retain the same settled mesh.
 */
export function bakeSemanticSimulation(shape: Shape, strength = 0.35): Shape {
  const simulation = simulationOf(shape);
  const positions = shape.geometryData?.positions;
  if (!simulation?.bakeable || !positions?.length) {
    throw new Error('Shape does not contain bakeable simulation geometry.');
  }

  const amount = Math.max(0, Math.min(1, strength));
  const next = [...positions];
  // Plain loop: spreading a six-figure vertex array into Math.min overflows the call stack.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < next.length; i += 3) {
    const x = next[i]!, y = next[i + 1]!, z = next[i + 2]!;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const width = Math.max(0.001, maxX - minX);
  const height = Math.max(0.001, maxY - minY);
  const depth = Math.max(0.001, maxZ - minZ);
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;

  const groups = shape.customData?.furnitureMaterialGroups as Array<{ start: number; count: number; materialIndex: number }> | undefined;
  const fabric = groups?.length ? new Uint8Array(next.length / 3) : undefined;
  for (const group of groups ?? []) if (group.materialIndex !== 0) fabric?.fill(1, group.start, group.start + group.count);

  const partRanges = shape.customData?.furniturePartRanges as FurniturePartRange[] | undefined;
  // Pieces built with part information settle part by part; older saved pieces use the whole-piece rule below.
  const byPart = simulation.type === 'softbody' && !!partRanges?.length;
  if (byPart) {
    // Cushions, seats and mattresses settle by formula; bedding is dropped onto them with the cloth solver
    // and, if that cannot be done, falls back to the formula too.
    relaxSoftParts(next, partRanges!, amount, part => !part.sheet);
    const draped = drapeSheetParts(next, partRanges!, amount);
    relaxSoftParts(next, partRanges!, amount, part => !!part.sheet && !draped.has(part));
  }

  for (let i = 0; i < next.length; i += 3) {
    if (byPart) break;
    if (simulation.type === 'softbody' && fabric && !fabric[i / 3]) continue;
    const x = next[i], y = next[i + 1], z = next[i + 2];
    const nx = Math.max(-1, Math.min(1, (x - cx) / (width / 2)));
    const nz = Math.max(-1, Math.min(1, (z - cz) / (depth / 2)));
    const ny = Math.max(0, Math.min(1, (y - minY) / height));
    const centreEnvelope = Math.max(0, (1 - nx * nx) * (1 - nz * nz));

    if (simulation.type === 'softbody') {
      // Upholstery settles slightly at broad upper centres while edges retain
      // enough structure to read as cushions/mattresses rather than rubber.
      const upper = Math.pow(ny, 2);
      next[i + 1] = y - height * 0.055 * amount * centreEnvelope * upper;
      const sideSoftness = height * 0.012 * amount * Math.sin(ny * Math.PI);
      next[i] = x + Math.sign(nx || 1) * sideSoftness * (1 - Math.abs(nx));
      next[i + 2] = z + Math.sign(nz || 1) * sideSoftness * (1 - Math.abs(nz));
    } else if (simulation.type === 'cloth' && shape.customData?.furnitureType !== 'curtain') {
      const verticalSag = (1 - ny) * amount;
      const wave = Math.sin((nx + 1) * Math.PI * 7 + ny * 1.3);
      next[i + 2] = z + wave * depth * 0.18 * verticalSag;
      next[i + 1] = y - height * 0.012 * amount * (1 - nx * nx) * verticalSag;
    }
  }

  if (simulation.type === 'cloth' && shape.customData?.furnitureType === 'curtain') {
    const params = shape.customData.semanticComponent.params;
    relaxCurtainPositions(next, Number(params.width), Number(params.height), amount);
  }

  const normals = rebuildNormals(next, shape.geometryData?.uvs);
  if (simulation.type === 'softbody' && groups) for (const group of groups) {
    if (group.materialIndex === 0) continue;
    const start=group.start*3, length=group.count*3;
    const smooth = smoothPatchNormals(next.slice(start,start+length));
    for(let i=0;i<smooth.length;i++) normals[start+i]=smooth[i];
  }
  return {
    ...shape,
    geometryData: {
      ...shape.geometryData,
      positions: next,
      normals,
    },
    customData: {
      ...shape.customData,
      simulationBake: {
        type: simulation.type,
        strength: amount,
        bakedAt: Date.now(),
      },
    },
  };
}
