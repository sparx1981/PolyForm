import React, { useEffect, useState } from 'react';
import { AlertTriangle, Building2, Eye, Mountain, RotateCcw, Trash2 } from 'lucide-react';
import { useApp } from '../AppContext';
import type { Shape, WorldSiteInfo } from '../types';
import { cn } from '../lib/utils';
import { actionLabel } from '../lib/macroRecorder';
import { browserSiteIO } from '../lib/worldSite/fetchSite';
import { buildSite, findSiteGround, isSiteShape, replaceSite } from '../lib/worldSite/site';
import { OSM_ATTRIBUTION, removedBuildings, shapeFromSnapshot, withBuildingHeight } from '../lib/worldSite/buildings';
import { MAX_SITE_SIZE, MIN_SITE_SIZE } from '../lib/worldSite/geo';

// World View's 3D site: bring in the real ground and existing buildings around the chosen place
// (see lib/worldSite), then choose how the ground looks and whether removed buildings show as
// ghosts. Each change is one undo step and is recorded as an sdk.worldView command.

const sdkCall = (method: string, ...args: unknown[]) => `sdk.worldView.${method}(${args.map(a => JSON.stringify(a)).join(', ')});`;

function useSiteChange() {
  const { setShapes, commitHistory, recordAction } = useApp();
  return (label: string, sdk: string, change: (prev: Shape[]) => Shape[]) => {
    recordAction(actionLabel(label), { sdk });
    setShapes(change);
    commitHistory();
  };
}

const withSite = (changes: Partial<WorldSiteInfo>) => (prev: Shape[]) => prev.map(s => (s.terrainData?.site
  ? { ...s, terrainData: { ...s.terrainData, site: { ...s.terrainData.site, ...changes } } }
  : s));

function Toggle({ options, value, onChange }: { options: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="flex items-center gap-1 p-1 rounded-lg bg-gray-100 dark:bg-gray-800">
      {options.map(o => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)}
          className={cn('flex-1 text-[10px] font-bold uppercase tracking-wider py-1.5 rounded-md transition-colors',
            value === o.id ? 'bg-white dark:bg-gray-700 text-polyform-blue shadow-sm' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The World View panel's "3D site" section. */
export function WorldSiteSection() {
  const { shapes, worldViewLocation, setIsWorldViewActive, recordAction, setShapes, commitHistory, googleMapsApiKey } = useApp();
  const change = useSiteChange();
  const ground = findSiteGround(shapes);
  const site = ground?.terrainData?.site;
  const [size, setSize] = useState(100);
  const [style, setStyle] = useState<'plain' | 'satellite'>('plain');
  const [status, setStatus] = useState<{ busy: boolean; message: string; warn?: boolean }>({ busy: false, message: '' });
  useEffect(() => { if (site) setStyle(site.groundStyle); }, [site?.groundStyle]); // eslint-disable-line react-hooks/exhaustive-deps

  const buildingCount = shapes.filter(s => s.type === 'site_building').length;
  const removed = removedBuildings(ground?.terrainData?.siteExisting, shapes);
  const checks = shapes.filter(s => s.siteBuildingData?.heightCheck).length;

  const importSite = async () => {
    if (status.busy) return;
    if (site && !window.confirm('Replace the site you imported before? Your own design stays; the old ground and existing buildings are swapped for the new ones.')) return;
    setStatus({ busy: true, message: 'Loading ground heights and buildings…' });
    try {
      const origin = { lat: worldViewLocation.lat, lng: worldViewLocation.lng };
      const address = worldViewLocation.address ?? `${origin.lat.toFixed(6)}, ${origin.lng.toFixed(6)}`;
      const built = await buildSite(browserSiteIO, { origin, size, address, groundStyle: style });
      recordAction(actionLabel(`Import 3D site at ${address}`), {
        sdk: sdkCall('importArea', { lat: +origin.lat.toFixed(7), lng: +origin.lng.toFixed(7) }, { size, groundStyle: style }),
        unchecked: true,
      });
      setShapes(prev => replaceSite(prev, built));
      commitHistory();
      setIsWorldViewActive(false);
      setStatus({
        busy: false,
        warn: built.warnings.length > 0,
        message: `${built.buildings.length} building${built.buildings.length === 1 ? '' : 's'} imported on ${size} × ${size} m of ground.${built.warnings.length ? ` ${built.warnings.join(' ')}` : ''}`,
      });
    } catch (err) {
      setStatus({ busy: false, warn: true, message: `Import failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  const chooseStyle = (next: string) => {
    const s = next as 'plain' | 'satellite';
    setStyle(s);
    if (site && site.groundStyle !== s) change(`Site ground: ${s}`, sdkCall('setGroundStyle', s), withSite({ groundStyle: s }));
  };

  const label = 'text-xs font-bold text-gray-400 uppercase tracking-wider';
  return (
    <div className="space-y-3 pt-4 border-t border-gray-100 dark:border-gray-800">
      <div className="flex items-center gap-2">
        <Mountain size={14} className="text-polyform-blue" />
        <span className={label}>3D Site</span>
      </div>
      <p className="text-[10px] text-gray-400 leading-tight">
        Brings in the real ground (editable terrain) and existing buildings around the location above. Click a building to select it; delete it to design in its place.
      </p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Area</span>
          <span className="text-xs font-mono text-polyform-blue bg-polyform-blue/10 px-1.5 py-0.5 rounded">{size} × {size} m</span>
        </div>
        <input type="range" min={MIN_SITE_SIZE} max={MAX_SITE_SIZE} step={10} value={size}
          onChange={e => setSize(parseInt(e.target.value, 10))}
          className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-polyform-blue" />
      </div>
      <div className="space-y-1.5">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Ground</span>
        <Toggle options={[{ id: 'plain', label: 'Plain' }, { id: 'satellite', label: 'Satellite' }]} value={style} onChange={chooseStyle} />
        {style === 'satellite' && !googleMapsApiKey && (
          <p className="text-[10px] text-amber-600 leading-tight">Satellite ground needs a Google Maps API key; it shows plain until one is added.</p>
        )}
      </div>
      <button type="button" onClick={importSite} disabled={status.busy}
        className="w-full py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 bg-polyform-blue hover:bg-polyform-blue/90 disabled:opacity-60 text-white shadow-lg shadow-polyform-blue/20">
        <Building2 size={16} />
        {status.busy ? 'Importing…' : site ? 'Re-import 3D site here' : 'Import 3D site'}
      </button>
      {status.message && (
        <p className={cn('text-[10px] leading-tight', status.warn ? 'text-amber-600' : 'text-emerald-600')}>{status.message}</p>
      )}
      {site && (
        <div className="space-y-2 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800">
          <p className="text-[10px] text-gray-500 leading-tight">
            {site.address ?? 'Imported site'} · {site.size} m · {buildingCount} building{buildingCount === 1 ? '' : 's'}
            {removed.length ? ` · ${removed.length} removed` : ''} · centre {site.elevation.toFixed(1)} m above sea level
          </p>
          <p className="text-[10px] text-gray-400 leading-tight">
            {site.lidarSource ? `LiDAR: ${site.lidarSource}` : `Heights: ${site.terrainSource}; building heights from the map`}
            {checks > 0 ? ` · ${checks} building${checks === 1 ? '' : 's'} to check` : ''}
          </p>
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
            <input type="checkbox" checked={site.showRemoved}
              onChange={e => change(e.target.checked ? 'Show removed buildings' : 'Hide removed buildings', sdkCall('showExisting', e.target.checked), withSite({ showRemoved: e.target.checked }))} />
            <Eye size={12} /> Show removed buildings as ghosts
          </label>
          {removed.length > 0 && (
            <button type="button"
              onClick={() => change('Restore removed buildings', removed.map(r => sdkCall('restoreBuilding', r.id)).join('\n'), prev => [...prev, ...removed.map(shapeFromSnapshot)])}
              className="text-[10px] text-polyform-blue hover:underline flex items-center gap-1">
              <RotateCcw size={10} /> Put back all {removed.length} removed
            </button>
          )}
          <button type="button"
            onClick={() => {
              if (!window.confirm('Remove the imported site (ground and existing buildings)? Your own design stays.')) return;
              recordAction(actionLabel('Remove imported site'));
              setShapes(prev => prev.filter(s => !isSiteShape(s)));
              commitHistory();
            }}
            className="text-[10px] text-red-500 hover:underline flex items-center gap-1">
            <Trash2 size={10} /> Remove imported site
          </button>
        </div>
      )}
      <p className="text-[9px] text-gray-400 leading-tight">
        Buildings {OSM_ATTRIBUTION} (ODbL). Heights: Terrain Tiles (AWS open data); LiDAR from the Environment Agency (OGL), AHN (CC0) or USGS 3DEP where available. Up to {MAX_SITE_SIZE} m square.
      </p>
    </div>
  );
}

const toMetres = (v: number, unit: 'm' | 'cm' | 'mm') => (unit === 'mm' ? v / 1000 : unit === 'cm' ? v / 100 : v);
const fromMetres = (v: number, unit: 'm' | 'cm' | 'mm') => +(unit === 'mm' ? v * 1000 : unit === 'cm' ? v * 100 : v).toFixed(2);

const ROOF_TEXT = { flat: 'Flat', skillion: 'Lean-to', gable: 'Gable', hip: 'Hipped', pyramid: 'Pyramid' } as const;

const SOURCE_TEXT = {
  lidar: 'Measured from the LiDAR survey',
  tagged: 'Height given on the map (or typed in)',
  levels: 'From its number of floors (3 m each)',
  estimated: 'Estimated from the kind of building',
} as const;

/** Entity Info fields for an existing building on an imported site. */
export function SiteBuildingFields({ shape }: { shape: Shape }) {
  const { unit, setSelectedId, setSelectedIds } = useApp();
  const change = useSiteChange();
  const data = shape.siteBuildingData!;
  const [height, setHeight] = useState(String(fromMetres(data.height, unit)));
  useEffect(() => setHeight(String(fromMetres(data.height, unit))), [shape.id, data.height, unit]);

  const applyHeight = () => {
    const h = toMetres(parseFloat(height), unit);
    if (!(h > 0) || Math.abs(h - data.height) < 1e-4) { setHeight(String(fromMetres(data.height, unit))); return; }
    const next = withBuildingHeight(data, h);
    change(`Set height of ${shape.name}`, sdkCall('setBuildingHeight', shape.id, h), prev => prev.map(s => (s.id === shape.id ? { ...s, siteBuildingData: next } : s)));
  };

  const field = 'w-full px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-polyform-blue';
  const label = 'text-[9px] font-bold text-gray-400 uppercase tracking-wider';
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <label className={label}>Existing building height ({unit})</label>
        <input inputMode="decimal" value={height} onChange={e => setHeight(e.target.value)} onBlur={applyHeight}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} className={field} />
        <p className="text-[10px] text-gray-400 leading-tight">
          {SOURCE_TEXT[data.heightSource]}{data.kind && data.kind !== 'yes' ? ` · ${data.kind.replace(/_/g, ' ')}` : ''}
        </p>
        {data.roof && (
          <p className="text-[10px] text-gray-500 leading-tight">
            {ROOF_TEXT[data.roof.shape]} roof, {Math.round(data.roof.pitch)}° · eaves {fromMetres(data.roof.eave, unit)} {unit}
          </p>
        )}
        {data.heightCheck && (
          <p className="flex items-start gap-1 text-[10px] leading-tight text-amber-600">
            <AlertTriangle size={11} className="mt-px shrink-0" />
            Check height: the LiDAR survey shows open ground here, so this is the map's estimate. The building may be newer than the survey, or its outline may be wrong.
          </p>
        )}
      </div>
      <button type="button"
        onClick={() => {
          change(`Remove ${shape.name}`, sdkCall('removeBuilding', shape.id), prev => prev.filter(s => s.id !== shape.id));
          setSelectedId(null);
          setSelectedIds([]);
        }}
        className="w-full py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 bg-red-50 dark:bg-red-950/40 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/40">
        <Trash2 size={12} /> Remove building (keeps a ghost)
      </button>
    </div>
  );
}
