import { DEFAULT_CAMERA_VIEW, FOV_RANGE, LENS_PRESETS, STANDARD_VIEWS, cameraView, useCameraView, type Projection, type StandardView } from '../lib/cameraView';
import { cn } from '../lib/utils';

const heading = 'text-[10px] text-gray-500 font-bold uppercase tracking-wider';
const chip = (on: boolean) => cn(
  'flex-1 px-2 py-1.5 rounded-md text-[11px] font-semibold border transition-colors',
  on ? 'bg-polyform-blue text-white border-polyform-blue' : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-polyform-blue',
);

/**
 * The Camera Type tool's modifier panel: perspective or orthographic projection, the lens for perspective,
 * and one-click plan, elevation and isometric views framed to the model.
 */
export function CameraTypePanel() {
  const { projection, fov } = useCameraView();
  const ortho = projection === 'orthographic';
  const show = (view: StandardView, wanted?: Projection) => window.dispatchEvent(new CustomEvent('frame-view', { detail: { view, projection: wanted } }));
  const groups = ['Drawing', 'Isometric'] as const;
  const isDefault = projection === DEFAULT_CAMERA_VIEW.projection && fov === DEFAULT_CAMERA_VIEW.fov;
  return (
    <div className="space-y-4">
      <button type="button" disabled={isDefault} onClick={() => cameraView.reset()}
        title="Back to Perspective with the Standard lens"
        className="w-full px-2 py-1.5 rounded-md text-[11px] font-semibold border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-polyform-blue disabled:opacity-40 disabled:hover:border-gray-300 disabled:cursor-default">
        Reset to default
      </button>
      <div className="space-y-1.5">
        <div className={heading}>Projection</div>
        <div role="group" aria-label="Projection" className="flex gap-1">
          {([['perspective', 'Perspective'], ['orthographic', 'Orthographic']] as const).map(([id, name]) => (
            <button key={id} type="button" aria-pressed={projection === id} onClick={() => cameraView.set({ projection: id })} className={chip(projection === id)}>{name}</button>
          ))}
        </div>
        <p className="text-[10px] text-gray-500 leading-snug">
          {ortho ? 'Parallel lines stay parallel and size does not change with distance. Walk and Portal Navigation switch back to Perspective while they run.'
            : 'Things get smaller with distance, as in a photograph.'}
        </p>
      </div>

      <div className={cn('space-y-1.5', ortho && 'opacity-50')}>
        <div className={heading}>Lens {ortho && <span className="normal-case font-normal">(Perspective only)</span>}</div>
        <div role="group" aria-label="Lens" className="grid grid-cols-2 gap-1">
          {LENS_PRESETS.map(p => (
            <button key={p.id} type="button" title={p.hint} aria-pressed={fov === p.fov} onClick={() => cameraView.set({ fov: p.fov })} className={chip(fov === p.fov)}>
              {p.name} · {p.fov}°
            </button>
          ))}
        </div>
        <label className="block">
          <div className="flex justify-between text-[11px] text-gray-600 dark:text-gray-300 mb-1"><span>Field of view</span><span className="tabular-nums">{Math.round(fov)}°</span></div>
          <input type="range" min={FOV_RANGE[0]} max={FOV_RANGE[1]} step={1} value={fov} onChange={e => cameraView.set({ fov: +e.target.value })} className="w-full accent-sky-500" />
        </label>
      </div>

      {groups.map(group => (
        <div key={group} className="space-y-1.5">
          <div className={heading}>{group === 'Drawing' ? 'Plan and elevations' : 'Isometric views'}</div>
          <div className="grid grid-cols-3 gap-1">
            {STANDARD_VIEWS.filter(v => v.group === group).map(v => (
              <button key={v.id} type="button" onClick={() => show(v.id, group === 'Isometric' ? 'orthographic' : undefined)}
                title={group === 'Isometric' ? 'Isometric view (switches to Orthographic)' : `${v.name} view of the whole model`}
                className="px-2 py-1.5 rounded-md text-[11px] font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-polyform-blue">
                {v.name}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="text-[10px] text-gray-500 leading-snug">Views fit the whole model. Drag to orbit, scroll to zoom: the view stays in the projection you chose.</p>
    </div>
  );
}
