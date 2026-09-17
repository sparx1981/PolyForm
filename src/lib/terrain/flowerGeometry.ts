import * as THREE from 'three';
import { Shape, TerrainModifier, WildflowerSettings } from '../../types';
import { sampleTerrainElevation } from '../archRoomAssembly';
import {
  extractExclusionFootprints,
  isPointExcluded,
  computeTerrainNormal
} from './grassGeometry';

/**
 * Creates low-poly 3D geometry for low-lying wildflowers.
 * Features:
 *  - Low-lying leafy green stem base (aIsPetal = 0.0)
 *  - Cross-card and angled petal blossom at top (aIsPetal = 1.0)
 *  - aCenterDist (0.0 = center stamen, 1.0 = petal edge)
 *  - aHeightPercent for wind animation swaying
 */
export function createWildflowerGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const heightPercents: number[] = [];
  const isPetalAttrs: number[] = [];
  const centerDists: number[] = [];
  const indices: number[] = [];

  let vertIdx = 0;

  function addVertex(
    x: number, y: number, z: number,
    nx: number, ny: number, nz: number,
    u: number, v: number,
    hPct: number,
    isPetal: number,
    cDist: number
  ): number {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    uvs.push(u, v);
    heightPercents.push(hPct);
    isPetalAttrs.push(isPetal);
    centerDists.push(cDist);
    return vertIdx++;
  }

  function addQuad(
    v0: [number, number, number, number, number, number, number, number, number, number, number],
    v1: [number, number, number, number, number, number, number, number, number, number, number],
    v2: [number, number, number, number, number, number, number, number, number, number, number],
    v3: [number, number, number, number, number, number, number, number, number, number, number]
  ) {
    const idx0 = addVertex(...v0);
    const idx1 = addVertex(...v1);
    const idx2 = addVertex(...v2);
    const idx3 = addVertex(...v3);

    // Front face
    indices.push(idx0, idx1, idx2);
    indices.push(idx0, idx2, idx3);

    // Double-sided back face
    indices.push(idx2, idx1, idx0);
    indices.push(idx3, idx2, idx0);
  }

  // --- 1. Main Stem (Vertical quad from 0.0 to 0.70) ---
  const stemWidth = 0.025;
  addQuad(
    [-stemWidth, 0.0, 0.0,  0, 0, 1,  0.0, 0.0,  0.0,  0.0, 0.0],
    [ stemWidth, 0.0, 0.0,  0, 0, 1,  1.0, 0.0,  0.0,  0.0, 0.0],
    [ stemWidth * 0.8, 0.70, 0.0,  0, 0, 1,  1.0, 0.70, 0.70, 0.0, 0.0],
    [-stemWidth * 0.8, 0.70, 0.0,  0, 0, 1,  0.0, 0.70, 0.70, 0.0, 0.0]
  );

  // --- 2. Low-lying Leaf blades at base (y = 0.15 to 0.40) ---
  // Left leaf
  addQuad(
    [-0.01, 0.15, 0.0,  -0.5, 0.5, 0.7,  0.0, 0.15, 0.15, 0.0, 0.0],
    [-0.01, 0.25, 0.0,  -0.5, 0.5, 0.7,  0.0, 0.25, 0.25, 0.0, 0.0],
    [-0.09, 0.32, 0.04, -0.5, 0.5, 0.7,  1.0, 0.35, 0.35, 0.0, 0.0],
    [-0.06, 0.18, 0.02, -0.5, 0.5, 0.7,  1.0, 0.18, 0.18, 0.0, 0.0]
  );
  // Right leaf
  addQuad(
    [ 0.01, 0.18, 0.0,   0.5, 0.5, 0.7,  0.0, 0.18, 0.18, 0.0, 0.0],
    [ 0.06, 0.22, -0.03, 0.5, 0.5, 0.7,  1.0, 0.22, 0.22, 0.0, 0.0],
    [ 0.09, 0.36, -0.05, 0.5, 0.5, 0.7,  1.0, 0.38, 0.38, 0.0, 0.0],
    [ 0.01, 0.28, 0.0,   0.5, 0.5, 0.7,  0.0, 0.28, 0.28, 0.0, 0.0]
  );

  // --- 3. Blossom Petal Cards at Top (y = 0.65 to 1.05) ---
  // We place 3 crossed vertical/angled petal quads rotated at 0°, 60°, and 120°
  // and a horizontal top blossom disk to make it vibrant from top-down and isometric angles
  const petalRadius = 0.14;
  const flowerCenterY = 0.85;

  const angles = [0, Math.PI / 3, (2 * Math.PI) / 3];
  for (const rot of angles) {
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);

    const xL = -petalRadius * cosR;
    const zL = -petalRadius * sinR;
    const xR =  petalRadius * cosR;
    const zR =  petalRadius * sinR;

    const yBottom = flowerCenterY - 0.14;
    const yTop = flowerCenterY + 0.14;

    addQuad(
      [xL, yBottom, zL,  -sinR, 0, cosR,  0.0, 0.0,  0.72, 1.0, 1.0],
      [xR, yBottom, zR,  -sinR, 0, cosR,  1.0, 0.0,  0.72, 1.0, 1.0],
      [xR, yTop,    zR,  -sinR, 0, cosR,  1.0, 1.0,  1.00, 1.0, 1.0],
      [xL, yTop,    zL,  -sinR, 0, cosR,  0.0, 1.0,  1.00, 1.0, 1.0]
    );
  }

  // --- 4. Horizontal Top Petal Star Disk (y = 0.88) ---
  // Central stamen disc with petals radiating outward
  const numPetals = 6;
  const centerIdx = addVertex(0, flowerCenterY + 0.02, 0, 0, 1, 0, 0.5, 0.5, 0.88, 1.0, 0.0);

  const ringIndices: number[] = [];
  for (let p = 0; p < numPetals; p++) {
    const th = (p / numPetals) * Math.PI * 2;
    const px = Math.cos(th) * petalRadius;
    const pz = Math.sin(th) * petalRadius;
    ringIndices.push(addVertex(px, flowerCenterY + 0.01, pz, 0, 1, 0, 0.5 + px * 3, 0.5 + pz * 3, 0.87, 1.0, 1.0));
  }

  for (let p = 0; p < numPetals; p++) {
    const next = (p + 1) % numPetals;
    indices.push(centerIdx, ringIndices[p], ringIndices[next]);
    indices.push(centerIdx, ringIndices[next], ringIndices[p]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('aHeightPercent', new THREE.Float32BufferAttribute(heightPercents, 1));
  geometry.setAttribute('aIsPetal', new THREE.Float32BufferAttribute(isPetalAttrs, 1));
  geometry.setAttribute('aCenterDist', new THREE.Float32BufferAttribute(centerDists, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

export interface WildflowerInstanceData {
  instanceCount: number;
  matrices: Float32Array;
  shapeOffsets: Float32Array; // vec4: (leanX, leanZ, scaleMultiplier, colorJitter)
  heightVariances: Float32Array; // 0.0 to 1.0
}

/**
 * Distributes instanced low-lying wildflowers across terrain with floor slab and road exclusion.
 */
export function generateWildflowerInstances(
  terrainShape: Shape,
  shapes: Shape[],
  terrainModifiers: TerrainModifier[] = [],
  settings: WildflowerSettings
): WildflowerInstanceData {
  const td = terrainShape.terrainData;
  if (!td || !settings.enabled) {
    return {
      instanceCount: 0,
      matrices: new Float32Array(0),
      shapeOffsets: new Float32Array(0),
      heightVariances: new Float32Array(0)
    };
  }

  const terrainWidth = td.width || 30;
  const terrainDepth = td.depth || 30;
  const terrainArea = terrainWidth * terrainDepth;

  // Target instance count based on density (supports delicate low density < 1 up to 15 per m²)
  // Cap at 45,000 for smooth 60fps performance
  const targetCount = Math.min(
    Math.max(1, Math.round(terrainArea * Math.max(0.01, settings.density))),
    45000
  );

  // Extract slab and road exclusion footprints
  const exclusionFootprints = extractExclusionFootprints(shapes, terrainModifiers);

  const matrices: number[] = [];
  const shapeOffsets: number[] = [];
  const heightVariances: number[] = [];

  const halfW = terrainWidth / 2;
  const halfD = terrainDepth / 2;
  const originX = (terrainShape.position ? terrainShape.position[0] : 0) - halfW;
  const originZ = (terrainShape.position ? terrainShape.position[2] : 0) - halfD;

  const maxSlopeCos = Math.cos((settings.maxSlopeAngle * Math.PI) / 180);

  // Clump distribution: wildflowers naturally grow in clusters and meadows
  // Use a pseudo-random jittered grid with clump clustering
  const numCellsX = Math.max(1, Math.floor(Math.sqrt(targetCount * (terrainWidth / terrainDepth))));
  const numCellsZ = Math.max(1, Math.floor(targetCount / numCellsX));
  const stepX = terrainWidth / numCellsX;
  const stepZ = terrainDepth / numCellsZ;

  let seed = 7183;
  function lcg() {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  }

  const dummy = new THREE.Object3D();
  const upVector = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i < targetCount; i++) {
    const cellI = i % numCellsX;
    const cellJ = Math.floor(i / numCellsX);

    // Jitter within cell with organic clustering
    const r1 = lcg();
    const r2 = lcg();
    const r3 = lcg();

    // Natural clustering: 30% clump clusters, 70% scattered
    let offsetX = (r1 - 0.5) * stepX * 1.8;
    let offsetZ = (r2 - 0.5) * stepZ * 1.8;
    if (r3 < 0.35) {
      // Pull toward clump center
      offsetX *= 0.4;
      offsetZ *= 0.4;
    }

    const lx = (cellI + 0.5) * stepX + offsetX;
    const lz = (cellJ + 0.5) * stepZ + offsetZ;

    if (lx < 0.2 || lx > terrainWidth - 0.2 || lz < 0.2 || lz > terrainDepth - 0.2) {
      continue;
    }

    const wx = originX + lx;
    const wz = originZ + lz;
    const wy = sampleTerrainElevation(wx, wz, terrainShape);

    // 1. Slope culling
    const normal = computeTerrainNormal(wx, wz, terrainShape);
    if (normal.y < maxSlopeCos) {
      continue;
    }

    // 2. Floor Slab & Road Corridor Exclusion
    if (exclusionFootprints.length > 0) {
      if (isPointExcluded(wx, wy, wz, exclusionFootprints)) {
        continue;
      }
    }

    // 3. Instance transforms
    dummy.position.set(wx, wy, wz);

    // Surface normal alignment (slight tilt matching hillside)
    dummy.quaternion.setFromUnitVectors(upVector, normal);

    // Random rotation around local up axis
    const randYaw = lcg() * Math.PI * 2;
    dummy.rotateY(randYaw);

    // Scale: base height and subtle variance
    const hVar = lcg();
    const scaleFactor = 0.85 + lcg() * 0.35;
    dummy.scale.set(scaleFactor, scaleFactor, scaleFactor);
    dummy.updateMatrix();

    for (let m = 0; m < 16; m++) {
      matrices.push(dummy.matrix.elements[m]);
    }

    // Per-instance shape offsets: leanX, leanZ, widthScale, colorJitter
    const leanX = (lcg() - 0.5) * 0.15;
    const leanZ = (lcg() - 0.5) * 0.15;
    const widthScale = 0.8 + lcg() * 0.4;
    const colorJitter = lcg(); // used to mix primary & secondary colors and petal hues

    shapeOffsets.push(leanX, leanZ, widthScale, colorJitter);
    heightVariances.push(hVar);
  }

  const validCount = heightVariances.length;
  return {
    instanceCount: validCount,
    matrices: new Float32Array(matrices),
    shapeOffsets: new Float32Array(shapeOffsets),
    heightVariances: new Float32Array(heightVariances)
  };
}
