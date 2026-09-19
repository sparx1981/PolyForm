// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isTouchOnlyDevice } from './deviceDetection';

describe('deviceDetection', () => {
  const originalMatchMedia = window.matchMedia;
  let mockMatchMediaMap: Record<string, boolean> = {};

  beforeEach(() => {
    mockMatchMediaMap = {};
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: Boolean(mockMatchMediaMap[query]),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  it('identifies desktop devices with fine pointer as non-touch-only', () => {
    mockMatchMediaMap['(pointer: fine)'] = true;
    mockMatchMediaMap['(hover: hover)'] = true;
    expect(isTouchOnlyDevice()).toBe(false);
  });

  it('identifies touchscreen laptops (fine pointer + maxTouchPoints > 0) as desktop', () => {
    mockMatchMediaMap['(pointer: fine)'] = true;
    mockMatchMediaMap['(hover: hover)'] = true;
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 10, configurable: true });

    expect(isTouchOnlyDevice()).toBe(false);
  });

  it('identifies touch-only mobile devices (coarse pointer, no fine pointer, touch points) as touch-only', () => {
    mockMatchMediaMap['(pointer: fine)'] = false;
    mockMatchMediaMap['(hover: hover)'] = false;
    mockMatchMediaMap['(pointer: coarse)'] = true;
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });

    expect(isTouchOnlyDevice()).toBe(true);
  });

  it('defaults safely to false (desktop) when matchMedia returns false for all', () => {
    mockMatchMediaMap['(pointer: fine)'] = false;
    mockMatchMediaMap['(hover: hover)'] = false;
    mockMatchMediaMap['(pointer: coarse)'] = false;
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true });

    expect(isTouchOnlyDevice()).toBe(false);
  });
});
