import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createDoorGeometry } from './archGeometry';
import { DOOR_STYLES, DOOR_TAGS } from './archStyles';
import { DoorOpener, doorMotion, pieces } from './presentation/doors';
import { bifoldLeafCount, carriageLeafCount, garagePanelColumns, garageSectionCount, patioPanelCount, shutterLayout } from './doorStyles';

/** Glass boxes in a door: material 1's triangles, twelve to a box. */
function glassBoxes(geometry: THREE.BufferGeometry): number {
  const group = geometry.groups.find(g => g.materialIndex === 1);
  return group ? group.count / 3 / 12 : 0;
}
const glassSize = (geometry: THREE.BufferGeometry) => {
  const g = geometry.groups.find(group => group.materialIndex === 1)!;
  const index = geometry.index!, pos = geometry.attributes.position!, box = new THREE.Box3(), v = new THREE.Vector3();
  for (let i = g.start; i < g.start + g.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, index.getX(i)));
  return box.getSize(new THREE.Vector3());
};

describe('door layout rules follow the width', () => {
  it('bi-fold leaves are 0.6 to 0.9 m wide, never fewer than two', () => {
    expect([1.2, 1.8, 2.4, 3.0, 3.6, 4.2, 4.8].map(bifoldLeafCount)).toEqual([2, 2, 3, 4, 4, 5, 6]);
    expect(bifoldLeafCount(0.5)).toBe(2);
    expect(bifoldLeafCount(30)).toBe(8);
    for (let w = 1.2; w <= 7; w += 0.1) expect(w / bifoldLeafCount(w)).toBeLessThanOrEqual(0.9 + 1e-9);
  });
  it('sliding patio doors use panels of about 1.2 m', () => {
    expect([1.0, 1.8, 2.4, 3.0, 3.6, 4.8, 6.0].map(patioPanelCount)).toEqual([2, 2, 2, 3, 3, 4, 5]);
  });
  it('shutters, door leaves and panes suit the width and height', () => {
    const narrow = shutterLayout(1.0, 2.1), standard = shutterLayout(1.8, 2.1), wide = shutterLayout(4.2, 2.4);
    expect(narrow.leaves).toBe(1); expect(standard.leaves).toBe(2); expect(wide.leaves).toBe(4);
    for (const l of [narrow, standard, wide]) {
      expect(l.shutterWidth).toBeGreaterThanOrEqual(0.28); expect(l.shutterWidth).toBeLessThanOrEqual(0.65);
      expect(l.leafWidth).toBeLessThanOrEqual(1.3);
    }
    expect(wide.columns).toBeGreaterThanOrEqual(standard.columns);
    expect(shutterLayout(1.8, 2.8).rows).toBeGreaterThan(shutterLayout(1.8, 1.8).rows);
  });
  it('garage doors get sections, panels and leaves to suit the opening', () => {
    expect([1.8, 2.1, 2.4, 3.0].map(garageSectionCount)).toEqual([4, 4, 5, 6]);
    expect(garagePanelColumns(2.4)).toBe(3); expect(garagePanelColumns(4.8)).toBe(6);
    expect(carriageLeafCount(3.0)).toBe(2); expect(carriageLeafCount(4.8)).toBe(4);
  });
});

describe('door geometry is built to the size', () => {
  it('builds the right number of glazed leaves for each width', () => {
    expect(glassBoxes(createDoorGeometry(1.2, 2.1, 0.15, 'bifold'))).toBe(2);
    expect(glassBoxes(createDoorGeometry(2.4, 2.1, 0.15, 'bifold'))).toBe(3);
    expect(glassBoxes(createDoorGeometry(4.2, 2.1, 0.15, 'bifold'))).toBe(5);
    expect(glassBoxes(createDoorGeometry(1.8, 2.1, 0.15, 'patio-sliding'))).toBe(2);
    expect(glassBoxes(createDoorGeometry(3.6, 2.1, 0.15, 'patio-sliding'))).toBe(3);
    expect(glassBoxes(createDoorGeometry(4.8, 2.1, 0.15, 'patio-sliding'))).toBe(4);
    expect(glassBoxes(createDoorGeometry(1.0, 2.1, 0.15, 'shutters'))).toBe(1);
    expect(glassBoxes(createDoorGeometry(1.8, 2.1, 0.15, 'shutters'))).toBe(2);
    expect(glassBoxes(createDoorGeometry(4.2, 2.4, 0.15, 'shutters'))).toBe(4);
    expect(glassBoxes(createDoorGeometry(3.0, 2.4, 0.18, 'garage-carriage'))).toBe(2);
    expect(glassBoxes(createDoorGeometry(4.8, 2.4, 0.18, 'garage-carriage'))).toBe(4);
    expect(glassBoxes(createDoorGeometry(2.4, 2.1, 0.15, 'garage-sectional-glazed'))).toBe(garagePanelColumns(2.4 - 0.11));
  });

  it('stays inside its opening and is complete at every size, for every door style', () => {
    for (const style of DOOR_STYLES) for (const scale of [0.7, 1, 1.6, 2.2]) {
      const width = +(style.defaultDimensions[0] * scale).toFixed(2), height = style.defaultDimensions[1], depth = style.defaultDimensions[2];
      const geometry = createDoorGeometry(width, height, depth, style.id);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      expect(geometry.attributes.position!.count).toBeGreaterThan(30);
      for (const v of [box.min.x, box.max.x, box.min.y, box.max.y, box.min.z, box.max.z]) expect(Number.isFinite(v)).toBe(true);
      // Overhead rails run a little past the opening; nothing else may.
      expect(box.max.x).toBeLessThanOrEqual(width / 2 + 0.16); expect(box.min.x).toBeGreaterThanOrEqual(-width / 2 - 0.16);
      expect(box.min.y).toBeGreaterThanOrEqual(-height / 2 - 0.02); expect(box.max.y).toBeLessThanOrEqual(height / 2 + 0.1);
      if (style.hasGlass) expect(glassSize(geometry).x).toBeGreaterThan(0.1);
    }
  });

  it('keeps leaves clear of each other: bi-fold and sliding leaves do not run past the jambs', () => {
    for (const width of [1.2, 2.4, 4.2, 6]) {
      for (const style of ['bifold', 'patio-sliding']) {
        const g = createDoorGeometry(width, 2.1, 0.15, style);
        const size = glassSize(g);
        expect(size.x).toBeLessThanOrEqual(width);
      }
    }
  });
});

describe('garage and workshop doors', () => {
  const garage = DOOR_STYLES.filter(s => s.category === 'Garage & Workshop');
  it('adds a few variations, each with an opening motion', () => {
    expect(garage.length).toBeGreaterThanOrEqual(5);
    for (const s of garage) expect(doorMotion(s.id)).not.toBe('none');
    expect(doorMotion('garage-sectional')).toBe('lift');
    expect(doorMotion('garage-roller')).toBe('roll');
    expect(doorMotion('garage-carriage')).toBe('double');
    expect(doorMotion('workshop-sliding')).toBe('slide');
  });
  it('offers filters for archways, exterior and the rest', () => {
    for (const tag of DOOR_TAGS) expect(DOOR_STYLES.some(s => s.tags?.includes(tag))).toBe(true);
    expect(DOOR_STYLES.filter(s => s.tags?.includes('Archways')).map(s => s.id).sort()).toEqual(['archway-round', 'archway-square']);
    for (const s of garage) expect(s.tags).toContain('Exterior');
  });

  it('opens overhead doors up and in, and rolls a shutter up into its box', () => {
    const viewer = new THREE.Vector3(0, 1, 5);
    const doors = new DoorOpener();
    const sectional = new THREE.Mesh(createDoorGeometry(2.4, 2.1, 0.15, 'garage-sectional'), new THREE.MeshStandardMaterial());
    const roller = new THREE.Mesh(createDoorGeometry(2.4, 2.1, 0.18, 'garage-roller'), new THREE.MeshStandardMaterial());
    doors.toggle(sectional, { width: 2.4, height: 2.1 }, 'garage-sectional', viewer);
    doors.toggle(roller, { width: 2.4, height: 2.1 }, 'garage-roller', viewer);
    for (let i = 0; i < 30; i++) doors.update(0.05);
    expect(sectional.children).toHaveLength(1);
    const leaf = sectional.children[0]!;
    // The foot of the door has swung away from the viewer (to -z) and up.
    const foot = new THREE.Vector3(0, -1.9, 0).applyEuler(leaf.rotation).add(leaf.position);
    expect(foot.z).toBeLessThan(-1.5);
    expect(foot.y).toBeGreaterThan(0.9);
    expect(roller.children[0]!.scale.y).toBeLessThan(0.1);
    expect(roller.children[0]!.position.y).toBeGreaterThan(0.9); // hangs from the top of the opening
    doors.dispose();
    expect(sectional.children).toHaveLength(0);
  });

  it('keeps a roller shutter box and guide rails in place while the slats roll', () => {
    const geometry = createDoorGeometry(2.4, 2.1, 0.18, 'garage-roller');
    const frame = pieces(geometry).filter(p => p.box.min.x < -2.4 / 2 + 0.02 || p.box.max.x > 2.4 / 2 - 0.02 || p.box.max.y > 2.1 / 2 - 0.02);
    expect(frame.length).toBeGreaterThanOrEqual(3);
  });
});
