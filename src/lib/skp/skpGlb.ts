import type { FinishedGroup } from './skpMesh';

/** One drawable piece of a mesh, already laid out as the bytes that go into the GLB's binary chunk. */
export interface MeshPrimitive {
  /** positions, normals, uvs, then indices, padded to a multiple of four bytes. */
  blob: Uint8Array;
  vertexCount: number;
  indexCount: number;
  indexBytes: 2 | 4;
  min: [number, number, number];
  max: [number, number, number];
  materialIndex: number;
}

export interface MeshResource {
  name: string;
  primitives: MeshPrimitive[];
}

const COMPONENT_FLOAT = 5126;
const COMPONENT_UNSIGNED_SHORT = 5123;
const COMPONENT_UNSIGNED_INT = 5125;

export function packPrimitive(group: FinishedGroup, materialIndex: number): MeshPrimitive {
  const n = group.positions.length / 3;
  let maxIndex = 0;
  for (let i = 0; i < group.indices.length; i++) if (group.indices[i] > maxIndex) maxIndex = group.indices[i];
  const indexBytes: 2 | 4 = maxIndex <= 65535 ? 2 : 4;
  const unpadded = n * 32 + group.indices.length * indexBytes;
  const blob = new Uint8Array(unpadded + ((4 - (unpadded % 4)) % 4));
  new Float32Array(blob.buffer, 0, n * 3).set(group.positions);
  new Float32Array(blob.buffer, n * 12, n * 3).set(group.normals);
  new Float32Array(blob.buffer, n * 24, n * 2).set(group.uvs);
  if (indexBytes === 2) new Uint16Array(blob.buffer, n * 32, group.indices.length).set(group.indices);
  else new Uint32Array(blob.buffer, n * 32, group.indices.length).set(group.indices);
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const p = group.positions;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] < minX) minX = p[i];
    if (p[i] > maxX) maxX = p[i];
    if (p[i + 1] < minY) minY = p[i + 1];
    if (p[i + 1] > maxY) maxY = p[i + 1];
    if (p[i + 2] < minZ) minZ = p[i + 2];
    if (p[i + 2] > maxZ) maxZ = p[i + 2];
  }
  if (minX === Infinity) minX = minY = minZ = maxX = maxY = maxZ = 0;
  return { blob, vertexCount: n, indexCount: group.indices.length, indexBytes, min: [minX, minY, minZ], max: [maxX, maxY, maxZ], materialIndex };
}

/** The placements of the scene: a tree of named, transformed nodes, each optionally showing one mesh. Stored in typed arrays. */
export class NodeStore {
  count = 0;
  private nameIds = new Int32Array(1024);
  private meshIds = new Int32Array(1024);
  private matrices = new Float64Array(16 * 1024);
  private firstChild = new Int32Array(1024);
  private lastChild = new Int32Array(1024);
  private nextSibling = new Int32Array(1024);
  private names: string[] = [];
  private nameIndex = new Map<string, number>();

  /** Appends a node as the last child of `parent` (-1 for the root). Nodes are numbered in the order they are added. */
  add(parent: number): number {
    const at = this.count++;
    if (this.count > this.nameIds.length) this.growStorage();
    this.nameIds[at] = -1;
    this.meshIds[at] = -1;
    this.firstChild[at] = -1;
    this.lastChild[at] = -1;
    this.nextSibling[at] = -1;
    if (parent >= 0) {
      if (this.lastChild[parent] >= 0) this.nextSibling[this.lastChild[parent]] = at;
      else this.firstChild[parent] = at;
      this.lastChild[parent] = at;
    }
    return at;
  }

  private growStorage(): void {
    const size = this.nameIds.length * 2;
    const widen = <T extends Int32Array | Float64Array>(a: T, factor: number): T => {
      const next = new (a.constructor as new (n: number) => T)(size * factor);
      next.set(a);
      return next;
    };
    this.nameIds = widen(this.nameIds, 1);
    this.meshIds = widen(this.meshIds, 1);
    this.matrices = widen(this.matrices, 16);
    this.firstChild = widen(this.firstChild, 1);
    this.lastChild = widen(this.lastChild, 1);
    this.nextSibling = widen(this.nextSibling, 1);
  }

  setName(node: number, name: string): void {
    let id = this.nameIndex.get(name);
    if (id === undefined) {
      id = this.names.length;
      this.names.push(name);
      this.nameIndex.set(name, id);
    }
    this.nameIds[node] = id;
  }

  setMesh(node: number, mesh: number): void {
    this.meshIds[node] = mesh;
  }

  setMatrix(node: number, matrix: ArrayLike<number>): void {
    for (let i = 0; i < 16; i++) this.matrices[node * 16 + i] = matrix[i];
  }

  nodeJson(node: number): string {
    let json = '{';
    const nameId = this.nameIds[node];
    if (nameId >= 0 && this.names[nameId]) json += `"name":${JSON.stringify(this.names[nameId])},`;
    const base = node * 16;
    let identity = true;
    for (let i = 0; i < 16; i++) {
      if (!(Math.abs(this.matrices[base + i] - (i % 5 === 0 ? 1 : 0)) < 1e-12)) {
        identity = false;
        break;
      }
    }
    if (!identity) {
      json += '"matrix":[';
      for (let i = 0; i < 16; i++) {
        const v = this.matrices[base + i];
        json += (i ? ',' : '') + (Number.isFinite(v) ? String(v) : 'null');
      }
      json += '],';
    }
    if (this.meshIds[node] >= 0) json += `"mesh":${this.meshIds[node]},`;
    if (this.firstChild[node] >= 0) {
      json += '"children":[';
      let first = true;
      for (let c = this.firstChild[node]; c >= 0; c = this.nextSibling[c]) {
        json += (first ? '' : ',') + c;
        first = false;
      }
      json += '],';
    }
    return (json.endsWith(',') ? json.slice(0, -1) : json) + '}';
  }
}

/** Collects JSON text and turns it into bytes a piece at a time, so no single string has to hold the whole file. */
class JsonBytes {
  private parts: Uint8Array[] = [];
  private pending: string[] = [];
  private pendingLength = 0;
  private encoder = new TextEncoder();
  length = 0;

  write(text: string): void {
    this.pending.push(text);
    this.pendingLength += text.length;
    if (this.pendingLength > 1 << 18) this.flush();
  }

  private flush(): void {
    if (this.pending.length === 0) return;
    const bytes = this.encoder.encode(this.pending.join(''));
    this.parts.push(bytes);
    this.length += bytes.length;
    this.pending = [];
    this.pendingLength = 0;
  }

  finish(): Uint8Array[] {
    this.flush();
    const padding = (4 - (this.length % 4)) % 4;
    if (padding) {
      this.parts.push(new Uint8Array(padding).fill(0x20));
      this.length += padding;
    }
    return this.parts;
  }
}

export interface GlbMaterial {
  /** JSON text of the glTF material. */
  json: string;
}

export function writeInstancedGlb(nodes: NodeStore, meshes: MeshResource[], materials: GlbMaterial[]): Uint8Array {
  const json = new JsonBytes();
  json.write('{"asset":{"version":"2.0","generator":"PolyForm low-memory SKP reader (after OpenSKP)"},"scene":0,"scenes":[{"nodes":[0]}],"nodes":[');
  for (let i = 0; i < nodes.count; i++) json.write((i ? ',' : '') + nodes.nodeJson(i));

  json.write('],"meshes":[');
  let primitiveNumber = 0;
  meshes.forEach((mesh, meshIndex) => {
    const prims = mesh.primitives.map((prim) => {
      const first = primitiveNumber * 4;
      primitiveNumber++;
      return `{"attributes":{"POSITION":${first},"NORMAL":${first + 1},"TEXCOORD_0":${first + 2}},"indices":${first + 3},"material":${prim.materialIndex}}`;
    });
    json.write(`${meshIndex ? ',' : ''}{"name":${JSON.stringify(mesh.name || `mesh_${meshIndex}`)},"primitives":[${prims.join(',')}]}`);
  });

  json.write('],"materials":[');
  json.write(materials.map((m) => m.json).join(','));

  let totalBinary = 0;
  for (const mesh of meshes) for (const prim of mesh.primitives) totalBinary += prim.blob.length;
  // A model with nothing to draw has no binary data, and glTF does not allow an empty buffer list.
  const hasBinary = totalBinary > 0;
  if (!hasBinary) json.write(']');
  else json.write(`],"buffers":[{"byteLength":${totalBinary}}],"bufferViews":[`);
  let offset = 0;
  let first = true;
  for (const mesh of meshes) {
    for (const prim of mesh.primitives) {
      const n = prim.vertexCount;
      const views = [
        `{"buffer":0,"byteOffset":${offset},"byteLength":${n * 12},"target":34962}`,
        `{"buffer":0,"byteOffset":${offset + n * 12},"byteLength":${n * 12},"target":34962}`,
        `{"buffer":0,"byteOffset":${offset + n * 24},"byteLength":${n * 8},"target":34962}`,
        `{"buffer":0,"byteOffset":${offset + n * 32},"byteLength":${prim.indexCount * prim.indexBytes},"target":34963}`,
      ];
      json.write((first ? '' : ',') + views.join(','));
      first = false;
      offset += prim.blob.length;
    }
  }

  if (hasBinary) json.write('],"accessors":[');
  let viewNumber = 0;
  first = true;
  for (const mesh of meshes) {
    for (const prim of mesh.primitives) {
      const n = prim.vertexCount;
      const accessors = [
        `{"bufferView":${viewNumber},"byteOffset":0,"componentType":${COMPONENT_FLOAT},"count":${n},"type":"VEC3","min":${JSON.stringify(prim.min)},"max":${JSON.stringify(prim.max)}}`,
        `{"bufferView":${viewNumber + 1},"byteOffset":0,"componentType":${COMPONENT_FLOAT},"count":${n},"type":"VEC3"}`,
        `{"bufferView":${viewNumber + 2},"byteOffset":0,"componentType":${COMPONENT_FLOAT},"count":${n},"type":"VEC2"}`,
        `{"bufferView":${viewNumber + 3},"byteOffset":0,"componentType":${prim.indexBytes === 2 ? COMPONENT_UNSIGNED_SHORT : COMPONENT_UNSIGNED_INT},"count":${prim.indexCount},"type":"SCALAR"}`,
      ];
      json.write((first ? '' : ',') + accessors.join(','));
      first = false;
      viewNumber += 4;
    }
  }
  json.write(hasBinary ? ']}' : '}');

  const jsonParts = json.finish();
  const jsonLength = json.length;
  const total = 12 + 8 + jsonLength + (hasBinary ? 8 + totalBinary : 0);
  const glb = new Uint8Array(total);
  const view = new DataView(glb.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  let at = 20;
  for (const part of jsonParts) {
    glb.set(part, at);
    at += part.length;
  }
  if (!hasBinary) return glb;
  view.setUint32(at, totalBinary, true);
  view.setUint32(at + 4, 0x004e4942, true);
  at += 8;
  for (const mesh of meshes) {
    for (const prim of mesh.primitives) {
      glb.set(prim.blob, at);
      at += prim.blob.length;
    }
  }
  return glb;
}
