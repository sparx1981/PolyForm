import { useApp } from '../AppContext';
import { activeSection, isSectionShape } from '../tools/sectionPlanes';
import { SectionPlaneFields } from './SectionPlaneFields';
import { cn } from '../lib/utils';

/**
 * The Section Plane tool's modifier panel: which plane is being edited, whether it is cutting,
 * flipping and moving it, and which parts of the model it cuts.
 */
export function SectionToolPanel() {
  const { shapes, selectedId, setSelectedId, setSelectedIds } = useApp();
  const planes = shapes.filter(isSectionShape);
  const cutting = activeSection(shapes);
  const chosen = planes.find(p => p.id === selectedId) ?? planes.find(p => p.id === cutting?.id) ?? planes[planes.length - 1];

  if (planes.length === 0) {
    return (
      <p className="text-xs text-gray-600 dark:text-gray-300 leading-snug">
        Hover a wall, floor or any face and click to place a section plane there. Its settings, including what it cuts, appear here.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Section planes</div>
        <div className="flex flex-wrap gap-1">
          {planes.map(p => {
            const on = p.id === chosen?.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => { setSelectedId(p.id); setSelectedIds([p.id]); }}
                className={cn(
                  'px-2 py-1 rounded text-[11px] font-medium border transition-colors',
                  on ? 'bg-polyform-blue text-white border-polyform-blue' : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-polyform-blue',
                )}
              >
                {p.name || 'Section'}{p.id === cutting?.id ? ' · cutting' : ''}
              </button>
            );
          })}
        </div>
      </div>
      {chosen && <SectionPlaneFields shape={chosen} />}
    </div>
  );
}
