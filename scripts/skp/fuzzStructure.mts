// Differential fuzz: random nesting of containers, definitions, geometry and junk records; the low-memory reader must
// agree with OpenSKP's on every one. usage: tsx fuzzStructure.mts [iterations] [seed]
import { buildInstancedScene, toInstancedGLB } from 'openskp';
import { readSkpToGlbLean } from '../../src/lib/skp/skpLeanReader';
import { buildSkp, definition, edge, face, instance, rec, vertex, translation } from '../../src/lib/skp/testing/synthSkp';
import { compareGlb } from './compareReaders.mts';

let seed = Number(process.argv[3] ?? 1);
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const CONTAINERS = ['F901', 'F801', 'F701', '8813', 'D430', '9713', '9013', '401F'];

function quad(ids: { v: number; e: number; f: number }, material?: number): Buffer[] {
  const out: Buffer[] = [];
  const x = rnd() * 100, y = rnd() * 100;
  const vs = [[0, 0], [10, 0], [10, 10], [0, 10]].map(([dx, dy]) => { out.push(vertex(ids.v, x + dx, y + dy, 0)); return ids.v++; });
  const co: Array<[number, number]> = [];
  for (let i = 0; i < 4; i++) { out.push(edge(ids.e, vs[i], vs[(i + 1) % 4])); co.push([ids.e++, 0]); }
  out.push(face(ids.f++, 0, 0, 1, [co], material === undefined ? {} : { material }));
  return out;
}

function junk(): Buffer { return rec(pick(['AA01', 'BB02', 'CC03', '1234']), Buffer.from(Array.from({ length: Math.floor(rnd() * 12) }, () => Math.floor(rnd() * 256)))); }

function content(depth: number, state: { defs: number[]; ids: { v: number; e: number; f: number }; nextDef: number }, inDef: boolean): Buffer[] {
  const out: Buffer[] = [];
  const n = 1 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const r = rnd();
    if (r < 0.3 && inDef) out.push(...quad(state.ids));
    else if (r < 0.45 && state.defs.length) out.push(instance(pick(state.defs), translation(rnd() * 50, rnd() * 50, 0), rnd() < 0.3 ? { name: 'n' + i } : {}));
    else if (r < 0.6 && depth < 3) {
      const id = state.nextDef++;
      const body = content(depth + 1, state, true);
      if (rnd() < 0.5) out.push(definition(id, 'Def' + id, body));
      else { const parts = [...body, definition(id, 'x', []).subarray(0, 0), ...definition(id, 'Def' + id, []).length ? [] : []]; void parts; const d = definition(id, 'Def' + id, []); /* same header records, geometry placed before them */ out.push(rec('7C15', [...body, d.subarray(6)])); }
      state.defs.push(id);
    } else if (r < 0.8 && depth < 4) out.push(rec(pick(CONTAINERS), content(depth + 1, state, inDef)));
    else out.push(junk());
  }
  return out;
}

const iterations = Number(process.argv[2] ?? 500);
let bad = 0;
let nonEmpty = 0;
for (let it = 0; it < iterations; it++) {
  const state = { defs: [] as number[], ids: { v: 1, e: 1, f: 1 }, nextDef: 1 };
  const records: Buffer[] = [];
  for (let k = 0; k < 1 + Math.floor(rnd() * 4); k++) records.push(rec(pick(CONTAINERS), content(0, state, false)));
  records.push(rec('F601', [...content(0, state, true), ...(state.defs.length ? [instance(state.defs[0], translation(0, 0, 0))] : [])]));
  const skp = buildSkp({ model: records, wrapF401: rnd() < 0.6 });
  const ab = skp.buffer.slice(skp.byteOffset, skp.byteOffset + skp.byteLength) as ArrayBuffer;
  let ref: Uint8Array | string, lean: Uint8Array | string;
  try { ref = toInstancedGLB(buildInstancedScene(ab.slice(0), { respectEdgeVisibility: true })); } catch (e) { ref = 'THROW ' + (e as Error).message; }
  try { lean = readSkpToGlbLean(ab.slice(0), { respectEdgeVisibility: true, allowEmptyScene: true }); } catch (e) { lean = 'THROW ' + (e as Error).message; }
  let problems: string[] = [];
  if (typeof ref === 'string' || typeof lean === 'string') { if (typeof ref !== typeof lean || (typeof ref === 'string' && !/Recursive/.test(ref as string) )) problems = [`ref=${typeof ref === 'string' ? ref : 'ok'} lean=${typeof lean === 'string' ? lean : 'ok'}`]; }
  else { problems = compareGlb(ref, lean); if (lean.length > 600) nonEmpty++; }
  if (problems.length) { bad++; console.log(`iteration ${it} (seed ${process.argv[3] ?? 1}):`, problems.join('; ')); if (bad > 5) break; }
}
console.log(bad ? `${bad} mismatching cases` : `all ${iterations} random structures agree (${nonEmpty} with geometry)`);
