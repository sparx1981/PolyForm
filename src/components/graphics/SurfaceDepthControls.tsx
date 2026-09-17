import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../AppContext';
import { canApplySurfaceDepth } from '../../lib/graphics/depthGeometry';
import { GraphicsSlider } from './WeatherControls';
import type { Shape } from '../../types';

export function SurfaceDepthControls() {
  const { shapes, selectedId, setShapes } = useApp();
  const shape = shapes.find(item => item.id === selectedId);
  const [error, setError] = useState('');
  const request = useRef(0);
  useEffect(() => { setError(''); return () => { request.current++; }; }, [selectedId]);
  const update = (changes: Partial<Shape>) => { if (shape) setShapes(previous => previous.map(item => item.id === shape.id ? { ...item, ...changes } : item)); };
  async function upload(file: File | undefined, normal = false) {
    if (!shape || !file) return;
    const shapeId = shape.id, token = ++request.current;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) { setError('Choose a PNG, JPEG or WebP under 8 MB.'); return; }
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      const factor = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * factor)); canvas.height = Math.max(1, Math.round(bitmap.height * factor));
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      const url = canvas.toDataURL('image/png');
      if (url.length > 450000) throw new Error('This texture is too detailed to embed; use a smaller image.');
      if (token !== request.current) return;
      setShapes(previous => previous.map(item => item.id === shapeId ? { ...item, ...(normal ? { normalMapUrl: url } : {
        displacementMapUrl: url, surfaceDepthEnabled: true, displacementScale: item.displacementScale ?? 0.04,
        displacementBias: item.displacementBias ?? -0.02, surfaceDepthSegments: item.surfaceDepthSegments ?? 16,
      }) } : item)); setError('');
    } catch (cause) { if (token === request.current) setError(cause instanceof Error ? cause.message : 'Could not read the texture.'); }
  }
  return <details className="border rounded p-2 space-y-2 text-xs" data-testid="surface-depth-controls">
    <summary className="font-semibold cursor-pointer">Surface depth</summary>
    {!shape ? <p>Select an object to configure surface depth.</p> : !canApplySurfaceDepth(shape) ?
      <p>Use an unbevelled primitive, terrain, polygon, rock or custom mesh with a single material. Face-painted objects keep their existing materials.</p> : <>
      <p className="truncate">{shape.name || shape.type}</p>
      <label className="flex gap-2"><input type="checkbox" disabled={!shape.displacementMapUrl} checked={Boolean(shape.surfaceDepthEnabled)} onChange={e => update({ surfaceDepthEnabled: e.target.checked })} />Enable surface depth</label>
      <label className="block">Height map<input aria-label="Height map" className="block w-full text-[10px]" type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} /></label>
      <label className="block">Matching normal map (optional)<input aria-label="Matching normal map" className="block w-full text-[10px]" type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { void upload(e.target.files?.[0], true); e.target.value = ''; }} /></label>
      {shape.displacementMapUrl && <>
        <GraphicsSlider label="Depth amount" value={shape.displacementScale ?? 0.04} min={0} max={0.2} step={0.001} unit=" m" onChange={displacementScale => update({ displacementScale })} />
        <GraphicsSlider label="Depth offset" value={shape.displacementBias ?? 0} min={-0.2} max={0.2} step={0.001} unit=" m" onChange={displacementBias => update({ displacementBias })} />
        <label className="block">Surface detail<select className="block w-full bg-white dark:bg-gray-800 border rounded" value={shape.surfaceDepthSegments ?? 16} onChange={e => update({ surfaceDepthSegments: Number(e.target.value) })}>
          <option value={8}>Low</option><option value={16}>Balanced</option><option value={32}>High</option>
        </select></label>
        <button className="text-blue-500" onClick={() => update({ surfaceDepthEnabled: false, displacementMapUrl: undefined })}>Remove height map</button>
      </>}
      <p className="text-[10px] text-gray-500">White raises the surface; black lowers it. Saved with this object. Textures are embedded at up to 512 px. Fine detail looks best with a matching normal map.</p>
    </>}
    {error && <p role="alert" className="text-red-500">{error}</p>}
  </details>;
}
