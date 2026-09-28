import type { Shape } from '../types';

// The action recorder ("record macro"): turns what the user did by hand into an SDK script that
// replays it. Rather than relying on every tool to describe itself, the recorder compares the
// model before and after each action and writes the exact change, so no tool can be missed and
// a replay produces the same objects (same ids, so later steps find them again).

/**
 * Numbers are written at full precision: a replay has to land exactly where the user drew, or
 * corners that met stop meeting. Only -0 is tidied (JSON writes it as 0 anyway).
 */
function tidyNumber(n: number): number {
  return Object.is(n, -0) ? 0 : n;
}

/** Plain-JSON copy with typed arrays as arrays; undefined fields are dropped. */
export function normalizeForScript(value: unknown): unknown {
  if (typeof value === 'number') return tidyNumber(value);
  if (value === null || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return Array.from(value as unknown as ArrayLike<number>, tidyNumber);
  }
  if (Array.isArray(value)) return value.map(v => (v === undefined ? null : normalizeForScript(v)));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined || typeof v === 'function') continue;
    out[k] = normalizeForScript(v);
  }
  return out;
}

/** A JavaScript literal for any recorded value (JSON is valid JS, and escapes strings safely). */
export function sdkLiteral(value: unknown): string {
  if (value === undefined) return 'undefined';
  return JSON.stringify(normalizeForScript(value));
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return sdkLiteral(a) === sdkLiteral(b);
}

/** `{ a: 1, b: undefined }` - JSON can't say "remove this field", so object patches are written by hand. */
function patchLiteral(patch: Record<string, unknown>): string {
  const parts = Object.entries(patch).map(([k, v]) => `${JSON.stringify(k)}: ${sdkLiteral(v)}`);
  return `{ ${parts.join(', ')} }`;
}

/**
 * SDK lines that turn the model `prev` into `next`: deleteObject for removed objects,
 * addObject (keeping the id) for new ones, and updateObject with only the changed fields
 * (a field set to `undefined` is removed).
 */
export function diffShapesToSdk(prev: Shape[], next: Shape[]): string[] {
  const lines: string[] = [];
  const before = new Map(prev.map(s => [s.id, s]));
  const after = new Map(next.map(s => [s.id, s]));

  for (const s of prev) {
    if (!after.has(s.id)) lines.push(`sdk.deleteObject(${JSON.stringify(s.id)});`);
  }
  for (const s of next) {
    const old = before.get(s.id);
    if (!old) {
      const { type, ...props } = s;
      lines.push(`sdk.addObject(${JSON.stringify(type)}, ${sdkLiteral(props)});`);
      continue;
    }
    if (old === s) continue;
    const patch: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(old), ...Object.keys(s)]);
    for (const k of keys) {
      if (k === 'id') continue;
      const a = (old as any)[k];
      const b = (s as any)[k];
      if (!sameValue(a, b)) patch[k] = b;
    }
    if (Object.keys(patch).length > 0) {
      lines.push(`sdk.updateObject(${JSON.stringify(s.id)}, ${patchLiteral(patch)});`);
    }
  }
  return lines;
}

/** Recorded settings: one entry per setting the recorder watches, and the SDK line that sets it. */
export interface RecordedSetting {
  key: string;
  value: unknown;
  toSdk: (value: unknown) => string;
}

/** SDK lines for the settings whose value differs between the two snapshots. */
export function diffSettingsToSdk(prev: Record<string, unknown>, settings: RecordedSetting[]): string[] {
  const lines: string[] = [];
  for (const s of settings) {
    if (!(s.key in prev) || sameValue(prev[s.key], s.value)) continue;
    lines.push(s.toSdk(s.value));
  }
  return lines;
}

/** A comment line naming the action, made safe for any text (no line breaks can escape the comment). */
export function actionLabel(text: string): string {
  return `// ${text.replace(/[\r\n]+/g, ' ').trim()}`;
}
