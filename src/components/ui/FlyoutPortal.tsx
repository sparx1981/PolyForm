/**
 * PolyForm — flyout portal.
 *
 * Renders its children into document.body, positioned next to `anchorRef`'s
 * element, escaping ANY ancestor's z-index or stacking context entirely.
 *
 * A flyout's own z-index only wins ties WITHIN its nearest positioned
 * ancestor's stacking context. If that ancestor — a toolbar column, say —
 * is itself behind a LATER sibling column at the same z-index, no z-index
 * on the flyout can ever escape that: it is trapped inside a losing
 * stacking context no matter how high its own number is raised. This is
 * exactly what was happening with the toolbar submenus (Line/Poly/Arc,
 * 3D Primitives, and similar) — their host toolbar and an adjacent one
 * both sat at the same z-40, so whichever was later in the DOM won
 * outright, regardless of the flyout's own z-50.
 *
 * Portaling to document.body sidesteps the problem instead of fighting it:
 * the flyout is no longer a DOM descendant of its trigger at all, so it
 * always stacks against the very top of the page. React's synthetic event
 * system still bubbles mouseEnter/mouseLeave through the REACT tree (not
 * the DOM tree), so hover-to-keep-open logic on a wrapping element keeps
 * working exactly as before.
 */

import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

export interface FlyoutPortalProps {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  children: ReactNode;
  /** Gap between the anchor's right edge and the flyout, in px. */
  offset?: number;
  /** z-index for the portaled wrapper. Matches LAYER.flyout in Surface.tsx. */
  zIndex?: number;
}

export function FlyoutPortal({ anchorRef, open, children, offset = 8, zIndex = 150 }: FlyoutPortalProps) {
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  // Once true, stays true for the component's lifetime. `children` is
  // expected to be an AnimatePresence wrapping a conditionally-rendered
  // element — closing sets `open` false, AnimatePresence plays its OWN
  // exit transition, and only then removes its child. If this wrapper
  // unmounted the instant `open` went false, that exit transition would
  // never get the chance to run at all: the portal target would already
  // be gone. Leaving an empty, invisible fixed div mounted afterwards is a
  // negligible cost next to that.
  const [everOpened, setEverOpened] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEverOpened(true);
    const el = anchorRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.right + offset });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, anchorRef, offset]);

  if (!everOpened || !rect) return null;

  return createPortal(
    <div style={{ position: 'fixed', top: rect.top, left: rect.left, zIndex }}>
      {children}
    </div>,
    document.body,
  );
}

export default FlyoutPortal;
