import { useApp } from '../AppContext';
import { componentDefinitions } from '../tools/kernelGroups';
import { actionLabel } from '../lib/macroRecorder';

// The components in the model (tools/kernelGroups.ts): one row per definition, with how many
// copies it has. Rename a component (every copy takes the name), place another copy, or select
// all its copies. Make one from drawn faces with right-click > Make Component.

export function ComponentsList() {
  const { shapes, setShapes, duplicateObject, setSelectedId, setSelectedIds, recordAction } = useApp();
  const defs = componentDefinitions(shapes);
  const button = 'text-[10px] px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 hover:border-polyform-blue transition-colors';

  if (defs.length === 0) {
    return (
      <p className="text-[10px] text-gray-400 leading-snug">
        No components in this model yet. Select drawn faces, right-click and choose Make Component. Copies of a component share their inside: edit one (double-click it) and they all change.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {defs.map(def => (
        <div key={def.componentId} className="flex items-center gap-2">
          <input
            value={def.name}
            onChange={e => {
              const name = e.target.value;
              setShapes(prev => prev.map(s => (s.componentId === def.componentId ? { ...s, componentName: name } : s)));
            }}
            className="flex-1 min-w-0 px-1.5 py-0.5 text-xs bg-transparent rounded focus:outline-none focus:ring-1 focus:ring-polyform-blue"
            title="Rename this component"
          />
          <span className="text-[10px] text-gray-400 whitespace-nowrap">{def.count} {def.count === 1 ? 'copy' : 'copies'}</span>
          <button className={button} onClick={() => duplicateObject(def.firstId)} title="Place another copy next to the first">
            Copy
          </button>
          <button
            className={button}
            onClick={() => {
              const ids = shapes.filter(s => s.componentId === def.componentId).map(s => s.id);
              setSelectedId(ids[0] ?? null);
              setSelectedIds(ids);
              recordAction(actionLabel(`Select all ${def.name}`));
            }}
            title="Select every copy"
          >
            Select
          </button>
        </div>
      ))}
    </div>
  );
}
