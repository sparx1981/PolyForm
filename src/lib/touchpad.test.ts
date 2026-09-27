import { describe, it, expect } from 'vitest';
import { isTouchpadScroll } from './touchpad';

describe('isTouchpadScroll', () => {
  it('tells a touchpad swipe from a mouse wheel', () => {
    expect(isTouchpadScroll({ deltaMode: 0, deltaX: 0, deltaY: 100 })).toBe(false); // wheel notch
    expect(isTouchpadScroll({ deltaMode: 0, deltaX: 0, deltaY: -120 })).toBe(false);
    expect(isTouchpadScroll({ deltaMode: 1, deltaX: 0, deltaY: 3 })).toBe(false); // line mode (Firefox wheel)
    expect(isTouchpadScroll({ deltaMode: 0, deltaX: 4, deltaY: 0 })).toBe(true); // sideways
    expect(isTouchpadScroll({ deltaMode: 0, deltaX: 0, deltaY: 12 })).toBe(true); // small
    expect(isTouchpadScroll({ deltaMode: 0, deltaX: 0, deltaY: 57.5 })).toBe(true); // fractional
  });
});
