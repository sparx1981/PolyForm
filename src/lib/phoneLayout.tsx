import React, { createContext, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Phone layout: a small screen gets one dock of tool groups (bottom in portrait, left in
 * landscape), a slim top bar, and a single settings sheet that tool panels render into.
 *
 * A screen counts as a phone when its short side is under PHONE_SHORT_SIDE pixels. `?phone=1`
 * (or `?phone=0`) in the address forces it on or off, and is remembered, so the layout can be
 * tried on a desktop browser.
 */
export const PHONE_SHORT_SIDE = 520;
const OVERRIDE_KEY = 'polyform_phone_layout';

export function readPhoneOverride(): boolean | null {
  try {
    const param = new URLSearchParams(window.location.search).get('phone');
    if (param === '1' || param === '0') {
      localStorage.setItem(OVERRIDE_KEY, param);
      return param === '1';
    }
    const stored = localStorage.getItem(OVERRIDE_KEY);
    if (stored === '1' || stored === '0') return stored === '1';
  } catch {
    // Storage can be blocked; fall back to measuring the screen.
  }
  return null;
}

export function measurePhoneLayout(width: number, height: number, override: boolean | null) {
  const isPhone = override ?? Math.min(width, height) < PHONE_SHORT_SIDE;
  return { isPhone, landscape: width > height };
}

export interface PhoneLayout {
  isPhone: boolean;
  landscape: boolean;
  /** The element tool settings portal into, or null when there is no sheet. */
  slot: HTMLElement | null;
  setSlot: (el: HTMLElement | null) => void;
}

const PhoneLayoutContext = createContext<PhoneLayout>({
  isPhone: false,
  landscape: false,
  slot: null,
  setSlot: () => {},
});

export function PhoneLayoutProvider({ children }: { children: React.ReactNode }) {
  const [override] = useState(readPhoneOverride);
  const [size, setSize] = useState(() => measurePhoneLayout(window.innerWidth, window.innerHeight, override));
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const update = () => setSize(measurePhoneLayout(window.innerWidth, window.innerHeight, override));
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, [override]);

  return (
    <PhoneLayoutContext.Provider value={{ ...size, slot, setSlot }}>
      {children}
    </PhoneLayoutContext.Provider>
  );
}

export function usePhoneLayout(): PhoneLayout {
  return useContext(PhoneLayoutContext);
}

/**
 * On a phone, renders its children inside the settings sheet; elsewhere renders them in place.
 */
export function PhoneSheetPortal({ children }: { children: React.ReactNode }) {
  const { isPhone, slot } = usePhoneLayout();
  if (!isPhone) return <>{children}</>;
  if (!slot) return null;
  return createPortal(children, slot);
}
