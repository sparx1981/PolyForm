import React, { useEffect, useRef, useState } from 'react';
import { GraphicsSlider } from './WeatherControls';
import { SurfaceDepthPresetThumbnail } from './SurfaceDepthPresetThumbnail';
import {
  SURFACE_DEPTH_PRESETS, DEFAULT_SURFACE_DEPTH_PARAMS, AUTO_NORMAL_STRENGTH, findSurfaceDepthPreset,
  heightCanvasToNormalCanvas, heightCanvasFromImageUrl, canvasToDataUrl,
  type SurfaceDepthPresetParams,
} from '../../lib/graphics/proceduralSurface';
import type { HeightMapValue } from '../../types';

export type { HeightMapValue };

type Mode = 'presets' | 'texture' | 'upload';
const MAX_DATA_URL_LENGTH = 450000;

/** Presets / from-texture / upload picker for a height map (+ its auto-derived normal
 * map), plus the depth-amount/offset/detail sliders once one is set. Pure value/onChange -
 * no assumption about what the result is attached to. Used both by SurfaceDepthControls
 * (tunes the currently selected object directly) and the Add Material modal (defines a
 * reusable material that carries a height map, applied later via the paint tool). */
export function HeightMapPicker({ value, onChange, sourceTextureUrl }: {
  value: HeightMapValue; onChange: (changes: Partial<HeightMapValue>) => void; sourceTextureUrl?: string;
}) {
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>('presets');
  const [draft, setDraft] = useState<SurfaceDepthPresetParams>({
    scale: value.surfaceDepthPatternScale ?? DEFAULT_SURFACE_DEPTH_PARAMS.scale,
    strength: value.surfaceDepthPatternStrength ?? DEFAULT_SURFACE_DEPTH_PARAMS.strength,
    seed: value.surfaceDepthSeed ?? DEFAULT_SURFACE_DEPTH_PARAMS.seed,
  });
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const regenerateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => { if (regenerateTimer.current) clearTimeout(regenerateTimer.current); }, []);

  function applyHeightCanvas(heightCanvas: HTMLCanvasElement, extra: Partial<HeightMapValue>) {
    const heightUrl = canvasToDataUrl(heightCanvas);
    if (heightUrl.length > MAX_DATA_URL_LENGTH) throw new Error('This pattern is too detailed to embed; try a lower pattern scale.');
    const changes: Partial<HeightMapValue> = {
      displacementMapUrl: heightUrl,
      displacementScale: value.displacementScale ?? 0.04, displacementBias: value.displacementBias ?? -0.02,
      surfaceDepthSegments: value.surfaceDepthSegments ?? 16, ...extra,
    };
    if (value.surfaceDepthAutoNormal !== false) {
      const normalUrl = canvasToDataUrl(heightCanvasToNormalCanvas(heightCanvas, AUTO_NORMAL_STRENGTH));
      if (normalUrl.length <= MAX_DATA_URL_LENGTH) { changes.normalMapUrl = normalUrl; changes.surfaceDepthAutoNormal = true; }
    }
    onChange(changes);
  }

  function applyPreset(presetId: string, params: SurfaceDepthPresetParams) {
    const preset = findSurfaceDepthPreset(presetId);
    if (!preset) return;
    try {
      applyHeightCanvas(preset.generateHeight(params, 512), {
        surfaceDepthPresetId: presetId, surfaceDepthPatternScale: params.scale,
        surfaceDepthPatternStrength: params.strength, surfaceDepthSeed: params.seed,
      });
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not generate this pattern.'); }
  }

  function scheduleRegenerate(presetId: string, params: SurfaceDepthPresetParams) {
    setDraft(params);
    if (regenerateTimer.current) clearTimeout(regenerateTimer.current);
    regenerateTimer.current = setTimeout(() => applyPreset(presetId, params), 150);
  }

  async function applyFromTexture() {
    if (!sourceTextureUrl) return;
    const token = ++request.current;
    setBusy(true);
    try {
      const heightCanvas = await heightCanvasFromImageUrl(sourceTextureUrl, 512);
      if (token !== request.current) return;
      applyHeightCanvas(heightCanvas, { surfaceDepthPresetId: undefined });
      setError('');
    } catch {
      if (token === request.current) setError('Could not read this texture.');
    } finally { if (token === request.current) setBusy(false); }
  }

  async function upload(file: File | undefined, normal = false) {
    if (!file) return;
    const token = ++request.current;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) { setError('Choose a PNG, JPEG or WebP under 8 MB.'); return; }
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      const factor = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * factor)); canvas.height = Math.max(1, Math.round(bitmap.height * factor));
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      if (token !== request.current) return;
      if (normal) {
        const url = canvas.toDataURL('image/png');
        if (url.length > MAX_DATA_URL_LENGTH) throw new Error('This texture is too detailed to embed; use a smaller image.');
        onChange({ normalMapUrl: url, surfaceDepthAutoNormal: false });
      } else {
        applyHeightCanvas(canvas, { surfaceDepthPresetId: undefined });
      }
      setError('');
    } catch (cause) { if (token === request.current) setError(cause instanceof Error ? cause.message : 'Could not read the texture.'); }
  }

  function regenerateNormalFromCurrentHeight() {
    if (!value.displacementMapUrl) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      const normalUrl = canvasToDataUrl(heightCanvasToNormalCanvas(canvas, AUTO_NORMAL_STRENGTH));
      if (normalUrl.length <= MAX_DATA_URL_LENGTH) onChange({ normalMapUrl: normalUrl, surfaceDepthAutoNormal: true });
    };
    img.src = value.displacementMapUrl;
  }

  const activePreset = value.surfaceDepthPresetId ? findSurfaceDepthPreset(value.surfaceDepthPresetId) : undefined;

  return <div className="space-y-2">
    <div className="flex gap-1 border-b pb-1" role="tablist">
      {([['presets', 'Patterns'], ['texture', 'From texture'], ['upload', 'Upload image']] as [Mode, string][]).map(([key, label]) => (
        <button key={key} role="tab" aria-selected={mode === key}
          className={`px-2 py-1 rounded-t ${mode === key ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-700'}`}
          onClick={() => setMode(key)}>{label}</button>
      ))}
    </div>

    {mode === 'presets' && <div className="space-y-2">
      <p className="text-[10px] text-gray-500">Pick a pattern; it generates a height map and a matching normal map automatically, no image needed.</p>
      <div className="grid grid-cols-3 gap-2">
        {SURFACE_DEPTH_PRESETS.map(preset => {
          const active = value.surfaceDepthPresetId === preset.id;
          const params = active ? draft : DEFAULT_SURFACE_DEPTH_PARAMS;
          return (
            <button key={preset.id} title={preset.description}
              className={`flex flex-col items-center gap-1 p-1 rounded border ${active ? 'border-blue-500 ring-1 ring-blue-500' : 'border-transparent hover:border-gray-300'}`}
              onClick={() => applyPreset(preset.id, active ? draft : DEFAULT_SURFACE_DEPTH_PARAMS)}>
              <SurfaceDepthPresetThumbnail preset={preset} params={params} />
              <span className="text-[10px] text-center leading-tight">{preset.name}</span>
            </button>
          );
        })}
      </div>
      {activePreset && <div className="space-y-2 pt-1">
        <GraphicsSlider label="Pattern scale" value={draft.scale} min={1} max={10} step={1}
          onChange={scale => scheduleRegenerate(activePreset.id, { ...draft, scale })} />
        <GraphicsSlider label="Pattern strength" value={draft.strength} min={0.1} max={1} step={0.05}
          onChange={strength => scheduleRegenerate(activePreset.id, { ...draft, strength })} />
        <button className="text-blue-500" onClick={() => scheduleRegenerate(activePreset.id, { ...draft, seed: Math.floor(Math.random() * 1e6) })}>Shuffle variation</button>
      </div>}
    </div>}

    {mode === 'texture' && <div className="space-y-2">
      <p className="text-[10px] text-gray-500">Derives a height map from the brightness of the texture, so the relief follows its existing detail.</p>
      {!sourceTextureUrl ? <p className="text-amber-600">No image texture to derive a height map from yet.</p> :
        <button className="px-2 py-1 rounded bg-blue-500 text-white disabled:opacity-50" disabled={busy} onClick={() => void applyFromTexture()}>
          {busy ? 'Generating…' : 'Generate from this texture'}
        </button>}
    </div>}

    {mode === 'upload' && <div className="space-y-2">
      <label className="block">Height map<input aria-label="Height map" className="block w-full text-[10px]" type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} /></label>
      <label className="flex gap-2 items-center"><input type="checkbox" checked={value.surfaceDepthAutoNormal !== false} onChange={e => onChange({ surfaceDepthAutoNormal: e.target.checked })} />Auto-generate matching normal map</label>
      {value.surfaceDepthAutoNormal === false && <label className="block">Matching normal map<input aria-label="Matching normal map" className="block w-full text-[10px]" type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { void upload(e.target.files?.[0], true); e.target.value = ''; }} /></label>}
      <p className="text-[10px] text-gray-500">White raises the surface; black lowers it.</p>
    </div>}

    {value.displacementMapUrl && <>
      <GraphicsSlider label="Depth amount" value={value.displacementScale ?? 0.04} min={0} max={0.2} step={0.001} unit=" m" onChange={displacementScale => onChange({ displacementScale })} />
      <GraphicsSlider label="Depth offset" value={value.displacementBias ?? 0} min={-0.2} max={0.2} step={0.001} unit=" m" onChange={displacementBias => onChange({ displacementBias })} />
      <label className="block">Surface detail<select className="block w-full bg-white dark:bg-gray-800 border rounded" value={value.surfaceDepthSegments ?? 16} onChange={e => onChange({ surfaceDepthSegments: Number(e.target.value) })}>
        <option value={8}>Low</option><option value={16}>Balanced</option><option value={32}>High</option>
      </select></label>
      {value.surfaceDepthAutoNormal === false && value.normalMapUrl && <button className="text-blue-500" onClick={regenerateNormalFromCurrentHeight}>Regenerate normal map from height</button>}
      <button className="text-blue-500" onClick={() => onChange({ displacementMapUrl: undefined, normalMapUrl: undefined, surfaceDepthPresetId: undefined })}>Remove height map</button>
    </>}
    {error && <p role="alert" className="text-red-500">{error}</p>}
  </div>;
}
