import { describe, expect, it } from 'vitest';
import type { DockZone, ToolbarKey } from '../types';
import { defaultLanes, lanesOf, moveToolbar, type ToolbarLayout } from './toolbarLayout';

const order: ToolbarKey[] = ['left', 'architecture', 'landscapes', 'camera', 'ai'];
const start = (): ToolbarLayout => ({
  order,
  docks: { left: 'left', architecture: 'left', landscapes: 'left', camera: 'left', ai: 'left' } as Record<ToolbarKey, DockZone>,
  lanes: defaultLanes(order),
});
const all = () => true;
const shape = (l: ToolbarLayout, zone: DockZone = 'left') => lanesOf(l, zone, all);

describe('toolbar lanes', () => {
  it('starts as one column each, as before', () => {
    expect(shape(start())).toEqual([['left'], ['architecture'], ['landscapes'], ['camera'], ['ai']]);
  });

  it('stacks a toolbar under another in its column', () => {
    const l = moveToolbar(start(), 'ai', { kind: 'stack', relativeTo: 'camera', position: 'after' });
    expect(shape(l)).toEqual([['left'], ['architecture'], ['landscapes'], ['camera', 'ai']]);
  });

  it('stacks above', () => {
    const l = moveToolbar(start(), 'ai', { kind: 'stack', relativeTo: 'camera', position: 'before' });
    expect(shape(l)[3]).toEqual(['ai', 'camera']);
  });

  it('stacks into a column that already has two', () => {
    let l = moveToolbar(start(), 'ai', { kind: 'stack', relativeTo: 'camera', position: 'after' });
    l = moveToolbar(l, 'landscapes', { kind: 'stack', relativeTo: 'camera', position: 'after' });
    expect(shape(l)).toEqual([['left'], ['architecture'], ['camera', 'landscapes', 'ai']]);
  });

  it('moves a stacked toolbar out to its own new column at the front', () => {
    let l = moveToolbar(start(), 'ai', { kind: 'stack', relativeTo: 'camera', position: 'after' });
    l = moveToolbar(l, 'ai', { kind: 'lane', zone: 'left', index: 0 });
    expect(shape(l)).toEqual([['ai'], ['left'], ['architecture'], ['landscapes'], ['camera']]);
  });

  it('starts a new column between two others', () => {
    const l = moveToolbar(start(), 'ai', { kind: 'lane', zone: 'left', index: 2 });
    expect(shape(l)).toEqual([['left'], ['architecture'], ['ai'], ['landscapes'], ['camera']]);
  });

  it('closes the gap a toolbar leaves behind', () => {
    const l = moveToolbar(start(), 'architecture', { kind: 'stack', relativeTo: 'ai', position: 'after' });
    expect(shape(l)).toEqual([['left'], ['landscapes'], ['camera'], ['ai', 'architecture']]);
  });

  it('re-docks to another edge, in its own row', () => {
    const l = moveToolbar(start(), 'camera', { kind: 'lane', zone: 'top', index: 0 });
    expect(shape(l, 'top')).toEqual([['camera']]);
    expect(shape(l)).toEqual([['left'], ['architecture'], ['landscapes'], ['ai']]);
  });

  it('stacking under a toolbar on another edge moves it there', () => {
    let l = moveToolbar(start(), 'camera', { kind: 'lane', zone: 'top', index: 0 });
    l = moveToolbar(l, 'ai', { kind: 'stack', relativeTo: 'camera', position: 'after' });
    expect(shape(l, 'top')).toEqual([['camera', 'ai']]);
  });

  it('leaves the layout alone when dropped on itself', () => {
    const l = start();
    expect(moveToolbar(l, 'ai', { kind: 'stack', relativeTo: 'ai', position: 'after' })).toBe(l);
  });

  it('skips toolbars that are switched off', () => {
    const l = moveToolbar(start(), 'ai', { kind: 'stack', relativeTo: 'camera', position: 'after' });
    expect(lanesOf(l, 'left', k => k !== 'camera')).toEqual([['left'], ['architecture'], ['landscapes'], ['ai']]);
  });
});
