import { useEffect } from 'react';
import * as THREE from 'three';
import type { Shape } from '../../types';
import { useApp } from '../../AppContext';
import { getLampLightAnchor } from '../../lib/landscapeGeometry';

const DEFAULT_LAMP_LIGHT = { color: '#ffd8a8', intensity: 1.4, distance: 9, decay: 2 } as const;

function computeWorldAnchor(shape: Shape, local: [number, number, number]): [number, number, number] {
  const object = new THREE.Object3D();
  object.position.set(...shape.position);
  if (shape.quaternion) object.quaternion.set(...shape.quaternion);
  else if (shape.rotation) object.rotation.set(...shape.rotation);
  if (shape.scale) object.scale.set(...shape.scale);
  object.updateMatrixWorld(true);
  const world = new THREE.Vector3(...local).applyMatrix4(object.matrixWorld);
  return [world.x, world.y, world.z];
}

/** Keeps a real, independently-editable CustomLight (point light, by default a warm
 * street-lamp glow) positioned at the correct spot on a lamp shape's model - the lantern
 * head, the cobra-head housing, etc, depending on style - rather than the shape's own
 * base-level pivot. Renders nothing itself; it only manages the light's entry in
 * customLights. */
export function LampLightBinding({ shape }: { shape: Shape }) {
  const { setCustomLights } = useApp();
  const height = Array.isArray(shape.args) ? (shape.args[1] ?? 3.2) : 3.2;
  const style = shape.archStyle || 'classic';
  const lightId = `lamp-light-${shape.id}`;

  useEffect(() => {
    const worldPos = computeWorldAnchor(shape, getLampLightAnchor(height, style));
    setCustomLights(prev => {
      const existing = prev.find(l => l.id === lightId);
      if (!existing) {
        return [...prev, {
          id: lightId, type: 'point', color: DEFAULT_LAMP_LIGHT.color, intensity: DEFAULT_LAMP_LIGHT.intensity,
          distance: DEFAULT_LAMP_LIGHT.distance, decay: DEFAULT_LAMP_LIGHT.decay, position: worldPos, parentShapeId: shape.id,
        }];
      }
      const [x, y, z] = existing.position;
      if (x === worldPos[0] && y === worldPos[1] && z === worldPos[2]) return prev;
      return prev.map(l => l.id === lightId ? { ...l, position: worldPos } : l);
    });
  }, [lightId, shape.id, shape.position, shape.rotation, shape.quaternion, shape.scale, height, style, setCustomLights]);

  // Separate effect so this only fires on true unmount (the lamp shape being deleted),
  // not on every position/style update above.
  useEffect(() => () => { setCustomLights(prev => prev.filter(l => l.id !== lightId)); }, [lightId, setCustomLights]);

  return null;
}
