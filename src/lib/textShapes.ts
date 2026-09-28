import * as THREE from 'three';
import type { Shape, TextData } from '../types';
import { newShapeIdPart } from './shapeIds';

// Text labels and 3D letters, built the way the Text and 3D Text tools place them. Shared by the
// tools, sdk.text and the action recorder. A text object stores only its words and settings
// (textData); the letters are drawn from the bundled font when it renders (TextMesh.tsx).
//
// Local axes of a text object: letters run along +X, their tops point +Y, and +Z is the side
// they're read from (and, for 3D text, the direction they stand out towards).

type V3 = [number, number, number];

export const TEXT_DEFAULTS = {
  text: { size: 0.3 },
  text3d: { size: 0.5, depth: 0.1 },
} as const;

const UP = new THREE.Vector3(0, 1, 0);

/** Horizontal unit vector towards the viewer (any horizontal direction if looking straight down). */
function horizontal(v: THREE.Vector3): THREE.Vector3 {
  const h = new THREE.Vector3(v.x, 0, v.z);
  return h.lengthSq() > 1e-8 ? h.normalize() : new THREE.Vector3(0, 0, 1);
}

/**
 * Orientation of a text object from the surface it was placed on (`normal`) and the direction
 * towards the viewer (`towardsViewer`).
 *
 * - Flat text lies on the surface, facing out of it. On a floor or roof its tops point away from
 *   the viewer, so it reads the right way up from where you are; on a wall they point up.
 * - 3D text stands upright: out of a wall it faces the room, on the ground it faces the viewer.
 */
export function textQuaternion(kind: 'text' | 'text3d', normal: V3, towardsViewer: V3): [number, number, number, number] {
  const n = new THREE.Vector3(...normal).normalize();
  const view = new THREE.Vector3(...towardsViewer);
  const onWall = Math.abs(n.y) < 0.7;
  let z: THREE.Vector3;
  let y: THREE.Vector3;
  if (kind === 'text3d') {
    z = onWall ? horizontal(n) : horizontal(view);
    y = UP.clone();
  } else {
    z = n;
    y = onWall
      ? UP.clone().projectOnPlane(z).normalize()
      : horizontal(view).negate().projectOnPlane(z).normalize();
  }
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  y = new THREE.Vector3().crossVectors(z, x).normalize();
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  return [q.x, q.y, q.z, q.w];
}

export interface TextOptions {
  text: string;
  /** Where the text goes: the middle of a flat label, or the base of 3D letters. */
  position: V3;
  /** The surface it's placed on (default: the ground, facing up). */
  normal?: V3;
  /** Direction towards the viewer, which way it reads (default: towards +Z). */
  towardsViewer?: V3;
  /** Exact orientation, instead of working it out from normal / towardsViewer. */
  quaternion?: [number, number, number, number];
  /** Letter height, metres. */
  size?: number;
  /** How far 3D letters stand out, metres. */
  depth?: number;
  bold?: boolean;
  align?: TextData['align'];
  color?: string;
  id?: string;
  name?: string;
}

/** A flat text label ('text') or solid 3D letters ('text3d'), as the Text tools make them. */
export function buildTextShape(kind: 'text' | 'text3d', opts: TextOptions): Shape {
  const text = opts.text.trim();
  if (!text) throw new Error('Text needs some words.');
  const size = opts.size ?? TEXT_DEFAULTS[kind].size;
  if (!(size > 0)) throw new Error('Text size must be more than 0.');
  const depth = kind === 'text3d' ? (opts.depth ?? TEXT_DEFAULTS.text3d.depth) : 0;
  const normal = opts.normal ?? [0, 1, 0];
  const quaternion = opts.quaternion ?? textQuaternion(kind, normal, opts.towardsViewer ?? [0, 0, 1]);
  // A flat label sits a couple of millimetres off its surface so the two don't flicker.
  const n = new THREE.Vector3(...normal).normalize();
  const lift = kind === 'text' && !opts.quaternion ? 0.002 : 0;
  const textData: TextData = { text, size, align: opts.align ?? 'center', bold: opts.bold ?? false };
  if (kind === 'text3d') textData.depth = depth;
  return {
    id: opts.id ?? newShapeIdPart(),
    name: opts.name ?? `${kind === 'text3d' ? '3D Text' : 'Text'} "${text.length > 24 ? text.slice(0, 23) + '…' : text}"`,
    type: kind,
    position: [opts.position[0] + n.x * lift, opts.position[1] + n.y * lift, opts.position[2] + n.z * lift],
    quaternion,
    scale: [1, 1, 1],
    args: [size, depth],
    color: opts.color ?? (kind === 'text3d' ? '#e2e8f0' : '#1f2937'),
    roughness: 0.6,
    metalness: 0,
    textData,
  };
}

/** New settings for an existing text object: the words, size, depth, weight or alignment. */
export function editTextShape(shape: Shape, changes: Partial<TextData>): Shape {
  if (!shape.textData) throw new Error('That object is not text.');
  const textData = { ...shape.textData, ...changes };
  textData.text = textData.text.trim();
  if (!textData.text) throw new Error('Text needs some words.');
  if (!(textData.size > 0)) throw new Error('Text size must be more than 0.');
  const kind = shape.type as 'text' | 'text3d';
  const name = shape.name && /^(3D )?Text "/.test(shape.name)
    ? `${kind === 'text3d' ? '3D Text' : 'Text'} "${textData.text.length > 24 ? textData.text.slice(0, 23) + '…' : textData.text}"`
    : shape.name;
  return { ...shape, name, textData, args: [textData.size, textData.depth ?? 0] };
}
