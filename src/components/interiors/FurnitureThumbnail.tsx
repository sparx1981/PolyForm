import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { createInteriorFurnitureGeometry, type InteriorFurnitureType } from '../../lib/interiors/parametricFurniture';
import { renderGeometryThumbnail } from '../../lib/graphics/thumbnailRenderer';

const cache = new Map<string, string>();

/** A small picture of one gallery piece, drawn once through the app's shared offscreen renderer. */
export function FurnitureThumbnail({ type, size = 88 }: { type: InteriorFurnitureType; size?: number }) {
  const [url, setUrl] = useState<string | undefined>(() => cache.get(type));
  useEffect(() => {
    if (cache.has(type)) { setUrl(cache.get(type)); return; }
    try {
      const geometry = createInteriorFurnitureGeometry(type).clone();
      // The shared thumbnail material reads vertex colours; furniture carries none, so give it a soft grey.
      if (!geometry.getAttribute('color')) {
        const count = geometry.getAttribute('position').count, colours = new Float32Array(count * 3).fill(0.78);
        geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
      }
      const image = renderGeometryThumbnail(geometry, size * 2);
      geometry.dispose();
      cache.set(type, image);
      setUrl(image);
    } catch { /* no preview: the name still identifies it */ }
  }, [type, size]);
  return (
    <div className="pointer-events-none overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800" style={{ width: size, height: size }}>
      {url && <img src={url} width={size} height={size} alt="" className="w-full h-full object-contain" />}
    </div>
  );
}
