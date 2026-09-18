import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Shape, CustomLight } from '../../types';
import { useApp } from '../../AppContext';
import { getLampLightAnchor, getLampLightAimOffset } from '../../lib/landscapeGeometry';
import { findLampStyle } from '../../lib/lampStyles';

function computeWorldPoint(shape: Shape, local: [number, number, number]): [number, number, number] {
  const object = new THREE.Object3D();
  object.position.set(...shape.position);
  if (shape.quaternion) object.quaternion.set(...shape.quaternion);
  else if (shape.rotation) object.rotation.set(...shape.rotation);
  if (shape.scale) object.scale.set(...shape.scale);
  object.updateMatrixWorld(true);
  const world = new THREE.Vector3(...local).applyMatrix4(object.matrixWorld);
  return [world.x, world.y, world.z];
}

/** Keeps a real, independently-editable CustomLight positioned (and, for a directional
 * fixture, aimed) at the correct spot on a lamp shape's model - the lantern head, the
 * cobra-head housing, a ceiling pendant's bulb, etc, depending on style - rather than
 * the shape's own base-level pivot. Renders nothing itself; it only manages the
 * light's entry in customLights. Each style in lampStyles.ts carries its own light
 * type and defaults (a roadway cutoff and a ceiling downlight are both 'spot', a
 * bollard and a pendant are both 'point', an office troffer is 'rect') rather than
 * every style sharing one hardcoded point light. */
export function LampLightBinding({ shape }: { shape: Shape }) {
  const { setCustomLights } = useApp();
  const height = Array.isArray(shape.args) ? (shape.args[1] ?? 3.2) : 3.2;
  const style = shape.archStyle || 'classic';
  const lightId = `lamp-light-${shape.id}`;
  const previousStyle = useRef<string | undefined>(undefined);

  // setCustomLights (from useApp()) is a plain function recreated every AppContext
  // render, not a stable useState setter or a useCallback - including it in a
  // dependency array below would re-run these effects on every single app render
  // (not just when this lamp's own position/style actually changes), which is exactly
  // what caused the crash this was fixing: the cleanup effect would keep tearing the
  // light down and the setup effect would keep rebuilding it, forever. It's still safe
  // to call from inside the effects without being a dependency, since every call always
  // goes through the current-state functional-updater form (`prev => ...`), never a
  // captured/stale value.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const def = findLampStyle(style);
    const worldPos = computeWorldPoint(shape, getLampLightAnchor(height, style));
    const styleChanged = previousStyle.current !== undefined && previousStyle.current !== style;
    previousStyle.current = style;

    const target: [number, number, number] | undefined = def.light.type === 'spot'
      ? computeWorldPoint(shape, addLocal(getLampLightAnchor(height, style), getLampLightAimOffset(style)))
      : undefined;

    setCustomLights(prev => {
      const existing = prev.find(l => l.id === lightId);
      // A brand-new light, or a style swap to a genuinely different fixture, gets the
      // new style's full defaults - carrying over a floodlight's intensity onto a
      // freshly-picked bedside lamp would look wrong. A plain move/resize of the SAME
      // style only refreshes position/target, preserving anything the user tuned by
      // hand in the light panel afterward.
      if (!existing || styleChanged) {
        const next: CustomLight = {
          id: lightId, type: def.light.type, color: def.light.color, intensity: def.light.intensity,
          position: worldPos, parentShapeId: shape.id,
          distance: def.light.distance, decay: def.light.decay,
          angle: def.light.angle, penumbra: def.light.penumbra,
          width: def.light.width, height: def.light.height,
          target,
          // rectAreaLight has no target; it's aimed via a fixed rotation instead -
          // straight down suits every 'rect' style here (a flush ceiling panel).
          rotationX: def.light.type === 'rect' ? -90 : undefined,
        };
        return existing ? prev.map(l => (l.id === lightId ? next : l)) : [...prev, next];
      }
      const samePosition = existing.position[0] === worldPos[0] && existing.position[1] === worldPos[1] && existing.position[2] === worldPos[2];
      const sameTarget = !target || (existing.target && existing.target[0] === target[0] && existing.target[1] === target[1] && existing.target[2] === target[2]);
      if (samePosition && sameTarget) return prev;
      return prev.map(l => (l.id === lightId ? { ...l, position: worldPos, target: target ?? l.target } : l));
    });
  }, [lightId, shape.id, shape.position, shape.rotation, shape.quaternion, shape.scale, height, style]);

  // Separate effect so this only fires on true unmount (the lamp shape being deleted),
  // not on every position/style update above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => { setCustomLights(prev => prev.filter(l => l.id !== lightId)); }, [lightId]);

  return null;
}

function addLocal(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
