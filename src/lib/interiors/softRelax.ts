import * as THREE from 'three';
import type { FurniturePartRange, SoftRole } from './furnitureParts';

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * How far a part's surface moves when it settles, in the part's own frame. u runs across its width
 * (-1..1), v from its underside to its top (0..1) and t along its depth (-1..1); sizes are in metres.
 * Strength k is 1 at the Interior Studio default and scales every effect, so the slider is visible.
 */
export function relaxOffset(role: SoftRole | undefined, u: number, v: number, t: number, size: [number, number, number], k: number, edge = 0.85): [number, number, number] {
  const [w, h, d] = size;
  const bowl = Math.pow(Math.max(0, 1 - u * u), 0.9) * Math.pow(Math.max(0, 1 - t * t), 0.9);
  const top = smooth(0.35, 1, v);
  switch (role) {
    case 'seat': {
      // The cushion sinks where people sit, its sides swell and the front lip rolls over.
      const dip = Math.min(0.085, h * 0.55) * k;
      return [Math.sign(u) * Math.abs(u) ** 2 * 0.014 * k * Math.sin(Math.PI * v), -top * bowl * dip - top * smooth(0.6, 1, t) * 0.014 * k, Math.sign(t) * 0.012 * k * smooth(0.6, 1, Math.abs(t)) * top];
    }
    case 'back': {
      // Back cushions lean into the frame, slump at the top corners and dish in the middle.
      return [0, -top * bowl * 0.04 * k - 0.035 * k * u * u * v * v, -v * 0.065 * k];
    }
    case 'arm':
      return [Math.sign(u) * 0.014 * k * v, -0.012 * k * v * (1 - t * t), 0];
    case 'mattress':
      return [Math.sign(u) * 0.012 * k * Math.sin(Math.PI * v), -top * bowl * 0.045 * k, Math.sign(t) * 0.01 * k * Math.sin(Math.PI * v)];
    case 'duvet':
    case 'throw': {
      // Bedding hangs over the sides beyond the mattress edge, billows in the middle and folds.
      const side = Math.max(0, Math.abs(u) - edge) / Math.max(0.05, 1 - edge);
      const foot = Math.max(0, t - 0.9) / 0.1;
      const drop = (role === 'throw' ? 0.16 : 0.26) * k;
      const folds = top * 0.014 * k * Math.sin(t * 7 + u * 2.3) * (1 - side);
      return [Math.sign(u) * side * 0.05 * k, -(side ** 1.5) * drop - (foot ** 1.5) * 0.07 * k + top * bowl * (role === 'throw' ? 0.012 : 0.04) * k + folds, 0];
    }
    case 'pillow':
      return [0, -top * bowl * 0.035 * k + top * 0.026 * k * u * u - v * 0.012 * k, Math.sign(t) * 0.01 * k * (1 - Math.abs(u)) * top];
    case 'scatter':
      // A scatter cushion pinches in the middle and its corners lift.
      return [0, -top * bowl * 0.04 * k + top * 0.032 * k * u * u * t * t - v * 0.008 * k, 0];
    default:
      return [0, 0, 0];
  }
}

/** Settles every soft part of an upholstered piece in place. Positions are a flat xyz array. */
export function relaxSoftParts(positions: number[], parts: FurniturePartRange[], strength: number, include: (part: FurniturePartRange) => boolean = () => true): void {
  const k = Math.min(2.5, Math.max(0, strength) / 0.4);
  if (!k) return;
  const toLocal = new THREE.Matrix4(), toWorld = new THREE.Matrix4(), v = new THREE.Vector3();
  for (const part of parts) {
    if (!part.material || !part.role || !part.size || !part.centre || !include(part)) continue;
    const [rx, ry, rz] = part.rotation ?? [0, 0, 0];
    toWorld.makeRotationZ(rz).multiply(new THREE.Matrix4().makeRotationY(ry)).multiply(new THREE.Matrix4().makeRotationX(rx));
    toLocal.copy(toWorld).invert();
    const [w, h, d] = part.size;
    const [cx, cy, cz] = part.centre;
    for (let i = part.start; i < part.start + part.count; i++) {
      v.set(positions[i * 3]! - cx, positions[i * 3 + 1]! - cy, positions[i * 3 + 2]! - cz).applyMatrix4(toLocal);
      const u = Math.max(-1, Math.min(1, v.x / (w / 2)));
      const t = Math.max(-1, Math.min(1, v.z / (d / 2)));
      const vy = Math.max(0, Math.min(1, v.y / h + 0.5));
      const [dx, dy, dz] = relaxOffset(part.role, u, vy, t, [w, h, d], k, part.edge);
      v.x += dx; v.y += dy; v.z += dz;
      v.applyMatrix4(toWorld);
      positions[i * 3] = v.x + cx; positions[i * 3 + 1] = v.y + cy; positions[i * 3 + 2] = v.z + cz;
    }
  }
}
