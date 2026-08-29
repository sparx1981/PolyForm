/**
 * PolyForm — shared surface primitives.
 *
 * Before this, twenty modal overlays across the app used seven different
 * scrim opacities, four different blurs and nine different z-indexes ranging
 * from 100 to 9999. Which dialog won when two opened together was accidental,
 * and every new modal invented its own header, padding and button sizing.
 *
 * These primitives carry one answer to each of those questions. Import them
 * rather than writing `fixed inset-0` again.
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Stacking order, named and ordered.
 *
 * Raw z-index literals are how a dialog ends up behind its own dropdown. Add
 * a layer here rather than picking a number that looks big enough.
 */
export const LAYER = {
  /** Inline panels attached to the toolbars. */
  panel: 100,
  /**
   * Tooltips and expanding icon menus anchored to a toolbar icon — a
   * hover label, a submenu, a colour-picker flyout. Always above every
   * toolbar's own body, regardless of which toolbar it belongs to or its
   * position in the DOM.
   *
   * These previously used whatever raw z-index literal seemed big enough
   * at the time — some tooltips at 100, some flyouts at 60 — so a flyout
   * from one toolbar could render behind an adjacent toolbar's tooltip,
   * or vice versa, depending on DOM order. One shared value here is what
   * actually guarantees "always in front," not a bigger-sounding number.
   */
  flyout: 150,
  /** Standard dialogs. */
  modal: 200,
  /** A dialog raised BY a dialog — confirmations, pickers. */
  nested: 300,
  /** Blocking, app-level: sign-in, fatal errors. */
  blocking: 400,
  /** Transient, non-interactive: toasts, diagnostics. */
  toast: 500,
} as const;

export type LayerName = keyof typeof LAYER;

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const SIZE: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl',
  full: 'max-w-[95vw]',
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  size?: ModalSize;
  layer?: LayerName;
  /** Clicking the scrim closes. Off for anything destructive or long-running. */
  dismissOnBackdrop?: boolean;
  /** Accessible name. Required — a dialog without one is unusable by screen reader. */
  label: string;
  className?: string;
}

/**
 * Dialog shell: scrim, panel, escape handling, scroll lock, focus return.
 *
 * One scrim value and one blur for every dialog in the app. Consistency here
 * is not cosmetic — a scrim that varies by dialog reads as a rendering bug.
 */
export function Modal({
  open,
  onClose,
  children,
  size = 'md',
  layer = 'modal',
  dismissOnBackdrop = true,
  label,
  className,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Remember what had focus, so closing returns the user where they were
    // rather than dumping them at the top of the document.
    restoreFocusTo.current = document.activeElement as HTMLElement | null;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);

    // Move focus into the dialog so the keyboard is not left behind it.
    const timer = window.setTimeout(() => {
      const focusable = panelRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      (focusable ?? panelRef.current)?.focus();
    }, 0);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(timer);
      restoreFocusTo.current?.focus?.();
    };
  }, [open, onClose]);

  const onBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (!dismissOnBackdrop) return;
      if (e.target === e.currentTarget) onClose();
    },
    [dismissOnBackdrop, onClose],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
      style={{ zIndex: LAYER[layer] }}
      onMouseDown={onBackdrop}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cn(
          'w-full flex flex-col max-h-[90vh] overflow-hidden outline-none',
          'rounded-2xl bg-white dark:bg-gray-900',
          'border border-gray-200 dark:border-gray-800',
          // Offset plus soft blur: a real shadow, not a coloured halo.
          'shadow-[0_24px_60px_-12px_rgba(15,23,42,0.35)]',
          SIZE[size],
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export interface ModalHeaderProps {
  title: string;
  subtitle?: string;
  /** Short status shown beside the title, e.g. a count. */
  badge?: string;
  icon?: React.ReactNode;
  onClose?: () => void;
}

export function ModalHeader({ title, subtitle, badge, icon, onClose }: ModalHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-gray-200 dark:border-gray-800">
      <div className="flex items-start gap-3 min-w-0">
        {icon && (
          <div className="shrink-0 w-10 h-10 rounded-xl bg-trimble-blue/10 text-trimble-blue flex items-center justify-center">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white truncate">
              {title}
            </h2>
            {badge && (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-trimble-blue/10 text-trimble-blue">
                {badge}
              </span>
            )}
          </div>
          {subtitle && (
            <p className="mt-0.5 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 p-2 -m-1 rounded-lg text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-trimble-blue"
        >
          <X size={18} />
        </button>
      )}
    </header>
  );
}

export function ModalBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('flex-1 overflow-y-auto px-6 py-5', className)}>{children}</div>;
}

/**
 * Actions sit right-aligned with the confirming action last, matching the
 * platform convention users already carry in from every other application.
 */
export function ModalFooter({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <footer
      className={cn(
        'flex items-center justify-end gap-2 px-6 py-4',
        'border-t border-gray-200 dark:border-gray-800',
        'bg-gray-50/60 dark:bg-gray-950/30',
        className,
      )}
    >
      {children}
    </footer>
  );
}

// ---------------------------------------------------------------------------

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON: Record<ButtonVariant, string> = {
  primary:
    'bg-trimble-blue text-white hover:bg-trimble-blue/90 shadow-sm shadow-trimble-blue/20',
  secondary:
    'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700',
  ghost:
    'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm shadow-red-600/20',
};

export function Button({
  variant = 'secondary',
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...rest}
      className={cn(
        // 36px tall: comfortably above the 44px touch target once the
        // surrounding gap is counted, and consistent across every dialog.
        'inline-flex items-center justify-center gap-2 h-9 px-4 rounded-lg',
        'text-sm font-medium transition-colors',
        'outline-none focus-visible:ring-2 focus-visible:ring-trimble-blue focus-visible:ring-offset-2',
        'dark:focus-visible:ring-offset-gray-900',
        'disabled:opacity-50 disabled:pointer-events-none',
        BUTTON[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Selectable tile. Used for style pickers and any comparable set. */
export function Card({
  selected,
  onSelect,
  children,
  className,
  label,
}: {
  selected?: boolean;
  onSelect?: () => void;
  children: React.ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <div
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-pressed={onSelect ? !!selected : undefined}
      aria-label={label}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (!onSelect) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'group relative flex flex-col rounded-xl border p-4 transition-all duration-200',
        onSelect && 'cursor-pointer',
        'outline-none focus-visible:ring-2 focus-visible:ring-trimble-blue focus-visible:ring-offset-2',
        'dark:focus-visible:ring-offset-gray-900',
        selected
          ? 'border-trimble-blue ring-2 ring-trimble-blue/20 bg-trimble-blue/[0.03] shadow-sm'
          : 'border-gray-200 dark:border-gray-800 hover:border-trimble-blue/50 hover:bg-gray-50/60 dark:hover:bg-gray-800/40',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Metadata pill. 11px is the floor — the 9px chips this replaces were
 * unreadable, and grey-on-grey put them under 4.5:1.
 */
export function Chip({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'success';
  className?: string;
}) {
  const tones = {
    neutral: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300',
    accent: 'bg-trimble-blue/10 text-trimble-blue',
    success: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Labelled numeric input.
 *
 * Always sets a foreground colour. Inputs that style only the background
 * inherit their text colour from an ancestor, which on a dark panel renders
 * the value invisible — a defect that shipped in two toolbars here.
 */
export function NumberField({
  label,
  value,
  onChange,
  suffix,
  min,
  max,
  step,
  className,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}) {
  const id = React.useId();
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={id} className="block text-[11px] font-medium text-gray-600 dark:text-gray-400">
        {label}
      </label>
      <div className="mt-1 flex items-center gap-1.5">
        <input
          id={id}
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className={cn(
            'w-full h-8 px-2 rounded-lg text-sm tabular-nums',
            'bg-white dark:bg-gray-800',
            'text-gray-900 dark:text-gray-100',
            'border border-gray-300 dark:border-gray-700',
            'outline-none focus:border-trimble-blue focus:ring-1 focus:ring-trimble-blue/30',
          )}
        />
        {suffix && <span className="text-xs text-gray-500 shrink-0">{suffix}</span>}
      </div>
    </div>
  );
}

/** Section heading inside a modal body or panel. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
      {children}
    </h3>
  );
}

/**
 * What to show when a list has nothing in it.
 *
 * An empty region with no explanation reads as a loading failure. Name what
 * would appear here and how to make it appear.
 */
export function EmptyState({
  title,
  hint,
  icon,
}: {
  title: string;
  hint?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-6">
      {icon && <div className="mb-3 text-gray-400 dark:text-gray-600">{icon}</div>}
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{title}</p>
      {hint && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 max-w-[38ch]">{hint}</p>}
    </div>
  );
}
