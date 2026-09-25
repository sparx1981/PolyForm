import * as THREE from 'three';
import type { Shape } from '../../types';
import { denseOutline, type Vec2 } from './patioGeometry';
import type { PatioData, PatioKind, PatioToolSettings } from './patioTypes';

/**
 * Where a patio or deck sits: the wall faces it can be drawn against, the ground under it, and
 * the shape a drawn outline becomes. Shared by the drawing tool and the PolyForm connector.
 */

export interface WallFace { a: Vec2; b: Vec2; floor: number; wallId: string; face: number }

/** The two long faces of every straight wall, as lines on the ground plus the wall's floor level. */
export function wallFaces(shapes: Shape[]): WallFace[] {
  const faces: WallFace[] = [];
  for (const s of shapes) {
    if (s.type !== 'wall' || s.hidden || !Array.isArray(s.args)) continue;
    const [length = 0, height = 0, thickness = 0.2] = s.args as number[];
    if (length < 0.2) continue;
    const q = new THREE.Quaternion(...(s.quaternion ?? [0, 0, 0, 1]));
    if (!s.quaternion && s.rotation) q.setFromEuler(new THREE.Euler(...s.rotation));
    const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const [cx, cy, cz] = s.position;
    const floor = cy - height / 2;
    for (const side of [1, -1]) {
      const ox = cx + normal.x * side * thickness / 2, oz = cz + normal.z * side * thickness / 2;
      faces.push({
        a: [ox - dir.x * length / 2, oz - dir.z * length / 2],
        b: [ox + dir.x * length / 2, oz + dir.z * length / 2],
        floor, wallId: s.id, face: side,
      });
    }
  }
  return faces;
}


export function terrainAt(shapes: Shape[], x: number, z: number): Shape | undefined {
  return shapes.find(s => s.type === 'terrain' && !s.hidden && s.terrainData
    && Math.abs(x - s.position[0]) <= s.terrainData.width / 2 && Math.abs(z - s.position[2]) <= s.terrainData.depth / 2);
}


/** Terrain helpers for the Viewport: ground (as drawn) and ground before patio levelling. */
export function patioGroundHelpers(shapes: Shape[], drawn: Map<string, Shape>, sample: (x: number, z: number, terrain: Shape) => number) {
  return {
    drawnGround: (x: number, z: number) => {
      const t = terrainAt(shapes, x, z);
      return t ? sample(x, z, drawn.get(t.id) ?? t) : 0;
    },
    originalGround: (x: number, z: number) => {
      const t = terrainAt(shapes, x, z);
      return t ? sample(x, z, t) : 0;
    },
  };
}

/**
 * Level of a new patio or deck: the house floor when drawn against a wall, otherwise the middle
 * of the ground under a patio (plus 2 cm), or the deck height above the highest ground.
 */
export function patioLevel(
  world: Vec2[],
  bulges: number[],
  kind: PatioKind,
  deckHeight: number,
  wallFloors: number[],
  groundAt: (x: number, z: number) => number,
): number {
  if (wallFloors.length) return Math.max(...wallFloors);
  const samples = denseOutline(world, bulges, 0.5).points.map(([x, z]) => groundAt(x, z)).sort((a, b) => a - b);
  return kind === 'patio' ? samples[Math.floor(samples.length / 2)] + 0.02 : samples[samples.length - 1] + deckHeight;
}

/** For each straight edge, whether it runs along a wall face (edges there get no kerb or railing). */
export function patioWallEdges(world: Vec2[], bulges: number[], faces: WallFace[]): boolean[] {
  return world.map((a, i) => {
    const b = world[(i + 1) % world.length];
    const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return Math.abs(bulges[i] ?? 0) < 1e-4 && faces.some(face => {
      const dx = face.b[0] - face.a[0], dz = face.b[1] - face.a[1], len2 = dx * dx + dz * dz;
      const t = ((mid[0] - face.a[0]) * dx + (mid[1] - face.a[1]) * dz) / len2;
      return t >= 0 && t <= 1 && Math.hypot(mid[0] - face.a[0] - dx * t, mid[1] - face.a[1] - dz * t) < 0.05;
    });
  });
}

/** The shape a finished outline becomes (world points in metres on the ground plane). */
export function makePatioShape(opts: {
  id: string;
  name: string;
  world: Vec2[];
  bulges: number[];
  level: number;
  wallEdges: boolean[];
  kind: PatioKind;
  template: PatioToolSettings['template'];
}): Shape {
  const { world, template } = opts;
  const cx = world.reduce((sum, p) => sum + p[0], 0) / world.length;
  const cz = world.reduce((sum, p) => sum + p[1], 0) / world.length;
  const patioData: PatioData = {
    ...template,
    kind: opts.kind,
    points: world.map(([x, z]) => [x - cx, z - cz] as Vec2),
    bulges: opts.bulges,
    wallEdges: opts.wallEdges,
    steps: [],
  };
  return {
    id: opts.id,
    name: opts.name,
    type: 'patio',
    position: [cx, opts.level, cz],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    args: [],
    color: template.color,
    patioData,
  };
}
