import { describe, expect, it } from 'vitest';
import { measurePhoneLayout, PHONE_SHORT_SIDE } from './phoneLayout';

describe('measurePhoneLayout', () => {
  it('treats a small screen as a phone in either orientation', () => {
    expect(measurePhoneLayout(390, 844, null)).toEqual({ isPhone: true, landscape: false });
    expect(measurePhoneLayout(844, 390, null)).toEqual({ isPhone: true, landscape: true });
  });

  it('keeps tablets and desktops on the full layout', () => {
    expect(measurePhoneLayout(1024, 768, null).isPhone).toBe(false);
    expect(measurePhoneLayout(1920, 1080, null).isPhone).toBe(false);
    expect(measurePhoneLayout(PHONE_SHORT_SIDE, 900, null).isPhone).toBe(false);
  });

  it('lets an override force the layout on or off', () => {
    expect(measurePhoneLayout(1920, 1080, true).isPhone).toBe(true);
    expect(measurePhoneLayout(390, 844, false).isPhone).toBe(false);
  });
});
