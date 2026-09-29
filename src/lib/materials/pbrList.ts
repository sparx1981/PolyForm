import { FINISH_FAMILIES, PLAIN_FINISHES, type PlainFinish } from './plainFinishes';

/**
 * One list of PBR materials: the plain finishes (plastics, metals, glass ...) and the pre-made
 * library, sorted into shared categories with one filter. Categories with the same name (the
 * "Metal" finishes and a library's "Metal") are one category.
 */
export interface LibraryPbr {
  id: string;
  name: string;
  /** The library category shown as a filter (its top-level group). */
  topCategory: string;
  texture: string;
  hasHeight: boolean;
}

export type PbrEntry =
  | { kind: 'finish'; key: string; name: string; category: string; finish: PlainFinish }
  | { kind: 'library'; key: string; name: string; category: string; item: LibraryPbr };

export interface PbrList {
  entries: PbrEntry[];
  /** Every category once, alphabetical. */
  categories: string[];
}

const sameName = (s: string) => s.trim().toLowerCase();

export function buildPbrList(library: readonly LibraryPbr[]): PbrList {
  const display = new Map<string, string>();
  const category = (name: string) => {
    const k = sameName(name);
    if (!display.has(k)) display.set(k, name.trim());
    return display.get(k)!;
  };
  const entries: PbrEntry[] = [];
  for (const family of FINISH_FAMILIES) {
    for (const finish of PLAIN_FINISHES[family.id]) {
      entries.push({ kind: 'finish', key: `finish:${finish.id}`, name: finish.name, category: category(family.label), finish });
    }
  }
  for (const item of library) {
    entries.push({ kind: 'library', key: `library:${item.id}`, name: item.name, category: category(item.topCategory || 'Other'), item });
  }
  return { entries, categories: [...display.values()].sort((a, b) => a.localeCompare(b)) };
}

export function filterPbrList(entries: readonly PbrEntry[], category: string): PbrEntry[] {
  if (category === 'all') return [...entries];
  const k = sameName(category);
  return entries.filter(e => sameName(e.category) === k);
}
