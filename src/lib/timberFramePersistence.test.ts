import { describe, it, expect } from 'vitest';
import { Shape, TimberFrameParams, OpeningFrameAssembly } from '../types';
import { DEFAULT_TIMBER_FRAME_PARAMS } from '../constants/timberFrameDefaults';

describe('Timber Frame Persistence & Blueprint Schema Compliance', () => {
  it('preserves timberFrame object metadata on framed wall/roof shapes', () => {
    const openingAssembly: OpeningFrameAssembly = {
      openingId: 'door-1',
      headerMemberIds: ['tf-header-1', 'tf-header-2'],
      sillMemberIds: null,
      jackStudMemberIds: ['tf-jack-1', 'tf-jack-2'],
      kingStudMemberIds: ['tf-king-1', 'tf-king-2'],
      isValid: true,
      validationMessages: [],
      hostWallId: 'wall-101',
      headerDepth: 0.184,
      spanMm: 914,
      headerDepthMm: 184
    };

    const wallShape: Shape = {
      id: 'wall-101',
      name: 'Wall 101',
      type: 'wall',
      position: [0, 1.4, 0],
      args: [5, 2.8, 0.2],
      color: '#ffffff',
      timberFrame: {
        params: { ...DEFAULT_TIMBER_FRAME_PARAMS },
        openingAssemblies: [openingAssembly],
        lastComputedAt: new Date().toISOString()
      }
    };

    expect(wallShape.timberFrame).toBeDefined();
    expect(wallShape.timberFrame?.params.studSpacing).toBe(DEFAULT_TIMBER_FRAME_PARAMS.studSpacing);
    expect(wallShape.timberFrame?.openingAssemblies).toHaveLength(1);
    expect(wallShape.timberFrame?.openingAssemblies?.[0].openingId).toBe('door-1');
    expect(typeof wallShape.timberFrame?.lastComputedAt).toBe('string');
  });

  it('cleanData strips undefined fields while keeping valid timberFrame fields', () => {
    const cleanData = (obj: any): any => {
      if (Array.isArray(obj)) return obj.map(cleanData);
      if (obj !== null && typeof obj === 'object') {
        return Object.entries(obj).reduce((acc: any, [key, value]) => {
          if (value !== undefined) acc[key] = cleanData(value);
          return acc;
        }, {});
      }
      return obj;
    };

    const payload = {
      id: 'wall-1',
      type: 'wall',
      position: [0, 0, 0],
      color: '#ffffff',
      timberFrame: {
        params: {
          studSpacing: 0.4,
          memberWidth: 0.038,
          memberDepth: 0.14,
          species: 'SPF',
          grade: 'No. 2',
          headerDepthRule: 'code-table',
          revealDistance: 0.02,
          advancedModeEnabled: true,
          optionalUndefinedField: undefined
        },
        openingAssemblies: [],
        lastComputedAt: '2026-09-07T12:00:00.000Z'
      }
    };

    const cleaned = cleanData(payload);
    expect(cleaned.timberFrame.params.studSpacing).toBe(0.4);
    expect(cleaned.timberFrame.params.optionalUndefinedField).toBeUndefined();
    expect(Object.keys(cleaned.timberFrame.params)).not.toContain('optionalUndefinedField');
    expect(cleaned.timberFrame.lastComputedAt).toBe('2026-09-07T12:00:00.000Z');
  });

  it('generates and updates timber framing for building elements with matching functionality', async () => {
    const { generateTimberFrameForBuilding } = await import('./timberFrameGenerator');

    const testWall: Shape = {
      id: 'wall-1',
      name: 'Wall 1',
      type: 'wall',
      position: [0, 1.4, 0],
      args: [4, 2.8, 0.2],
      color: '#ffffff'
    };

    const initialResult = generateTimberFrameForBuilding([testWall], {
      studSpacing: 0.40,
      joistSpacing: 0.40,
      rafterSpacing: 0.60
    });

    expect(initialResult.members.length).toBeGreaterThan(0);
    expect(initialResult.wallCount).toBeGreaterThan(0);

    // Simulate regenerate when existing timber framing is present
    const existingTimber = initialResult.members;
    const existingIds = new Set(existingTimber.map(t => t.id));
    const remainingShapes = [testWall, ...existingTimber].filter(s => !existingIds.has(s.id));

    expect(remainingShapes).toHaveLength(1);
    expect(remainingShapes[0].id).toBe('wall-1');

    const updatedResult = generateTimberFrameForBuilding(remainingShapes, {
      studSpacing: 0.60,
      joistSpacing: 0.40,
      rafterSpacing: 0.60
    });

    expect(updatedResult.members.length).toBeGreaterThan(0);
  });

  it('hiding wall(s) in the outliner does not hide or remove any existing timber frame', async () => {
    const { generateTimberFraming, updateTimberFramesIfPresent } = await import('./timberFrameGenerator');

    const wall: Shape = {
      id: 'wall-hide-test-1',
      name: 'South Wall',
      type: 'wall',
      position: [0, 1.4, 0],
      args: [4.0, 2.8, 0.2],
      color: '#ffffff',
      tags: ['story-1', 'architecture', 'wall-assembly']
    };

    // 1. Generate timber frame initially
    const result = generateTimberFraming([wall], {
      includeWalls: true,
      includeFloors: false,
      includeRoof: false,
      studSpacing: 0.40
    });

    expect(result.shapes.length).toBeGreaterThan(0);
    const initialMemberCount = result.shapes.length;

    // All initial timber members are visible
    expect(result.shapes.every(s => !s.hidden)).toBe(true);

    // 2. User hides the wall in the Outliner (wall.hidden = true)
    const hiddenWall: Shape = { ...wall, hidden: true };
    const allShapesAfterWallHidden = [hiddenWall, ...result.shapes];

    // Verify updateTimberFramesIfPresent does not remove or hide timber members
    const nextShapes = updateTimberFramesIfPresent(allShapesAfterWallHidden);
    const timberAfterWallHidden = nextShapes.filter(s => s.tags?.includes('timber-frame') || s.id.startsWith('tf-'));

    expect(timberAfterWallHidden.length).toBe(initialMemberCount);
    // Timber members must NOT be hidden
    expect(timberAfterWallHidden.every(s => !s.hidden)).toBe(true);

    // 3. Verify generateTimberFraming works even if wall is already hidden
    const regeneratedFromHiddenWall = generateTimberFraming([hiddenWall], {
      includeWalls: true,
      includeFloors: false,
      includeRoof: false,
      studSpacing: 0.40
    });
    expect(regeneratedFromHiddenWall.shapes.length).toBe(initialMemberCount);
    expect(regeneratedFromHiddenWall.shapes.every(s => !s.hidden)).toBe(true);

    // 4. Verify Outliner wall grouping excludes timber framing members
    const outlinerWallShapes = allShapesAfterWallHidden.filter(s =>
      (s.type === 'wall' || s.tags?.includes('wall-assembly')) &&
      !s.tags?.includes('timber-frame') &&
      !s.tags?.includes('timber-framing') &&
      !s.name?.toLowerCase().startsWith('timber ') &&
      !s.id.startsWith('tf-')
    );
    expect(outlinerWallShapes).toHaveLength(1);
    expect(outlinerWallShapes[0].id).toBe('wall-hide-test-1');
  });

  it('supports default reset parameters and offset joists toggle', async () => {
    const { DEFAULT_TIMBER_FRAME_PARAMS } = await import('../constants/timberFrameDefaults');
    const { generateTimberFrameForBuilding } = await import('./timberFrameGenerator');

    // 1. Verify defaults
    expect(DEFAULT_TIMBER_FRAME_PARAMS.studSpacing).toBe(0.40);
    expect(DEFAULT_TIMBER_FRAME_PARAMS.memberWidth).toBe(0.045);
    expect(DEFAULT_TIMBER_FRAME_PARAMS.memberDepth).toBe(0.140);
    expect(DEFAULT_TIMBER_FRAME_PARAMS.offsetFloorJoists).toBe(false);
    expect(DEFAULT_TIMBER_FRAME_PARAMS.offsetWallJoists).toBe(false);

    // 2. Test floor framing with offsetFloorJoists enabled
    const slab: Shape = {
      id: 'slab-1',
      name: 'Floor Slab',
      type: 'box',
      tags: ['floor-slab'],
      position: [0, 0, 0],
      args: [4, 0.2, 5],
      color: '#cccccc'
    };

    const regularFloorResult = generateTimberFrameForBuilding([slab], {
      includeFloors: true,
      offsetFloorJoists: false
    });

    const offsetFloorResult = generateTimberFrameForBuilding([slab], {
      includeFloors: true,
      offsetFloorJoists: true
    });

    expect(regularFloorResult.members.length).toBeGreaterThan(0);
    expect(offsetFloorResult.members.length).toBeGreaterThan(0);
    expect(offsetFloorResult.members.some(m => m.name.includes('Offset'))).toBe(true);

    // 3. Test wall framing with offsetWallJoists enabled
    const wall: Shape = {
      id: 'wall-offset-test',
      name: 'Wall Long',
      type: 'wall',
      position: [0, 1.4, 0],
      args: [4.0, 2.8, 0.2],
      color: '#ffffff'
    };

    const regularWallResult = generateTimberFrameForBuilding([wall], {
      includeWalls: true,
      offsetWallJoists: false
    });

    const offsetWallResult = generateTimberFrameForBuilding([wall], {
      includeWalls: true,
      offsetWallJoists: true
    });

    expect(regularWallResult.members.length).toBeGreaterThan(0);
    expect(offsetWallResult.members.length).toBeGreaterThan(0);
    expect(offsetWallResult.members.some(m => m.name.includes('Offset'))).toBe(true);
  });
});
