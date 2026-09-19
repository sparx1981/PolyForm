import { useEffect, useState } from 'react';
import { loadAssetManifest } from '../lib/assets/catalog';
import { resolveMaterial } from '../lib/assets/materialResolver';
import { isMaterialAssetId, type AssetManifest, type AssetSummary, type MaterialInstance } from '../lib/assets/types';

type Props = {
  asset: AssetSummary;
  instance?: MaterialInstance;
  onSave: (instance: MaterialInstance) => void;
  onClose: () => void;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function MaterialEditorDialog({ asset, instance, onSave, onClose }: Props) {
  const [manifest, setManifest] = useState<AssetManifest | null>(null);
  const [draft, setDraft] = useState<MaterialInstance | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setManifest(null);
    setDraft(null);
    setError(null);
    if (!isMaterialAssetId(asset.id)) {
      setError('This asset is not a material.');
      return () => controller.abort();
    }
    void loadAssetManifest(asset, controller.signal).then(next => {
      if (controller.signal.aborted) return;
      const starting: MaterialInstance = instance ?? { ref: { assetId: asset.id as MaterialInstance['ref']['assetId'], revision: asset.revision } };
      const resolved = resolveMaterial(starting, next, '2k');
      setManifest(next);
      setDraft({
        ...starting,
        roughness: resolved.roughness,
        metalness: resolved.metalness,
        opacity: resolved.opacity,
        normalStrength: starting.normalStrength ?? 1,
        depth: resolved.depth ? {
          enabled: resolved.depth.enabled,
          scaleMeters: resolved.depth.scaleMeters,
          biasMeters: resolved.depth.biasMeters,
        } : undefined,
      });
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load the material manifest.');
    });
    return () => controller.abort();
  }, [asset, instance]);

  const maps = manifest?.tiers['2k'] ?? manifest?.tiers['1k'] ?? manifest?.tiers['4k'];
  const slider = (label: string, value: number, min: number, max: number, step: number, update: (value: number) => void) => (
    <label className="block text-xs text-gray-700">
      <span className="flex justify-between"><span>{label}</span><span>{value.toFixed(step < 0.01 ? 3 : 2)}</span></span>
      <input className="w-full accent-blue-600" type="range" min={min} max={max} step={step} value={value}
        onChange={event => update(clamp(Number(event.target.value), min, max))} />
    </label>
  );

  return <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/60 p-4" role="presentation" onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
    <div role="dialog" aria-modal="true" aria-label={`Edit ${asset.name}`} className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b pb-3">
        <div><h2 className="font-semibold text-lg text-gray-900">{asset.name}</h2><p className="text-xs text-gray-500">Poly Haven · CC0 · project material instance</p></div>
        <button type="button" onClick={onClose} aria-label="Close material editor" className="text-gray-600 hover:text-gray-900">✕</button>
      </div>
      {error && <p role="alert" className="py-4 text-sm text-red-600">{error}</p>}
      {!error && !draft && <p className="py-4 text-sm text-gray-500">Loading PBR properties…</p>}
      {draft && <div className="space-y-4 pt-4">
        <div className="flex gap-4">
          <img src={asset.thumbnailUrl} alt="" className="h-24 w-24 rounded object-cover" />
          <div className="text-xs text-gray-600">
            <p>Maps: {Object.entries(maps ?? {}).filter(([, map]) => Boolean(map)).map(([semantic]) => semantic).join(', ') || 'none'}</p>
            <p className="mt-2">Edits affect this material wherever it is used in this project. Source files remain unchanged.</p>
          </div>
        </div>
        <label className="flex items-center gap-3 text-xs text-gray-700">Tint
          <input aria-label="Material tint" type="color" value={draft.tint ?? '#ffffff'} onChange={event => setDraft(previous => previous ? { ...previous, tint: event.target.value } : previous)} />
          <button type="button" className="text-blue-600" onClick={() => setDraft(previous => previous ? { ...previous, tint: undefined } : previous)}>Use source colour</button>
        </label>
        {slider('Roughness', draft.roughness ?? 0.5, 0, 1, 0.01, roughness => setDraft(previous => previous ? { ...previous, roughness } : previous))}
        {slider('Metalness', draft.metalness ?? 0, 0, 1, 0.01, metalness => setDraft(previous => previous ? { ...previous, metalness } : previous))}
        {slider('Opacity', draft.opacity ?? 1, 0, 1, 0.01, opacity => setDraft(previous => previous ? { ...previous, opacity } : previous))}
        {maps?.['normal-gl'] && slider('Normal strength', draft.normalStrength ?? 1, 0, 2, 0.01, normalStrength => setDraft(previous => previous ? { ...previous, normalStrength } : previous))}
        {maps?.height && draft.depth && <div className="space-y-2 rounded border p-3">
          <label className="flex gap-2 text-xs"><input type="checkbox" checked={draft.depth.enabled} onChange={event => setDraft(previous => previous?.depth ? { ...previous, depth: { ...previous.depth, enabled: event.target.checked } } : previous)} />Enable height relief</label>
          {slider('Height amount (m)', draft.depth.scaleMeters, 0, 0.2, 0.001, scaleMeters => setDraft(previous => previous?.depth ? { ...previous, depth: { ...previous.depth, scaleMeters } } : previous))}
          {slider('Height offset (m)', draft.depth.biasMeters, -0.1, 0.1, 0.001, biasMeters => setDraft(previous => previous?.depth ? { ...previous, depth: { ...previous.depth, biasMeters } } : previous))}
          <p className="text-[11px] text-gray-500">Height uses bounded geometry relief on whole-object surfaces. On a box, Shift-click while painting to apply the material to the whole object; a normal click paints one face with normal detail but no height relief. Height values are provisional, not calibrated physical depth.</p>
        </div>}
        <div className="flex justify-end gap-2 border-t pt-4">
          <button type="button" onClick={onClose} className="rounded border px-4 py-2 text-xs">Cancel</button>
          <button type="button" onClick={() => onSave(draft)} className="rounded bg-blue-700 px-4 py-2 text-xs font-semibold text-white">Save material</button>
        </div>
      </div>}
    </div>
  </div>;
}
