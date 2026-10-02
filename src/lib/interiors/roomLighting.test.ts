import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Shape } from '../../types';
import { detectRooms } from '../spatial/rooms';
import { createLampGeometry, getLampLightAnchor } from '../landscapeGeometry';
import { findLampStyle } from '../lampStyles';
import { planRoomFurnishing, pointInPolygonOrNear, type FurnishingPreset } from './smartFurnish';
import { furnishRooms } from './furnishBatch';
import { inferLightingType, lightingTypeForPreset, planRoomLighting } from './roomLighting';

const wall = (id: string, x: number, z: number, length: number, rotationY = 0): Shape => ({
  id, type: 'wall', position: [x, 1.4, z], rotation: [0, rotationY, 0], args: [length, 2.8, 0.2], color: '#fff',
});
const room = (w: number, d: number): Shape[] => [
  wall('north', 0, -d / 2, w), wall('south', 0, d / 2, w),
  wall('west', -w / 2, 0, d, Math.PI / 2), wall('east', w / 2, 0, d, Math.PI / 2),
  { id: 'door', type: 'door', hostWallId: 'south', position: [w / 2 - 0.6, 1.0, d / 2], args: [0.9, 2.0, 0.2], color: '#fff' },
];
const lit = (w: number, d: number, preset: FurnishingPreset) => {
  const shapes = room(w, d);
  const r = detectRooms(shapes, { cell: 0.1 })[0]!;
  const furniture = planRoomFurnishing(shapes, r, preset).shapes;
  const all = [...shapes, ...furniture];
  return { r, all, furniture, lights: planRoomLighting(all, r, lightingTypeForPreset(preset)) };
};
const styles = (lights: Shape[]) => lights.map(l => l.archStyle);

describe('room-aware lighting', () => {
  it('lights every room type with fixtures suited to it', () => {
    expect(styles(lit(5, 4.5, 'bedroom').lights)).toEqual(expect.arrayContaining(['flush-ceiling', 'nightstand']));
    expect(styles(lit(5, 4.5, 'living-room').lights)).toEqual(expect.arrayContaining(['recessed', 'floor-lamp']));
    expect(styles(lit(6, 5, 'office').lights)).toEqual(expect.arrayContaining(['troffer', 'desk-lamp']));
    expect(styles(lit(5.5, 4.5, 'kitchen').lights)).toEqual(expect.arrayContaining(['recessed', 'pendant']));
    expect(styles(lit(3, 2.5, 'bathroom').lights)).toEqual(expect.arrayContaining(['vanity-light']));
    expect(styles(lit(2.1, 1.7, 'toilet').lights)).toEqual(expect.arrayContaining(['flush-ceiling', 'vanity-light']));
    expect(styles(lit(5, 4, 'workshop').lights)).toEqual(expect.arrayContaining(['linear-led', 'desk-lamp']));
  });

  it('uses high-bays rather than battens in a large workshop', () => {
    const { lights } = lit(9, 6.5, 'workshop');
    expect(styles(lights)).toContain('high-bay');
    expect(styles(lights)).not.toContain('linear-led');
  });

  it('puts ceiling fixtures at the ceiling and inside the room, with unique ids', () => {
    for (const [w, d, preset] of [[5, 4.5, 'living-room'], [6, 5, 'office'], [4, 3, 'workshop'], [3, 2.5, 'bathroom']] as const) {
      const { r, lights } = lit(w, d, preset);
      expect(new Set(lights.map(l => l.id)).size).toBe(lights.length);
      for (const light of lights) {
        expect(pointInPolygonOrNear([light.position[0], light.position[2]], r.boundary, 0.3), `${preset} ${light.archStyle}`).toBe(true);
        if (findLampStyle(light.archStyle).mount === 'ceiling') expect(light.position[1]).toBeCloseTo(2.8, 1);
        expect(light.customData.interiorLightRoom).toBe(r.id);
      }
    }
  });

  it('puts bedside and table lamps on top of the furniture they stand on', () => {
    const { lights, furniture } = lit(5, 4.5, 'bedroom');
    const stand = furniture.find(s => s.customData.furnitureType === 'nightstand')!;
    const lamp = lights.find(l => l.archStyle === 'nightstand' && Math.hypot(l.position[0] - stand.position[0], l.position[2] - stand.position[2]) < 0.01)!;
    expect(lamp.position[1]).toBeCloseTo(Number(stand.customData.semanticComponent.params.height), 1);
  });

  it('hangs a pendant over the dining table and lights each desk', () => {
    const kitchen = lit(5.5, 4.5, 'kitchen');
    const table = kitchen.furniture.find(s => s.customData.furnitureType === 'dining-table')!;
    const pendants = kitchen.lights.filter(l => l.archStyle === 'pendant');
    expect(pendants.length).toBeGreaterThanOrEqual(1);
    for (const p of pendants) expect(Math.hypot(p.position[0] - table.position[0], p.position[2] - table.position[2])).toBeLessThan(0.9);
    const office = lit(6, 5, 'office');
    expect(office.lights.filter(l => l.archStyle === 'desk-lamp').length).toBe(office.furniture.filter(s => s.customData.furnitureType === 'desk').length);
  });

  it('mounts a vanity light on the wall behind the basin, facing into the room', () => {
    const { lights, furniture } = lit(3, 2.5, 'bathroom');
    const basin = furniture.find(s => s.customData.furnitureType === 'basin')!;
    const light = lights.find(l => l.archStyle === 'vanity-light')!;
    expect(light.position[1]).toBeCloseTo(1.75, 1);
    // The fixture's +X is its front: it must point the same way as the basin's front.
    const front = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(...light.quaternion!));
    const basinYaw = basin.rotation![1];
    expect(front.x).toBeCloseTo(Math.sin(basinYaw), 2);
    expect(front.z).toBeCloseTo(Math.cos(basinYaw), 2);
    // And it sits behind the basin, toward the wall.
    const toLight = new THREE.Vector3(light.position[0] - basin.position[0], 0, light.position[2] - basin.position[2]);
    expect(toLight.dot(new THREE.Vector3(Math.sin(basinYaw), 0, Math.cos(basinYaw)))).toBeLessThan(0);
  });

  it('never fits more than a fixed number of lights in a room', () => {
    expect(lit(20, 15, 'workshop').lights.length).toBeLessThanOrEqual(14);
  });

  it('works out a room\'s type from its furniture', () => {
    const cases: Array<[number, number, FurnishingPreset, string]> = [[5, 4.5, 'bedroom', 'bedroom'], [5, 4.5, 'living-room', 'living'], [3, 2.5, 'bathroom', 'bathroom'], [2.1, 1.7, 'toilet', 'toilet'], [5.5, 4.5, 'kitchen', 'kitchen'], [5, 4, 'workshop', 'workshop'], [6, 5, 'office', 'office']];
    for (const [w, d, preset, expected] of cases) {
      const { r, all } = lit(w, d, preset);
      expect(inferLightingType(all, r), preset).toBe(expected);
    }
    const bare = room(4, 4);
    expect(inferLightingType(bare, detectRooms(bare, { cell: 0.1 })[0]!)).toBeNull();
  });

  it('adds lights when furnishing a queue and replaces them on the next run', () => {
    const shapes = room(5, 4.5);
    const rooms = detectRooms(shapes, { cell: 0.1 });
    const first = furnishRooms(shapes, rooms, [{ roomId: rooms[0]!.id, preset: 'bedroom', replaceExisting: false, lighting: true }], false);
    const count = (all: Shape[]) => all.filter(s => s.customData?.interiorLight).length;
    expect(count(first.shapes)).toBeGreaterThan(0);
    expect(first.results[0]!.lights).toBe(count(first.shapes));
    const second = furnishRooms(first.shapes, rooms, [{ roomId: rooms[0]!.id, preset: 'bedroom', replaceExisting: true, lighting: true }], false);
    expect(count(second.shapes)).toBe(second.results[0]!.lights);
    const unlit = furnishRooms(shapes, rooms, [{ roomId: rooms[0]!.id, preset: 'bedroom', replaceExisting: false }], false);
    expect(count(unlit.shapes)).toBe(0);
  });
});

describe('new interior fixtures', () => {
  it('builds finite geometry and a light anchor for each', () => {
    for (const id of ['flush-ceiling', 'vanity-light', 'linear-led']) {
      const g = createLampGeometry(3.2, id);
      expect(g.getAttribute('position').count, id).toBeGreaterThan(20);
      expect(Array.from(g.getAttribute('position').array).every(Number.isFinite), id).toBe(true);
      expect(getLampLightAnchor(3.2, id).every(Number.isFinite)).toBe(true);
      expect(findLampStyle(id).id).toBe(id);
      expect(findLampStyle(id).category).toBe('interior');
      g.dispose();
    }
  });

  it('gives the batten a rectangular light along its length', () => {
    const light = findLampStyle('linear-led').light;
    expect(light.type).toBe('rect');
    expect(light.width!).toBeGreaterThan(light.height! * 5);
  });
});
