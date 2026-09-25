import React, { useEffect, useState } from 'react';
import { Box, Building2, Camera, Mountain, MoreHorizontal, Shapes, X } from 'lucide-react';
import { cn } from '../lib/utils';

export interface PhoneDockTool {
  id: string;
  label: string;
  icon: React.ReactNode;
  isActive?: (appState: any) => boolean;
  onClick: (appState: any) => void;
}

export interface PhoneDockGroup {
  id: string;
  name: string;
  tools: PhoneDockTool[];
}

const GROUP_LOOK: Record<string, { label: string; icon: React.ReactNode }> = {
  basic: { label: 'Draw', icon: <Shapes size={20} /> },
  architecture: { label: 'Build', icon: <Building2 size={20} /> },
  landscape: { label: 'Land', icon: <Mountain size={20} /> },
  camera: { label: 'View', icon: <Camera size={20} /> },
};

interface PhoneDockProps {
  groups: PhoneDockGroup[];
  app: any;
  theme: string;
  accent?: string;
  landscape: boolean;
  morePanelOpen: boolean;
  onMore: () => void;
}

/**
 * The phone's one dock: a button per tool group plus "More" (the right-hand panels). Tapping a
 * group opens a sheet of that group's tools; picking a tool closes it. In portrait the dock runs
 * along the bottom and the sheet rises above it; in landscape the dock is a left column and the
 * sheet opens beside it.
 */
export default function PhoneDock({ groups, app, theme, accent, landscape, morePanelOpen, onMore }: PhoneDockProps) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const dark = theme === 'dark';
  const group = groups.find(g => g.id === openGroup) ?? null;

  useEffect(() => {
    if (morePanelOpen) setOpenGroup(null);
  }, [morePanelOpen]);

  const groupHasActive = (g: PhoneDockGroup) => g.tools.some(t => t.isActive?.(app));

  const dockButton = (id: string, label: string, icon: React.ReactNode, active: boolean, highlighted: boolean, onClick: () => void) => (
    <button
      key={id}
      id={`phone-dock-${id}`}
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center gap-0.5 rounded-lg transition-colors relative',
        landscape ? 'w-14 h-14' : 'flex-1 h-full min-w-0',
        active
          ? 'text-white'
          : dark ? 'text-gray-300 active:bg-gray-700' : 'text-gray-700 active:bg-gray-100'
      )}
      style={active ? { backgroundColor: accent || '#0063a3' } : undefined}
    >
      {icon}
      <span className="text-[10px] font-semibold leading-none">{label}</span>
      {highlighted && !active && (
        <span className="absolute top-1.5 right-1/2 translate-x-4 w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accent || '#0063a3' }} />
      )}
    </button>
  );

  return (
    <>
      <nav
        id="phone-dock"
        aria-label="Tools"
        className={cn(
          'z-[60] flex shrink-0 border select-none',
          landscape ? 'flex-col items-center gap-1 w-16 h-full py-2 border-y-0 border-l-0' : 'flex-row items-stretch gap-1 h-14 px-1 py-1 border-x-0 border-b-0',
          dark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
        )}
        style={landscape ? undefined : { paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom))' }}
      >
        {groups.map(g => {
          const look = GROUP_LOOK[g.id] ?? { label: g.name, icon: <Box size={20} /> };
          return dockButton(g.id, look.label, look.icon, openGroup === g.id, groupHasActive(g), () =>
            setOpenGroup(prev => (prev === g.id ? null : g.id)));
        })}
        {dockButton('more', 'More', <MoreHorizontal size={20} />, morePanelOpen, false, () => {
          setOpenGroup(null);
          onMore();
        })}
      </nav>

      {group && (
        <div
          id="phone-tool-sheet"
          className={cn(
            'absolute z-[70] flex flex-col shadow-2xl border',
            landscape
              ? 'left-16 top-0 bottom-0 w-72 border-y-0 border-l-0'
              : 'left-0 right-0 bottom-14 max-h-[55%] rounded-t-2xl border-b-0',
            dark ? 'bg-gray-900 border-gray-700 text-gray-200' : 'bg-white border-gray-200 text-gray-800'
          )}
        >
          <div className={cn('flex items-center justify-between px-4 h-11 shrink-0 border-b', dark ? 'border-gray-800' : 'border-gray-100')}>
            <span className="text-xs font-bold uppercase tracking-wider">{group.name}</span>
            <button onClick={() => setOpenGroup(null)} className="p-2 -mr-2" aria-label="Close tools">
              <X size={16} />
            </button>
          </div>
          <div className="overflow-y-auto p-2 grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(68px, 1fr))' }}>
            {group.tools.map(tool => {
              const active = tool.isActive ? tool.isActive(app) : false;
              return (
                <button
                  key={tool.id}
                  id={`phone-tool-${tool.id}`}
                  onClick={() => {
                    tool.onClick(app);
                    setOpenGroup(null);
                  }}
                  className={cn(
                    'flex flex-col items-center justify-start gap-1 rounded-xl px-1 py-2 min-h-[64px]',
                    active ? 'text-white' : dark ? 'active:bg-gray-800' : 'active:bg-gray-100'
                  )}
                  style={active ? { backgroundColor: accent || '#0063a3' } : undefined}
                >
                  {tool.icon}
                  <span className="text-[10px] leading-tight text-center line-clamp-2">{tool.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
