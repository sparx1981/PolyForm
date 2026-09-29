import { describe, expect, it } from 'vitest';
import { buildPbrList, filterPbrList, type LibraryPbr } from './pbrList';
import { FINISH_FAMILIES, PLAIN_FINISHES } from './plainFinishes';

const lib = (id: string, topCategory: string): LibraryPbr => ({ id, name: id, topCategory, texture: `${id}.jpg`, hasHeight: false });
const finishCount = FINISH_FAMILIES.reduce((n, f) => n + PLAIN_FINISHES[f.id].length, 0);

describe('buildPbrList', () => {
  it('puts the plain finishes first, then the library, in one list', () => {
    const { entries } = buildPbrList([lib('bricks-1', 'Brick'), lib('oak-1', 'Wood')]);
    expect(entries).toHaveLength(finishCount + 2);
    expect(entries.slice(0, finishCount).every(e => e.kind === 'finish')).toBe(true);
    expect(entries.slice(finishCount).map(e => e.kind)).toEqual(['library', 'library']);
  });

  it('gives every finish family and every library category as a filter, once each, sorted', () => {
    const { categories } = buildPbrList([lib('a', 'Wood'), lib('b', 'Brick'), lib('c', 'Wood')]);
    expect(categories).toEqual(['Brick', 'Glass', 'Metal', 'Other', 'Plastic', 'Wood']);
  });

  it("treats the finishes' Metal and a library's metal as one category", () => {
    const list = buildPbrList([lib('a', 'metal'), lib('b', 'METAL ')]);
    expect(list.categories.filter(c => c.toLowerCase() === 'metal')).toHaveLength(1);
    const metals = filterPbrList(list.entries, 'Metal');
    expect(metals.filter(e => e.kind === 'library')).toHaveLength(2);
    expect(metals.filter(e => e.kind === 'finish')).toHaveLength(PLAIN_FINISHES.metal.length);
  });

  it('files a library item with no category under Other, with the "Other" finishes', () => {
    const list = buildPbrList([lib('a', '')]);
    const other = filterPbrList(list.entries, 'Other');
    expect(other.some(e => e.kind === 'library')).toBe(true);
    expect(other.some(e => e.kind === 'finish')).toBe(true);
  });

  it('works before the library has loaded', () => {
    const list = buildPbrList([]);
    expect(list.entries).toHaveLength(finishCount);
    expect(list.categories).toEqual(['Glass', 'Metal', 'Other', 'Plastic']);
  });
});

describe('filterPbrList', () => {
  it('shows everything for all, and one category otherwise', () => {
    const list = buildPbrList([lib('a', 'Wood')]);
    expect(filterPbrList(list.entries, 'all')).toHaveLength(list.entries.length);
    expect(filterPbrList(list.entries, 'Wood').map(e => e.key)).toEqual(['library:a']);
    expect(filterPbrList(list.entries, 'Nothing')).toEqual([]);
  });
});
