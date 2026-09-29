import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Shape, CustomLight } from '../../types';
import { useApp } from '../../AppContext';
import { getLampLightHeads } from '../../lib/landscapeGeometry';
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
    const heads = getLampLightHeads(height, style);
    const styleChanged = previousStyle.current !== undefined && previousStyle.current !== style;
    previousStyle.current = style;
    const idOf = (k: number) => (k === 0 ? lightId : `${lightId}-h${k}`);
    const placed = heads.map(head => ({
      worldPos: computeWorldPoint(shape, head.anchor),
      target: def.light.type === 'spot' ? computeWorldPoint(shape, addLocal(head.anchor, head.aim)) : undefined,
    }));

    setCustomLights(prev => {
      // A style swap to a genuinely different fixture gets the new style's full defaults (carrying a
      // floodlight's intensity onto a bedside lamp would look wrong); a plain move or resize of the
      // SAME style only refreshes position and target, keeping anything tuned by hand afterwards.
      let next = prev.filter(l => !(l.id.startsWith(`${lightId}-h`) && !heads.some((_, k) => idOf(k) === l.id)));
      let changed = next.length !== prev.length;
      placed.forEach(({ worldPos, target }, k) => {
        const id = idOf(k);
        const existing = next.find(l => l.id === id);
        if (!existing || styleChanged) {
          const fresh: CustomLight = {
            id, type: def.light.type, color: def.light.color, intensity: def.light.intensity,
            position: worldPos, parentShapeId: shape.id,
            distance: def.light.distance, decay: def.light.decay,
            angle: def.light.angle, penumbra: def.light.penumbra,
            width: def.light.width, height: def.light.height,
            scale: def.light.scale,
            target,
            // A rectAreaLight has no target; it's aimed by a fixed rotation instead - straight down
            // suits every 'rect' style here (a flush ceiling panel or a roadway cutoff).
            rotationX: def.light.type === 'rect' ? -90 : undefined,
          };
          next = existing ? next.map(l => (l.id === id ? fresh : l)) : [...next, fresh];
          changed = true;
          return;
        }
        const samePosition = existing.position[0] === worldPos[0] && existing.position[1] === worldPos[1] && existing.position[2] === worldPos[2];
        const sameTarget = !target || (existing.target && existing.target[0] === target[0] && existing.target[1] === target[1] && existing.target[2] === target[2]);
        if (samePosition && sameTarget) return;
        next = next.map(l => (l.id === id ? { ...l, position: worldPos, target: target ?? l.target } : l));
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [lightId, shape.id, shape.position, shape.rotation, shape.quaternion, shape.scale, height, style]);

  // Separate effect so this only fires on true unmount (the lamp shape being deleted),
  // not on every position/style update above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => { setCustomLights(prev => prev.filter(l => l.id !== lightId && !l.id.startsWith(`${lightId}-h`))); }, [lightId]);

  return null;
}

function addLocal(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
