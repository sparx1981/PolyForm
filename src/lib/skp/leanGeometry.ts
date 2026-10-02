import earcut from 'earcut';
import { IdMap } from './idMap';
import type { EntitySink, FaceRecord, InstanceRecord } from './skpRecords';

/**
 * One component definition (or the model's own loose geometry) boiled down to what is needed to draw it:
 * its vertices, and every face already cut into triangles that point at those vertices.
 * The edges and loops a face was described with are thrown away once the triangles exist.
 */
export interface DefTemplate {
  name: string;
  /** x, y, z in SketchUp's own units, three per vertex. */
  coords: Float64Array;
  faceCount: number;
  /** Face normals, three per face. */
  normals: Float64Array;
  /** Material id painted on the front / back of each face, or -1. */
  front: Int32Array;
  back: Int32Array;
  hidden: Uint8Array;
  /** Face f owns the triangles at triStart[f] .. triStart[f + 1] (counted in triangles). */
  triStart: Uint32Array;
  /** Corners of every triangle, as indices into `coords`. */
  tris: Uint32Array;
  /** Texture placement for the faces that have one. */
  uv: Map<number, { front: number[] | null; back: number[] | null }> | null;
  instances: InstanceRecord[];
  /** The ids this definition can be known by (see the reader); set when it is read from a file. */
  id?: number | null;
  altId?: number | null;
}

const grow = <T extends Float64Array | Int32Array | Uint8Array | Int8Array>(array: T, needed: number): T => {
  if (needed <= array.length) return array;
  const next = new (array.constructor as new (n: number) => T)(Math.max(needed, array.length * 2, 16));
  next.set(array);
  return next;
};

/** Collects the records of one definition as they are read, then turns them into a {@link DefTemplate}. */
export class GeometryAccumulator implements EntitySink {
  private vertexIds = new IdMap();
  private coords = new Float64Array(96);
  private vertexCount = 0;

  private edgeIds = new IdMap();
  private edgeStart = new Float64Array(64);
  private edgeEnd = new Float64Array(64);
  private edgeCount = 0;

  private faceIds = new IdMap();
  private faceCount = 0;
  private faceNormal = new Float64Array(96);
  private faceFront = new Int32Array(32);
  private faceBack = new Int32Array(32);
  private faceHidden = new Uint8Array(32);
  private faceDead = new Uint8Array(32);
  private faceLoopFirst = new Int32Array(32);
  private faceLoopCount = new Int32Array(32);
  private faceUv = new Map<number, { front: number[] | null; back: number[] | null }>();

  private loopCoFirst = new Int32Array(64);
  private loopCoCount = new Int32Array(64);
  private loopCount = 0;

  private coEdge = new Float64Array(256);
  private coOrient = new Int8Array(256);
  private coCount = 0;

  instances: InstanceRecord[] = [];

  reset(): void {
    this.vertexIds.clear();
    this.vertexCount = 0;
    this.edgeIds.clear();
    this.edgeCount = 0;
    this.faceIds.clear();
    this.faceCount = 0;
    this.faceUv.clear();
    this.loopCount = 0;
    this.coCount = 0;
    this.instances = [];
    // A very large definition would otherwise keep its big buffers alive for every small one that follows.
    if (this.coords.length > 1 << 20) {
      this.coords = new Float64Array(96);
      this.edgeStart = new Float64Array(64);
      this.edgeEnd = new Float64Array(64);
      this.faceNormal = new Float64Array(96);
      this.faceFront = new Int32Array(32);
      this.faceBack = new Int32Array(32);
      this.faceHidden = new Uint8Array(32);
      this.faceDead = new Uint8Array(32);
      this.faceLoopFirst = new Int32Array(32);
      this.faceLoopCount = new Int32Array(32);
      this.loopCoFirst = new Int32Array(64);
      this.loopCoCount = new Int32Array(64);
      this.coEdge = new Float64Array(256);
      this.coOrient = new Int8Array(256);
    }
  }

  vertex(id: number, x: number, y: number, z: number): void {
    let slot = this.vertexIds.get(id);
    if (slot < 0) {
      slot = this.vertexCount++;
      this.coords = grow(this.coords, this.vertexCount * 3);
      this.vertexIds.set(id, slot);
    }
    this.coords[slot * 3] = x;
    this.coords[slot * 3 + 1] = y;
    this.coords[slot * 3 + 2] = z;
  }

  edge(id: number, v1: number, v2: number, _flags?: number): void {
    let slot = this.edgeIds.get(id);
    if (slot < 0) {
      slot = this.edgeCount++;
      this.edgeStart = grow(this.edgeStart, this.edgeCount);
      this.edgeEnd = grow(this.edgeEnd, this.edgeCount);
      this.edgeIds.set(id, slot);
    }
    this.edgeStart[slot] = v1;
    this.edgeEnd[slot] = v2;
  }

  face(face: FaceRecord): void {
    const previous = this.faceIds.get(face.id);
    const slot = this.faceCount++;
    if (previous >= 0) this.faceDead = grow(this.faceDead, previous + 1);
    this.faceIds.set(face.id, slot);
    this.faceNormal = grow(this.faceNormal, this.faceCount * 3);
    this.faceFront = grow(this.faceFront, this.faceCount);
    this.faceBack = grow(this.faceBack, this.faceCount);
    this.faceHidden = grow(this.faceHidden, this.faceCount);
    this.faceDead = grow(this.faceDead, this.faceCount);
    this.faceLoopFirst = grow(this.faceLoopFirst, this.faceCount);
    this.faceLoopCount = grow(this.faceLoopCount, this.faceCount);
    if (previous >= 0) this.faceDead[previous] = 1;
    this.faceDead[slot] = 0;
    this.faceNormal[slot * 3] = face.normal[0];
    this.faceNormal[slot * 3 + 1] = face.normal[1];
    this.faceNormal[slot * 3 + 2] = face.normal[2];
    this.faceFront[slot] = face.materialId;
    this.faceBack[slot] = face.backMaterialId;
    this.faceHidden[slot] = face.hidden ? 1 : 0;
    if (face.uvFront || face.uvBack) this.faceUv.set(slot, { front: face.uvFront, back: face.uvBack });
    this.faceLoopFirst[slot] = this.loopCount;
    this.faceLoopCount[slot] = face.loops.length;
    for (const loop of face.loops) {
      const pairs = loop.length / 2;
      this.loopCoFirst = grow(this.loopCoFirst, this.loopCount + 1);
      this.loopCoCount = grow(this.loopCoCount, this.loopCount + 1);
      this.coEdge = grow(this.coEdge, this.coCount + pairs);
      this.coOrient = grow(this.coOrient, this.coCount + pairs);
      this.loopCoFirst[this.loopCount] = this.coCount;
      this.loopCoCount[this.loopCount] = pairs;
      this.loopCount++;
      for (let i = 0; i < loop.length; i += 2) {
        this.coEdge[this.coCount] = loop[i];
        this.coOrient[this.coCount] = loop[i + 1];
        this.coCount++;
      }
    }
  }

  instance(instance: InstanceRecord): void {
    this.instances.push(instance);
  }

  /** The corner vertices of one loop, in order, as vertex ids (a vertex an edge names but that was never defined stays in). */
  private loopVertexIds(loop: number, out: number[]): void {
    out.length = 0;
    const first = this.loopCoFirst[loop];
    const end = first + this.loopCoCount[loop];
    for (let c = first; c < end; c++) {
      const edgeSlot = this.edgeIds.get(this.coEdge[c]);
      if (edgeSlot < 0) continue;
      const start = this.coOrient[c] === 1 ? this.edgeStart[edgeSlot] : this.edgeEnd[edgeSlot];
      if (start === -1) continue;
      if (out.length === 0 || out[out.length - 1] !== start) out.push(start);
    }
    if (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
  }

  finalize(name: string): DefTemplate {
    const trisOut: number[] = [];
    const triCounts: number[] = [];
    const keep: number[] = [];
    const ids: number[] = [];
    const loops: number[][] = [];
    for (let f = 0; f < this.faceCount; f++) {
      if (this.faceDead[f]) continue;
      loops.length = 0;
      const firstLoop = this.faceLoopFirst[f];
      for (let l = firstLoop; l < firstLoop + this.faceLoopCount[f]; l++) {
        this.loopVertexIds(l, ids);
        if (ids.length > 0) loops.push(ids.map((id) => this.vertexIds.get(id)));
      }
      if (loops.length === 0) continue;
      const before = trisOut.length;
      triangulateFace(this.coords, loops, this.faceNormal[f * 3], this.faceNormal[f * 3 + 1], this.faceNormal[f * 3 + 2], trisOut);
      // A triangle with a corner nobody defined cannot be drawn.
      let write = before;
      for (let t = before; t < trisOut.length; t += 3) {
        if (trisOut[t] < 0 || trisOut[t + 1] < 0 || trisOut[t + 2] < 0) continue;
        trisOut[write++] = trisOut[t];
        trisOut[write++] = trisOut[t + 1];
        trisOut[write++] = trisOut[t + 2];
      }
      trisOut.length = write;
      if (write === before) continue;
      keep.push(f);
      triCounts.push((write - before) / 3);
    }

    const n = keep.length;
    const normals = new Float64Array(n * 3);
    const front = new Int32Array(n);
    const back = new Int32Array(n);
    const hidden = new Uint8Array(n);
    const triStart = new Uint32Array(n + 1);
    let uv: DefTemplate['uv'] = null;
    for (let i = 0; i < n; i++) {
      const f = keep[i];
      normals[i * 3] = this.faceNormal[f * 3];
      normals[i * 3 + 1] = this.faceNormal[f * 3 + 1];
      normals[i * 3 + 2] = this.faceNormal[f * 3 + 2];
      front[i] = this.faceFront[f];
      back[i] = this.faceBack[f];
      hidden[i] = this.faceHidden[f];
      triStart[i + 1] = triStart[i] + triCounts[i];
      const placement = this.faceUv.get(f);
      if (placement) (uv ??= new Map()).set(i, placement);
    }
    return {
      name,
      coords: this.coords.slice(0, this.vertexCount * 3),
      faceCount: n,
      normals,
      front,
      back,
      hidden,
      triStart,
      tris: Uint32Array.from(trisOut),
      uv,
      instances: this.instances,
    };
  }
}

// --- Triangulation: the same method as OpenSKP's, working on vertex slots instead of ids ---

function pointInPolygon(u: number, v: number, polygon: number[]): boolean {
  let inside = false;
  const n = polygon.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ui = polygon[i * 2];
    const vi = polygon[i * 2 + 1];
    const uj = polygon[j * 2];
    const vj = polygon[j * 2 + 1];
    if (vi > v !== vj > v && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) inside = !inside;
  }
  return inside;
}

function anyVertexInside(points: number[], polygon: number[]): boolean {
  for (let i = 0; i < points.length; i += 2) if (pointInPolygon(points[i], points[i + 1], polygon)) return true;
  return false;
}

function holesOverlap(loops2d: number[][]): boolean {
  for (let i = 1; i < loops2d.length; i++) {
    for (let j = i + 1; j < loops2d.length; j++) {
      if (anyVertexInside(loops2d[i], loops2d[j]) || anyVertexInside(loops2d[j], loops2d[i])) return true;
    }
  }
  return false;
}

function fan(outer: number[], out: number[]): void {
  for (let i = 1; i < outer.length - 1; i++) out.push(outer[0], outer[i], outer[i + 1]);
}

/** Appends the triangles of one face (corners as vertex slots, -1 for a vertex that does not exist) to `out`. */
export function triangulateFace(coords: Float64Array, loops: number[][], nx0: number, ny0: number, nz0: number, out: number[]): void {
  if (loops.length === 0) return;
  if (loops.length === 1 && loops[0].length === 3) {
    out.push(loops[0][0], loops[0][1], loops[0][2]);
    return;
  }
  if (loops.length === 1 && loops[0].length === 4) {
    const v = loops[0];
    out.push(v[0], v[1], v[2], v[0], v[2], v[3]);
    return;
  }
  let nx = nx0;
  let ny = ny0;
  let nz = nz0;
  const normVal = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (normVal > 1e-6) {
    nx /= normVal;
    ny /= normVal;
    nz /= normVal;
  } else {
    nx = 0;
    ny = 0;
    nz = 1;
  }
  const uAxis = Math.abs(nx) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let ux = ny * uAxis[2] - nz * uAxis[1];
  let uy = nz * uAxis[0] - nx * uAxis[2];
  let uz = nx * uAxis[1] - ny * uAxis[0];
  const uLen = Math.sqrt(ux * ux + uy * uy + uz * uz);
  if (uLen < 1e-12) {
    ux = 1;
    uy = 0;
    uz = 0;
  } else {
    ux /= uLen;
    uy /= uLen;
    uz /= uLen;
  }
  let vx = ny * uz - nz * uy;
  let vy = nz * ux - nx * uz;
  let vz = nx * uy - ny * ux;
  const vLen = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (vLen > 1e-12) {
    vx /= vLen;
    vy /= vLen;
    vz /= vLen;
  }
  const loops2d: number[][] = [];
  for (const loop of loops) {
    const pts: number[] = [];
    for (const slot of loop) {
      if (slot < 0) return;
      const x = coords[slot * 3];
      const y = coords[slot * 3 + 1];
      const z = coords[slot * 3 + 2];
      pts.push(x * ux + y * uy + z * uz, x * vx + y * vy + z * vz);
    }
    loops2d.push(pts);
  }
  if (loops.length > 2 && holesOverlap(loops2d)) {
    const outer = loops[0];
    let tri: number[];
    try {
      tri = earcut(loops2d[0], [], 2);
    } catch {
      fan(outer, out);
      return;
    }
    const outer2d = loops2d[0];
    for (let i = 0; i < tri.length; i += 3) {
      const ia = tri[i];
      const ib = tri[i + 1];
      const ic = tri[i + 2];
      const cu = (outer2d[ia * 2] + outer2d[ib * 2] + outer2d[ic * 2]) / 3;
      const cv = (outer2d[ia * 2 + 1] + outer2d[ib * 2 + 1] + outer2d[ic * 2 + 1]) / 3;
      let insideAnyHole = false;
      for (let h = 1; h < loops2d.length; h++) {
        if (pointInPolygon(cu, cv, loops2d[h])) {
          insideAnyHole = true;
          break;
        }
      }
      if (!insideAnyHole) out.push(outer[ia], outer[ib], outer[ic]);
    }
    return;
  }
  const all: number[] = [];
  const holeIndices: number[] = [];
  const flat: number[] = [];
  let offset = 0;
  for (let l = 0; l < loops.length; l++) {
    if (l > 0) holeIndices.push(offset);
    for (const slot of loops[l]) all.push(slot);
    for (const value of loops2d[l]) flat.push(value);
    offset += loops[l].length;
  }
  let tri: number[];
  try {
    tri = earcut(flat, holeIndices, 2);
  } catch {
    fan(loops[0], out);
    return;
  }
  for (let i = 0; i < tri.length; i += 3) out.push(all[tri[i]], all[tri[i + 1]], all[tri[i + 2]]);
}
