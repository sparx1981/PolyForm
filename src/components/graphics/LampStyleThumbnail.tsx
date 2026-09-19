import React, { useEffect, useState } from 'react';
import { createLampGeometry } from '../../lib/landscapeGeometry';
import { renderGeometryThumbnail } from '../../lib/graphics/thumbnailRenderer';

// Keyed by style+height, so reopening the picker (or the AI Generate tab's preview,
// wherever else this gets used) is instant instead of re-rendering every thumbnail
// again. Small strings - never worth bothering to evict.
const snapshotCache = new Map<string, string>();

/** Small static preview of one lamp style, so a user sees the actual model shape
 * before applying it. Renders through the app's single shared offscreen WebGL
 * context (see thumbnailRenderer.ts) rather than mounting its own live <Canvas> -
 * a picker grid can have a couple dozen of these open at once, and that many
 * simultaneous WebGL contexts is what was crashing the app when the interior style
 * library shipped. Framed off the geometry's own bounding sphere (as
 * CustomToolbarOverlay's TilePreviewThumbnail does) rather than guessed dimensions,
 * so it works for any style's actual built size - including a bollard's much
 * shorter post or the cobra arm's sideways reach - without per-style camera tuning. */
export function LampStyleThumbnail({ styleId, height = 3.2, size = 96 }: { styleId: string; height?: number; size?: number }) {
  const key = `${styleId}:${height}`;
  const [dataUrl, setDataUrl] = useState<string | undefined>(() => snapshotCache.get(key));

  useEffect(() => {
    const cached = snapshotCache.get(key);
    if (cached) { setDataUrl(cached); return; }
    const geometry = createLampGeometry(height, styleId);
    const url = renderGeometryThumbnail(geometry, Math.max(96, size * 2));
    geometry.dispose();
    snapshotCache.set(key, url);
    setDataUrl(url);
  }, [key, height, styleId, size]);

  return (
    <div className="rounded pointer-events-none overflow-hidden bg-transparent" style={{ width: size, height: size }}>
      {dataUrl && <img src={dataUrl} width={size} height={size} alt="" className="w-full h-full object-contain" />}
    </div>
  );
}
