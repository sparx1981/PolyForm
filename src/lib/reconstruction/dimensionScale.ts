/**
 * Works out a floor plan's scale from the dimensions printed on it.
 *
 * Plans carry dimension chains outside the walls: a thin line with tick marks, and between each pair of
 * ticks the real length as text (7'2", 3600, 4.2 m). The distance between two ticks in pixels and the
 * value in the text give the scale. Reading tiny text is error prone, so every chain reading is only a
 * vote: the scale most strings agree on wins, and one misread digit is simply outvoted.
 */
import { GLYPH_GRID, GLYPH_TEMPLATES } from './glyphTemplates';

export interface DimensionReading {
  text: string;
  /** Length in metres the text stands for. */
  valueM: number;
  /** Distance between the two ticks, pixels. */
  pixels: number;
  /** The tick positions in the original image. */
  a: [number, number];
  b: [number, number];
  side: 'top' | 'bottom' | 'left' | 'right';
  /** 0 to 1: how sure the reader is of the characters. */
  confidence: number;
}

export interface ScaleEstimate {
  metresPerPixel: number;
  source: 'dimension-text' | 'door-width';
  confidence: number;
  evidence: string;
  /** For dimension text: a pair of points on the plan and the length between them, ready for the calibration tool. */
  pointA?: [number, number];
  pointB?: [number, number];
  knownDistanceM?: number;
  readings?: DimensionReading[];
}

const INCH = 0.0254;

// ---------------------------------------------------------------------------------------------
// Parsing the text of a dimension
// ---------------------------------------------------------------------------------------------

/** "7'2\"", "10' 5", "8'", "3600", "3.6 m", "3,600 mm" -> metres, or null. */
export function parseDimension(raw: string): number | null {
  // A plain number never starts with a zero (0998 is a misread 3998), unless it is a decimal.
  if (/^0\d/.test(raw.trim())) return null;
  // Ticks read as ' or " depending on the resolution, so structure decides: feet mark, inches mark.
  const text = raw.replace(/[′’ʹ`]/g, "'").replace(/[″”ʺ]/g, '"').replace(/\s+/g, ' ').trim();
  // Two marks in a row are one inch mark; a lone mark after digits is feet unless it is the last one.
  const marks = text.replace(/['"]{2,}/g, '"');
  const digitsMarks = /^(\d{1,3})['"](\d{1,2})['"]?$/.exec(marks);
  if (digitsMarks) {
    const feet = Number(digitsMarks[1]), inches = Number(digitsMarks[2]);
    return inches >= 12 ? null : (feet * 12 + inches) * INCH;
  }
  let m = /^(\d{1,3})\s*'\s*(\d{1,2})(?:\s*(\d)\/(\d))?\s*"?$/.exec(text);
  if (m) {
    const feet = Number(m[1]), inches = Number(m[2]);
    if (inches >= 12) return null;
    const frac = m[3] && m[4] && Number(m[4]) ? Number(m[3]) / Number(m[4]) : 0;
    return (feet * 12 + inches + frac) * INCH;
  }
  m = /^(\d{1,3})\s*'$/.exec(text);
  if (m) return Number(m[1]) * 12 * INCH;
  m = /^(\d{1,3})\s*"$/.exec(text);
  if (m) return Number(m[1]) * INCH;
  m = /^(\d+(?:[.,]\d+)?)\s*m$/i.exec(text);
  if (m) return Number(m[1]!.replace(',', '.'));
  m = /^(\d{1,3}(?:,\d{3})+)\s*mm$/i.exec(text);
  if (m) return Number(m[1]!.replace(/,/g, '')) / 1000;
  m = /^(\d+(?:[.,]\d+)?)\s*mm$/i.exec(text);
  if (m) return Number(m[1]!.replace(',', '.')) / 1000;
  m = /^(\d{1,2})[ ,.]?(\d{3})$/.exec(text); // 3600 or 3,600 (millimetres)
  if (m) return Number(m[1]! + m[2]!) / 1000;
  m = /^(\d{3,5})$/.exec(text);
  if (m) return Number(m[1]) / 1000;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Pictures: strips, rotation, connected components
// ---------------------------------------------------------------------------------------------

interface Gray { w: number; h: number; d: Uint8Array }

function crop(src: Uint8Array, sw: number, x0: number, y0: number, x1: number, y1: number): Gray {
  const w = Math.max(0, x1 - x0), h = Math.max(0, y1 - y0);
  const d = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = src[(y0 + y) * sw + x0 + x]!;
  return { w, h, d };
}

/** Quarter turns clockwise. Returns the picture and a map from its coordinates back to the source's. */
function rotate(g: Gray, quarter: 0 | 1 | 2 | 3): { g: Gray; back: (x: number, y: number) => [number, number] } {
  if (quarter === 0) return { g, back: (x, y) => [x, y] };
  if (quarter === 2) {
    const d = new Uint8Array(g.d.length);
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) d[(g.h - 1 - y) * g.w + (g.w - 1 - x)] = g.d[y * g.w + x]!;
    return { g: { w: g.w, h: g.h, d }, back: (x, y) => [g.w - 1 - x, g.h - 1 - y] };
  }
  const w = g.h, h = g.w;
  const d = new Uint8Array(w * h);
  if (quarter === 1) {
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) d[x * w + (g.h - 1 - y)] = g.d[y * g.w + x]!;
    return { g: { w, h, d }, back: (x, y) => [y, g.h - 1 - x] };
  }
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) d[(g.w - 1 - x) * w + y] = g.d[y * g.w + x]!;
  return { g: { w, h, d }, back: (x, y) => [g.w - 1 - y, x] };
}

interface Comp { x0: number; y0: number; x1: number; y1: number; area: number }

function components(g: Gray, limit: number): Comp[] {
  const seen = new Uint8Array(g.w * g.h);
  const out: Comp[] = [];
  const stack: number[] = [];
  for (let s = 0; s < g.d.length; s++) {
    if (seen[s] || g.d[s]! >= limit) continue;
    let x0 = g.w, y0 = g.h, x1 = -1, y1 = -1, area = 0;
    stack.push(s); seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % g.w, y = (p / g.w) | 0;
      area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
        const q = ny * g.w + nx;
        if (!seen[q] && g.d[q]! < limit) { seen[q] = 1; stack.push(q); }
      }
    }
    out.push({ x0, y0, x1, y1, area });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Recognising glyphs
// ---------------------------------------------------------------------------------------------

function toGrid(g: Gray, c: { x0: number; y0: number; x1: number; y1: number }): number[] {
  const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
  const { w: GW, h: GH } = GLYPH_GRID;
  const out: number[] = [];
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    // Bilinear-ish: average the source pixels this cell covers, weighting partial pixels.
    const sx0 = (gx * w) / GW, sx1 = ((gx + 1) * w) / GW, sy0 = (gy * h) / GH, sy1 = ((gy + 1) * h) / GH;
    let sum = 0, weight = 0;
    for (let y = Math.floor(sy0); y < Math.ceil(sy1); y++) for (let x = Math.floor(sx0); x < Math.ceil(sx1); x++) {
      const wx = Math.min(x + 1, sx1) - Math.max(x, sx0), wy = Math.min(y + 1, sy1) - Math.max(y, sy0);
      const wgt = wx * wy;
      if (wgt <= 0) continue;
      sum += (1 - g.d[(c.y0 + y) * g.w + c.x0 + x]! / 255) * wgt;
      weight += wgt;
    }
    out.push(weight ? (sum / weight) * 255 : 0);
  }
  return out;
}

export interface GlyphGuess { char: string; cost: number }

/** Best guesses for one glyph, cheapest first. `digitHeight` and `stringTop` place it within its string. */
function classify(g: Gray, c: Comp, digitHeight: number, stringTop: number): GlyphGuess[] {
  const grid = toGrid(g, c);
  const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
  const aspect = w / h, heightRel = h / digitHeight, topRel = (c.y0 - stringTop) / digitHeight;
  const guesses: GlyphGuess[] = [];
  const short = heightRel < 0.62;
  for (const [char, templates] of Object.entries(GLYPH_TEMPLATES)) {
    if (short !== ("'\".".includes(char))) continue;
    let best = Infinity;
    for (const t of templates) {
      let sq = 0;
      for (let i = 0; i < grid.length; i++) { const d = (grid[i]! - t.grid[i]!) / 255; sq += d * d; }
      const shape = Math.sqrt(sq / grid.length);
      const cost = shape * 2.2 + Math.abs(Math.log(aspect / t.aspect)) * 0.9 + Math.abs(heightRel - t.heightRel) * 1.6 + Math.abs(topRel - t.topRel) * 1.2;
      if (cost < best) best = cost;
    }
    guesses.push({ char, cost: best });
  }
  return guesses.sort((a, b) => a.cost - b.cost);
}

interface Hypothesis { text: string; cost: number }

/** The few most likely readings of a string, from each glyph's two best guesses. */
function hypotheses(glyphs: GlyphGuess[][]): Hypothesis[] {
  let beams: Hypothesis[] = [{ text: '', cost: 0 }];
  for (const guesses of glyphs) {
    const next: Hypothesis[] = [];
    for (const beam of beams) for (const guess of guesses.slice(0, 3)) {
      if (guess.cost - guesses[0]!.cost > 0.35) continue;
      next.push({ text: beam.text + guess.char, cost: beam.cost + guess.cost });
    }
    beams = next.sort((a, b) => a.cost - b.cost).slice(0, 24);
  }
  return beams;
}

// ---------------------------------------------------------------------------------------------
// Reading one dimension chain
// ---------------------------------------------------------------------------------------------

interface ChainString {
  hyps: Hypothesis[];
  cx: number;
  glyphs: number;
  /** The tick pair around it, in strip coordinates. */
  t0: number;
  t1: number;
  line: number;
}

interface Chain { strings: ChainString[]; ticks: number[]; line: number; back: (x: number, y: number) => [number, number] }

function findChain(strip: Gray, alongLen: number, u: number): { line: number; ticks: number[] } | null {
  let bestRow = -1, bestCount = 0;
  for (let y = 0; y < strip.h; y++) {
    let n = 0;
    for (let x = 0; x < strip.w; x++) if (strip.d[y * strip.w + x]! < 205) n++;
    if (n > bestCount) { bestCount = n; bestRow = y; }
  }
  if (bestRow < 0 || bestCount < alongLen * 0.4) return null;
  // Thin lines can be drawn two pixels thick or anti-aliased over two rows: take the middle of the run.
  let top = bestRow, bottom = bestRow;
  const rowCount = (y: number) => { let n = 0; for (let x = 0; x < strip.w; x++) if (strip.d[y * strip.w + x]! < 205) n++; return n; };
  while (top > 0 && rowCount(top - 1) >= bestCount * 0.7) top--;
  while (bottom < strip.h - 1 && rowCount(bottom + 1) >= bestCount * 0.7) bottom++;
  const line = (top + bottom) / 2;
  const ticks: number[] = [];
  let run: number[] = [];
  const dark = (x: number, y: number) => y >= 0 && y < strip.h && strip.d[y * strip.w + x]! < 225;
  // Count unbroken dark pixels outward from the line, forgiving one anti-aliased gap.
  const reach = (x: number, from: number, step: 1 | -1) => {
    let n = 0, gap = 0;
    for (let k = 0; k < 14 * u; k++) {
      if (dark(x, from + step * k)) { n++; gap = 0; } else if (++gap > Math.max(1, Math.round(u))) break;
    }
    return n;
  };
  const flush = () => { if (run.length) { ticks.push(run.reduce((a, b) => a + b, 0) / run.length); run = []; } };
  // Tick marks do not grow with the image the way text does, so they are judged more leniently on big plans.
  const tu = Math.min(u, 1.2);
  // A tick is a short stroke across the line: dark rows unbroken above and below it add up to a few pixels.
  for (let x = 0; x < strip.w; x++) {
    const up = reach(x, Math.floor(top) - 1, -1), down = reach(x, Math.ceil(bottom) + 1, 1);
    if (up >= 1.5 * tu && down >= 1.5 * tu && up + down >= 4.2 * tu && up <= 12.5 * u && down <= 12.5 * u) run.push(x); else if (run.length && x - run[run.length - 1]! > 1) flush();
  }
  flush();
  return ticks.length >= 2 ? { line, ticks } : null;
}

function readChain(strip: Gray, alongLen: number, u: number, back: Chain['back']): Chain | null {
  const found = findChain(strip, alongLen, u);
  if (!found) return null;
  const { line, ticks } = found;
  // Text sits just above or below the line.
  const ya = Math.max(0, Math.floor(line - 24 * u)), yb = Math.min(strip.h, Math.ceil(line + 25 * u));
  const region = crop(strip.d, strip.w, 0, ya, strip.w, yb);
  const lineInRegion = line - ya;
  // Knock out the line and the tick stubs so they cannot join characters.
  const knock = Math.ceil(u);
  for (let y = Math.max(0, Math.floor(lineInRegion) - knock); y <= Math.min(region.h - 1, Math.ceil(lineInRegion) + knock); y++) for (let x = 0; x < region.w; x++) region.d[y * region.w + x] = 255;
  const comps = components(region, 175).filter(c => c.area >= 1.7 * u);
  const tall = comps.filter(c => c.y1 - c.y0 + 1 >= 5.1 * u && c.y1 - c.y0 + 1 <= 27 * u && c.x1 - c.x0 + 1 <= (c.y1 - c.y0 + 1) * 1.6);
  if (!tall.length) return null;
  const heights = tall.map(c => c.y1 - c.y0 + 1).sort((a, b) => a - b);
  const H = heights[Math.floor(heights.length / 2)]!;
  const glyphComps = comps.filter(c => {
    const h = c.y1 - c.y0 + 1, w = c.x1 - c.x0 + 1;
    if (h >= 0.75 * H && h <= 1.3 * H && w <= 1.7 * H) return true;
    return h >= 0.18 * H && h < 0.9 * H && w <= 1.15 * H && c.area >= 2; // marks, points and the letter m
  });
  // Split fused pairs (two digits, or a digit and a mark, touching).
  const split: Comp[] = [];
  for (const c of glyphComps) {
    const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
    if (h >= 0.75 * H && w > 0.95 * H) {
      let bestX = -1, bestInk = Infinity;
      for (let x = c.x0 + Math.floor(w * 0.3); x <= c.x0 + Math.ceil(w * 0.7); x++) {
        let ink = 0;
        for (let y = c.y0; y <= c.y1; y++) ink += 255 - region.d[y * region.w + x]!;
        if (ink < bestInk) { bestInk = ink; bestX = x; }
      }
      split.push({ ...c, x1: bestX }, { ...c, x0: bestX + 1 });
    } else split.push(c);
  }
  const sorted = split.sort((a, b) => a.x0 - b.x0);
  // Group into strings: neighbours on the same baseline, a character's width apart at most.
  const groups: Comp[][] = [];
  for (const c of sorted) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    if (last && prev && c.x0 - prev.x1 <= 0.9 * H) last.push(c); else groups.push([c]);
  }
  const strings: ChainString[] = [];
  for (const group of groups) {
    const digits = group.filter(c => c.y1 - c.y0 + 1 >= 0.75 * H);
    if (digits.length < 1) continue;
    const top = Math.min(...digits.map(c => c.y0));
    const glyphs = group.map(c => classify(region, c, H, top));
    const cx = (group[0]!.x0 + group[group.length - 1]!.x1) / 2;
    const idx = ticks.findIndex((t, i) => t <= cx && ticks[i + 1] !== undefined && ticks[i + 1]! >= cx);
    if (idx < 0) continue;
    strings.push({ hyps: hypotheses(glyphs), cx, glyphs: group.length, t0: ticks[idx]!, t1: ticks[idx + 1]!, line });
  }
  return { strings, ticks, line, back };
}

// ---------------------------------------------------------------------------------------------
// The public entry: read every margin and vote
// ---------------------------------------------------------------------------------------------

export interface DimensionScaleInput {
  luminance: Uint8Array;
  width: number;
  height: number;
  /** Wall extents in the image. Dimension chains lie outside them. */
  bounds: { x0: number; y0: number; x1: number; y1: number };
}

/** A plausible drawing scale: a wall run or room is somewhere between ~1 m and ~60 m. */
const plausible = (m: number, px: number) => px > 20 && m / px > 0.0015 && m / px < 0.2;

export function estimateScaleFromDimensions(input: DimensionScaleInput, prior?: { metresPerPixel: number }, debug?: (line: string) => void): ScaleEstimate | null {
  const { luminance, width, height, bounds } = input;
  const margin = 3;
  // Everything printed scales with the picture; 1 is a plan roughly 700 px across.
  const unit = Math.min(6, Math.max(0.5, Math.max(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0) / 706));
  const variants: Array<{ side: DimensionReading['side']; strip: Gray; along: number; rotations: Array<0 | 1 | 2 | 3>; origin: [number, number] }> = [];
  if (bounds.y0 - margin > 14 * unit) variants.push({ side: 'top', strip: crop(luminance, width, 0, 0, width, bounds.y0 - margin), along: bounds.x1 - bounds.x0, rotations: [0, 2], origin: [0, 0] });
  if (height - bounds.y1 - margin > 14 * unit) variants.push({ side: 'bottom', strip: crop(luminance, width, 0, bounds.y1 + margin, width, height), along: bounds.x1 - bounds.x0, rotations: [0, 2], origin: [0, bounds.y1 + margin] });
  if (bounds.x0 - margin > 14 * unit) variants.push({ side: 'left', strip: crop(luminance, width, 0, 0, bounds.x0 - margin, height), along: bounds.y1 - bounds.y0, rotations: [1, 3], origin: [0, 0] });
  if (width - bounds.x1 - margin > 14 * unit) variants.push({ side: 'right', strip: crop(luminance, width, bounds.x1 + margin, 0, width, height), along: bounds.y1 - bounds.y0, rotations: [1, 3], origin: [bounds.x1 + margin, 0] });

  interface Vote { text: string; valueM: number; pixels: number; a: [number, number]; b: [number, number]; side: DimensionReading['side']; cost: number; group: number }
  const votes: Vote[] = [];
  let group = 0;
  for (const v of variants) {
    let best: { chain: Chain; score: number } | null = null;
    for (const q of v.rotations) {
      const rot = rotate(v.strip, q);
      const chain = readChain(rot.g, v.along, unit, rot.back);
      if (!chain) continue;
      const parsed = chain.strings.filter(s => s.hyps.some(h => parseDimension(h.text) !== null)).length;
      const score = parsed + chain.strings.length * 0.01;
      if (!best || score > best.score) best = { chain, score };
    }
    if (!best) continue;
    const { chain } = best;
    debug?.(`${v.side}: line ${chain.line.toFixed(1)}, ticks ${chain.ticks.map(t => t.toFixed(0)).join(' ')}`);
    for (const s of chain.strings) {
      group++;
      debug?.(`  [${s.t0.toFixed(0)}..${s.t1.toFixed(0)}] ${(s.t1 - s.t0).toFixed(0)}px: ${s.hyps.slice(0, 4).map(h => `${h.text}(${h.cost.toFixed(2)})`).join(' ')}`);
      for (const h of s.hyps) {
        const m = parseDimension(h.text);
        const px = s.t1 - s.t0;
        if (m === null || !plausible(m, px)) continue;
        const [ax, ay] = chain.back(s.t0, s.line), [bx, by] = chain.back(s.t1, s.line);
        votes.push({
          text: h.text, valueM: m, pixels: px, side: v.side, cost: h.cost / Math.max(1, s.glyphs), group,
          a: [ax + v.origin[0], ay + v.origin[1]], b: [bx + v.origin[0], by + v.origin[1]],
        });
      }
    }
  }
  if (!votes.length) return null;

  // Consensus: the scale (metres per pixel) that the most strings can explain within 2.5 %.
  let bestScale = 0, bestSupport = 0, bestCost = Infinity;
  const candidates = [...new Set(votes.map(v => v.valueM / v.pixels))];
  for (const s of candidates) {
    if (prior && (s < prior.metresPerPixel / 1.8 || s > prior.metresPerPixel * 1.8)) continue;
    const perGroup = new Map<number, number>();
    for (const v of votes) {
      const k = v.valueM / v.pixels;
      if (Math.abs(k - s) / s <= 0.025) perGroup.set(v.group, Math.min(perGroup.get(v.group) ?? Infinity, v.cost));
    }
    const support = perGroup.size;
    const cost = [...perGroup.values()].reduce((a, b) => a + b, 0) / Math.max(1, support);
    if (support > bestSupport || (support === bestSupport && cost < bestCost)) { bestSupport = support; bestScale = s; bestCost = cost; }
  }
  if (!bestSupport) return null;
  // One or two labels agreeing could be chance: they must also fit the typical door width closely.
  if (bestSupport < 3 && prior && Math.abs(bestScale / prior.metresPerPixel - 1) > 0.18) return null;
  const chosen = new Map<number, Vote>();
  for (const v of votes) {
    if (Math.abs(v.valueM / v.pixels - bestScale) / bestScale > 0.025) continue;
    const cur = chosen.get(v.group);
    if (!cur || v.cost < cur.cost) chosen.set(v.group, v);
  }
  const used = [...chosen.values()].sort((a, b) => b.pixels - a.pixels);
  const metresPerPixel = used.reduce((sum, v) => sum + v.valueM / v.pixels * v.pixels, 0) / used.reduce((sum, v) => sum + v.pixels, 0);
  const groups = new Set(votes.map(v => v.group)).size;
  const readings: DimensionReading[] = used.map(v => ({ text: v.text, valueM: v.valueM, pixels: v.pixels, a: v.a, b: v.b, side: v.side, confidence: Math.max(0, 1 - v.cost) }));
  const longest = used[0]!;
  const confidence = bestSupport >= 3 ? Math.min(0.97, 0.8 + 0.05 * bestSupport) : bestSupport === 2 ? 0.55 : 0.4;
  return {
    metresPerPixel,
    source: 'dimension-text',
    confidence,
    evidence: `${bestSupport} of ${groups} dimension labels agree (${used.slice(0, 4).map(v => v.text).join(', ')}${used.length > 4 ? '…' : ''})`,
    pointA: longest.a,
    pointB: longest.b,
    knownDistanceM: longest.valueM,
    readings,
  };
}
