import type { DockZone, ToolbarKey } from '../types';

/**
 * Where the classic-layout toolbars sit. Each toolbar has a dock (left, top or bottom edge) and a
 * lane inside it. Lanes lie side by side on the left edge (columns) and stack on the top and
 * bottom edges (rows); toolbars that share a lane stack the other way, so two short toolbars can
 * sit one above the other in one column instead of leaving empty space under each.
 */
export interface ToolbarLayout {
  order: ToolbarKey[];
  docks: Record<ToolbarKey, DockZone>;
  lanes: Record<ToolbarKey, number>;
}

export type MoveTarget =
  /** Share `relativeTo`'s lane, just before or after it. */
  | { kind: 'stack'; relativeTo: ToolbarKey; position: 'before' | 'after' }
  /** Start a new lane at `index` (0 = first) in a dock. */
  | { kind: 'lane'; zone: DockZone; index: number };

/** Lanes numbered from 0 with no gaps, per dock, in their existing order. */
export function normalizeLanes(layout: ToolbarLayout): ToolbarLayout {
  const lanes = { ...layout.lanes };
  for (const zone of ['left', 'top', 'bottom'] as DockZone[]) {
    const keys = layout.order.filter(k => layout.docks[k] === zone);
    const used = [...new Set(keys.map(k => layout.lanes[k]))].sort((a, b) => a - b);
    for (const k of keys) lanes[k] = used.indexOf(layout.lanes[k]);
  }
  return { ...layout, lanes };
}

/** A layout with each toolbar in its own lane, as toolbars sat before lanes existed. */
export function defaultLanes(order: ToolbarKey[]): Record<ToolbarKey, number> {
  const lanes = {} as Record<ToolbarKey, number>;
  order.forEach((k, i) => { lanes[k] = i; });
  return lanes;
}

export function moveToolbar(layout: ToolbarLayout, key: ToolbarKey, target: MoveTarget): ToolbarLayout {
  const rest = layout.order.filter(k => k !== key);
  const docks = { ...layout.docks };
  const lanes = { ...layout.lanes };
  let order = rest;
  if (target.kind === 'stack') {
    if (target.relativeTo === key) return layout;
    docks[key] = layout.docks[target.relativeTo];
    lanes[key] = layout.lanes[target.relativeTo];
    const at = rest.indexOf(target.relativeTo);
    order = [...rest];
    order.splice(target.position === 'before' ? at : at + 1, 0, key);
  } else {
    // Make room for a lane at `index`, then put the toolbar in it.
    const inZone = rest.filter(k => layout.docks[k] === target.zone);
    const used = [...new Set(inZone.map(k => layout.lanes[k]))].sort((a, b) => a - b);
    const clamped = Math.max(0, Math.min(used.length, target.index));
    const before = clamped === 0 ? -1 : used[clamped - 1]!;
    const shifted = { ...lanes };
    for (const k of inZone) if (layout.lanes[k]! > before) shifted[k] = layout.lanes[k]! + 1;
    Object.assign(lanes, shifted);
    docks[key] = target.zone;
    lanes[key] = before + 1;
    order = [...rest, key];
  }
  return normalizeLanes({ order, docks, lanes });
}

/** The toolbars in a dock as lanes, each lane in toolbar order. Only `enabled` toolbars count. */
export function lanesOf(layout: ToolbarLayout, zone: DockZone, enabled: (k: ToolbarKey) => boolean): ToolbarKey[][] {
  const keys = layout.order.filter(k => layout.docks[k] === zone && enabled(k));
  const laneNumbers = [...new Set(keys.map(k => layout.lanes[k]))].sort((a, b) => a - b);
  return laneNumbers.map(n => keys.filter(k => layout.lanes[k] === n));
}
