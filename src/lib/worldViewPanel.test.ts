import { describe, expect, it } from 'vitest';
import { buildMap3DOptions, worldViewUnlocked } from './worldViewPanel';

describe('worldViewUnlocked', () => {
  it('is locked until there is a place', () => {
    expect(worldViewUnlocked({ address: '', overlayActive: false, hasImportedSite: false })).toBe(false);
    expect(worldViewUnlocked({ address: undefined, overlayActive: false, hasImportedSite: false })).toBe(false);
    expect(worldViewUnlocked({ address: '   ', overlayActive: false, hasImportedSite: false })).toBe(false);
  });
  it('unlocks once an address is found', () => {
    expect(worldViewUnlocked({ address: '10 Downing Street, London', overlayActive: false, hasImportedSite: false })).toBe(true);
  });
  it('is unlocked straight away when the model already has a site or the overlay on', () => {
    expect(worldViewUnlocked({ address: '', overlayActive: true, hasImportedSite: false })).toBe(true);
    expect(worldViewUnlocked({ address: '', overlayActive: false, hasImportedSite: true })).toBe(true);
  });
});

describe('buildMap3DOptions', () => {
  it('always sets the mode, which the 3D map needs to draw anything', () => {
    expect(buildMap3DOptions(undefined, 1, 2).mode).toBe('HYBRID');
    const HYBRID = { name: 'HYBRID enum' };
    expect(buildMap3DOptions({ MapMode: { HYBRID } }, 1, 2).mode).toBe(HYBRID);
  });
  it('centres on the place, looking down at it from the side', () => {
    const o = buildMap3DOptions({}, 51.5, -0.12);
    expect(o.center).toEqual({ lat: 51.5, lng: -0.12, altitude: 250 });
    expect(o.tilt).toBe(60);
    expect(o.range).toBe(900);
  });
});
