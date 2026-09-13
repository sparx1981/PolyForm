import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Adds the baseline keyboard/screen-reader behavior every modal overlay in
 * this app was missing: initial focus moves into the dialog when it opens,
 * Tab/Shift+Tab cycle within it instead of escaping into the page behind
 * it, Escape closes it, and focus returns to whatever triggered it on
 * close. Attach the returned ref to the modal's outermost container
 * (the one that should carry role="dialog" aria-modal="true") — this hook
 * only adds behavior, it doesn't render anything or change layout, so it's
 * safe to drop into an existing modal's markup without restructuring it.
 */
export function useModalA11y<T extends HTMLElement>(isOpen: boolean, onClose?: () => void) {
  const containerRef = useRef<T>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    if (container) {
      const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length > 0) {
        focusable[0]!.focus();
      } else {
        container.focus();
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (onClose) {
          e.stopPropagation();
          onClose();
        }
        return;
      }
      if (e.key !== 'Tab' || !containerRef.current) return;

      const focusable = Array.from(
        containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [isOpen, onClose]);

  return containerRef;
}
