import { describe, expect, it } from 'vitest';
import { BoxCollider, PlaneCollider, XpbdCloth, gridTopology, type ClothSettings } from './xpbd';

/** A flat w x d sheet in the XZ plane at height y, with (columns+1) x (rows+1) particles. */
function sheet(columns: number, rows: number, w: number, d: number, y: number, settings?: ClothSettings, pinTop = false) {
  const positions: number[] = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= columns; c++) positions.push((c / columns - 0.5) * w, y, (r / rows - 0.5) * d);
  const { triangles, extraEdges } = gridTopology(columns, rows);
  const pinned = pinTop ? Array.from({ length: columns + 1 }, (_, c) => c) : [];
  return new XpbdCloth({ positions, triangles, extraEdges, pinned, settings });
}
const run = (cloth: XpbdCloth, seconds: number, options: Parameters<XpbdCloth['step']>[1] = {}) => {
  for (let i = 0; i < seconds * 60; i++) cloth.step(1 / 60, { substeps: 6, ...options });
};
const maxStrain = (cloth: XpbdCloth, columns: number, rows: number, restW: number, restD: number) => {
  let worst = 0;
  const p = cloth.positions, at = (c: number, r: number) => (r * (columns + 1) + c) * 3;
  for (let r = 0; r <= rows; r++) for (let c = 0; c < columns; c++) {
    const a = at(c, r), b = at(c + 1, r);
    worst = Math.max(worst, Math.abs(Math.hypot(p[a]! - p[b]!, p[a + 1]! - p[b + 1]!, p[a + 2]! - p[b + 2]!) / (restW / columns) - 1));
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c <= columns; c++) {
    const a = at(c, r), b = at(c, r + 1);
    worst = Math.max(worst, Math.abs(Math.hypot(p[a]! - p[b]!, p[a + 1]! - p[b + 1]!, p[a + 2]! - p[b + 2]!) / (restD / rows) - 1));
  }
  return worst;
};

describe('XPBD cloth', () => {
  it('is deterministic: identical inputs give bit-identical results', () => {
    const make = () => { const c = sheet(12, 12, 1.2, 1.2, 0.5); run(c, 1.5, { colliders: [new BoxCollider([0, 0.2, 0], [0.3, 0.2, 0.3])], wind: { velocity: [1, 0, 0.5] } }); return c; };
    const a = make(), b = make();
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(a.positions.every(Number.isFinite)).toBe(true);
  });

  it('keeps pinned particles exactly where they are', () => {
    const cloth = sheet(10, 14, 1, 1.4, 2, undefined, true);
    const before = Array.from(cloth.positions.slice(0, 11 * 3));
    run(cloth, 2);
    expect(Array.from(cloth.positions.slice(0, 11 * 3))).toEqual(before);
  });

  it('hangs from its pins without stretching, thanks to the tethers', () => {
    // A tall curtain at a modest solver budget: tethers stop the long drop from stretching.
    const cloth = sheet(12, 24, 1, 2.4, 2.4, { stretchCompliance: 1e-5 }, true);
    // Rotate the sheet to hang: swap Y and Z so it is a vertical panel.
    const p = cloth.positions;
    for (let i = 0; i < cloth.count; i++) { const z = p[i * 3 + 2]!; p[i * 3 + 2] = 0; p[i * 3 + 1] = 2.4 - (z + 1.2); cloth.previous[i * 3 + 1] = p[i * 3 + 1]!; }
    run(cloth, 4, { substeps: 4 });
    expect(maxStrain(cloth, 12, 24, 1, 2.4)).toBeLessThan(0.04);
  });

  it('settles: kinetic energy falls to almost nothing', () => {
    const cloth = sheet(10, 10, 1, 1, 0.4);
    const floor = new PlaneCollider([0, 0, 0], [0, 1, 0]);
    run(cloth, 1, { colliders: [floor] });
    const early = cloth.kineticEnergy();
    run(cloth, 4, { colliders: [floor] });
    expect(cloth.kineticEnergy()).toBeLessThan(early * 0.1 + 1e-6);
    expect(cloth.kineticEnergy()).toBeLessThan(1e-4);
  });

  it('rests on a box without passing through it, and drapes over the edges', () => {
    const cloth = sheet(20, 20, 1.2, 1.2, 0.6, { thickness: 0.01 });
    const box = new BoxCollider([0, 0.25, 0], [0.3, 0.25, 0.3]);
    const floor = new PlaneCollider([0, 0, 0], [0, 1, 0]);
    run(cloth, 4, { colliders: [box, floor] });
    const p = cloth.positions;
    for (let i = 0; i < cloth.count; i++) {
      const x = p[i * 3]!, y = p[i * 3 + 1]!, z = p[i * 3 + 2]!;
      const inside = Math.abs(x) < 0.3 - 1e-3 && Math.abs(z) < 0.3 - 1e-3 && y < 0.5 + 0.01 - 2e-3 && y > 0;
      expect(inside, `particle ${i} at ${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`).toBe(false);
    }
    // The middle of the sheet sits on top of the box; the corners have fallen well below it.
    const mid = (10 * 21 + 10) * 3;
    expect(p[mid + 1]!).toBeGreaterThan(0.5);
    expect(p[1]!).toBeLessThan(0.3);
  });

  it('resists folding more at a lower bend compliance', { timeout: 30000 }, () => {
    const meanHeight = (bendCompliance: number) => {
      const cloth = sheet(20, 20, 1.2, 1.2, 0.6, { bendCompliance });
      run(cloth, 4, { colliders: [new BoxCollider([0, 0.25, 0], [0.3, 0.25, 0.3]), new PlaneCollider([0, 0, 0], [0, 1, 0])] });
      let sum = 0;
      for (let i = 0; i < cloth.count; i++) sum += cloth.positions[i * 3 + 1]!;
      return sum / cloth.count;
    };
    // Stiff card-like cloth holds itself out over the box edges; soft cloth hangs straight down.
    expect(meanHeight(1e-6)).toBeGreaterThan(meanHeight(1e-2) + 0.03);
  });

  it('computes bending gradients that match finite differences', () => {
    const cloth = new XpbdCloth({ positions: [0, 0, 0, 1, 0, 0, 0.4, 0.8, 0.2, 0.5, -0.7, 0.4], triangles: [0, 1, 2, 1, 0, 3] });
    const base = cloth.positions.slice();
    const analytic = cloth.bendGradient(0)!;
    expect(analytic).toBeDefined();
    const angle = () => cloth.dihedral(cloth.positions, 0)!;
    const h = 1e-6;
    // The four particles in constraint order: shared edge (0, 1) then the far vertices (2, 3).
    [0, 1, 2, 3].forEach((particle, k) => {
      for (let axis = 0; axis < 3; axis++) {
        cloth.positions.set(base); cloth.positions[particle * 3 + axis]! += h;
        const up = angle();
        cloth.positions.set(base); cloth.positions[particle * 3 + axis]! -= h;
        const down = angle();
        expect(analytic[k * 3 + axis]!, `particle ${particle} axis ${axis}`).toBeCloseTo((up - down) / (2 * h), 4);
      }
    });
    // A rigid translation leaves the dihedral angle unchanged.
    cloth.positions.set(base);
    const rest = angle();
    for (let i = 0; i < 4; i++) { cloth.positions[i * 3]! += 0.3; cloth.positions[i * 3 + 1]! -= 0.2; cloth.positions[i * 3 + 2]! += 0.1; }
    expect(angle()).toBeCloseTo(rest, 10);
  });

  it('feels wind through its surface: face-on cloth is pushed far more than edge-on cloth', () => {
    const push = (windDirection: [number, number, number]) => {
      const cloth = sheet(8, 8, 1, 1, 3, { gravity: 0 });
      run(cloth, 1, { wind: { velocity: windDirection, drag: 1.2 } });
      let x = 0, y = 0, z = 0;
      for (let i = 0; i < cloth.count; i++) { x += cloth.positions[i * 3]!; y += cloth.positions[i * 3 + 1]!; z += cloth.positions[i * 3 + 2]!; }
      return Math.hypot(x / cloth.count, y / cloth.count - 3, z / cloth.count);
    };
    // The sheet lies flat in XZ, so its normal is Y: wind along Y hits it face-on, wind along X skims past.
    expect(push([0, 6, 0])).toBeGreaterThan(push([6, 0, 0]) * 3);
  });

  it('keeps every particle finite under strong wind and a floor', () => {
    const cloth = sheet(14, 14, 1.5, 1.5, 1, undefined, true);
    run(cloth, 3, { colliders: [new PlaneCollider([0, 0, 0], [0, 1, 0])], wind: { velocity: [8, 1, -5], drag: 1.5 } });
    expect(cloth.positions.every(Number.isFinite)).toBe(true);
  });
});
