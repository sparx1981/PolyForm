import React, { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { FontLoader, type Font } from 'three/examples/jsm/loaders/FontLoader.js';
import type { Shape } from '../types';
import regularUrl from '../assets/fonts/helvetiker_regular.typeface.json?url';
import boldUrl from '../assets/fonts/helvetiker_bold.typeface.json?url';

// Draws a text label ('text') or 3D letters ('text3d') from its textData (see lib/textShapes.ts
// for the local axes). The font (Helvetiker, see assets/fonts/LICENSE-helvetiker.txt) loads once,
// the first time any text is shown.

const fonts: Partial<Record<'regular' | 'bold', Promise<Font>>> = {};
function loadFont(weight: 'regular' | 'bold'): Promise<Font> {
  fonts[weight] ??= fetch(weight === 'bold' ? boldUrl : regularUrl)
    .then(r => r.json())
    .then(json => new FontLoader().parse(json));
  return fonts[weight]!;
}

/** Letter geometry for a text object, positioned for its alignment (null for no words). */
export function textGeometry(font: Font, shape: Shape): THREE.BufferGeometry | null {
  const data = shape.textData;
  if (!data?.text) return null;
  const shapes = font.generateShapes(data.text, data.size);
  const geometry = shape.type === 'text3d'
    ? new THREE.ExtrudeGeometry(shapes, {
      depth: data.depth ?? 0.1,
      curveSegments: 6,
      bevelEnabled: (data.depth ?? 0.1) > 0.02,
      bevelThickness: Math.min(0.01, (data.depth ?? 0.1) / 6),
      bevelSize: Math.min(0.006, data.size / 40),
      bevelSegments: 2,
    })
    : new THREE.ShapeGeometry(shapes, 6);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const x = data.align === 'left' ? -box.min.x : data.align === 'right' ? -box.max.x : -(box.min.x + box.max.x) / 2;
  // A label is centred on its point; 3D letters stand on theirs.
  const y = shape.type === 'text3d' ? -box.min.y : -(box.min.y + box.max.y) / 2;
  geometry.translate(x, y, 0);
  geometry.computeVertexNormals();
  return geometry;
}

interface Props {
  shape: Shape;
  meshProps: Record<string, unknown>;
  selectionHighlight?: React.ReactNode;
}

export function TextMesh({ shape, meshProps, selectionHighlight }: Props) {
  const weight = shape.textData?.bold ? 'bold' : 'regular';
  const [font, setFont] = useState<Font | null>(null);
  useEffect(() => {
    let live = true;
    loadFont(weight).then(f => { if (live) setFont(f); }).catch(() => {});
    return () => { live = false; };
  }, [weight]);
  const { text, size, depth, align } = shape.textData ?? { text: '', size: 0, align: 'center' as const };
  const geometry = useMemo(
    () => (font ? textGeometry(font, shape) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [font, shape.type, text, size, depth, align],
  );
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return (
    <mesh {...meshProps} geometry={geometry}>
      <meshStandardMaterial
        color={shape.color}
        roughness={shape.roughness ?? 0.6}
        metalness={shape.metalness ?? 0}
        transparent={(shape.opacity ?? 1) < 1}
        opacity={shape.opacity ?? 1}
        side={shape.type === 'text' ? THREE.DoubleSide : THREE.FrontSide}
      />
      {selectionHighlight}
    </mesh>
  );
}
