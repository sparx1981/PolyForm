import React from 'react';
import { useApp } from '../../AppContext';
import { canApplySurfaceDepth } from '../../lib/graphics/depthGeometry';
import { HeightMapPicker, type HeightMapValue } from './HeightMapPicker';
import { getLandscapeTextureUrl, LANDSCAPE_PRESET_IDS } from '../../lib/landscapeTextures';
import { isTextureUrl, type Shape } from '../../types';

/** Resolves a shape's textureUrl to something fetchable: known landscape preset ids
 * aren't URLs themselves, they're looked up through the landscape texture generator. */
function resolveShapeTextureUrl(shape: Shape): string | undefined {
  const url = shape.textureUrl;
  if (!url) return undefined;
  if (LANDSCAPE_PRESET_IDS.has(url)) return getLandscapeTextureUrl(url);
  return isTextureUrl(url) ? url : undefined;
}

/** Tunes the currently selected object's own height map directly. Defining a height map
 * as part of a reusable material (to paint onto any object) happens in the Add Material
 * modal instead - see HeightMapPicker, which both of these share. */
export function SurfaceDepthControls() {
  const { shapes, selectedId, setShapes } = useApp();
  const shape = shapes.find(item => item.id === selectedId);

  const update = (changes: Partial<Shape>) => {
    if (shape) setShapes(previous => previous.map(item => item.id === shape.id ? { ...item, ...changes } : item));
  };

  const value: HeightMapValue = {
    displacementMapUrl: shape?.displacementMapUrl,
    normalMapUrl: shape?.normalMapUrl,
    surfaceDepthAutoNormal: shape?.surfaceDepthAutoNormal,
    surfaceDepthPresetId: shape?.surfaceDepthPresetId,
    surfaceDepthPatternScale: shape?.surfaceDepthPatternScale,
    surfaceDepthPatternStrength: shape?.surfaceDepthPatternStrength,
    surfaceDepthSeed: shape?.surfaceDepthSeed,
    displacementScale: shape?.displacementScale,
    displacementBias: shape?.displacementBias,
    surfaceDepthSegments: shape?.surfaceDepthSegments,
  };

  function handleChange(changes: Partial<HeightMapValue>) {
    // Picking/generating a new height map should also (re-)enable it; removing one
    // (displacementMapUrl explicitly set to undefined) should turn it back off.
    const enabling = 'displacementMapUrl' in changes;
    update({ ...changes, surfaceDepthEnabled: enabling ? Boolean(changes.displacementMapUrl) : shape?.surfaceDepthEnabled });
  }

  return <details className="border rounded p-2 space-y-2 text-xs" data-testid="surface-depth-controls">
    <summary className="font-semibold cursor-pointer">Surface depth</summary>
    {!shape ? <p>Select an object to configure surface depth.</p> : !canApplySurfaceDepth(shape) ?
      <p>Surface depth isn't available on objects with per-face texture tiling (surface divisions).</p> : <>
      <p className="truncate">{shape.name || shape.type}</p>
      <label className="flex gap-2"><input type="checkbox" disabled={!shape.displacementMapUrl} checked={Boolean(shape.surfaceDepthEnabled)} onChange={e => update({ surfaceDepthEnabled: e.target.checked })} />Enable surface depth</label>
      <p className="text-[10px] text-gray-500">Works on most objects. A few (mostly vertex-colored landscape props) can't take a height map - if nothing changes after enabling, check the browser console.</p>
      <p className="text-[10px] text-gray-500">Tip: defining a height map as part of a reusable material (Materials panel → + → Color Picker/Upload Texture) lets you paint it onto any object, same as a color or texture.</p>

      <HeightMapPicker value={value} onChange={handleChange} sourceTextureUrl={resolveShapeTextureUrl(shape)} />

      {(shape.bevelAmount || shape.surfaceMaterials) && <p className="text-[10px] text-gray-500">Bevelled edges and multi-material faces apply one shared height field across the whole object; per-face detail near a bevel may look softer.</p>}
    </>}
  </details>;
}
