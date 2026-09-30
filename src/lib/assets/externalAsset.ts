import * as THREE from 'three';
import type { Shape } from '../../types';

export type ExternalAssetSource = 'polyform' | 'uploaded' | 'generated' | 'ifc';

export interface AssetProvenance {
  source: ExternalAssetSource;
  createdAt?: number;
  sourceFile?: string;
  sourceUrl?: string;
  creator?: string;
  license?: string;
  provider?: string;
  model?: string;
  prompt?: string;
  requestId?: string;
  externalId?: string;
}

export interface GeneratedGeometryInput {
  positions: number[];
  normals?: number[];
  uvs?: number[];
  colors?: number[];
  indices?: number[];
}

export interface GeneratedAssetInput {
  name: string;
  geometry: GeneratedGeometryInput;
  provenance: AssetProvenance;
  color?: string;
  position?: [number, number, number];
  targetHeightM?: number;
  maxTriangles?: number;
}

export interface GeneratedAssetIssue {
  severity: 'error' | 'warning';
  code:
    | 'missing-geometry'
    | 'invalid-position'
    | 'invalid-index'
    | 'excessive-triangles'
    | 'extreme-scale'
    | 'missing-provenance';
  message: string;
}

export interface GeneratedAssetValidation {
  valid: boolean;
  issues: GeneratedAssetIssue[];
  triangles: number;
  bounds?: { size: [number, number, number]; min: [number, number, number]; max: [number, number, number] };
}

export interface GeneratedAssetProviderRequest {
  prompt?: string;
  imageDataUrl?: string;
  name?: string;
  targetHeightM?: number;
}

export interface GeneratedAssetProviderResult {
  geometry: GeneratedGeometryInput;
  name?: string;
  providerAssetId?: string;
  license?: string;
  metadata?: Record<string, unknown>;
}

export interface GeneratedAssetProvider {
  id: string;
  generate(request: GeneratedAssetProviderRequest): Promise<GeneratedAssetProviderResult>;
}

function triangleCount(g: GeneratedGeometryInput): number {
  if (g.indices?.length) return Math.floor(g.indices.length / 3);
  return Math.floor(g.positions.length / 9);
}

function geometryFromInput(input: GeneratedGeometryInput): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(input.positions, 3));
  if (input.normals?.length === input.positions.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(input.normals, 3));
  if (input.uvs?.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(input.uvs, 2));
  if (input.colors?.length === input.positions.length) g.setAttribute('color', new THREE.Float32BufferAttribute(input.colors, 3));
  if (input.indices?.length) g.setIndex(input.indices);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function finitePositions(positions: number[]): boolean {
  return positions.length >= 9 && positions.length % 3 === 0 && positions.every(Number.isFinite);
}

export function validateGeneratedAsset(input: GeneratedAssetInput): GeneratedAssetValidation {
  const issues: GeneratedAssetIssue[] = [];
  const g = input.geometry;
  if (!finitePositions(g.positions)) {
    issues.push({ severity: 'error', code: 'missing-geometry', message: 'Generated asset has no valid triangle positions.' });
    return { valid: false, issues, triangles: 0 };
  }
  if (g.indices?.some(i => !Number.isInteger(i) || i < 0 || i >= g.positions.length / 3)) {
    issues.push({ severity: 'error', code: 'invalid-index', message: 'Generated asset contains an invalid vertex index.' });
  }
  if (!input.provenance?.source) {
    issues.push({ severity: 'error', code: 'missing-provenance', message: 'External/generated assets must record their source.' });
  }
  const triangles = triangleCount(g);
  const maxTriangles = input.maxTriangles ?? 250_000;
  if (triangles > maxTriangles) {
    issues.push({
      severity: 'warning',
      code: 'excessive-triangles',
      message: `Asset has ${triangles.toLocaleString()} triangles; consider decimation before interactive use.`,
    });
  }

  const geo = geometryFromInput(g);
  const box = geo.boundingBox!;
  const size = new THREE.Vector3();
  box.getSize(size);
  if (!(size.x > 0 || size.y > 0 || size.z > 0) || !Number.isFinite(size.length())) {
    issues.push({ severity: 'error', code: 'invalid-position', message: 'Generated geometry bounds are invalid.' });
  }
  const largest = Math.max(size.x, size.y, size.z);
  if (largest > 1000 || (largest > 0 && largest < 0.001)) {
    issues.push({ severity: 'warning', code: 'extreme-scale', message: 'Generated geometry appears to use an implausible scale.' });
  }
  const bounds = {
    size: [size.x, size.y, size.z] as [number, number, number],
    min: [box.min.x, box.min.y, box.min.z] as [number, number, number],
    max: [box.max.x, box.max.y, box.max.z] as [number, number, number],
  };
  geo.dispose();
  return { valid: issues.every(i => i.severity !== 'error'), issues, triangles, bounds };
}

/**
 * Normalise a generated mesh for PolyForm: centre it in X/Z, put its lowest
 * point at Y=0 and optionally scale uniformly to a requested height.
 */
/**
 * Flattens a Three.js hierarchy (for example a GLB returned by an image-to-3D
 * provider) into the provider-neutral triangle arrays used by PolyForm.
 * World transforms are baked into each mesh before concatenation.
 */
export function generatedGeometryFromObject3D(root: THREE.Object3D): GeneratedGeometryInput {
  root.updateMatrixWorld(true);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvParts: number[][] = [];
  let allHaveUvs = true;

  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !(mesh.geometry instanceof THREE.BufferGeometry)) return;

    let geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    if (geometry.index) {
      const nonIndexed = geometry.toNonIndexed();
      geometry.dispose();
      geometry = nonIndexed;
    }
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();

    const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
    if (!position || position.count < 3) {
      geometry.dispose();
      return;
    }

    positions.push(...Array.from(position.array as ArrayLike<number>));
    if (normal) normals.push(...Array.from(normal.array as ArrayLike<number>));
    else normals.push(...new Array(position.count * 3).fill(0));

    if (uv) uvParts.push(Array.from(uv.array as ArrayLike<number>));
    else allHaveUvs = false;
    geometry.dispose();
  });

  if (positions.length < 9) throw new Error('Generated 3D result contained no triangle meshes.');
  return {
    positions,
    normals: normals.length === positions.length ? normals : undefined,
    uvs: allHaveUvs && uvParts.length ? uvParts.flat() : undefined,
  };
}

export function normaliseGeneratedGeometry(
  input: GeneratedGeometryInput,
  targetHeightM?: number,
): GeneratedGeometryInput {
  const geo = geometryFromInput(input);
  const box = geo.boundingBox!;
  const centre = new THREE.Vector3();
  box.getCenter(centre);
  const height = box.max.y - box.min.y;
  const scale = targetHeightM && targetHeightM > 0 && height > 1e-9 ? targetHeightM / height : 1;

  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      (pos.getX(i) - centre.x) * scale,
      (pos.getY(i) - box.min.y) * scale,
      (pos.getZ(i) - centre.z) * scale,
    );
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const result: GeneratedGeometryInput = {
    positions: Array.from((geo.getAttribute('position') as THREE.BufferAttribute).array as ArrayLike<number>),
    normals: Array.from((geo.getAttribute('normal') as THREE.BufferAttribute).array as ArrayLike<number>),
    uvs: geo.getAttribute('uv') ? Array.from((geo.getAttribute('uv') as THREE.BufferAttribute).array as ArrayLike<number>) : undefined,
    colors: geo.getAttribute('color') ? Array.from((geo.getAttribute('color') as THREE.BufferAttribute).array as ArrayLike<number>) : undefined,
    indices: geo.index ? Array.from(geo.index.array as ArrayLike<number>) : undefined,
  };
  geo.dispose();
  return result;
}

export function createExternalAssetShape(input: GeneratedAssetInput): Shape {
  const validation = validateGeneratedAsset(input);
  if (!validation.valid) {
    throw new Error(validation.issues.filter(i => i.severity === 'error').map(i => i.message).join(' '));
  }
  const geometry = normaliseGeneratedGeometry(input.geometry, input.targetHeightM);
  return {
    id: Math.random().toString(36).slice(2, 11),
    name: input.name,
    type: 'custom',
    position: input.position ?? [0, 0, 0],
    args: validation.bounds?.size ?? [1, 1, 1],
    color: input.color ?? '#d8d8d8',
    roughness: 0.72,
    metalness: 0.04,
    tags: ['external-asset', input.provenance.source],
    geometryData: geometry,
    customData: {
      semanticComponent: {
        kind: 'generated-asset',
        definitionId: `external:${input.provenance.source}`,
        params: {},
        placement: { hosts: ['floor', 'surface', 'free'], preferredHost: 'floor' },
        source: input.provenance,
      },
      assetProvenance: { ...input.provenance, createdAt: input.provenance.createdAt ?? Date.now() },
      assetValidation: { triangles: validation.triangles, issues: validation.issues },
    },
  };
}

export class GeneratedAssetProviderRegistry {
  private providers = new Map<string, GeneratedAssetProvider>();

  register(provider: GeneratedAssetProvider): void {
    if (!provider.id.trim()) throw new Error('Generated asset provider requires an id.');
    this.providers.set(provider.id, provider);
  }

  unregister(id: string): void {
    this.providers.delete(id);
  }

  list(): string[] {
    return [...this.providers.keys()].sort();
  }

  async generate(
    providerId: string,
    request: GeneratedAssetProviderRequest,
  ): Promise<GeneratedAssetProviderResult> {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Generated asset provider "${providerId}" is not registered.`);
    return provider.generate(request);
  }
}
