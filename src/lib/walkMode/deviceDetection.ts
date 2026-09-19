import { useState, useEffect } from 'react';

/**
 * Detects whether the current device is a touch-only mobile/tablet device
 * (e.g. smartphone, iPad without mouse) where on-screen touch joystick and
 * jump buttons should be rendered, as opposed to a desktop/laptop browser
 * with a mouse or trackpad.
 *
 * Devices with a fine pointer (mouse, trackpad) or hover capability (including
 * touchscreen laptops like Surface or Dell XPS) are identified as desktop
 * environments, preventing mobile touch controls from overlaying desktop viewports.
 */
export function isTouchOnlyDevice(): boolean {
  if (typeof window === 'undefined') return false;

  // 1. If the device has a fine pointer (mouse, precision trackpad) or hover capability,
  // it is a desktop or laptop environment.
  const hasFinePointer = window.matchMedia?.('(pointer: fine)').matches;
  const hasHover = window.matchMedia?.('(hover: hover)').matches;
  if (hasFinePointer || hasHover) {
    return false;
  }

  // 2. Only if there is no fine pointer and the primary pointer is coarse with touch points,
  // treat it as a touch-only device (mobile phone or tablet).
  const hasCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches;
  const hasTouch = 'ontouchstart' in window || (Boolean(navigator.maxTouchPoints) && navigator.maxTouchPoints > 0);

  return Boolean(hasCoarsePointer && hasTouch);
}

/**
 * React hook that returns whether the current device is touch-only,
 * reacting to media query changes (e.g. devtools device emulation toggle).
 */
export function useIsTouchOnlyDevice(): boolean {
  const [isTouch, setIsTouch] = useState<boolean>(() => isTouchOnlyDevice());

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mqlFine = window.matchMedia('(pointer: fine)');
    const mqlHover = window.matchMedia('(hover: hover)');
    const mqlCoarse = window.matchMedia('(pointer: coarse)');

    const update = () => {
      setIsTouch(isTouchOnlyDevice());
    };

    mqlFine.addEventListener?.('change', update);
    mqlHover.addEventListener?.('change', update);
    mqlCoarse.addEventListener?.('change', update);

    return () => {
      mqlFine.removeEventListener?.('change', update);
      mqlHover.removeEventListener?.('change', update);
      mqlCoarse.removeEventListener?.('change', update);
    };
  }, []);

  return isTouch;
}
