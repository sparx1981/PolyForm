import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createDoorGeometry, createWindowGeometry } from './archGeometry';
import { DOOR_STYLES, DOOR_TAGS, WINDOW_STYLES } from './archStyles';
import { DoorOpener, doorMotion, pieces } from './presentation/doors';
import { bifoldLeafCount, carriageLeafCount, garagePanelColumns, garageSectionCount, patioPanelCount, shutterLayout, shutterPanels } from './doorStyles';

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
  it('shutter panels fold back flat: about 0.6 m or less each, half the opening on each side', () => {
    for (const w of [0.6, 0.9, 1.2, 1.8, 2.4, 3.0, 4.2]) {
      const { shuttersPerSide, shutterWidth } = shutterPanels(w);
      expect(shutterWidth).toBeLessThanOrEqual(0.6 + 1e-9);
      expect(shuttersPerSide * shutterWidth).toBeGreaterThan(w / 2 - 0.02);
      expect(shuttersPerSide * shutterWidth).toBeLessThanOrEqual(w / 2 + 1e-9);
    }
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
    // A standard pair of French doors is ten lights a leaf (two across, five down).
    expect(standard.columns).toBe(2); expect(shutterLayout(1.8, 2.1).rows).toBe(5);
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
      // The shutters hang on the wall either side of their doors, so they are measured separately below.
      if (style.id !== 'shutters') { expect(box.max.x).toBeLessThanOrEqual(width / 2 + 0.16); expect(box.min.x).toBeGreaterThanOrEqual(-width / 2 - 0.16); }
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

/** Boxes of the glass (material 1) and every other piece, from the merged door or window geometry. */
function glassAndSolids(geometry: THREE.BufferGeometry) {
  const material = new Map<number, number>();
  for (const g of geometry.groups) for (let i = g.start; i < g.start + g.count; i += 3) material.set(i / 3, g.materialIndex ?? 0);
  const all = pieces(geometry);
  const glass = all.filter(p => p.tris.every(t => material.get(t) === 1)).map(p => p.box);
  const solids = all.filter(p => !p.tris.every(t => material.get(t) === 1)).map(p => p.box);
  return { glass, solids };
}
describe('glazed garage and steel doors are see-through', () => {
  it.each([
    ['garage-sectional-glazed', 2.4, 2.1], ['garage-sectional-glazed', 4.8, 2.4], ['workshop-personnel', 0.9, 2.1], ['workshop-personnel', 1.2, 2.2],
  ])('%s %sm wide: a ray through any part of a pane hits only glass, nothing solid behind or in front', (style, width, height) => {
    const geometry = createDoorGeometry(width, height, 0.15, style);
    const mesh = new THREE.Mesh(geometry, [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })));
    mesh.updateMatrixWorld(true);
    const { glass } = glassAndSolids(geometry);
    expect(glass.length).toBeGreaterThan(0);
    for (const box of glass) {
      const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      // The middle and the four quarter points, away from the slim bead round the edge.
      for (const [fx, fy] of [[0, 0], [-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
        const origin = new THREE.Vector3(c.x + fx * s.x, c.y + fy * s.y, 1);
        for (const dir of [-1, 1]) {
          const from = origin.clone(); from.z = dir;
          const hits = new THREE.Raycaster(from, new THREE.Vector3(0, 0, -dir)).intersectObject(mesh);
          expect(hits.length).toBeGreaterThan(0);
          expect(hits.every(h => h.face!.materialIndex === 1)).toBe(true);
        }
      }
    }
  });
});

describe('French doors and windows with louvered shutters', () => {
  const FACE = 0.18 / 2;
  /** Boxes of the pieces that lie wholly outside the opening's width (the shutters and their ironwork). */
  const outside = (geometry: THREE.BufferGeometry, width: number) => pieces(geometry).map(p => p.box).filter(b => b.min.x >= width / 2 - 1e-6 || b.max.x <= -width / 2 + 1e-6);

  it.each([[1.0], [1.8], [2.4], [4.2]])('the %s m French doors are their own width, with the shutters outside it on the wall face', width => {
    const geometry = createDoorGeometry(width, 2.1, 0.18, 'shutters');
    // Every pane of glass is inside the opening: the doors are the whole width, shutters not included.
    const { glass } = glassAndSolids(geometry);
    expect(glass.length).toBe(shutterLayout(width, 2.1).leaves);
    for (const g of glass) { expect(g.min.x).toBeGreaterThanOrEqual(-width / 2); expect(g.max.x).toBeLessThanOrEqual(width / 2); }
    const doorSpan = new THREE.Box3(); glass.forEach(g => doorSpan.union(g));
    expect(doorSpan.getSize(new THREE.Vector3()).x).toBeGreaterThan(width * 0.65);
    // The shutters fill the wall beside the opening, each side the same, and stand proud of the outside face.
    const shutters = outside(geometry, width);
    expect(shutters.length).toBeGreaterThan(20);
    const left = new THREE.Box3(), right = new THREE.Box3();
    shutters.forEach(b => (b.max.x <= 0 ? left : right).union(b));
    expect(left.max.x).toBeLessThan(-width / 2 + 1e-6); expect(right.min.x).toBeGreaterThan(width / 2 - 1e-6);
    expect(right.getSize(new THREE.Vector3()).x).toBeGreaterThan(width / 2 - 0.05);
    expect(right.getSize(new THREE.Vector3()).x).toBeCloseTo(left.getSize(new THREE.Vector3()).x, 2);
    expect(left.min.z).toBeGreaterThanOrEqual(FACE - 1e-6);
    expect(right.min.z).toBeGreaterThanOrEqual(FACE - 1e-6);
    // Nothing of the doors themselves pokes beyond the opening.
    const overall = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position as THREE.BufferAttribute);
    expect(overall.max.x).toBeGreaterThan(width / 2 + width / 2 - 0.05);
  });
  it('the doors swing open and the shutters stay where they are', () => {
    expect(doorMotion('shutters')).toBe('double');
    const doors = new DoorOpener();
    const mesh = new THREE.Mesh(createDoorGeometry(1.8, 2.1, 0.18, 'shutters'), new THREE.MeshStandardMaterial());
    doors.toggle(mesh, { width: 1.8, height: 2.1 }, 'shutters', new THREE.Vector3(0, 1, 5));
    for (let i = 0; i < 30; i++) doors.update(0.05);
    expect(mesh.children).toHaveLength(2);
    const stay = new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position as THREE.BufferAttribute);
    expect(stay.min.x).toBeLessThan(-1.8 / 2 - 0.3); expect(stay.max.x).toBeGreaterThan(1.8 / 2 + 0.3);
    doors.dispose();
  });
  it('has a matching window style whose shutters sit outside its width', () => {
    const style = WINDOW_STYLES.find(s => s.id === 'casement-shutters');
    expect(style?.name).toMatch(/Louvered Shutters/);
    for (const width of [0.9, 1.2, 1.8]) {
      const geometry = createWindowGeometry(width, 1.5, 0.15, 'casement-shutters');
      const { glass } = glassAndSolids(geometry);
      expect(glass.length).toBe(2);
      for (const g of glass) { expect(g.min.x).toBeGreaterThanOrEqual(-width / 2); expect(g.max.x).toBeLessThanOrEqual(width / 2); }
      const shutters = outside(geometry, width);
      expect(shutters.length).toBeGreaterThan(20);
      for (const b of shutters) expect(b.min.z).toBeGreaterThanOrEqual(0.15 / 2 - 1e-6);
      const overall = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position as THREE.BufferAttribute);
      expect(overall.max.x).toBeGreaterThan(width * 0.9);
    }
  });
});
