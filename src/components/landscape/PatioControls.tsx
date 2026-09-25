import React, { useMemo, useState } from 'react';
import { useApp } from '../../AppContext';
import { cn } from '../../lib/utils';
import { useAssetCatalog } from '../../lib/assets/useAssetCatalog';
import { isMaterialAssetId, type AssetSummary } from '../../lib/assets/types';
import {
  DECK_BOARDS, PAVING_STYLES, SLAB_SIZES,
  type BlockPattern, type BoardDirection, type DeckBoard, type PatioData, type PatioKind, type PatioToolSettings,
  type PavingStyle, type RailingStyle,
} from '../../lib/patio/patioTypes';
import { buildPatio } from '../../lib/patio/patioGeometry';

type Look = PatioToolSettings['template'];

const label = 'text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400';
const chip = (active: boolean) => cn('rounded-md border px-2 py-1.5 text-left text-[11px] font-semibold transition-colors',
  active ? 'border-polyform-blue bg-polyform-blue/10 text-polyform-blue'
    : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-300');

function Toggle({ text, checked, onChange }: { text: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center justify-between text-[11px] text-gray-600 dark:text-gray-300">
      {text}
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
    </label>
  );
}

function Slider({ text, value, min, max, step, format, onChange }: {
  text: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between">
        <label className={label}>{text}</label>
        <span className="text-[10px] font-mono text-polyform-blue">{format(value)}</span>
      </div>
      <input type="range" className="w-full" min={min} max={max} step={step} value={value}
        onChange={event => onChange(parseFloat(event.target.value))} />
    </div>
  );
}

function ColorField({ text, value, onChange }: { text: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between text-[11px] text-gray-600 dark:text-gray-300">
      {text}
      <input type="color" value={value} onChange={event => onChange(event.target.value)} className="h-6 w-10 cursor-pointer rounded border-none p-0" />
    </label>
  );
}

/** Library materials that suit paving or decking are offered first. */
function suits(asset: AssetSummary, kind: PatioKind, paving: PavingStyle): boolean {
  const path = asset.categoryPath;
  if (kind === 'deck') return path.startsWith('Wood');
  if (paving === 'gravel') return path.includes('Gravel') || path.includes('Pebbles');
  return path.startsWith('Brick & Block') || path.startsWith('Stone/Cobblestone') || path.startsWith('Stone/Slabs')
    || path.startsWith('Ceramic') || path.startsWith('Concrete') || path.startsWith('Stone/Walls');
}

/**
 * Settings for the Patio / Decking tool: the look of the next patio or deck, or of the selected
 * one (changes apply to it straight away), plus steps, lights and quantities.
 */
export function PatioControls() {
  const { patioToolSettings: tool, setPatioToolSettings, shapes, setShapes, selectedId, commitHistory, setMaterialBindings, setActiveTool } = useApp();
  const selected = shapes.find(shape => shape.id === selectedId && shape.type === 'patio' && shape.patioData);
  const data: Look & { kind: PatioKind } = selected ? selected.patioData! : { ...tool.template, kind: tool.kind };
  const kind = data.kind;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState('');
  const { assets } = useAssetCatalog('material');

  const update = (patch: Partial<PatioData>) => {
    const { kind: nextKind, ...look } = patch;
    setPatioToolSettings(prev => ({ ...prev, ...(nextKind ? { kind: nextKind } : {}), template: { ...prev.template, ...look } }));
    if (selected) {
      setShapes(prev => prev.map(shape => shape.id !== selected.id ? shape : { ...shape, patioData: { ...shape.patioData!, ...patch } }));
      commitHistory();
    }
  };
  const updateLights = (patch: Partial<PatioData['lights']>) => update({ lights: { ...data.lights, ...patch } });

  const setKind = (next: PatioKind) => {
    if (next === kind) return;
    // Each kind starts from its own natural colour.
    const color = next === 'deck' ? (DECK_BOARDS.find(b => b.id === data.board)?.color ?? DECK_BOARDS[0].color)
      : (PAVING_STYLES.find(p => p.id === data.paving)?.presets[0].color ?? '#a3a7aa');
    update({ kind: next, color, surfaceMaterialId: undefined });
  };

  const chooseMaterial = (asset: AssetSummary | null) => {
    if (asset && isMaterialAssetId(asset.id)) {
      const assetId = asset.id;
      setMaterialBindings(prev => ({
        ...prev,
        [assetId]: prev[assetId]?.ref.revision === asset.revision ? prev[assetId] : { ref: { assetId, revision: asset.revision } },
      }));
    }
    update({ surfaceMaterialId: asset?.id });
    setPickerOpen(false);
  };

  const library = useMemo(() => {
    const term = search.trim().toLowerCase();
    return assets
      .filter(asset => showAll || term || suits(asset, kind, data.paving))
      .filter(asset => !term || asset.name.toLowerCase().includes(term) || asset.categoryPath.toLowerCase().includes(term));
  }, [assets, showAll, search, kind, data.paving]);
  const currentMaterial = assets.find(a => a.id === data.surfaceMaterialId);

  const stats = useMemo(() => selected
    ? buildPatio(selected.patioData!, () => (selected.patioData!.kind === 'deck' ? -0.5 : -0.02)).stats
    : null, [selected]);

  const style = PAVING_STYLES.find(p => p.id === data.paving)!;

  return (
    <div className="space-y-3.5">
      <p className="text-[10px] text-gray-500 dark:text-gray-400">
        {selected
          ? `Editing ${selected.name}. Drag yellow corners to reshape; click a white dot to add a corner; Shift-drag a dot to curve that edge (drag a violet dot to change a curve); right-click a corner to remove it.`
          : 'Click the corners (hold Shift and click to curve the next edge through that point), or drag out a rectangle. Click the first point or press Enter to finish. Points snap to walls; a patio or deck drawn against a building is set level with its floor.'}
      </p>

      <div className="grid grid-cols-2 gap-1.5">
        {(['patio', 'deck'] as const).map(k => (
          <button key={k} type="button" className={chip(kind === k)} onClick={() => setKind(k)}>
            {k === 'patio' ? 'Patio (paving)' : 'Decking (timber)'}
          </button>
        ))}
      </div>

      {kind === 'patio' ? (
        <>
          <div>
            <label className={label}>Paving</label>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {PAVING_STYLES.map(p => (
                <button key={p.id} type="button" title={p.description} className={chip(data.paving === p.id)}
                  onClick={() => update({ paving: p.id, color: p.presets[0].color, slabSize: p.slabSize, jointWidth: p.joint || data.jointWidth })}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={label}>Colour</label>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {style.presets.map(preset => (
                <button key={preset.id} type="button" title={preset.label} onClick={() => update({ color: preset.color, surfaceMaterialId: undefined })}
                  className={cn('h-7 w-7 rounded-md border-2', data.color === preset.color && !data.surfaceMaterialId ? 'border-polyform-blue' : 'border-transparent')}
                  style={{ backgroundColor: preset.color }} />
              ))}
              <input type="color" value={data.color} onChange={event => update({ color: event.target.value })}
                className="h-7 w-9 cursor-pointer rounded border-none p-0" title="Custom colour" />
            </div>
          </div>
          {(data.paving === 'slabs' || data.paving === 'porcelain' || data.paving === 'natural') && (
            <div>
              <label className={label}>{data.paving === 'natural' ? 'Stone size' : 'Slab size (mm)'}</label>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {(data.paving === 'natural'
                  ? [{ label: 'Small', size: [0.35, 0.35] as [number, number] }, { label: 'Medium', size: [0.55, 0.55] as [number, number] }, { label: 'Large', size: [0.8, 0.8] as [number, number] }]
                  : SLAB_SIZES).map(option => (
                  <button key={option.label} type="button" className={chip(data.slabSize[0] === option.size[0] && data.slabSize[1] === option.size[1])}
                    onClick={() => update({ slabSize: option.size })}>
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {data.paving === 'block' && (
            <div>
              <label className={label}>Pattern</label>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {([['herringbone', 'Herringbone'], ['stretcher', 'Stretcher'], ['basketweave', 'Basketweave']] as [BlockPattern, string][]).map(([id, text]) => (
                  <button key={id} type="button" className={chip(data.blockPattern === id)} onClick={() => update({ blockPattern: id })}>{text}</button>
                ))}
              </div>
            </div>
          )}
          {data.paving !== 'gravel' && (
            <>
              <Slider text="Pattern angle" value={data.rotation} min={0} max={90} step={5} format={v => `${v}°`} onChange={v => update({ rotation: v })} />
              <Slider text="Joint width" value={data.jointWidth * 1000} min={1} max={20} step={1} format={v => `${v} mm`} onChange={v => update({ jointWidth: v / 1000 })} />
              <ColorField text="Grout colour" value={data.groutColor} onChange={v => update({ groutColor: v })} />
            </>
          )}
          <Toggle text="Edging kerb" checked={data.kerb} onChange={v => update({ kerb: v })} />
          {data.kerb && <ColorField text="Kerb & wall colour" value={data.kerbColor} onChange={v => update({ kerbColor: v })} />}
          <Toggle text="Retaining wall where the ground is higher" checked={data.retainingWall} onChange={v => update({ retainingWall: v })} />
        </>
      ) : (
        <>
          <div>
            <label className={label}>Boards</label>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {DECK_BOARDS.map(b => (
                <button key={b.id} type="button" title={b.description} className={chip(data.board === b.id)}
                  onClick={() => update({ board: b.id as DeckBoard, color: b.color, surfaceMaterialId: undefined })}>
                  <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ backgroundColor: b.color }} />{b.label}
                </button>
              ))}
            </div>
          </div>
          <ColorField text={data.board === 'painted' ? 'Paint colour' : 'Board colour'} value={data.color} onChange={v => update({ color: v })} />
          <Slider text="Board width" value={data.boardWidth * 1000} min={90} max={200} step={2} format={v => `${v} mm`} onChange={v => update({ boardWidth: v / 1000 })} />
          <Slider text="Gap" value={data.boardGap * 1000} min={3} max={10} step={1} format={v => `${v} mm`} onChange={v => update({ boardGap: v / 1000 })} />
          <div>
            <label className={label}>Board direction</label>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              {([['length', 'Lengthways'], ['across', 'Across'], ['diagonal', 'Diagonal']] as [BoardDirection, string][]).map(([id, text]) => (
                <button key={id} type="button" className={chip(data.direction === id)} onClick={() => update({ direction: id })}>{text}</button>
              ))}
            </div>
          </div>
          <Toggle text="Picture-frame border boards" checked={data.pictureFrame} onChange={v => update({ pictureFrame: v })} />
          <Toggle text="Grooved (anti-slip) boards" checked={data.grooved} onChange={v => update({ grooved: v })} />
          {selected ? (
            <Slider text="Deck height (surface level)" value={selected.position[1]} min={selected.position[1] - 1} max={selected.position[1] + 1} step={0.01}
              format={v => `${v.toFixed(2)} m`}
              onChange={v => { setShapes(prev => prev.map(s => s.id === selected.id ? { ...s, position: [s.position[0], v, s.position[2]] } : s)); }} />
          ) : (
            <Slider text="Deck height above ground" value={tool.deckHeight} min={0.1} max={3} step={0.05} format={v => `${v.toFixed(2)} m`}
              onChange={v => setPatioToolSettings(prev => ({ ...prev, deckHeight: v }))} />
          )}
          <div>
            <label className={label}>Underneath</label>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <button type="button" className={chip(data.underside === 'frame')} onClick={() => update({ underside: 'frame' })}>Open posts & frame</button>
              <button type="button" className={chip(data.underside === 'skirting')} onClick={() => update({ underside: 'skirting' })}>Skirting boards</button>
            </div>
          </div>
          {data.underside === 'frame' && <Toggle text="Fascia board round the edge" checked={data.fascia} onChange={v => update({ fascia: v })} />}
          <div>
            <label className={label}>Railing</label>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {([['none', 'None'], ['timber', 'Timber spindles'], ['glass', 'Glass panels'], ['cable', 'Metal & cable']] as [RailingStyle, string][]).map(([id, text]) => (
                <button key={id} type="button" className={chip(data.railing === id)} onClick={() => update({ railing: id })}>{text}</button>
              ))}
            </div>
          </div>
          <Toggle text="Built-in deck lights" checked={data.lights.enabled} onChange={v => updateLights({ enabled: v })} />
          {data.lights.enabled && (
            <div className="space-y-2 rounded-lg border border-gray-200 p-2 dark:border-gray-700">
              <Slider text="Spacing" value={data.lights.spacing} min={0.5} max={3} step={0.1} format={v => `${v.toFixed(1)} m`} onChange={v => updateLights({ spacing: v })} />
              <ColorField text="Light colour" value={data.lights.color} onChange={v => updateLights({ color: v })} />
              <Toggle text="Only glow at night" checked={data.lights.nightOnly} onChange={v => updateLights({ nightOnly: v })} />
              <Toggle text="Light up the surroundings" checked={data.lights.castLight} onChange={v => updateLights({ castLight: v })} />
            </div>
          )}
        </>
      )}

      {/* Library material for the paving or boards. */}
      <div>
        <label className={label}>Library material</label>
        <div className="mt-1.5 flex items-center gap-2">
          <button type="button" onClick={() => setPickerOpen(open => !open)}
            className="flex-1 rounded-md border border-gray-200 px-2 py-1.5 text-left text-[11px] font-semibold text-gray-700 hover:border-polyform-blue dark:border-gray-700 dark:text-gray-200">
            {currentMaterial ? currentMaterial.name : 'Choose from library…'}
          </button>
          {data.surfaceMaterialId && (
            <button type="button" onClick={() => chooseMaterial(null)} className="text-[10px] text-red-500 hover:underline">Clear</button>
          )}
        </div>
        {pickerOpen && (
          <div className="mt-2 space-y-2 rounded-lg border border-gray-200 p-2 dark:border-gray-700">
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search materials"
              className="h-7 w-full rounded border border-gray-300 bg-white px-2 text-[11px] text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100" />
            <Toggle text="Show every material" checked={showAll} onChange={setShowAll} />
            <div className="grid max-h-56 grid-cols-3 gap-1.5 overflow-y-auto">
              {library.map(asset => (
                <button key={asset.id} type="button" onClick={() => chooseMaterial(asset)} title={asset.categoryPath}
                  className={cn('overflow-hidden rounded-md border text-left', data.surfaceMaterialId === asset.id ? 'border-polyform-blue' : 'border-gray-200 dark:border-gray-700')}>
                  <img src={asset.thumbnailUrl} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                  <span className="block truncate px-1 py-0.5 text-[9px] text-gray-600 dark:text-gray-300">{asset.name}</span>
                </button>
              ))}
              {!library.length && <p className="col-span-3 text-[10px] text-gray-400">No matching materials.</p>}
            </div>
          </div>
        )}
      </div>

      {/* Steps */}
      <div className="space-y-2">
        <label className={label}>Steps</label>
        <Slider text="Step width" value={tool.stepWidth} min={0.6} max={4} step={0.1} format={v => `${v.toFixed(1)} m`}
          onChange={v => setPatioToolSettings(prev => ({ ...prev, stepWidth: v }))} />
        <button type="button" disabled={!selected}
          onClick={() => {
            if (!tool.placingSteps) setActiveTool('patio');
            setPatioToolSettings(prev => ({ ...prev, placingSteps: !prev.placingSteps }));
          }}
          className={cn('w-full rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-40',
            tool.placingSteps ? 'border-green-600 bg-green-600 text-white' : 'border-gray-200 text-gray-700 hover:border-green-600 dark:border-gray-700 dark:text-gray-200')}>
          {tool.placingSteps ? 'Click an edge to place the steps…' : selected ? 'Add steps: click an edge' : 'Select a patio or deck to add steps'}
        </button>
        {selected?.patioData!.steps.map((step, index) => (
          <div key={index} className="space-y-1 rounded-md border border-gray-200 p-1.5 dark:border-gray-700">
            <div className="flex items-center justify-between text-[10px] text-gray-600 dark:text-gray-300">
              <span>Steps {index + 1} (edge {step.edge + 1})</span>
              <button type="button" className="text-red-500 hover:underline"
                onClick={() => update({ steps: selected.patioData!.steps.filter((_, i) => i !== index) })}>Remove</button>
            </div>
            <Slider text="Position along edge" value={step.t} min={0.05} max={0.95} step={0.01} format={v => `${Math.round(v * 100)}%`}
              onChange={v => update({ steps: selected.patioData!.steps.map((s, i) => i === index ? { ...s, t: v } : s) })} />
            <Slider text="Width" value={step.width} min={0.6} max={4} step={0.1} format={v => `${v.toFixed(1)} m`}
              onChange={v => update({ steps: selected.patioData!.steps.map((s, i) => i === index ? { ...s, width: v } : s) })} />
          </div>
        ))}
      </div>

      {selected && kind === 'patio' && (
        <Slider text="Surface level" value={selected.position[1]} min={selected.position[1] - 1} max={selected.position[1] + 1} step={0.01}
          format={v => `${v.toFixed(2)} m`}
          onChange={v => setShapes(prev => prev.map(s => s.id === selected.id ? { ...s, position: [s.position[0], v, s.position[2]] } : s))} />
      )}

      {selected && stats && (
        <div className="rounded-lg bg-gray-100 p-2 text-[11px] text-gray-700 dark:bg-gray-800 dark:text-gray-200">
          <div className={cn(label, 'mb-1')}>Quantities</div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            <span>Area</span><span className="text-right font-mono">{stats.area.toFixed(2)} m²</span>
            <span>Perimeter</span><span className="text-right font-mono">{stats.perimeter.toFixed(2)} m</span>
            {kind === 'patio' ? (
              data.paving === 'gravel' ? (
                <><span>Gravel (50 mm deep)</span><span className="text-right font-mono">{(stats.area * 0.05).toFixed(2)} m³</span></>
              ) : (
                <><span>{data.paving === 'block' ? 'Blocks' : data.paving === 'natural' ? 'Stones' : 'Slabs'} (incl. cuts)</span><span className="text-right font-mono">{stats.pieces}</span></>
              )
            ) : (
              <>
                <span>Board length</span><span className="text-right font-mono">{stats.boardLength.toFixed(1)} m</span>
                <span>3.6 m boards (+10%)</span><span className="text-right font-mono">{Math.ceil(stats.boardLength * 1.1 / 3.6)}</span>
              </>
            )}
            <span>Step flights</span><span className="text-right font-mono">{selected.patioData!.steps.length}</span>
          </div>
        </div>
      )}
    </div>
  );
}
