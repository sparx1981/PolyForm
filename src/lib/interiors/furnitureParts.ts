import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { smoothPatchNormals } from './upholsteryNormals';
import type { ComponentDefinition } from '../semantics/componentTypes';

export interface FurnitureParams {
  width?: number;
  height?: number;
  depth?: number;
  seatHeight?: number;
  mattressHeight?: number;
  headboardHeight?: number;
  doorCount?: number;
  openAmount?: number;
  fullness?: number;
  foldDepth?: number;
}

export type FurnitureProfile = {
  definition: ComponentDefinition<Record<string, unknown>>;
  defaults: Required<FurnitureParams>;
  color: string;
  /** Glossy ceramics read differently from timber; defaults are roughness 0.82, metalness 0.02. */
  surface?: { roughness: number; metalness?: number };
};

/** Neutral defaults for the parameters a piece does not use. */
export const BASE_PARAMS: Required<FurnitureParams> = {
  width: 1, height: 1, depth: 1, seatHeight: 0, mattressHeight: 0, headboardHeight: 0,
  doorCount: 0, openAmount: 0, fullness: 1, foldDepth: 0,
};

export function padded(width: number, height: number, depth: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new RoundedBoxGeometry(width, height, depth, 3, Math.min(0.065, height / 4, depth / 4));
  const position = g.getAttribute('position');
  for (let i=0;i<position.count;i++) {
    const px=position.getX(i), py=position.getY(i), pz=position.getZ(i);
    const envelope=Math.max(0,1-(2*px/width)**2)*Math.max(0,1-(2*pz/depth)**2);
    const loft=height*0.12*envelope;
    const wrinkle=Math.sin(px*28 + pz*11)*height*0.018*envelope;
    position.setY(i, py + Math.sign(py)*(loft+wrinkle));
  }
  g.setAttribute('normal', new THREE.Float32BufferAttribute(smoothPatchNormals(position.array), 3));
  g.userData.fabric = true;
  g.translate(x, y, z);
  return g;
}

export function box(width: number, height: number, depth: number, x: number, y: number, z: number, yaw = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(Math.max(0.01, width), Math.max(0.01, height), Math.max(0.01, depth));
  if (yaw) g.rotateY(yaw);
  g.translate(x, y, z);
  return g;
}

/** Hard-edged piece with softly rounded corners (ceramics, seats, table tops). */
export function rbox(width: number, height: number, depth: number, x: number, y: number, z: number, radius = 0.025): THREE.BufferGeometry {
  const w = Math.max(0.01, width), h = Math.max(0.01, height), d = Math.max(0.01, depth);
  const g = new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, w / 2.2, h / 2.2, d / 2.2));
  g.translate(x, y, z);
  return g;
}

/** Upright cylinder; scaleZ stretches it into an oval for bowls and seats. */
export function cyl(radius: number, height: number, x: number, y: number, z: number, scaleZ = 1, radiusBottom = radius): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radiusBottom, Math.max(0.005, height), 24);
  if (scaleZ !== 1) g.scale(1, 1, scaleZ);
  g.translate(x, y, z);
  return g;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map(part => part.index ? part.toNonIndexed() : part);
  const result = mergeGeometries(flat, false);
  if (result) {
    let start=0;
    for (let i=0;i<flat.length;i++) {
      const count=flat[i].getAttribute('position').count;
      result.addGroup(start,count,parts[i].userData.fabric ? 1 : 0);
      start+=count;
    }
  }
  for (const part of flat) if (!parts.includes(part)) part.dispose();
  for (const part of parts) part.dispose();
  if (!result) throw new Error('Could not merge furniture geometry');
  result.computeBoundingBox();
  result.computeBoundingSphere();
  return result;
}
