import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DEFAULT_GLASS, GLASS_KEYS, GLASS_PROFILES, GlassMotion, createSpring, glassDimensions, glassDisplacement, glassSurfaceHeight,
  glassShadowMargin, loadGlassSettings, sanitizeGlass, saveGlassSettings, stepSpring,
} from './glass';
import { configureLoupeCamera } from './loupe';
import * as THREE from 'three';

describe('glass settings', () => {
  it('fills missing values with defaults and clamps wild ones', () => {
    expect(sanitizeGlass()).toEqual(DEFAULT_GLASS);
    const s = sanitizeGlass({ glassIndex: 99, glassBezel: -4, glassThickness: NaN, loupeAspect: 'x', glassProfile: 7.6, glassTint: 'red', loupeShape: 'blob', glassLiquid: 'yes', loupeFollow: true });
    expect(s.glassIndex).toBe(2.4);
    expect(s.glassBezel).toBe(0.08);
    expect(Number.isFinite(s.glassThickness)).toBe(true);
    expect(s.loupeAspect).toBeGreaterThanOrEqual(1);
    expect(s.glassProfile).toBe(3);
    expect(s.glassTint).toBe(DEFAULT_GLASS.glassTint);
    expect(s.loupeShape).toBe('circle');
    expect(s.glassLiquid).toBe(DEFAULT_GLASS.glassLiquid);
    expect(s.loupeFollow).toBe(true);
  });
  it('exposes every setting key and four profiles', () => {
    expect(GLASS_KEYS).toContain('loupeFollow');
    expect(GLASS_KEYS.length).toBe(Object.keys(DEFAULT_GLASS).length);
    expect(GLASS_PROFILES.map(p => p.id)).toEqual([0, 1, 2, 3]);
  });
});

describe('glass persistence', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
  });
  it('round-trips settings and survives corrupt or unavailable storage', () => {
    saveGlassSettings({ ...DEFAULT_GLASS, glassIndex: 1.8, loupeShape: 'rounded' });
    expect(loadGlassSettings()).toMatchObject({ glassIndex: 1.8, loupeShape: 'rounded' });
    store.set('polyform_glass_v1', '{not json');
    expect(loadGlassSettings()).toEqual(DEFAULT_GLASS);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(loadGlassSettings()).toEqual(DEFAULT_GLASS);
    expect(() => saveGlassSettings(DEFAULT_GLASS)).not.toThrow();
  });
});

describe('glass geometry', () => {
  it('makes circles square and pills wide, keeping the lens inside the viewport', () => {
    const c = glassDimensions({ ...DEFAULT_GLASS, loupeShape: 'circle' }, 100);
    expect(c.hx).toBe(100); expect(c.hy).toBe(100); expect(c.corner).toBe(100);
    const p = glassDimensions({ ...DEFAULT_GLASS, loupeShape: 'rounded', loupeAspect: 2, loupeRoundness: 0.5 }, 100);
    expect(p.hx).toBe(200); expect(p.hy).toBe(100); expect(p.corner).toBe(50);
    const small = glassDimensions({ ...DEFAULT_GLASS, loupeShape: 'rounded', loupeAspect: 3 }, 100, { width: 300, height: 400 });
    expect(small.hx).toBeCloseTo(300 * 0.46, 6);
    expect(small.hx / small.hy).toBeCloseTo(3, 6);
  });
  it('grows the shadow margin with blur', () => {
    expect(glassShadowMargin({ ...DEFAULT_GLASS, glassShadowBlur: 40 })).toBeGreaterThan(glassShadowMargin({ ...DEFAULT_GLASS, glassShadowBlur: 5 }));
  });
  it('crops a non-square lens by its own height', () => {
    const source = new THREE.PerspectiveCamera(50, 2, .1, 200);
    source.position.set(0, 0, 10); source.updateMatrixWorld();
    const copy = source.clone();
    configureLoupeCamera(source, copy, 800, 400, [.5, .5], 120, 2, 60);
    expect(copy.view).toMatchObject({ width: 120, height: 60 });
  });
});

describe('glass refraction', () => {
  it('has surface heights in 0..~1.1 for every profile across the whole rim', () => {
    for (const p of GLASS_PROFILES) for (let i = 0; i <= 20; i++) {
      const h = glassSurfaceHeight(i / 20, p.id);
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(1.11);
    }
  });
  it('bends light everywhere that matters, finitely, for every profile', () => {
    for (const p of GLASS_PROFILES) {
      let any = false;
      for (let i = 0; i <= 40; i++) {
        const d = glassDisplacement(i / 40, p.id, 30, 12, 1.5);
        expect(Number.isFinite(d)).toBe(true);
        if (Math.abs(d) > 0.01) any = true;
      }
      expect(any).toBe(true);
    }
  });
  it('bends light more for a higher index and thicker glass', () => {
    const base = Math.abs(glassDisplacement(0.15, 0, 30, 12, 1.2));
    expect(Math.abs(glassDisplacement(0.15, 0, 30, 12, 1.9))).toBeGreaterThan(base);
    expect(Math.abs(glassDisplacement(0.15, 0, 30, 30, 1.5))).toBeGreaterThan(Math.abs(glassDisplacement(0.15, 0, 30, 4, 1.5)));
  });
});

describe('liquid motion', () => {
  it('springs converge to their target without overshooting wildly, even on a long frame', () => {
    const s = createSpring(0, 300, 15); s.target = 1;
    let peak = 0;
    for (let i = 0; i < 240; i++) { stepSpring(s, 1 / 60); peak = Math.max(peak, s.value); }
    expect(s.value).toBeCloseTo(1, 3);
    expect(peak).toBeLessThan(1.3);
    const wild = createSpring(0, 300, 15); wild.target = 1; stepSpring(wild, 50);
    expect(Number.isFinite(wild.value)).toBe(true);
  });
  it('swells when pressed, stretches along a drag, and settles back to rest', () => {
    const m = new GlassMotion();
    for (let i = 0; i < 90; i++) m.update(1 / 60, { pressed: true, vx: 0, vy: 0, enabled: true });
    expect(m.scale.x).toBeGreaterThan(1.05);
    for (let i = 0; i < 90; i++) m.update(1 / 60, { pressed: false, vx: 2, vy: 0, enabled: true });
    expect(m.scale.x).toBeGreaterThan(m.scale.y);
    for (let i = 0; i < 240; i++) m.update(1 / 60, { pressed: false, vx: 0, vy: 0, enabled: true });
    expect(m.scale.x).toBeCloseTo(1, 2); expect(m.scale.y).toBeCloseTo(1, 2);
  });
  it('stays perfectly still when liquid motion is off', () => {
    const m = new GlassMotion();
    expect(m.update(1 / 60, { pressed: true, vx: 5, vy: 5, enabled: false })).toEqual({ x: 1, y: 1 });
  });
});

describe('shared glass store', () => {
  it('keeps the look and lens size when presentation is reset, but not its position', async () => {
    const { presentation } = await import('./store');
    presentation.set({ glassIndex: 1.9, loupeShape: 'rounded', loupeFollow: true, loupeZoom: 4, loupePosition: [0.1, 0.9] });
    presentation.reset();
    const s = presentation.get();
    expect(s).toMatchObject({ glassIndex: 1.9, loupeShape: 'rounded', loupeFollow: true, loupeZoom: 4 });
    expect(s.loupePosition).not.toEqual([0.1, 0.9]);
    presentation.set({ ...DEFAULT_GLASS, loupeZoom: 2.5 });
  });
});
