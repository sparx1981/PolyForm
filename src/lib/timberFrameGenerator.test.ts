import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { generateTimberFraming, updateTimberFramesIfPresent } from './timberFrameGenerator';
import { buildRoofAssemblyForRoom } from './archRoofGenerator';
import { Shape } from '../types';
import { DEFAULT_TIMBER_FRAME_PARAMS } from '../constants/timberFrameDefaults';

describe('timberFrameGenerator - Roof Framing Precision', () => {
  it('generates accurate timber frame rafters and beams for an L-shaped Gable roof', () => {
    // Construct an L-shaped room wall polygon: 6 vertices with reflex corner at index 0
    const lShapeRoomWalls: Shape[] = [
      { id: 'w1', type: 'wall', position: [2, 1.4, 0], args: [4, 2.8, 0.2], color: '#ffffff' },
      { id: 'w2', type: 'wall', position: [4, 1.4, 3], args: [0.2, 2.8, 6], color: '#ffffff' },
      { id: 'w3', type: 'wall', position: [0, 1.4, 6], args: [8, 2.8, 0.2], color: '#ffffff' },
      { id: 'w4', type: 'wall', position: [-4, 1.4, 1], args: [0.2, 2.8, 10], color: '#ffffff' },
      { id: 'w5', type: 'wall', position: [-2, 1.4, -4], args: [4, 2.8, 0.2], color: '#ffffff' },
      { id: 'w6', type: 'wall', position: [0, 1.4, -2], args: [0.2, 2.8, 4], color: '#ffffff' },
    ];

    const roofAssembly = buildRoofAssemblyForRoom(lShapeRoomWalls, {
      roofType: 'gable',
      pitchAngleDeg: 35,
      eaveOverhang: 0.35,
      fasciaHeight: 0.18,
    });

    expect(roofAssembly).toBeDefined();
    if (!roofAssembly) return;

    const allShapes = [...lShapeRoomWalls, roofAssembly.roofShape];
    const frameResult = generateTimberFraming(allShapes, {
      includeRoof: true,
      includeWalls: false,
      includeFloors: false,
      studSpacing: 0.40,
    });

    expect(frameResult.roofRafterCount).toBeGreaterThan(10);

    const members = frameResult.shapes;
    
    // Check for Valley Rafter
    const valleyRafter = members.find(s => s.tags?.includes('timber-valley-rafter') || s.name?.includes('Valley Rafter'));
    expect(valleyRafter).toBeDefined();

    // Check for Outer Hip Rafter
    const hipRafter = members.find(s => s.tags?.includes('timber-hip-rafter') || s.name?.includes('Hip Rafter'));
    expect(hipRafter).toBeDefined();

    // Check for Ridge Beams
    const ridgeBeams = members.filter(s => s.tags?.includes('timber-ridge-beam') || s.name?.includes('Ridge Beam'));
    expect(ridgeBeams.length).toBeGreaterThanOrEqual(2);

    // Check for Valley Jack Rafters
    const valleyJackRafters = members.filter(s => s.tags?.includes('timber-valley-jack-rafter') || s.name?.includes('Valley Jack'));
    expect(valleyJackRafters.length).toBeGreaterThan(0);

    // Check for Rake / Bargeboard Rafters at gable ends
    const rakeRafters = members.filter(s => s.tags?.includes('timber-rake-rafter') || s.name?.includes('Rake Rafter'));
    expect(rakeRafters.length).toBeGreaterThanOrEqual(4);

    // Ensure no members are placed outside the building envelope in the empty courtyard/cutout
    // The courtyard void is at x > 0 and z < 0 (i.e. x in [0.5, 3.5] and z in [-3.5, -0.5])
    const voidMembers = members.filter(s => {
      const [x, , z] = s.position;
      return x > 0.8 && x < 3.5 && z > -3.5 && z < -0.8;
    });
    expect(voidMembers.length).toBe(0);
  });

  it('generates accurate timber frame members for an L-shaped Hip roof', () => {
    const lShapeRoomWalls: Shape[] = [
      { id: 'w1', type: 'wall', position: [2, 1.4, 0], args: [4, 2.8, 0.2], color: '#ffffff' },
      { id: 'w2', type: 'wall', position: [4, 1.4, 3], args: [0.2, 2.8, 6], color: '#ffffff' },
      { id: 'w3', type: 'wall', position: [0, 1.4, 6], args: [8, 2.8, 0.2], color: '#ffffff' },
      { id: 'w4', type: 'wall', position: [-4, 1.4, 1], args: [0.2, 2.8, 10], color: '#ffffff' },
      { id: 'w5', type: 'wall', position: [-2, 1.4, -4], args: [4, 2.8, 0.2], color: '#ffffff' },
      { id: 'w6', type: 'wall', position: [0, 1.4, -2], args: [0.2, 2.8, 4], color: '#ffffff' },
    ];

    const roofAssembly = buildRoofAssemblyForRoom(lShapeRoomWalls, {
      roofType: 'hip',
      pitchAngleDeg: 35,
      eaveOverhang: 0.35,
      fasciaHeight: 0.18,
    });

    expect(roofAssembly).toBeDefined();
    if (!roofAssembly) return;

    const allShapes = [...lShapeRoomWalls, roofAssembly.roofShape];
    const frameResult = generateTimberFraming(allShapes, {
      includeRoof: true,
      includeWalls: false,
      includeFloors: false,
    });

    const members = frameResult.shapes;
    const hipRafters = members.filter(s => s.tags?.includes('timber-hip-rafter'));
    expect(hipRafters.length).toBeGreaterThanOrEqual(5); // Outside hip + 4 wing hip ends

    const hipJackRafters = members.filter(s => s.tags?.includes('timber-hip-jack-rafter'));
    expect(hipJackRafters.length).toBeGreaterThan(0);
  });

  it('generates accurate timber framing for rectangular gable and hip roofs', () => {
    const rectWalls: Shape[] = [
      { id: 'w1', type: 'wall', position: [0, 1.4, -3], args: [8, 2.8, 0.2], color: '#ffffff' },
      { id: 'w2', type: 'wall', position: [4, 1.4, 0], args: [0.2, 2.8, 6], color: '#ffffff' },
      { id: 'w3', type: 'wall', position: [0, 1.4, 3], args: [8, 2.8, 0.2], color: '#ffffff' },
      { id: 'w4', type: 'wall', position: [-4, 1.4, 0], args: [0.2, 2.8, 6], color: '#ffffff' },
    ];

    const gableAssembly = buildRoofAssemblyForRoom(rectWalls, {
      roofType: 'gable',
      pitchAngleDeg: 30,
    });

    expect(gableAssembly).toBeDefined();
    if (!gableAssembly) return;

    const gableResult = generateTimberFraming([...rectWalls, gableAssembly.roofShape], {
      includeRoof: true,
      includeWalls: false,
      includeFloors: false,
    });

    expect(gableResult.roofRafterCount).toBeGreaterThan(10);
    const gableRidge = gableResult.shapes.find(s => s.tags?.includes('timber-ridge-beam'));
    expect(gableRidge).toBeDefined();
  });

  it('correctly updates timber framing when shapes change with updateTimberFramesIfPresent', () => {
    const rectWalls: Shape[] = [
      { id: 'w1', type: 'wall', position: [0, 1.4, -3], args: [8, 2.8, 0.2], color: '#ffffff' },
      { id: 'w2', type: 'wall', position: [4, 1.4, 0], args: [0.2, 2.8, 6], color: '#ffffff' },
      { id: 'w3', type: 'wall', position: [0, 1.4, 3], args: [8, 2.8, 0.2], color: '#ffffff' },
      { id: 'w4', type: 'wall', position: [-4, 1.4, 0], args: [0.2, 2.8, 6], color: '#ffffff' },
    ];

    const initialResult = generateTimberFraming(rectWalls, { includeWalls: true, includeRoof: false });
    const shapesWithTimber = [...rectWalls, ...initialResult.shapes];

    // Add a door to one wall
    const doorShape: Shape = {
      id: 'd1',
      type: 'door',
      position: [0, 1.05, -3],
      args: [0.9, 2.1, 0.1],
      hostWallId: 'w1',
      color: '#475569',
    };

    const updatedShapes = updateTimberFramesIfPresent([...shapesWithTimber, doorShape]);
    const timberCount = updatedShapes.filter(s => s.tags?.includes('timber-frame')).length;
    expect(timberCount).toBeGreaterThan(0);
  });

  it('clips floor framing strictly within the room footprint polygon without extending past walls', () => {
    // Construct an L-shaped room wall layout
    const lShapeRoomWalls: Shape[] = [
      { id: 'w1', type: 'wall', position: [2, 1.4, 0], args: [4, 2.8, 0.2], color: '#ffffff' },
      { id: 'w2', type: 'wall', position: [4, 1.4, 3], args: [0.2, 2.8, 6], color: '#ffffff' },
      { id: 'w3', type: 'wall', position: [0, 1.4, 6], args: [8, 2.8, 0.2], color: '#ffffff' },
      { id: 'w4', type: 'wall', position: [-4, 1.4, 1], args: [0.2, 2.8, 10], color: '#ffffff' },
      { id: 'w5', type: 'wall', position: [-2, 1.4, -4], args: [4, 2.8, 0.2], color: '#ffffff' },
      { id: 'w6', type: 'wall', position: [0, 1.4, -2], args: [0.2, 2.8, 4], color: '#ffffff' },
    ];

    const floorResult = generateTimberFraming(lShapeRoomWalls, {
      includeFloors: true,
      includeWalls: false,
      includeRoof: false,
      studSpacing: 0.40,
    });

    expect(floorResult.floorJoistCount).toBeGreaterThan(5);

    // Ensure NO floor joists or rim members are placed in the outside courtyard void
    // The courtyard void is at x > 0 and z < 0 (i.e. x in [0.5, 3.5] and z in [-3.5, -0.5])
    const voidMembers = floorResult.shapes.filter(s => {
      const [x, , z] = s.position;
      return x > 0.8 && x < 3.5 && z > -3.5 && z < -0.8;
    });
    expect(voidMembers.length).toBe(0);
  });

  it('preserves user hidden state and respects deletions when updating timber frames', () => {
    const rectWalls: Shape[] = [
      { id: 'w1', type: 'wall', position: [0, 1.4, -3], args: [8, 2.8, 0.2], color: '#ffffff' },
      { id: 'w2', type: 'wall', position: [4, 1.4, 0], args: [0.2, 2.8, 6], color: '#ffffff' },
      { id: 'w3', type: 'wall', position: [0, 1.4, 3], args: [8, 2.8, 0.2], color: '#ffffff' },
      { id: 'w4', type: 'wall', position: [-4, 1.4, 0], args: [0.2, 2.8, 6], color: '#ffffff' },
    ];

    const initialResult = generateTimberFraming(rectWalls, { includeWalls: true, includeRoof: false, includeFloors: true });
    // User hides the floor joists
    const shapesWithHiddenFloors = [...rectWalls, ...initialResult.shapes.map(s => s.tags?.includes('timber-floor-joist') ? { ...s, hidden: true } : s)];

    // When architecture has not changed, calling updateTimberFramesIfPresent retains all shapes unchanged
    const unchangedResult = updateTimberFramesIfPresent(shapesWithHiddenFloors);
    const hiddenFloorCount = unchangedResult.filter(s => s.tags?.includes('timber-floor-joist') && s.hidden).length;
    expect(hiddenFloorCount).toBeGreaterThan(0);
  });

  it('frames an opening centered mid-wall with jacks, kings, header, sill, and omitted studs', () => {
    const wall: Shape = {
      id: 'w1',
      type: 'wall',
      position: [0, 1.4, 0],
      args: [6.0, 2.8, 0.2],
      color: '#ffffff'
    };
    const windowShape: Shape = {
      id: 'win1',
      type: 'window',
      position: [0, 1.4, 0],
      args: [1.2, 1.2, 0.1],
      hostWallId: 'w1',
      color: '#38bdf8'
    };

    const res = generateTimberFraming([wall, windowShape], {
      includeWalls: true,
      includeFloors: false,
      includeRoof: false,
      studSpacing: 0.40,
    });

    // Check jack studs exist
    const jackStuds = res.shapes.filter(s => s.tags?.includes('timber-jack-stud'));
    expect(jackStuds.length).toBeGreaterThanOrEqual(2);

    // Check king studs exist
    const kingStuds = res.shapes.filter(s => s.tags?.includes('timber-king-stud'));
    expect(kingStuds.length).toBeGreaterThanOrEqual(2);

    // Check header exists
    const header = res.shapes.find(s => s.tags?.includes('timber-lintel'));
    expect(header).toBeDefined();

    // Check sill exists
    const sill = res.shapes.find(s => s.tags?.includes('timber-sill'));
    expect(sill).toBeDefined();

    // Check common studs do not fall within the window bounds (x in [-0.5, 0.5])
    const studsInWindow = res.shapes.filter(s => {
      if (!s.tags?.includes('timber-stud')) return false;
      const x = s.position[0];
      return x > -0.5 && x < 0.5;
    });
    expect(studsInWindow.length).toBe(0);

    // Verify openingAssemblies output
    expect(res.openingAssemblies).toBeDefined();
    expect(res.openingAssemblies.length).toBe(1);
    expect(res.openingAssemblies[0].spanMm).toBe(1200);
  });

  it('frames an opening flush against a corner without placing studs outside the wall boundary', () => {
    const wall: Shape = {
      id: 'w1',
      type: 'wall',
      position: [0, 1.4, 0],
      args: [6.0, 2.8, 0.2],
      color: '#ffffff'
    };
    // Door placed near the left edge: wall extends from -3 to +3
    // Door centered at -2.4 with width 0.9 => left edge at -2.85 (flush to corner)
    const doorShape: Shape = {
      id: 'd1',
      type: 'door',
      position: [-2.4, 1.05, 0],
      args: [0.9, 2.1, 0.1],
      hostWallId: 'w1',
      color: '#475569'
    };

    const res = generateTimberFraming([wall, doorShape], {
      includeWalls: true,
      includeFloors: false,
      includeRoof: false,
    });

    // None of the generated shapes should exceed the wall's outer bounds [-3.05, 3.05]
    res.shapes.forEach(s => {
      const x = s.position[0];
      expect(x).toBeGreaterThanOrEqual(-3.05);
      expect(x).toBeLessThanOrEqual(3.05);
    });

    // Check header and jack studs are formed safely
    const header = res.shapes.find(s => s.tags?.includes('timber-lintel'));
    expect(header).toBeDefined();
  });

  it('detects colliding jack studs between two adjacent openings and produces validation message without crashing', () => {
    const wall: Shape = {
      id: 'w1',
      type: 'wall',
      position: [0, 1.4, 0],
      args: [6.0, 2.8, 0.2],
      color: '#ffffff'
    };
    // Two windows with only 40mm between them (jack stud width is 45mm, so they collide)
    const win1: Shape = {
      id: 'win1',
      type: 'window',
      position: [-0.6, 1.4, 0],
      args: [1.0, 1.2, 0.1],
      color: '#ffffff',
      hostWallId: 'w1',
    };
    const win2: Shape = {
      id: 'win2',
      type: 'window',
      position: [0.45, 1.4, 0], // win1 right = -0.1, win2 left = -0.05 => gap = 0.05m (50mm < 90mm needed)
      args: [1.0, 1.2, 0.1],
      color: '#ffffff',
      hostWallId: 'w1',
    };

    const res = generateTimberFraming([wall, win1, win2], {
      includeWalls: true,
      includeFloors: false,
      includeRoof: false,
    });

    expect(res.validationMessages).toBeDefined();
    expect(res.validationMessages.length).toBeGreaterThan(0);
    expect(res.validationMessages[0]).toMatch(/collid|closer than/i);
  });

  it('applies revealDistance as an inward offset along the wall surface normal', () => {
    const wall: Shape = {
      id: 'w1',
      type: 'wall',
      position: [0, 1.4, 0],
      args: [4.0, 2.8, 0.2], // wall depth = 0.2, half-depth = 0.1
      color: '#ffffff'
    };

    const resZero = generateTimberFraming([wall], {
      includeWalls: true,
      includeFloors: false,
      includeRoof: false,
      params: { ...DEFAULT_TIMBER_FRAME_PARAMS, revealDistance: 0 }
    });

    const resInset = generateTimberFraming([wall], {
      includeWalls: true,
      includeFloors: false,
      includeRoof: false,
      params: { ...DEFAULT_TIMBER_FRAME_PARAMS, revealDistance: 0.025 }
    });

    const studZero = resZero.shapes.find(s => s.tags?.includes('timber-stud'));
    const studInset = resInset.shapes.find(s => s.tags?.includes('timber-stud'));

    expect(studZero).toBeDefined();
    expect(studInset).toBeDefined();
    if (studZero && studInset) {
      // With revealDistance = 0.025, the localZ shifts by -0.025
      expect(studInset.position[2]).toBeLessThan(studZero.position[2]);
      expect(studZero.position[2] - studInset.position[2]).toBeCloseTo(0.025, 4);
    }
  });

  it('populates instancedMembers for member kinds in TimberFramingResult', () => {
    const wall: Shape = {
      id: 'w1',
      type: 'wall',
      position: [0, 1.4, 0],
      args: [4.0, 2.8, 0.2],
      color: '#ffffff'
    };
    const win: Shape = {
      id: 'win1',
      type: 'window',
      position: [0, 1.4, 0],
      args: [1.0, 1.2, 0.1],
      color: '#ffffff',
      hostWallId: 'w1',
    };

    const res = generateTimberFraming([wall, win], {
      includeWalls: true,
      includeFloors: false,
      includeRoof: false,
    });

    expect(res.instancedMembers).toBeDefined();
    expect(res.instancedMembers.stud.length).toBeGreaterThan(0);
    expect(res.instancedMembers.plate.length).toBeGreaterThan(0);
    expect(res.instancedMembers.jackStud.length).toBeGreaterThan(0);
    expect(res.instancedMembers.header.length).toBeGreaterThan(0);
    expect(res.instancedMembers.sill.length).toBeGreaterThan(0);
  });
});
