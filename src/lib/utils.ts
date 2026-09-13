import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatValue(meters: number, unit: 'mm' | 'cm' | 'm', decimals: number = 2) {
  switch (unit) {
    case 'mm': return (meters * 1000).toFixed(decimals) + ' mm';
    case 'cm': return (meters * 100).toFixed(decimals) + ' cm';
    default: return meters.toFixed(decimals) + ' m';
  }
}

export const SCRIPT_EXECUTION_TIMEOUT_MS = 5000;

/**
 * Executes a user/toolbar script body via `new Function`. This still runs
 * in the page's own global scope (window/DOM/localStorage are reachable) —
 * it is NOT a sandbox. The timeout only interrupts a script awaiting a
 * promise that never resolves; it cannot preempt a synchronous infinite
 * loop, since JS is single-threaded. Centralized here so every call site
 * enforces the same limit instead of hanging indefinitely.
 */
export async function runToolboxScript(code: string, paramNames: string[], paramValues: any[], rethrow: boolean = false): Promise<void> {
  const fn = new Function(...paramNames, `
    return (async () => {
      try {
        ${code}
      } catch (e) {
        console.error(e.message || String(e));
        ${rethrow ? 'throw e;' : ''}
      }
    })();
  `);
  await Promise.race([
    fn(...paramValues),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Script execution timed out (${SCRIPT_EXECUTION_TIMEOUT_MS / 1000}s limit)`)), SCRIPT_EXECUTION_TIMEOUT_MS)
    )
  ]);
}

export function safelyToDate(val: any): Date {
  if (!val) return new Date(0);
  if (typeof val.toDate === 'function') return val.toDate();
  if (val instanceof Date) return val;
  if (typeof val === 'number') return new Date(val);
  if (val.seconds !== undefined) return new Date(val.seconds * 1000 + (val.nanoseconds || 0) / 1000000);
  if (typeof val === 'string') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? new Date(0) : d;
  }
  return new Date(0);
}
