// Benchmark for plan recognition: draws random floor plans (known walls, doors, windows and scale)
// in the style of typical CAD/estate-agent plans, scans them and reports how well they were read.
//   npx tsx scripts/reconstruction/benchmark.mts [count] [firstSeed]       clean plans
//   DEGRADE=1 npx tsx scripts/reconstruction/benchmark.mts 25 51           blurred, noisy, low-quality JPEG
// The plans are synthetic: they check the reader's logic, not every real-world drawing style.
import sharp from 'sharp';
import { analyseFloorPlan } from '../../src/lib/reconstruction/localPlanRecognizer';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const OUT = mkdtempSync(join(tmpdir(), 'polyform-plans-')) + '/';
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
interface Seg { o: 'h' | 'v'; c: number; a0: number; a1: number; t: number; ext?: boolean }
interface Gap { o: 'h' | 'v'; c: number; a0: number; a1: number; kind: 'door' | 'window'; swing: 1 | -1; hinge: 0 | 1 }
const INCH = 0.0254;
const fmtImp = (m: number) => { const inch = Math.round(m / INCH); return `${Math.floor(inch / 12)}'${inch % 12}"`; };

function makePlan(seed: number) {
  const R = rng(seed);
  const imperial = R() < 0.5;
  const W = Math.round((8 + R() * 12) * 10) / 10, D = Math.round((6 + R() * 8) * 10) / 10;
  const ppm = 28 + R() * 40;                       // pixels per metre
  const tExt = 0.22 + R() * 0.12, tInt = 0.1 + R() * 0.08;
  const mx = 3.2, my = 2.4;                        // margin for dimension chains (metres)
  const segs: Seg[] = [];
  const split = (x0: number, y0: number, x1: number, y1: number, depth: number) => {
    const w = x1 - x0, d = y1 - y0;
    if (depth > 3 || (w < 5.4 && d < 5.4) || R() < 0.12 && depth > 1) return;
    const vertical = w >= d ? true : false;
    const len = vertical ? w : d;
    if (len < 5.4) return;
    const at = (vertical ? x0 : y0) + len * (0.38 + R() * 0.24);
    segs.push(vertical ? { o: 'v', c: at, a0: y0, a1: y1, t: tInt } : { o: 'h', c: at, a0: x0, a1: x1, t: tInt });
    if (vertical) { split(x0, y0, at, y1, depth + 1); split(at, y0, x1, y1, depth + 1); } else { split(x0, y0, x1, at, depth + 1); split(x0, at, x1, y1, depth + 1); }
  };
  split(0, 0, W, D, 0);
  const ext: Seg[] = [
    { o: 'h', c: 0, a0: 0, a1: W, t: tExt, ext: true }, { o: 'h', c: D, a0: 0, a1: W, t: tExt, ext: true },
    { o: 'v', c: 0, a0: 0, a1: D, t: tExt, ext: true }, { o: 'v', c: W, a0: 0, a1: D, t: tExt, ext: true },
  ];
  const gaps: Gap[] = [];
  const free = (o: 'h' | 'v', c: number, a: number, wd: number, self: Seg) =>
    // keep openings clear of crossing walls
    ![...segs, ...ext].some(s => s !== self && s.o !== o && Math.abs(s.c - a - wd / 2) < s.t / 2 + wd / 2 + 0.25 && s.a0 - 0.05 <= c && s.a1 + 0.05 >= c)
    && !gaps.some(g => g.o === o && Math.abs(g.c - c) < 0.3 && a < g.a1 + 0.3 && a + wd > g.a0 - 0.3);
  for (const s of segs) {
    for (let tries = 0; tries < 12; tries++) {
      const wd = 0.8 + R() * 0.2, len = s.a1 - s.a0;
      if (len < wd + 1.2) break;
      const a = s.a0 + 0.6 + R() * (len - wd - 1.2);
      if (!free(s.o, s.c, a, wd, s)) continue;
      gaps.push({ o: s.o, c: s.c, a0: a, a1: a + wd, kind: 'door', swing: R() < 0.5 ? 1 : -1, hinge: R() < 0.5 ? 0 : 1 });
      break;
    }
  }
  ext.forEach((s, si) => {
    const n = 1 + Math.floor(R() * 3) + (si === 1 ? 1 : 0);
    for (let k = 0; k < n * 4 && gaps.filter(g => g.c === s.c && g.o === s.o).length < n; k++) {
      const kind: 'door' | 'window' = si === 1 && gaps.filter(g => g.kind === 'door' && g.c === s.c && g.o === s.o).length === 0 && R() < 0.4 ? 'door' : 'window';
      const wd = kind === 'door' ? 0.9 : 1.0 + R() * 0.5, len = s.a1 - s.a0;
      const a = s.a0 + 0.8 + R() * (len - wd - 1.6);
      if (!free(s.o, s.c, a, wd, s)) continue;
      gaps.push({ o: s.o, c: s.c, a0: a, a1: a + wd, kind, swing: R() < 0.5 ? 1 : -1, hinge: R() < 0.5 ? 0 : 1 });
    }
  });

  // ---- render
  const imgW = Math.round((W + 2 * mx) * ppm), imgH = Math.round((D + 2 * my) * ppm);
  const X = (x: number) => (x + mx) * ppm, Y = (y: number) => (y + my) * ppm;
  const P = (o: 'h' | 'v', c: number, a: number): [number, number] => (o === 'h' ? [X(a), Y(c)] : [X(c), Y(a)]);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${imgW}" height="${imgH}"><rect width="100%" height="100%" fill="#fff"/>`;
  const truth = new Uint8Array(imgW * imgH);
  const fillTruth = (x0: number, y0: number, x1: number, y1: number, v: number) => {
    for (let y = Math.max(0, Math.round(y0)); y < Math.min(imgH, Math.round(y1)); y++) for (let x = Math.max(0, Math.round(x0)); x < Math.min(imgW, Math.round(x1)); x++) truth[y * imgW + x] = v;
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, fill: string) => `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="${fill}"/>`;
  // furniture clutter (thin gray outlines) first
  const fontPx = Math.max(9, ppm * 0.3);
  for (let i = 0; i < 14; i++) {
    const fx = 0.5 + R() * (W - 2), fy = 0.5 + R() * (D - 2), fw = 0.5 + R() * 1.6, fh = 0.5 + R() * 1.2;
    svg += `<rect x="${X(fx)}" y="${Y(fy)}" width="${fw * ppm}" height="${fh * ppm}" fill="none" stroke="#777" stroke-width="1"/>`;
  }
  for (let i = 0; i < 4; i++) svg += `<text x="${X(1 + R() * (W - 3))}" y="${Y(1 + R() * (D - 2))}" font-family="Liberation Sans" font-size="${fontPx}" fill="#222">${['Bedroom', 'Kitchen', 'Living', 'Bath'][i]} ${Math.round(60 + R() * 200)} sq ft</text>`;
  const all = [...ext, ...segs];
  for (const s of all) {
    const [ax, ay] = P(s.o, s.c - s.t / 2, s.a0 - s.t / 2), [bx, by] = P(s.o, s.c + s.t / 2, s.a1 + s.t / 2);
    const [x0, y0, x1, y1] = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
    svg += rect(x0, y0, x1, y1, '#000'); fillTruth(x0, y0, x1, y1, 1);
  }
  for (const g of gaps) {
    const s = all.find(q => q.o === g.o && Math.abs(q.c - g.c) < 1e-6)!;
    const t = s.t;
    const [ax, ay] = P(g.o, g.c - t / 2 - 0.01, g.a0), [bx, by] = P(g.o, g.c + t / 2 + 0.01, g.a1);
    const [x0, y0, x1, y1] = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
    svg += rect(x0, y0, x1, y1, '#fff'); fillTruth(x0, y0, x1, y1, 0);
    if (g.kind === 'window') {
      for (const f of [-0.35, 0, 0.35]) {
        const [p, q] = [P(g.o, g.c + f * t, g.a0), P(g.o, g.c + f * t, g.a1)];
        svg += `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="#555" stroke-width="1"/>`;
      }
    } else {
      const wd = g.a1 - g.a0;
      const h = g.hinge === 0 ? g.a0 : g.a1, dir = g.hinge === 0 ? 1 : -1;
      const hp = P(g.o, g.c + g.swing * t / 2, h);
      const tip = P(g.o, g.c + g.swing * (t / 2 + wd * 0.95), h + dir * wd * 0.3);
      const end = P(g.o, g.c + g.swing * t / 2, h + dir * wd);
      svg += `<line x1="${hp[0]}" y1="${hp[1]}" x2="${tip[0]}" y2="${tip[1]}" stroke="#444" stroke-width="1"/>`;
      const sweep = (g.o === 'h' ? (dir * g.swing > 0 ? 1 : 0) : (dir * g.swing > 0 ? 0 : 1));
      svg += `<path d="M ${tip[0]} ${tip[1]} A ${wd * ppm} ${wd * ppm} 0 0 ${sweep} ${end[0]} ${end[1]}" fill="none" stroke="#444" stroke-width="1"/>`;
    }
  }
  // dimension chains: top (horizontal text) and left (rotated)
  const chain = (len: number) => { const cuts = [0]; const n = 2 + Math.floor(R() * 3); for (let i = 1; i < n; i++) cuts.push(len * i / n + (R() - 0.5) * len * 0.1); cuts.push(len); return cuts.map(v => imperial ? Math.round(v / INCH) * INCH : Math.round(v * 100) / 100); };
  const label = (m: number) => imperial ? fmtImp(m) : (R() < 0.5 ? `${Math.round(m * 1000)}` : `${m.toFixed(2)} m`);
  const top = chain(W), left = chain(D);
  const ty = Y(-0.9);
  svg += `<line x1="${X(top[0]!)}" y1="${ty}" x2="${X(top[top.length - 1]!)}" y2="${ty}" stroke="#888" stroke-width="1.2"/>`;
  top.forEach((v, i) => { svg += `<line x1="${X(v)}" y1="${ty - 4}" x2="${X(v)}" y2="${ty + 4}" stroke="#888" stroke-width="1.2"/>`; if (i) svg += `<text x="${(X(v) + X(top[i - 1]!)) / 2}" y="${ty - 5}" text-anchor="middle" font-family="Liberation Sans" font-size="${fontPx}" fill="#111">${label(v - top[i - 1]!)}</text>`; });
  const lx = X(-0.9);
  svg += `<line x1="${lx}" y1="${Y(left[0]!)}" x2="${lx}" y2="${Y(left[left.length - 1]!)}" stroke="#888" stroke-width="1.2"/>`;
  left.forEach((v, i) => { svg += `<line x1="${lx - 4}" y1="${Y(v)}" x2="${lx + 4}" y2="${Y(v)}" stroke="#888" stroke-width="1.2"/>`; if (i) { const cy = (Y(v) + Y(left[i - 1]!)) / 2; svg += `<text transform="translate(${lx - 5},${cy}) rotate(-90)" text-anchor="middle" font-family="Liberation Sans" font-size="${fontPx}" fill="#111">${label(v - left[i - 1]!)}</text>`; } });
  svg += '</svg>';
  return { svg, imgW, imgH, truth, gaps, W, D, mpp: 1 / ppm, ppm, imperial, tExt, tInt };
}

const rows: string[] = [];
let sums = { scaleOk: 0, wallIou: 0, dRec: 0, dPrec: 0, wRec: 0, wPrec: 0, n: 0 };
const errs: number[] = [];
const count = Number(process.argv[2] ?? 25), first = Number(process.argv[3] ?? 1);
for (let seed = first; seed < first + count; seed++) {
  const p = makePlan(seed * 7919);
  let png = await sharp(Buffer.from(p.svg)).png().toBuffer();
  if (process.env.DEGRADE) {
    const noisy = await sharp(png).blur(0.7).linear(0.9, 14).toBuffer();
    const { data: nd, info: ni } = await sharp(noisy).raw().toBuffer({ resolveWithObject: true });
    let st = seed * 2654435761 >>> 0;
    for (let i = 0; i < nd.length; i++) { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; nd[i] = Math.max(0, Math.min(255, nd[i]! + ((st >>> 24) - 128) * 0.12)); }
    png = await sharp(await sharp(nd, { raw: { width: ni.width, height: ni.height, channels: ni.channels } }).jpeg({ quality: 45 }).toBuffer()).png().toBuffer();
  }
  await sharp(png).toFile(OUT + `plan-${String(seed).padStart(2, '0')}.png`);
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let line = '';
  try {
    const a = analyseFloorPlan({ width: info.width, height: info.height, data: new Uint8ClampedArray(data) });
    const g = a.geometry;
    const det = new Uint8Array(info.width * info.height);
    for (const w of g.walls) { const [x0, y0, x1, y1] = w.o === 'h' ? [w.a0, w.c0, w.a1, w.c1] : [w.c0, w.a0, w.c1, w.a1]; for (let y = Math.max(0, Math.round(y0)); y < Math.min(info.height, Math.round(y1)); y++) for (let x = Math.max(0, Math.round(x0)); x < Math.min(info.width, Math.round(x1)); x++) det[y * info.width + x] = 1; }
    for (const o of g.openings) { /* openings are cut out of walls in truth; they lie inside detected wall rects */ const [x0, y0, x1, y1] = o.o === 'h' ? [o.a0, o.c - o.t / 2, o.a1, o.c + o.t / 2] : [o.c - o.t / 2, o.a0, o.c + o.t / 2, o.a1]; for (let y = Math.max(0, Math.round(y0)); y < Math.min(info.height, Math.round(y1)); y++) for (let x = Math.max(0, Math.round(x0)); x < Math.min(info.width, Math.round(x1)); x++) det[y * info.width + x] = 0; }
    let inter = 0, uni = 0;
    for (let i = 0; i < det.length; i++) { const t = p.truth[i]!, d = det[i]!; if (t && d) inter++; if (t || d) uni++; }
    const iou = inter / uni;
    const scaleErr = (a.scale.metresPerPixel - p.mpp) / p.mpp * 100;
    // openings: match by centre within 0.6 m and same kind
    const toPx = (gp: typeof p.gaps[number]) => gp.o === 'h' ? [((gp.a0 + gp.a1) / 2 + 3.2) * p.ppm, (gp.c + 2.4) * p.ppm] : [(gp.c + 3.2) * p.ppm, ((gp.a0 + gp.a1) / 2 + 2.4) * p.ppm];
    const detO = g.openings.map(o => ({ k: o.kind, c: o.o === 'h' ? [(o.a0 + o.a1) / 2, o.c] : [o.c, (o.a0 + o.a1) / 2], used: false }));
    let hit = { door: 0, window: 0 };
    for (const gp of p.gaps) {
      const [cx, cy] = toPx(gp)!;
      const m = detO.find(d => !d.used && d.k === gp.kind && Math.hypot(d.c[0]! - cx!, d.c[1]! - cy!) < 0.6 * p.ppm);
      if (m) { m.used = true; hit[gp.kind]++; }
    }
    const tDoors = p.gaps.filter(x => x.kind === 'door').length, tWins = p.gaps.filter(x => x.kind === 'window').length;
    const dDoors = detO.filter(d => d.k === 'door').length, dWins = detO.filter(d => d.k === 'window').length;
    errs.push(scaleErr);
    const scaleOk = Math.abs(scaleErr) <= 3 && a.scale.source === 'dimension-text';
    sums.scaleOk += scaleOk ? 1 : 0; sums.wallIou += iou; sums.n++;
    sums.dRec += tDoors ? hit.door / tDoors : 1; sums.dPrec += dDoors ? hit.door / dDoors : 1;
    sums.wRec += tWins ? hit.window / tWins : 1; sums.wPrec += dWins ? hit.window / dWins : 1;
    line = `${String(seed).padStart(2)} ${p.imperial ? 'imp' : 'met'} ${info.width}x${info.height} ${p.W.toFixed(1)}x${p.D.toFixed(1)}m  scale ${(scaleErr >= 0 ? '+' : '') + scaleErr.toFixed(1)}% [${a.scale.source === 'dimension-text' ? 'text ' + a.scale.confidence.toFixed(2) : 'doors'}]  wallIoU ${(iou * 100).toFixed(0)}%  doors ${hit.door}/${tDoors} (+${dDoors - hit.door} extra)  windows ${hit.window}/${tWins} (+${dWins - hit.window} extra)`;
  } catch (e) { line = `${seed} ERROR ${(e as Error).message}`; sums.n++; }
  rows.push(line); console.log(line);
}
console.log('\nSUMMARY over', sums.n, 'plans');
console.log('scale within 3% from printed text:', sums.scaleOk, '/', sums.n);
console.log('worst |scale error|:', Math.max(...errs.map(Math.abs)).toFixed(1) + '%');
console.log('median |scale error|:', [...errs].map(Math.abs).sort((a, b) => a - b)[Math.floor(errs.length / 2)]?.toFixed(2) + '%');
console.log('mean wall IoU:', (sums.wallIou / sums.n * 100).toFixed(1) + '%');
console.log('door recall/precision:', (sums.dRec / sums.n * 100).toFixed(0) + '% /', (sums.dPrec / sums.n * 100).toFixed(0) + '%');
console.log('window recall/precision:', (sums.wRec / sums.n * 100).toFixed(0) + '% /', (sums.wPrec / sums.n * 100).toFixed(0) + '%');
