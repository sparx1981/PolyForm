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
 * Page-scope script execution is intentionally restricted to code owned by
 * the signed-in user. Public/shared scripts may be inspected or copied, but
 * must never execute directly with another user's browser privileges.
 */
export function canExecuteDeveloperScript(scriptOwnerId: string | undefined, currentUserId: string | undefined): boolean {
  return Boolean(currentUserId && scriptOwnerId && scriptOwnerId === currentUserId);
}

export function assertScriptExecutionAllowed(scriptOwnerId: string | undefined, currentUserId: string | undefined): void {
  if (!canExecuteDeveloperScript(scriptOwnerId, currentUserId)) {
    throw new Error('Shared scripts cannot run directly. Copy the script to your library and review it before executing.');
  }
}

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

const GEMINI_KEY_STORAGE = 'polyform_gemini_key';

/** A Gemini key the user pasted into Settings / API. Stored only in this browser. */
export function getSavedGeminiApiKey(): string {
  try { return localStorage.getItem(GEMINI_KEY_STORAGE) || ''; } catch { return ''; }
}

export function setSavedGeminiApiKey(key: string): void {
  try {
    const trimmed = key.trim();
    if (trimmed) localStorage.setItem(GEMINI_KEY_STORAGE, trimmed);
    else localStorage.removeItem(GEMINI_KEY_STORAGE);
  } catch { /* storage unavailable */ }
}

/**
 * The Gemini API key. A key the user saved in Settings / API wins, so someone can always
 * use their own. Otherwise `process.env.GEMINI_API_KEY` is not a bug — this app's
 * primary deployment target (AI Studio) injects it at runtime specifically
 * under that name (see .env.example), so that stays the first deployment choice.
 * The problem it had was reading `process.env` unconditionally: outside AI
 * Studio (a plain `vite build` / static host), `process` itself is
 * undefined, so `process.env.GEMINI_API_KEY` throws a ReferenceError before
 * the `|| ''` fallback ever runs. Guarded here, with a `VITE_`-prefixed
 * fallback so a plain Vite deployment has a way to supply the key too.
 */
export function getGeminiApiKey(): string {
  const saved = getSavedGeminiApiKey();
  if (saved) return saved;
  if (typeof process !== 'undefined' && process.env && process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }
  return import.meta.env.VITE_GEMINI_API_KEY || '';
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
