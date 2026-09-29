import type { Shape } from '../../types';
import { categoryOf, isRoofTrim } from './classify';

/**
 * Bill of materials for the client page: quantities only (no prices), grouped the way a client
 * reads a project - the building, its doors and windows, then the garden. Everything is worked
 * out from the model's own objects; areas the objects don't carry directly (floor slabs, roofs)
 * come in `measured`, taken off the drawn 3D geometry when the page is published.
 */
export type BomUnit = 'no.' | 'm' | 'm²' | 'm³';

export interface BomLine {
  group: 'Structure' | 'Doors & windows' | 'Landscape' | 'Fixtures & furniture' | 'Timber frame';
  item: string;
  detail?: string;
  qty: number;
  unit: BomUnit;
}

export interface MeasuredArea {
  /** Area of the upward-facing surfaces, m² (a roof's covering, a slab's floor). */
  topArea: number;
}

const round = (n: number, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;

export function polygonArea(points: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, z1] = points[i];
    const [x2, z2] = points[(i + 1) % points.length];
    a += x1 * z2 - x2 * z1;
  }
  return Math.abs(a) / 2;
}

export function pathLength(points: [number, number][], closed = false): number {
  let d = 0;
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    const [x1, z1] = points[i];
    const [x2, z2] = points[(i + 1) % points.length];
    d += Math.hypot(x2 - x1, z2 - z1);
  }
  return d;
}

const nums = (s: Shape) => (Array.isArray(s.args) ? (s.args as number[]) : []);

const titleCase = (s: string) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const FIXTURE_NAMES: Partial<Record<Shape['type'], string>> = {
  lamp: 'Outdoor lights', bench: 'Benches', rock: 'Feature rocks', scale_figure: 'Scale figures',
};

class Tally {
  private lines = new Map<string, BomLine>();
  add(line: BomLine) {
    const key = `${line.group}|${line.item}|${line.detail ?? ''}|${line.unit}`;
    const had = this.lines.get(key);
    if (had) had.qty += line.qty;
    else this.lines.set(key, { ...line });
  }
  all(): BomLine[] {
    return [...this.lines.values()].filter(l => l.qty > 0).map(l => ({ ...l, qty: round(l.qty, l.unit === 'no.' ? 0 : 1) }));
  }
}

export function billOfMaterials(
  shapes: Shape[],
  opts: {
    measured?: Record<string, MeasuredArea>;
    plantName?: (s: Shape) => string | undefined;
  } = {},
): BomLine[] {
  const t = new Tally();
  const visible = shapes.filter(s => !s.hidden);
  const openingsByWall = new Map<string, number>();
  for (const o of visible) {
    if ((o.type === 'door' || o.type === 'window') && o.hostWallId) {
      const [w = 0, h = 0] = nums(o);
      openingsByWall.set(o.hostWallId, (openingsByWall.get(o.hostWallId) ?? 0) + w * h);
    }
  }

  for (const s of visible) {
    const cat = categoryOf(s);
    const a = nums(s);
    switch (cat) {
      case 'wall': {
        const [length = 0, height = 0, thickness = 0.2] = a;
        const style = s.wallStyle ? titleCase(s.wallStyle) : `${Math.round(thickness * 1000)} mm`;
        const net = Math.max(0, length * height - (openingsByWall.get(s.id) ?? 0));
        t.add({ group: 'Structure', item: 'Walls', detail: style, qty: net, unit: 'm²' });
        t.add({ group: 'Structure', item: 'Wall length', detail: style, qty: length, unit: 'm' });
        break;
      }
      case 'slab': {
        const area = opts.measured?.[s.id]?.topArea ?? (a.length >= 3 ? a[0] * a[2] : 0);
        t.add({ group: 'Structure', item: 'Floor slabs', qty: area, unit: 'm²' });
        break;
      }
      case 'roof': {
        const extra = s.customData?.roofExtra as string | undefined;
        if (extra === 'gutters') {
          t.add({ group: 'Structure', item: 'Gutters', qty: Number(s.customData.length) || 0, unit: 'm' });
          t.add({ group: 'Structure', item: 'Downpipes', qty: Number(s.customData.downpipes) || 0, unit: 'no.' });
        } else if (extra === 'chimney') t.add({ group: 'Structure', item: 'Chimney', qty: 1, unit: 'no.' });
        else if (extra === 'solar') t.add({ group: 'Structure', item: 'Solar panels', detail: 'About 1.0 × 1.7 m', qty: Number(s.customData.count) || 0, unit: 'no.' });
        else if (extra === 'dormer-walls') t.add({ group: 'Structure', item: 'Dormer windows', qty: Number(s.customData.count) || 0, unit: 'no.' });
        if (extra || isRoofTrim(s)) break;
        const area = opts.measured?.[s.id]?.topArea ?? 0;
        const type = s.roofData?.roofType ? `${titleCase(String(s.roofData.roofType))} roof` : 'Roof';
        if (area > 0) t.add({ group: 'Structure', item: 'Roof covering', detail: type, qty: area, unit: 'm²' });
        else t.add({ group: 'Structure', item: 'Roofs', detail: type, qty: 1, unit: 'no.' });
        break;
      }
      case 'stair': {
        if (s.type === 'staircase') {
          const style = s.stairStyle ? `${titleCase(s.stairStyle)}` : undefined;
          t.add({ group: 'Structure', item: 'Staircases', detail: style, qty: 1, unit: 'no.' });
        } else t.add({ group: 'Structure', item: 'Steps', qty: 1, unit: 'no.' });
        break;
      }
      case 'opening': {
        const [w = 0, h = 0] = a;
        const kind = s.type === 'door' ? 'Doors' : 'Windows';
        const style = s.archStyle ? `${titleCase(s.archStyle)}, ` : '';
        t.add({ group: 'Doors & windows', item: kind, detail: `${style}${Math.round(w * 1000)} × ${Math.round(h * 1000)} mm`, qty: 1, unit: 'no.' });
        break;
      }
      case 'landscape': {
        if (s.type === 'patio' && s.patioData) {
          const p = s.patioData;
          const area = polygonArea(p.points);
          const label = p.kind === 'deck' ? 'Decking' : p.kind === 'balcony' ? 'Balcony' : 'Patio';
          const finish = p.kind === 'patio' ? titleCase(p.paving) : titleCase(p.board);
          t.add({ group: 'Landscape', item: label, detail: finish, qty: area, unit: 'm²' });
          if (p.kerb && p.kind === 'patio') t.add({ group: 'Landscape', item: 'Kerb edging', qty: pathLength(p.points, true), unit: 'm' });
          if (p.railing && p.railing !== 'none') {
            const open = p.points.reduce((d, pt, i) => {
              if (p.wallEdges?.[i]) return d;
              const q = p.points[(i + 1) % p.points.length];
              return d + Math.hypot(q[0] - pt[0], q[1] - pt[1]);
            }, 0);
            t.add({ group: 'Landscape', item: 'Railing', detail: titleCase(p.railing), qty: open, unit: 'm' });
          }
        } else if (s.type === 'fence' && s.fenceData) {
          const f = s.fenceData;
          t.add({ group: 'Landscape', item: 'Fencing', detail: `${titleCase(f.style)}, ${f.height.toFixed(1)} m high`, qty: pathLength(f.points, !!f.closed), unit: 'm' });
        } else if (s.type === 'fence' || s.type === 'railing') {
          t.add({ group: 'Landscape', item: s.type === 'fence' ? 'Fence sections' : 'Railings', qty: 1, unit: 'no.' });
        } else if (s.type === 'water' && s.waterData) {
          const area = polygonArea(s.waterData.points);
          t.add({ group: 'Landscape', item: 'Pond / pool', detail: 'Water surface', qty: area, unit: 'm²' });
          // A basin that's deepest in the middle: roughly half its full depth on average.
          t.add({ group: 'Landscape', item: 'Pond / pool', detail: 'Water volume (approx.)', qty: area * s.waterData.depth * 0.5, unit: 'm³' });
        } else if (s.type === 'tree' || s.type === 'bush') {
          const name = opts.plantName?.(s) ?? (s.name && !/^(tree|bush)\b/i.test(s.name) ? s.name : undefined);
          t.add({ group: 'Landscape', item: s.type === 'tree' ? 'Trees' : 'Shrubs & plants', detail: name, qty: 1, unit: 'no.' });
        } else {
          const name = FIXTURE_NAMES[s.type] ?? titleCase(s.type);
          if (s.type !== 'scale_figure') t.add({ group: 'Fixtures & furniture', item: name, qty: 1, unit: 'no.' });
        }
        break;
      }
      case 'other': {
        const semantic = s.customData?.semanticComponent;
        if (semantic?.kind === 'furniture' || semantic?.kind === 'soft-furnishing') {
          t.add({
            group: 'Fixtures & furniture',
            item: s.name || titleCase(String(s.customData?.furnitureType || 'Furniture')),
            qty: 1,
            unit: 'no.',
          });
        }
        break;
      }
      default:
        break;
    }

    const bom = s.timberFrame?.bom;
    if (bom) {
      t.add({ group: 'Timber frame', item: 'Structural timber', detail: 'Linear metres', qty: bom.totalTimberLinearMeters, unit: 'm' });
      t.add({ group: 'Timber frame', item: 'Structural timber', detail: 'Volume', qty: bom.totalTimberVolumeM3, unit: 'm³' });
      for (const h of bom.hardware ?? []) t.add({ group: 'Timber frame', item: h.description || h.sku, qty: h.quantity, unit: 'no.' });
    }
  }

  const order: BomLine['group'][] = ['Structure', 'Doors & windows', 'Timber frame', 'Landscape', 'Fixtures & furniture'];
  return t.all().sort((x, y) => order.indexOf(x.group) - order.indexOf(y.group)
    || x.item.localeCompare(y.item) || (x.detail ?? '').localeCompare(y.detail ?? ''));
}

export function bomToCsv(lines: BomLine[]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return ['Group,Item,Detail,Quantity,Unit', ...lines.map(l => [l.group, l.item, l.detail ?? '', l.qty, l.unit].map(cell).join(','))].join('\n');
}
