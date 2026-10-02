// Builds a synthetic SketchUp 2021+ style (.skp: VFF header + ZIP holding model.dat) file for memory and parity tests.
// It writes only the records that OpenSKP's reader looks at, so it is not a real SketchUp export.
import { zipSync } from 'fflate';

type Payload = Buffer | Buffer[];
export interface FaceOptions { material?: number; backMaterial?: number; hidden?: boolean; uvFront?: number[] }
export interface InstanceOptions { name?: string; material?: number; layer?: number; hidden?: boolean; attributes?: [string, string, string] }

const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const f64s = (...v: number[]) => { const b = Buffer.alloc(8 * v.length); v.forEach((x, i) => b.writeDoubleLE(x, i * 8)); return b; };
const varint = (n: number) => {
  const out: number[] = [];
  do { out.push(n % 256); n = Math.floor(n / 256); } while (n > 0);
  return Buffer.from(out);
};
export const rec = (tag: string, payload: Payload = Buffer.alloc(0)): Buffer => {
  const p = Array.isArray(payload) ? Buffer.concat(payload) : payload;
  return Buffer.concat([Buffer.from([parseInt(tag.slice(0, 2), 16), parseInt(tag.slice(2, 4), 16)]), u32(p.length), p]);
};
const idRec = (id: number) => { const v = varint(id); return rec('DC05', Buffer.concat([Buffer.from([0xde, 0x05]), u32(v.length), v])); };

export const vertex = (id: number, x: number, y: number, z: number) => rec('C409', [idRec(id), rec('C509', f64s(x, y, z))]);
export const edge = (id: number, v1: number, v2: number, flags?: number) => rec('B80B', [idRec(id), rec('B90B', varint(v1)), rec('BA0B', varint(v2)), ...(flags === undefined ? [] : [rec('D007', [rec('D307', Buffer.from([flags]))])])]);
export const face = (id: number, nx: number, ny: number, nz: number, loops: Array<Array<[number, number]>>, opts: FaceOptions = {}) => {
  const loopRecs = loops.map((coedges) => rec('9411', coedges.map(([edgeId, orient]) => rec('A00F', [rec('A10F', varint(edgeId)), rec('A20F', varint(orient))]))));
  const d007: Buffer[] = [];
  if (opts.material !== undefined) d007.push(rec('D107', varint(opts.material)));
  if (opts.hidden) d007.push(rec('D307', Buffer.from([1])));
  if (opts.uvFront) d007.push(rec('DC05', rec('DD05', rec('B136', rec('B236', rec('1027', rec('1127', rec('1327', rec('1527', f64s(...opts.uvFront))))))))));
  return rec('AC0D', [idRec(id), rec('AD0D', f64s(nx, ny, nz)), rec('AE0D', loopRecs), ...(d007.length ? [rec('D007', d007)] : []), ...(opts.backMaterial !== undefined ? [rec('AF0D', varint(opts.backMaterial))] : [])]);
};
export const instance = (defIdx: number, matrix13: number[], opts: InstanceOptions = {}) => rec('6419', [
  rec('6819', Buffer.alloc(16, 7)),
  rec('6719', varint(defIdx)),
  ...(opts.name ? [rec('6519', Buffer.from(opts.name, 'utf8'))] : []),
  rec('6619', f64s(...matrix13)),
  ...(opts.material !== undefined || opts.layer !== undefined || opts.hidden || opts.attributes
    ? [rec('D007', [...(opts.material !== undefined ? [rec('D107', varint(opts.material))] : []), ...(opts.layer !== undefined ? [rec('D207', varint(opts.layer))] : []), ...(opts.hidden ? [rec('D307', Buffer.from([1]))] : []), ...(opts.attributes ? [rec('DC05', rec('DD05', rec('B536', [rec('B436', Buffer.from(opts.attributes[0])), rec('B336', [rec('B636', Buffer.from(opts.attributes[1])), rec('A438', rec('AD38', Buffer.from(opts.attributes[2])))])])))] : [])])]
    : []),
]);
export const definition = (id: number, name: string, children: Buffer[]) => rec('7C15', [rec('7D15', Buffer.alloc(16, id & 255)), rec('7E15', Buffer.from(name, 'utf8')), idRec(id), ...children]);
export const layer = (id: number, name: string, hidden = false) => rec('993A', [rec('8C3C', [idRec(id), rec('8D3C', Buffer.from(name)), rec('8E3C', Buffer.from([hidden ? 1 : 0]))])]);
export const materialEntry = (id: number, name: string) => rec('C832', [idRec(id), rec('CC32', Buffer.from(name))]);
export const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
export const translation = (x: number, y: number, z: number) => [1, 0, 0, 0, 1, 0, 0, 0, 1, x, y, z, 1];

/** A grid of w by h unit quads (with shared vertices), as vertex/edge/face records. */
export function gridGeometry(w: number, h: number, size = 10, material?: number): Buffer[] {
  const recs: Buffer[] = [];
  const vid = (i: number, j: number) => 1 + i * (h + 1) + j;
  for (let i = 0; i <= w; i++) for (let j = 0; j <= h; j++) recs.push(vertex(vid(i, j), i * size, j * size, 0));
  let eid = 1;
  const hEdge = new Map<string, number>(), vEdge = new Map<string, number>();
  for (let i = 0; i < w; i++) for (let j = 0; j <= h; j++) { hEdge.set(`${i},${j}`, eid); recs.push(edge(eid++, vid(i, j), vid(i + 1, j))); }
  for (let i = 0; i <= w; i++) for (let j = 0; j < h; j++) { vEdge.set(`${i},${j}`, eid); recs.push(edge(eid++, vid(i, j), vid(i, j + 1))); }
  let fid = 1;
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) {
    recs.push(face(fid++, 0, 0, 1, [[
      [hEdge.get(`${i},${j}`)!, 0], [vEdge.get(`${i + 1},${j}`)!, 0], [hEdge.get(`${i},${j + 1}`)!, 1], [vEdge.get(`${i},${j}`)!, 1],
    ]], material === undefined ? {} : { material }));
  }
  return recs;
}

export function buildSkp({ model, files = {}, wrapF401 = true }: { model: Buffer[]; files?: Record<string, Uint8Array>; wrapF401?: boolean }): Buffer {
  const dat = wrapF401 ? rec('F401', model) : Buffer.concat(model);
  const zipped = zipSync({ 'model.dat': new Uint8Array(dat), ...files }, { level: 1 });
  const header = Buffer.concat([Buffer.from([0xff, 0xfe, 0xff, 0x0e]), Buffer.from([0xff, 0xfe, 0xff, 0x0a]), Buffer.from('{00000000-0000-0000-0000-000000000000}', 'utf16le')]);
  return Buffer.concat([header, Buffer.from(zipped)]);
}

export const materialXml = (name: string, r: number, g: number, b: number, extra = '') => Buffer.from(`<?xml version="1.0"?><material name="${name}" colorRed="${r}" colorGreen="${g}" colorBlue="${b}" ${extra}/>`);
