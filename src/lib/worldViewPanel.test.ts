import { describe, expect, it } from 'vitest';
import { worldViewUnlocked } from './worldViewPanel';

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
