import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { generateTimberFraming } from './timberFrameGenerator';
import { insetPolygon2D } from './archRoofGenerator';
import { Shape } from '../types';

// A round two-storey building: 16 straight wall pieces of about 1.8m, 200mm thick, walls
// centred on the outline (as a drawn room makes them), a floor slab under the ground floor
// and an upper floor laid between the upper walls.
const SIDES = 16;
const PIECE = 1.8;
const RADIUS = PIECE / 2 / Math.sin(Math.PI / SIDES);
const THICK = 0.2;
const STOREY = 2.8;
const SLAB = 0.2;

const outline: [number, number][] = Array.from({ length: SIDES }, (_, i) => {
  const a = (i / SIDES) * Math.PI * 2;
  return [RADIUS * Math.cos(a), RADIUS * Math.sin(a)];
});

function wallsAt(baseY: number, story: number): Shape[] {
  return outline.map((pA, i) => {
    const pB = outline[(i + 1) % SIDES];
    const angle = Math.atan2(pB[1] - pA[1], pB[0] - pA[0]);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle);
    return {
      id: `s${story}-w${i}`,
      type: 'wall',
      position: [(pA[0] + pB[0]) / 2, baseY + STOREY / 2, (pA[1] + pB[1]) / 2],
      quaternion: [q.x, q.y, q.z, q.w],
      args: [Math.hypot(pB[0] - pA[0], pB[1] - pA[1]) + THICK, STOREY, THICK],
      color: '#ffffff',
      tags: [`story-${story}`, 'architecture', 'wall-assembly'],
    } as Shape;
  });
}

const slabQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
function slab(id: string, poly: [number, number][], centreY: number): Shape {
  return {
    id,
    name: 'Floor Slab',
    type: 'poly',
    position: [0, centreY, 0],
    rotation: [Math.PI / 2, 0, 0],
    quaternion: [slabQuat.x, slabQuat.y, slabQuat.z, slabQuat.w],
    args: { vertices: poly, height: SLAB } as any,
    color: '#cbd5e1',
    tags: ['architecture', 'floor-slab'],
  };
}

const groundWalls = wallsAt(0, 1);
const upperWalls = wallsAt(STOREY, 2);
const groundSlab = slab('slab-ground', outline, -SLAB / 2);
const upperOutline = insetPolygon2D(outline, THICK);
const upperSlab = slab('slab-upper', upperOutline, STOREY + SLAB / 2);

// A 3.4m bi-fold door on the 1.8m ground-floor piece 4: it runs on into both neighbours.
const host = groundWalls[4];
const bifold: Shape = {
  id: 'bifold',
  type: 'door',
  position: [host.position[0], 1.05, host.position[2]],
  quaternion: host.quaternion,
  args: [3.4, 2.1, 0.15],
  color: '#ffffff',
  hostWallId: host.id,
};

function pointInPolygon(x: number, z: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** The eight corners of a timber member's box, in world space. */
function corners(m: Shape): THREE.Vector3[] {
  const [w, h, d] = m.args as number[];
  const q = new THREE.Quaternion(...(m.quaternion || [0, 0, 0, 1]));
  const pos = new THREE.Vector3(...m.position);
  const out: THREE.Vector3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    out.push(new THREE.Vector3((sx * w) / 2, (sy * h) / 2, (sz * d) / 2).applyQuaternion(q).add(pos));
  }
  return out;
}

describe('timber frame on a round building', () => {
  it('leaves a bi-fold door wider than its wall piece clear, across the neighbouring pieces too', () => {
    const result = generateTimberFraming([...groundWalls, bifold], { includeWalls: true, includeFloors: false, includeRoof: false });
    const doorQ = new THREE.Quaternion(...(bifold.quaternion as [number, number, number, number]));
    const toDoor = doorQ.clone().invert();
    const doorPos = new THREE.Vector3(...bifold.position);
    const halfW = 3.4 / 2;

    const inDoorway = result.shapes.filter(m => {
      if (!m.tags?.includes('timber-wall')) return false;
      // The member's extent in the door's own frame: across, up, and through the wall.
      const local = corners(m).map(c => c.sub(doorPos).applyQuaternion(toDoor));
      const minX = Math.min(...local.map(p => p.x)), maxX = Math.max(...local.map(p => p.x));
      const minY = Math.min(...local.map(p => p.y)), maxY = Math.max(...local.map(p => p.y));
      const minZ = Math.min(...local.map(p => p.z)), maxZ = Math.max(...local.map(p => p.z));
      // Only the doorway itself: inside the jambs, below the head, and through the door's own
      // leaves (at its ends the curved wall bends away behind the flat door, so the jambs
      // there stand behind it, not in it).
      return maxX > -halfW + 0.01 && minX < halfW - 0.01 && minY < 1.05 - 0.01 && maxY > -1.05 + 0.01
        && maxZ > -0.1 && minZ < 0.1;
    });
    expect(inDoorway.map(m => m.name)).toEqual([]);

    // The door is still framed: a jack stud each side and a lintel over it.
    const doorFrame = result.shapes.filter(m => m.tags?.includes('timber-wall'));
    expect(doorFrame.filter(m => m.tags?.includes('timber-jack-stud') && m.parentWallOrRoofId !== host.id).length).toBeGreaterThanOrEqual(2);
    expect(doorFrame.filter(m => m.tags?.includes('timber-lintel')).length).toBeGreaterThanOrEqual(3);
  });

  it('keeps floor joists inside the floor slabs, clear of the slab edges', () => {
    const shapes = [...groundWalls, ...upperWalls, groundSlab, upperSlab];
    const result = generateTimberFraming(shapes, { includeWalls: false, includeFloors: true, includeRoof: false });
    const floor = result.shapes.filter(m => m.tags?.includes('timber-floor'));
    expect(floor.length).toBeGreaterThan(20);

    const slabs = [
      { poly: outline, bottom: -SLAB, top: 0 },
      { poly: upperOutline, bottom: STOREY, top: STOREY + SLAB },
    ];
    for (const s of slabs) {
      const members = floor.filter(m => m.position[1] > s.bottom - 0.5 && m.position[1] < s.top + 0.5);
      expect(members.length).toBeGreaterThan(10);
      for (const m of members) {
        for (const c of corners(m)) {
          expect(c.y).toBeGreaterThan(s.bottom);
          expect(c.y).toBeLessThan(s.top);
          expect(pointInPolygon(c.x, c.z, s.poly)).toBe(true);
        }
      }
    }
  });
});
