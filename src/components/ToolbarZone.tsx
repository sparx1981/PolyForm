import React, { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { GripHorizontal } from 'lucide-react';
import type { DockZone, ToolbarKey } from '../types';
import { cn } from '../lib/utils';
import { lanesOf, moveToolbar, type MoveTarget, type ToolbarLayout } from '../lib/toolbarLayout';

/**
 * One edge of the window holding classic-layout toolbars, as lanes. On the left edge lanes are
 * columns side by side; on the top and bottom edges they are rows. Toolbars in the same lane
 * stack the other way, so short toolbars can share a column instead of leaving empty space.
 *
 * Toolbars can be moved only in edit mode (Settings > Toolbars > Edit Toolbar Locations). Then
 * each toolbar shows a grip; drag it onto the top or bottom half of another toolbar (left edge)
 * or its left or right half (top/bottom edges) to stack with it, or onto a strip between lanes
 * to start a new lane.
 */

type Hint = { kind: 'stack'; key: ToolbarKey; position: 'before' | 'after' } | { kind: 'lane'; index: number } | null;

interface Props {
  zone: DockZone;
  layout: ToolbarLayout;
  enabled: (k: ToolbarKey) => boolean;
  editMode: boolean;
  theme: string;
  draggedKey: ToolbarKey | null;
  setDraggedKey: (k: ToolbarKey | null) => void;
  onLayout: (next: ToolbarLayout) => void;
  render: (key: ToolbarKey, dock: DockZone) => ReactNode;
}

export function ToolbarZone({ zone, layout, enabled, editMode, theme, draggedKey, setDraggedKey, onLayout, render }: Props) {
  const [hint, setHint] = useState<Hint>(null);
  const startTimer = useRef<number | undefined>(undefined);
  const horizontal = zone !== 'left';
  const lanes = lanesOf(layout, zone, enabled);
  const dragging = editMode && draggedKey !== null;

  const drop = (target: MoveTarget) => {
    if (!draggedKey) return;
    onLayout(moveToolbar(layout, draggedKey, target));
    setDraggedKey(null);
    setHint(null);
  };

  const accent = 'bg-polyform-blue';
  const strip = (index: number) => {
    if (!dragging) return null;
    const active = hint?.kind === 'lane' && hint.index === index;
    return (
      <div
        key={`strip-${index}`}
        title="Drop here to put the toolbar in its own column"
        className={cn(
          'shrink-0 transition-colors',
          horizontal ? 'h-2.5 w-full' : 'w-2.5 self-stretch',
          active ? accent : theme === 'dark' ? 'bg-gray-700/60' : 'bg-gray-200/80',
        )}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setHint({ kind: 'lane', index }); }}
        onDragLeave={() => setHint(h => (h?.kind === 'lane' && h.index === index ? null : h))}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); drop({ kind: 'lane', zone, index }); }}
      />
    );
  };

  const slot = (key: ToolbarKey) => {
    const isDragging = draggedKey === key;
    const before = hint?.kind === 'stack' && hint.key === key && hint.position === 'before';
    const after = hint?.kind === 'stack' && hint.key === key && hint.position === 'after';
    const line = cn(accent, 'absolute z-10 pointer-events-none', horizontal ? 'top-0 bottom-0 w-1' : 'left-0 right-0 h-1');
    return (
      <div
        key={key}
        className={cn('relative shrink-0 flex', horizontal ? 'flex-row' : 'flex-col', isDragging && 'opacity-40')}
        onDragOver={editMode ? (e) => {
          if (!draggedKey || draggedKey === key) return;
          e.preventDefault();
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          const first = horizontal ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2;
          setHint({ kind: 'stack', key, position: first ? 'before' : 'after' });
        } : undefined}
        onDragLeave={editMode ? () => setHint(h => (h?.kind === 'stack' && h.key === key ? null : h)) : undefined}
        onDrop={editMode ? (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!draggedKey || draggedKey === key) return;
          drop({ kind: 'stack', relativeTo: key, position: hint?.kind === 'stack' && hint.key === key ? hint.position : 'after' });
        } : undefined}
      >
        {before && <div className={cn(line, horizontal ? 'left-0' : 'top-0')} />}
        {after && <div className={cn(line, horizontal ? 'right-0' : 'bottom-0')} />}
        {editMode && (
          <div
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              // Some browsers won't start a drag that carries no data.
              e.dataTransfer.setData('text/plain', key);
              // The drop strips appear (and this toolbar shifts) as soon as a drag is under way. Doing
              // that inside dragstart makes Chrome cancel the drag at once, so wait until it has begun.
              startTimer.current = window.setTimeout(() => setDraggedKey(key), 0);
            }}
            onDragEnd={() => { window.clearTimeout(startTimer.current); setDraggedKey(null); setHint(null); }}
            title="Drag to move this toolbar"
            className={cn(
              'flex items-center justify-center cursor-grab active:cursor-grabbing transition-colors shrink-0',
              horizontal ? 'w-3.5 border-r' : 'h-3.5 border-b',
              theme === 'dark' ? 'bg-gray-850 border-gray-700 hover:bg-gray-800 text-gray-600' : 'bg-slate-50 border-gray-200 hover:bg-gray-100 text-gray-400',
            )}
          >
            <GripHorizontal size={12} className={horizontal ? 'rotate-90' : undefined} />
          </div>
        )}
        <div className="min-h-0 min-w-0">{render(key, zone)}</div>
      </div>
    );
  };

  if (lanes.length === 0 && !dragging) return null;

  // An empty edge is a real target while dragging, big enough to aim at.
  const emptyTarget = dragging && lanes.length === 0;
  const edgeName = zone === 'left' ? 'left' : zone === 'top' ? 'top' : 'bottom';

  return (
    <div
      className={cn(
        horizontal ? 'flex flex-col w-full shrink-0' : 'flex flex-row h-full shrink-0',
        emptyTarget && (horizontal ? 'min-h-[36px]' : 'min-w-[36px]'),
      )}
      onDragOver={dragging ? (e) => { e.preventDefault(); } : undefined}
      onDrop={dragging ? (e) => { e.preventDefault(); drop({ kind: 'lane', zone, index: lanes.length }); } : undefined}
    >
      {lanes.map((keys, i) => (
        <React.Fragment key={keys.join('+')}>
          {strip(i)}
          {/* The empty space after a lane's last toolbar is a target too: drop there to stack beneath it. */}
          <div
            className={cn('flex shrink-0 relative', horizontal ? 'flex-row w-full' : 'flex-col h-full overflow-y-auto overflow-x-hidden')}
            onDragOver={dragging ? (e) => {
              const last = keys[keys.length - 1]!;
              if (draggedKey === last && keys.length === 1) return;
              e.preventDefault();
              e.stopPropagation();
              setHint({ kind: 'stack', key: last, position: 'after' });
            } : undefined}
            onDragLeave={dragging ? () => setHint(h => (h?.kind === 'stack' && h.key === keys[keys.length - 1] ? null : h)) : undefined}
            onDrop={dragging ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              const last = keys[keys.length - 1]!;
              if (!draggedKey || draggedKey === last) return;
              drop({ kind: 'stack', relativeTo: last, position: 'after' });
            } : undefined}
          >
            {keys.map(slot)}
          </div>
        </React.Fragment>
      ))}
      {emptyTarget ? (
        <div
          title={`Drop here to dock the toolbar on the ${edgeName} edge`}
          className={cn(
            'flex-1 flex items-center justify-center border-2 border-dashed text-[10px] font-semibold uppercase tracking-wider select-none',
            hint?.kind === 'lane' && hint.index === 0
              ? 'border-polyform-blue bg-polyform-blue/15 text-polyform-blue'
              : theme === 'dark' ? 'border-gray-600 text-gray-400' : 'border-gray-300 text-gray-500',
          )}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setHint({ kind: 'lane', index: 0 }); }}
          onDragLeave={() => setHint(h => (h?.kind === 'lane' && h.index === 0 ? null : h))}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); drop({ kind: 'lane', zone, index: 0 }); }}
        >
          <span className={horizontal ? undefined : '[writing-mode:vertical-rl]'}>Dock {edgeName}</span>
        </div>
      ) : strip(lanes.length)}
    </div>
  );
}
