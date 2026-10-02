import { computeFaceUv } from 'openskp';
import type { DefTemplate } from './leanGeometry';
import type { SkpMaterial } from './skpMaterials';

/** SketchUp works in inches, y is "north" and z is "up"; the result is in metres with y up. */
const SCALE = 0.0254;

export interface RgbColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export interface MeshContext {
  resolveMaterial(materialId: number): SkpMaterial | undefined;
  textureIndexFor(texture: SkpMaterial['texture'] | undefined): number | null;
  inheritedMaterial: SkpMaterial | undefined;
  fallbackLayerColor: RgbColor;
  respectVisibility: boolean;
  /** Draw a face with no paint of its own on the back as one double-sided surface, not as a second, reversed copy. */
  mergeDefaultBacks?: boolean;
}

/** All the triangles of one definition that share a colour, texture and sidedness. */
export interface FinishedGroup {
  color: RgbColor;
  transparency: number;
  doubleSided: boolean;
  textureIndex: number | null;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

const keyBits = new Float64Array(2);
const keyWords = new Uint32Array(keyBits.buffer);

/** Hashes a corner by the vertex it sits on and the texture coordinates it gets, so a corner shared by several faces is stored once. */
function hashCorner(slot: number, u: number, v: number): number {
  keyBits[0] = u;
  keyBits[1] = v;
  let h = Math.imul(slot ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ keyWords[0], 0xc2b2ae35);
  h = Math.imul(h ^ keyWords[1], 0x27d4eb2f);
  h = Math.imul(h ^ keyWords[2], 0x165667b1);
  h = Math.imul(h ^ keyWords[3], 0x9e3779b1);
  return (h ^ (h >>> 15)) >>> 0;
}

const sameNumber = (a: number, b: number): boolean => a === b || (a !== a && b !== b);

class GroupBuilder {
  vertexCount = 0;
  triangleCount = 0;
  private positions = new Float32Array(96);
  private uvs = new Float32Array(64);
  private normalSums = new Float64Array(96);
  private cornerSlot = new Int32Array(32);
  private cornerU = new Float64Array(32);
  private cornerV = new Float64Array(32);
  private indices = new Uint32Array(96);
  private table = new Int32Array(64).fill(-1);
  private mask = 63;

  constructor(
    readonly color: RgbColor,
    readonly transparency: number,
    readonly doubleSided: boolean,
    readonly textureIndex: number | null,
  ) {}

  /** The corner at vertex `slot` with texture coordinates (u, v), added if it is new. Returns its index. */
  corner(slot: number, u: number, v: number, x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    // -0 and 0 are the same coordinate as far as telling corners apart goes.
    const ku = u === 0 ? 0 : u;
    const kv = v === 0 ? 0 : v;
    let i = hashCorner(slot, ku, kv) & this.mask;
    for (;;) {
      const at = this.table[i];
      if (at < 0) break;
      if (this.cornerSlot[at] === slot && sameNumber(this.cornerU[at], ku) && sameNumber(this.cornerV[at], kv)) {
        this.normalSums[at * 3] += nx;
        this.normalSums[at * 3 + 1] += ny;
        this.normalSums[at * 3 + 2] += nz;
        return at;
      }
      i = (i + 1) & this.mask;
    }
    const at = this.vertexCount++;
    if (this.vertexCount * 3 > this.positions.length) {
      const bigger = Math.max(this.positions.length * 2, 96);
      const positions = new Float32Array(bigger);
      positions.set(this.positions);
      this.positions = positions;
      const sums = new Float64Array(bigger);
      sums.set(this.normalSums);
      this.normalSums = sums;
      const uvs = new Float32Array((bigger / 3) * 2);
      uvs.set(this.uvs);
      this.uvs = uvs;
    }
    if (this.vertexCount > this.cornerSlot.length) {
      const bigger = this.cornerSlot.length * 2;
      const slots = new Int32Array(bigger);
      slots.set(this.cornerSlot);
      this.cornerSlot = slots;
      const us = new Float64Array(bigger);
      us.set(this.cornerU);
      this.cornerU = us;
      const vs = new Float64Array(bigger);
      vs.set(this.cornerV);
      this.cornerV = vs;
    }
    this.cornerSlot[at] = slot;
    this.cornerU[at] = ku;
    this.cornerV[at] = kv;
    this.positions[at * 3] = x * SCALE;
    this.positions[at * 3 + 1] = z * SCALE;
    this.positions[at * 3 + 2] = -y * SCALE;
    this.uvs[at * 2] = u;
    this.uvs[at * 2 + 1] = v;
    this.normalSums[at * 3] = nx;
    this.normalSums[at * 3 + 1] = ny;
    this.normalSums[at * 3 + 2] = nz;
    this.table[i] = at;
    if (this.vertexCount * 2 > this.table.length) this.rehash();
    return at;
  }

  private rehash(): void {
    const size = this.table.length * 2;
    this.table = new Int32Array(size).fill(-1);
    this.mask = size - 1;
    for (let at = 0; at < this.vertexCount; at++) {
      let i = hashCorner(this.cornerSlot[at], this.cornerU[at], this.cornerV[at]) & this.mask;
      while (this.table[i] >= 0) i = (i + 1) & this.mask;
      this.table[i] = at;
    }
  }

  triangle(a: number, b: number, c: number): void {
    const n = this.triangleCount++;
    if ((n + 1) * 3 > this.indices.length) {
      const indices = new Uint32Array(this.indices.length * 2);
      indices.set(this.indices);
      this.indices = indices;
    }
    this.indices[n * 3] = a;
    this.indices[n * 3 + 1] = b;
    this.indices[n * 3 + 2] = c;
  }

  finish(): FinishedGroup {
    const n = this.vertexCount;
    const normals = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const rx = this.normalSums[i * 3];
      const ry = this.normalSums[i * 3 + 1];
      const rz = this.normalSums[i * 3 + 2];
      const len = Math.sqrt(rx ** 2 + ry ** 2 + rz ** 2);
      let nx = 0;
      let ny = 0;
      let nz = 1;
      if (len > 1e-6) {
        nx = rx / len;
        ny = ry / len;
        nz = rz / len;
      }
      normals[i * 3] = nx;
      normals[i * 3 + 1] = nz;
      normals[i * 3 + 2] = -ny;
    }
    return {
      color: this.color,
      transparency: this.transparency,
      doubleSided: this.doubleSided,
      textureIndex: this.textureIndex,
      positions: this.positions.slice(0, n * 3),
      normals,
      uvs: this.uvs.slice(0, n * 2),
      indices: this.indices.slice(0, this.triangleCount * 3),
    };
  }
}

/**
 * Sorts a definition's triangles into groups by what they are painted with, one group per colour/texture/sidedness.
 * A face painted the same on both sides is one double-sided surface; otherwise each side becomes its own group, the
 * back one wound the other way round. Faces with no paint of their own take the colour of the component placed
 * around them, or else the colour of their layer.
 */
export function buildFaceGroups(template: DefTemplate, ctx: MeshContext): FinishedGroup[] {
  const groups = new Map<string, GroupBuilder>();
  const coords = template.coords;
  const cornerStamp = new Uint32Array(coords.length / 3);
  const cornerAt = new Int32Array(coords.length / 3);
  let stamp = 0;

  const groupFor = (color: RgbColor, doubleSided: boolean, textureIndex: number | null, transparency: number): GroupBuilder => {
    const key = `${color.r},${color.g},${color.b},${doubleSided},${textureIndex ?? -1},${transparency}`;
    let group = groups.get(key);
    if (!group) {
      group = new GroupBuilder(color, transparency, doubleSided, textureIndex);
      groups.set(key, group);
    }
    return group;
  };

  const addSide = (
    face: number,
    color: RgbColor,
    doubleSided: boolean,
    reverse: boolean,
    material: SkpMaterial | undefined,
    uvTransform: number[] | null,
    basis: { xr: number[]; yr: number[] },
  ) => {
    const textureIndex = ctx.textureIndexFor(material?.texture);
    const colorAlpha = color.a !== undefined ? color.a / 255 : 1;
    const group = groupFor(color, doubleSided, textureIndex, colorAlpha * (material?.transparency ?? 1));
    const texture = material?.texture;
    const tileW = texture && texture.width > 1e-9 ? texture.width : 1;
    const tileH = texture && texture.height > 1e-9 ? texture.height : 1;
    const sign = reverse ? -1 : 1;
    const nx = sign * template.normals[face * 3];
    const ny = sign * template.normals[face * 3 + 1];
    const nz = sign * template.normals[face * 3 + 2];
    const { xr, yr } = basis;
    stamp++;
    const first = template.triStart[face] * 3;
    const end = template.triStart[face + 1] * 3;
    const corner = (slot: number): number => {
      if (cornerStamp[slot] === stamp) return cornerAt[slot];
      const x = coords[slot * 3];
      const y = coords[slot * 3 + 1];
      const z = coords[slot * 3 + 2];
      let u: number;
      let v: number;
      if (uvTransform) {
        [u, v] = computeFaceUv([x, y, z], xr as [number, number, number], yr as [number, number, number], uvTransform, tileW, tileH);
      } else {
        u = (x * xr[0] + y * xr[1] + z * xr[2]) / tileW;
        v = (x * yr[0] + y * yr[1] + z * yr[2]) / tileH;
      }
      const at = group.corner(slot, u, v, x, y, z, nx, ny, nz);
      cornerStamp[slot] = stamp;
      cornerAt[slot] = at;
      return at;
    };
    for (let t = first; t < end; t += 3) {
      const a = template.tris[t];
      const b = reverse ? template.tris[t + 2] : template.tris[t + 1];
      const c = reverse ? template.tris[t + 1] : template.tris[t + 2];
      const ia = corner(a);
      const ib = corner(b);
      const ic = corner(c);
      group.triangle(ia, ib, ic);
    }
  };

  const fallbackColor: RgbColor = ctx.inheritedMaterial?.color ?? ctx.fallbackLayerColor;
  for (let f = 0; f < template.faceCount; f++) {
    if (ctx.respectVisibility && template.hidden[f]) continue;
    const frontMaterial = ctx.resolveMaterial(template.front[f]) ?? ctx.inheritedMaterial;
    const explicitBack = ctx.resolveMaterial(template.back[f]);
    const backMaterial = explicitBack ?? ctx.inheritedMaterial;
    const frontColor = frontMaterial?.color ?? fallbackColor;
    const backColor = backMaterial?.color ?? fallbackColor;
    const nx = template.normals[f * 3];
    const ny = template.normals[f * 3 + 1];
    const nz = template.normals[f * 3 + 2];
    const basis = faceBasis(nx, ny, nz);
    const placement = template.uv?.get(f);
    if (ctx.mergeDefaultBacks && !explicitBack) {
      // Nothing was painted on the back, so a viewer's default back colour is not worth a second copy of the face.
      addSide(f, frontColor, true, false, frontMaterial, placement?.front ?? null, basis);
    } else if (frontColor.r === backColor.r && frontColor.g === backColor.g && frontColor.b === backColor.b) {
      addSide(f, frontColor, true, false, frontMaterial, placement?.front ?? null, basis);
    } else {
      addSide(f, frontColor, false, false, frontMaterial, placement?.front ?? null, basis);
      addSide(f, backColor, false, true, backMaterial, placement?.back ?? null, basis);
    }
  }
  const finished: FinishedGroup[] = [];
  for (const group of groups.values()) if (group.triangleCount > 0) finished.push(group.finish());
  return finished;
}

/** The two in-plane directions texture coordinates are measured along for a face with this normal. */
function faceBasis(nx: number, ny: number, nz: number): { xr: number[]; yr: number[] } {
  const cx = -ny;
  const cy = nx;
  const clen = Math.sqrt(cx * cx + cy * cy);
  if (clen < 1e-9) return { xr: [1, 0, 0], yr: [0, nz >= 0 ? 1 : -1, 0] };
  const xr0 = cx / clen;
  const xr1 = cy / clen;
  return { xr: [xr0, xr1, 0], yr: [ny * 0 - nz * xr1, nz * xr0 - nx * 0, nx * xr1 - ny * xr0] };
}
