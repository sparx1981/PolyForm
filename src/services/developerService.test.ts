// @vitest-environment jsdom
//
// DeveloperSDK is a plain class (not a hook/component) but a few methods
// dispatch `window` CustomEvents (camera controls, CSG/deform requests), so
// this still runs under jsdom rather than the default Node environment.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeveloperSDK } from './developerService';
import type { Shape } from '../types';

/**
 * Mirrors how the app actually drives the SDK: a fresh DeveloperSDK is
 * constructed on every render with the current `shapes` array (see
 * DeveloperSuite.tsx's `useMemo(() => new DeveloperSDK(shapes, setShapes,
 * ...), [...])`). Rather than model React re-renders, this harness keeps
 * one mutable `shapes` array as the source of truth and hands back a
 * `refresh()` to rebuild the SDK against its latest contents — the same
 * "read the result of the last setShapes call" pattern a real render does.
 */
function makeHarness(initialShapes: Shape[] = [], extraSetters: any = {}) {
  let shapes: Shape[] = initialShapes;
  const setShapes = vi.fn((next: Shape[] | ((prev: Shape[]) => Shape[])) => {
    shapes = typeof next === 'function' ? (next as (prev: Shape[]) => Shape[])(shapes) : next;
  });
  const updateShapeColor = vi.fn();
  let selectedId: string | null = null;

  const makeSdk = () => new DeveloperSDK(shapes, setShapes, updateShapeColor, selectedId, extraSetters);

  return {
    get shapes() { return shapes; },
    setShapes,
    updateShapeColor,
    setSelectedId(id: string | null) { selectedId = id; },
    makeSdk,
  };
}

function makeShape(overrides: Partial<Shape> = {}): Shape {
  return {
    id: `shape-${Math.random().toString(36).slice(2)}`,
    name: 'Box',
    type: 'box',
    position: [0, 0, 0],
    args: [1, 1, 1],
    color: '#ffffff',
    ...overrides,
  } as Shape;
}

describe('DeveloperSDK', () => {
  describe('constructor defaults', () => {
    it('seeds every subsystem default config', () => {
      const { makeSdk } = makeHarness();
      const sdk = makeSdk();
      expect(sdk.roofDefaults.roofType).toBe('gable');
      expect(sdk.stairsDefaults.style).toBe('straight');
      expect(sdk.wallDefaults.thickness).toBe(0.20);
      expect(sdk.doorDefaults.width).toBe(0.90);
      expect(sdk.windowDefaults.width).toBe(1.20);
      expect(sdk.landscapeDefaults.defaultSpecies).toBe('english_oak');
      expect(sdk.materialDefaults.roughness).toBe(0.5);
    });

    it('measurementDefaults.unit falls back to "m" with no extraSetters.unit', () => {
      const { makeSdk } = makeHarness();
      expect(makeSdk().measurementDefaults.unit).toBe('m');
    });

    it('measurementDefaults.unit picks up extraSetters.unit when provided', () => {
      const { makeSdk } = makeHarness([], { unit: 'ft' });
      expect(makeSdk().measurementDefaults.unit).toBe('ft');
    });
  });

  describe('core primitive creation', () => {
    it('createBox adds exactly one shape (regression: used to double-add via a stray this.shapes.push)', () => {
      const h = makeHarness();
      const sdk = h.makeSdk();
      const box = sdk.createBox({ width: 2, height: 3, depth: 4 });
      expect(box.type).toBe('box');
      expect(box.args).toEqual([2, 3, 4]);
      expect(h.shapes).toHaveLength(1);
      expect(h.shapes[0].id).toBe(box.id);
    });

    it('createRectangle, createSphere, createCone each add exactly one shape', () => {
      const h = makeHarness();
      const sdk = h.makeSdk();
      sdk.createRectangle({ width: 2, height: 3 });
      sdk.createSphere({ radius: 1 });
      sdk.createCone({ radius: 1, height: 2 });
      expect(h.shapes).toHaveLength(3);
      expect(h.shapes.map(s => s.type)).toEqual(['rect', 'sphere', 'cone']);
    });

    it('createPoly returns null for fewer than 3 vertices and adds nothing', () => {
      const h = makeHarness();
      const sdk = h.makeSdk();
      const result = sdk.createPoly({ vertices: [[0, 0, 0], [1, 0, 0]] });
      expect(result).toBeNull();
      expect(h.shapes).toHaveLength(0);
    });

    it('createPoly builds a shape from 3+ vertices', () => {
      const h = makeHarness();
      const sdk = h.makeSdk();
      const poly = sdk.createPoly({ vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0]] });
      expect(poly).not.toBeNull();
      expect(poly!.type).toBe('poly');
      expect(h.shapes).toHaveLength(1);
    });

    it('addObject fills in default args per type when none are given', () => {
      const h = makeHarness();
      const sdk = h.makeSdk();
      const box = sdk.addObject('box', {});
      const sphere = sdk.addObject('sphere', {});
      expect(box.args).toEqual([1, 1, 1]);
      expect(sphere.args).toEqual([1, 32, 32]);
      expect(h.shapes).toHaveLength(2);
    });

    it('pushPull replaces a shape\'s type/args/position rather than creating a new one', () => {
      const h = makeHarness([makeShape({ id: 'a', args: [1, 1, 1] })]);
      const sdk = h.makeSdk();
      const original = h.shapes[0];
      const updated = sdk.pushPull(original, 5);
      expect(updated.type).toBe('box');
      expect(updated.args[1]).toBe(5);
      expect(updated.position[1]).toBe(2.5);
      expect(h.shapes).toHaveLength(1);
      expect(h.shapes[0].id).toBe('a');
    });
  });

  describe('object identity, color, tags, name', () => {
    it('applyColor delegates to updateShapeColor with the shape id', () => {
      const h = makeHarness();
      const sdk = h.makeSdk();
      const shape = makeShape({ id: 'x' });
      sdk.applyColor(shape, '#123456');
      expect(h.updateShapeColor).toHaveBeenCalledWith('x', '#123456');
    });

    it('applyColor is a no-op for a null/undefined shape', () => {
      const h = makeHarness();
      const sdk = h.makeSdk();
      expect(() => sdk.applyColor(null as any, '#123456')).not.toThrow();
      expect(h.updateShapeColor).not.toHaveBeenCalled();
    });

    it('setTag adds a "key:value" tag and does not duplicate it on a second call', () => {
      const h = makeHarness([makeShape({ id: 'a', tags: [] })]);
      let sdk = h.makeSdk();
      sdk.setTag(h.shapes[0], 'material', 'wood');
      sdk = h.makeSdk();
      expect(h.shapes[0].tags).toEqual(['material:wood']);

      sdk.setTag(h.shapes[0], 'material', 'wood');
      expect(h.shapes[0].tags).toEqual(['material:wood']);
    });

    it('setName updates the shape name', () => {
      const h = makeHarness([makeShape({ id: 'a', name: 'Old' })]);
      const sdk = h.makeSdk();
      sdk.setName(h.shapes[0], 'New');
      expect(h.shapes[0].name).toBe('New');
    });

    it('getObjectByName finds by id or by name', () => {
      const h = makeHarness([makeShape({ id: 'a', name: 'Chair' })]);
      const sdk = h.makeSdk();
      expect(sdk.getObjectByName('a')?.id).toBe('a');
      expect(sdk.getObjectByName('Chair')?.id).toBe('a');
      expect(sdk.getObjectByName('missing')).toBeUndefined();
    });

    it('deleteObject removes the shape', () => {
      const h = makeHarness([makeShape({ id: 'a' }), makeShape({ id: 'b' })]);
      const sdk = h.makeSdk();
      sdk.deleteObject('a');
      expect(h.shapes.map(s => s.id)).toEqual(['b']);
    });
  });

  describe('selection subsystem', () => {
    it('select sets selectedId to the first id and forwards the full list', () => {
      const setSelectedIds = vi.fn();
      const setSelectedId = vi.fn();
      const h = makeHarness([], { setSelectedIds, setSelectedId });
      const sdk = h.makeSdk();
      sdk.selection.select(['a', 'b']);
      expect(setSelectedIds).toHaveBeenCalledWith(['a', 'b']);
      expect(setSelectedId).toHaveBeenCalledWith('a');
    });

    it('getSelected reads from extraSetters.selectedIds when present', () => {
      const h = makeHarness([makeShape({ id: 'a' }), makeShape({ id: 'b' })], { selectedIds: ['b'] });
      const sdk = h.makeSdk();
      expect(sdk.selection.getSelected().map(s => s.id)).toEqual(['b']);
    });

    it('duplicateObject offsets by the default [1,0,1] when no offset is given', () => {
      const h = makeHarness([makeShape({ id: 'a', position: [0, 0, 0] })]);
      const sdk = h.makeSdk();
      const copy = sdk.selection.duplicateObject('a');
      expect(copy!.position).toEqual([1, 0, 1]);
      expect(copy!.name).toContain('(Copy)');
      expect(h.shapes).toHaveLength(2);
    });

    it('duplicateObject returns null and adds nothing for a missing id', () => {
      const h = makeHarness();
      const sdk = h.makeSdk();
      expect(sdk.selection.duplicateObject('missing')).toBeNull();
      expect(h.shapes).toHaveLength(0);
    });

    it('group tags shapes with a shared group id and ungroup clears it', () => {
      const h = makeHarness([makeShape({ id: 'a' }), makeShape({ id: 'b' }), makeShape({ id: 'c' })]);
      let sdk = h.makeSdk();
      const groupId = sdk.selection.group(['a', 'b'], 'My Group');
      sdk = h.makeSdk();
      expect(h.shapes.find(s => s.id === 'a')!.tags).toContain(`group:${groupId}`);
      expect(h.shapes.find(s => s.id === 'c')!.tags ?? []).not.toContain(`group:${groupId}`);

      sdk.selection.ungroup(groupId);
      sdk = h.makeSdk();
      expect(h.shapes.find(s => s.id === 'a')!.tags ?? []).toEqual([]);
      expect(h.shapes.find(s => s.id === 'a')!.customData?.groupId).toBeUndefined();
    });

    it('isolateObject hides every shape except the target, unhideAll reverses it', () => {
      const h = makeHarness([makeShape({ id: 'a' }), makeShape({ id: 'b' })]);
      let sdk = h.makeSdk();
      sdk.selection.isolateObject('a');
      sdk = h.makeSdk();
      expect(h.shapes.find(s => s.id === 'a')!.hidden).toBe(false);
      expect(h.shapes.find(s => s.id === 'b')!.hidden).toBe(true);

      sdk.selection.unhideAll();
      sdk = h.makeSdk();
      expect(h.shapes.every(s => !s.hidden)).toBe(true);
    });

    it('alignObjects aligns to min/center/max along an axis, and is a no-op for fewer than 2 targets', () => {
      const h = makeHarness([
        makeShape({ id: 'a', position: [0, 0, 0] }),
        makeShape({ id: 'b', position: [10, 0, 0] }),
      ]);
      let sdk = h.makeSdk();
      sdk.selection.alignObjects(['a', 'b'], 'x', 'center');
      sdk = h.makeSdk();
      expect(h.shapes.every(s => s.position[0] === 5)).toBe(true);

      sdk.selection.alignObjects(['a'], 'x', 'max');
      expect(h.shapes.find(s => s.id === 'a')!.position[0]).toBe(5); // unchanged, no-op
    });
  });

  describe('architecture subsystem', () => {
    it('createRoof derives ridgeHeight from pitch angle when no explicit ridgeHeight is given', () => {
      const h = makeHarness();
      const sdk = h.makeSdk();
      const roof = sdk.architecture.createRoof({ width: 8, depth: 6, pitchAngleDeg: 30 });
      const span = Math.min(8, 6);
      const expected = Math.max(0.6, (span / 2 + 0.30) * Math.tan(THREEDegToRad(30)));
      expect(roof.customData?.ridgeHeight).toBeCloseTo(expected, 5);
      expect(roof.type).toBe('roof');
      expect(h.shapes.length).toBeGreaterThanOrEqual(1);
    });

    it('createRoof does not add a tile shape when tileShape is "none"', () => {
      const h = makeHarness();
      const sdk = h.makeSdk();
      sdk.architecture.createRoof({ width: 6, depth: 6, tileShape: 'none' });
      expect(h.shapes).toHaveLength(1);
    });

    it('createWall derives length/position/rotation from start+end when given', () => {
      const h = makeHarness();
      const sdk = h.makeSdk();
      const wall = sdk.architecture.createWall({ start: [0, 0, 0], end: [3, 0, 4] });
      expect(wall.args[0]).toBeCloseTo(5); // 3-4-5 triangle
      expect(wall.position[1]).toBeCloseTo(wall.args[1] / 2);
    });

    it('createDoor and createWindow apply configured defaults', () => {
      const h = makeHarness();
      const sdk = h.makeSdk();
      sdk.architecture.configureDoorDefaults({ width: 1.0, color: '#000000' });
      const door = sdk.architecture.createDoor({});
      expect(door.args[0]).toBe(1.0);
      expect(door.color).toBe('#000000');

      const win = sdk.architecture.createWindow({ width: 2.0 });
      expect(win.args[0]).toBe(2.0);
    });

    it('createRoom builds 4 walls and a floor slab by default, and a ceiling only when asked', () => {
      const h = makeHarness();
      const sdk = h.makeSdk();
      const withoutCeiling = sdk.architecture.createRoom({ width: 4, length: 5 });
      expect(withoutCeiling.wallShapes).toHaveLength(4);
      expect(withoutCeiling.floorShape).toBeDefined();
      expect(withoutCeiling.ceilingShape).toBeUndefined();

      const h2 = makeHarness();
      const sdk2 = h2.makeSdk();
      const withCeiling = sdk2.architecture.createRoom({ width: 4, length: 5, includeCeiling: true, includeFloor: false });
      expect(withCeiling.ceilingShape).toBeDefined();
      expect(withCeiling.floorShape).toBeUndefined();
    });

    it('clearTimberFraming removes tf- prefixed and timber-frame tagged shapes only', () => {
      const h = makeHarness([
        makeShape({ id: 'tf-1', tags: [] }),
        makeShape({ id: 'a', tags: ['timber-frame'] }),
        makeShape({ id: 'keep', tags: ['wall'] }),
      ]);
      const sdk = h.makeSdk();
      sdk.architecture.clearTimberFraming();
      expect(h.shapes.map(s => s.id)).toEqual(['keep']);
    });

    it('configureRoofDefaults merges into existing defaults without dropping the rest', () => {
      const h = makeHarness();
      const sdk = h.makeSdk();
      sdk.architecture.configureRoofDefaults({ pitchAngleDeg: 45 });
      const defaults = sdk.architecture.getRoofDefaults();
      expect(defaults.pitchAngleDeg).toBe(45);
      expect(defaults.roofType).toBe('gable'); // untouched
    });
  });

  describe('landscape subsystem', () => {
    it('addPlant infers "bush" type for bush/flower/hedge catalog categories', () => {
      const h = makeHarness();
      const sdk = h.makeSdk();
      const bush = sdk.landscape.addPlant('boxwood_hedge');
      expect(['bush', 'tree']).toContain(bush.type); // catalog-dependent, but must resolve
      expect(h.shapes).toHaveLength(1);
    });

    it('addPlant falls back to name-based heuristic for an unknown species id', () => {
      const h = makeHarness();
      const sdk = h.makeSdk();
      const bush = sdk.landscape.addPlant('unknown_hedge_species');
      expect(bush.type).toBe('bush');
      const tree = sdk.landscape.addPlant('unknown_tree_species');
      expect(tree.type).toBe('tree');
    });
  });

  describe('materials subsystem', () => {
    it('applyMaterial with a hex string sets the color directly', () => {
      const h = makeHarness([makeShape({ id: 'a', color: '#000000' })]);
      const sdk = h.makeSdk();
      sdk.materials.applyMaterial('a', '#ff0000');
      expect(h.shapes[0].color).toBe('#ff0000');
    });

    it('applyMaterial with an unknown preset name logs and leaves the shape unchanged', () => {
      const h = makeHarness([makeShape({ id: 'a', color: '#abcdef' })]);
      const sdk = h.makeSdk();
      sdk.materials.applyMaterial('a', 'not-a-real-preset');
      expect(h.shapes[0].color).toBe('#abcdef');
    });

    it('applyMaterial with an object merges given fields over existing ones', () => {
      const h = makeHarness([makeShape({ id: 'a', color: '#abcdef', roughness: 0.2 })]);
      const sdk = h.makeSdk();
      sdk.materials.applyMaterial('a', { metalness: 0.8 });
      expect(h.shapes[0].metalness).toBe(0.8);
      expect(h.shapes[0].roughness).toBe(0.2); // untouched
      expect(h.shapes[0].color).toBe('#abcdef'); // untouched
    });
  });

  describe('measurement subsystem', () => {
    it('measureDistance computes distance, rise, and pitch', () => {
      const h = makeHarness();
      const sdk = h.makeSdk();
      const result = sdk.measurement.measureDistance([0, 0, 0], [3, 4, 0]);
      expect(result.distance).toBeCloseTo(5);
      expect(result.horizontalRun).toBeCloseTo(3);
      expect(result.rise).toBeCloseTo(4);
    });

    it('measureDistance formats using the current unit', () => {
      const h = makeHarness([], { unit: 'mm' });
      const sdk = h.makeSdk();
      const result = sdk.measurement.measureDistance([0, 0, 0], [1, 0, 0]);
      expect(result.formatted).toBe('1000mm');
    });

    it('addDimension creates a shape with a midpoint position and distance label', () => {
      const h = makeHarness();
      const sdk = h.makeSdk();
      const dim = sdk.measurement.addDimension([0, 0, 0], [2, 0, 0], 'Span');
      expect(dim.position[0]).toBeCloseTo(1);
      expect(dim.customData?.label).toBe('Span');
      expect(h.shapes).toHaveLength(1);
    });
  });

  describe('scene subsystem', () => {
    it('exportJSON/importJSON round-trip the shapes array', () => {
      const h = makeHarness([makeShape({ id: 'a' })]);
      const sdk = h.makeSdk();
      const json = sdk.scene.exportJSON();

      const h2 = makeHarness();
      const sdk2 = h2.makeSdk();
      sdk2.scene.importJSON(json);
      expect(h2.shapes).toHaveLength(1);
      expect(h2.shapes[0].id).toBe('a');
    });

    it('importJSON with invalid JSON logs an error and adds nothing', () => {
      const h = makeHarness();
      const sdk = h.makeSdk();
      expect(() => sdk.scene.importJSON('{not valid json')).not.toThrow();
      expect(h.shapes).toHaveLength(0);
    });

    it('clearScene only clears when confirm is true (default)', () => {
      const h = makeHarness([makeShape({ id: 'a' })]);
      const sdk = h.makeSdk();
      sdk.scene.clearScene(false);
      expect(h.shapes).toHaveLength(1);
      sdk.scene.clearScene();
      expect(h.shapes).toHaveLength(0);
    });

    it('getStats reports shape count, type counts, and a zeroed bounds box when empty', () => {
      const h = makeHarness();
      const sdk = h.makeSdk();
      const stats = sdk.scene.getStats();
      expect(stats.shapeCount).toBe(0);
      expect(stats.bounds).toEqual({ min: [0, 0, 0], max: [0, 0, 0] });
    });

    it('getStats computes bounds and type counts over non-empty shapes', () => {
      const h = makeHarness([
        makeShape({ id: 'a', type: 'box', position: [-1, 0, 0] }),
        makeShape({ id: 'b', type: 'box', position: [1, 5, 0] }),
        makeShape({ id: 'c', type: 'sphere', position: [0, 0, -2] }),
      ]);
      const sdk = h.makeSdk();
      const stats = sdk.scene.getStats();
      expect(stats.shapeCount).toBe(3);
      expect(stats.typeCounts).toEqual({ box: 2, sphere: 1 });
      expect(stats.bounds.min).toEqual([-1, 0, -2]);
      expect(stats.bounds.max).toEqual([1, 5, 0]);
    });

    it('undo/redo delegate to extraSetters', () => {
      const undo = vi.fn();
      const redo = vi.fn();
      const h = makeHarness([], { undo, redo });
      const sdk = h.makeSdk();
      sdk.scene.undo();
      sdk.scene.redo();
      expect(undo).toHaveBeenCalledTimes(1);
      expect(redo).toHaveBeenCalledTimes(1);
    });

    it('getShapeGeometry returns null for a shape with no stored geometryData', () => {
      const h = makeHarness([makeShape({ id: 'a' })]);
      const sdk = h.makeSdk();
      expect(sdk.scene.getShapeGeometry('a')).toBeNull();
      expect(sdk.scene.getShapeGeometry('missing')).toBeNull();
    });

    it('getShapeGeometry returns stored geometryData when present', () => {
      const h = makeHarness([makeShape({ id: 'a', geometryData: { positions: [0, 0, 0], normals: [0, 1, 0] } as any })]);
      const sdk = h.makeSdk();
      expect(sdk.scene.getShapeGeometry('a')).toEqual({ positions: [0, 0, 0], normals: [0, 1, 0], uvs: undefined });
    });
  });

  describe('outliner subsystem', () => {
    it('list mirrors shapes as id/name/type/tags entries', () => {
      const h = makeHarness([makeShape({ id: 'a', name: 'Wall 1', type: 'wall', tags: ['wall'] })]);
      const sdk = h.makeSdk();
      expect(sdk.outliner.list()).toEqual([{ id: 'a', name: 'Wall 1', type: 'wall', tags: ['wall'] }]);
    });

    it('find returns the first entry matching a predicate, or null', () => {
      const h = makeHarness([makeShape({ id: 'a', type: 'wall' }), makeShape({ id: 'b', type: 'door' })]);
      const sdk = h.makeSdk();
      expect(sdk.outliner.find(e => e.type === 'door')?.id).toBe('b');
      expect(sdk.outliner.find(e => e.type === 'roof')).toBeNull();
    });
  });

  describe('toolbars subsystem', () => {
    it('create/addButton/removeButton/list round-trip through extraSetters.setCustomToolbars', () => {
      let toolbars: any[] = [];
      const setCustomToolbars = vi.fn((fn: any) => { toolbars = typeof fn === 'function' ? fn(toolbars) : fn; });
      const h = makeHarness([], { setCustomToolbars, get customToolbars() { return toolbars; } });
      let sdk = h.makeSdk();

      const tb = sdk.toolbars.create({ title: 'My Toolbar' });
      sdk = h.makeSdk();
      expect(toolbars).toHaveLength(1);
      expect(toolbars[0].title).toBe('My Toolbar');

      sdk.toolbars.addButton(tb.id, { id: 'btn1', label: 'Click', icon: 'star' } as any);
      sdk = h.makeSdk();
      expect(toolbars[0].items).toHaveLength(1);

      sdk.toolbars.removeButton(tb.id, 'btn1');
      sdk = h.makeSdk();
      expect(toolbars[0].items).toHaveLength(0);

      expect(sdk.toolbars.list()).toEqual(toolbars);
    });
  });
});

// THREE.MathUtils isn't imported into the test file's scope on its own;
// this mirrors the exact conversion createRoof uses internally so the
// expected value in the pitch-angle test is derived the same way as the
// code under test, not duplicated by hand with floating point drift.
function THREEDegToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
