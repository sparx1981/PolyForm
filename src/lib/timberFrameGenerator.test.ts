import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { generateTimberFraming, generateTimberFrameForRoof, updateTimberFramesIfPresent } from './timberFrameGenerator';
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

    // The L-shape branch used to pass the raw ridge nodes (which sit
    // exactly ON the theoretical ridge line, at ridgeHeight) straight into
    // addBeamSegment. Since a ridge beam isn't tagged "rafter", it only
    // got the small fixed revealDistance inset (~2.5cm) instead of the
    // rafter-style half-depth inset, leaving roughly half the beam's own
    // 22cm thickness sticking up through the roof surface above it - the
    // ridge-line clash reported after the previous timber-frame fix.
    // ridgeHeight here is 2.0 (buildRoofAssemblyForRoom's default, since
    // this call doesn't set usePitchAngle/ridgeHeight explicitly), and the
    // walls sit at y=1.4 with height 2.8, so the wall top / roof base is
    // at world y=2.8 and the true ridge apex at 2.8 + 2.0 = 4.8.
    for (const beam of ridgeBeams) {
      expect(beam.position[1]).toBeLessThan(4.8 - 0.08);
    }

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

    // Both wings of the L must get comparable common-rafter coverage.
    // getCanonicalLPolygon rotates the room's own wall winding to start at
    // the reflex corner without normalizing which direction each wing
    // points - a signed-distance bug in the old loop meant whichever wing's
    // far end happened to lie at a LOWER x/z than the reflex corner got a
    // loop that started past its own bound and produced zero rafters,
    // leaving that wing's roof with only the ridge/valley/hip rafters and
    // none of the intermediate common rafters actually holding the roof
    // surface up.
    const wing1Rafters = members.filter(s => s.name?.includes('Common Rafter (Wing 1'));
    const wing2Rafters = members.filter(s => s.name?.includes('Common Rafter (Wing 2'));
    expect(wing1Rafters.length).toBeGreaterThan(5);
    expect(wing2Rafters.length).toBeGreaterThan(5);

    // Roof noggins (blocking between adjacent rafters) and collar ties
    // (a strut across each rafter pair) previously didn't exist anywhere
    // in the roof framing - both are now generated per wing.
    const collarTies = members.filter(s => s.tags?.includes('timber-collar-tie'));
    const roofNoggins = members.filter(s => s.tags?.includes('timber-roof-noggin'));
    expect(collarTies.length).toBeGreaterThan(0);
    expect(roofNoggins.length).toBeGreaterThan(0);

    // The new collar ties and noggins must not spill into the courtyard
    // void either.
    const newMembersInVoid = [...collarTies, ...roofNoggins].filter(s => {
      const [x, , z] = s.position;
      return x > 0.8 && x < 3.5 && z > -3.5 && z < -0.8;
    });
    expect(newMembersInVoid.length).toBe(0);
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

    // Both wings' common rafters and hip-setback jack rafters, checked
    // separately - a winding-direction bug in the old code could zero out
    // one wing's common rafters (§7) or hip-setback jacks (§8A)
    // independently of the other, so an aggregate >0 check across both
    // wings combined wouldn't have caught either.
    const wing1Rafters = members.filter(s => s.name?.includes('Common Rafter (Wing 1'));
    const wing2Rafters = members.filter(s => s.name?.includes('Common Rafter (Wing 2'));
    expect(wing1Rafters.length).toBeGreaterThan(0);
    expect(wing2Rafters.length).toBeGreaterThan(0);

    const wing1ValleyHipJacks = members.filter(s => s.name?.includes('Jack Rafter (Wing 1 Valley Hip)'));
    const wing2ValleyHipJacks = members.filter(s => s.name?.includes('Jack Rafter (Wing 2 Valley Hip)'));
    expect(wing1ValleyHipJacks.length).toBeGreaterThan(0);
    expect(wing2ValleyHipJacks.length).toBeGreaterThan(0);
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

  describe('Roof/timber-frame reliability fixes (rafter clearance, roofData as source of truth, eave overhang, recompute on roofData change)', () => {
    const rectRoof = (overrides: Partial<Shape> = {}): Shape => ({
      id: 'roof1',
      name: 'Rect Gable Roof',
      type: 'roof',
      position: [0, 0, 0],
      args: [6, 2.4, 6],
      color: '#a85a44',
      roofData: { ridgeHeight: 2.4, eaveOverhang: 0.3 },
      ...overrides,
    });

    it('never treats a window as a roof, even one mis-named with a roof-referencing name', () => {
      // A window hosted on any roof-tagged shape (e.g. a Gable Pediment)
      // used to be named "Velux Roof Window" regardless of its actual
      // style, and the roof-shape filter matched on a "roof" substring in
      // the name - so the window itself got treated as an extra roof and
      // framed accordingly. Excluding window/door types outright is the
      // fix that holds regardless of what the shape happens to be named,
      // including already-saved models still carrying the old bad name.
      const roof = rectRoof();
      const strayWindow: Shape = {
        id: 'w-bad-name',
        name: 'Velux Roof Window',
        type: 'window',
        position: [0, 1, 0],
        args: [0.8, 0.8, 0.14],
        color: '#ffffff',
        archStyle: 'porthole',
      };
      const withoutWindow = generateTimberFraming([roof], { includeRoof: true, includeWalls: false, includeFloors: false });
      const withWindow = generateTimberFraming([roof, strayWindow], { includeRoof: true, includeWalls: false, includeFloors: false });
      expect(withWindow.roofRafterCount).toBe(withoutWindow.roofRafterCount);
    });

    it('reads roof height from roofData.ridgeHeight, not a stale args[1]', () => {
      // args[1] intentionally disagrees with roofData.ridgeHeight - only
      // one of them can be the "real" roof height, and it must be
      // roofData.ridgeHeight (the value archRoofGenerator.ts itself uses
      // to build the visible roof mesh), not the compact args tuple which
      // nothing enforces staying in sync with it.
      const roof = rectRoof({ args: [6, 999, 6], roofData: { ridgeHeight: 2.4, eaveOverhang: 0.3 } });
      const members = generateTimberFrameForRoof(roof, []);
      const ridgeBeam = members.find(s => s.tags?.includes('timber-ridge-beam'));
      expect(ridgeBeam).toBeDefined();
      // Ridge beam sits just below the apex (roofH - ridgeBeamDepth/2);
      // if it had used args[1]=999 this would be nowhere close to 2.4.
      expect(ridgeBeam!.position[1]).toBeGreaterThan(1.5);
      expect(ridgeBeam!.position[1]).toBeLessThan(2.4);
    });

    it('extends common-rafter eave endpoints by eaveOverhang, matching the actual roof mesh', () => {
      const smallOverhang = generateTimberFrameForRoof(rectRoof({ roofData: { ridgeHeight: 2.4, eaveOverhang: 0.1 } }), []);
      const bigOverhang = generateTimberFrameForRoof(rectRoof({ roofData: { ridgeHeight: 2.4, eaveOverhang: 1.0 } }), []);

      const smallRafter = smallOverhang.find(s => s.name?.includes('Common Rafter (Front)'));
      const bigRafter = bigOverhang.find(s => s.name?.includes('Common Rafter (Front)'));
      expect(smallRafter).toBeDefined();
      expect(bigRafter).toBeDefined();

      // args[2] is the member's span (its length) - a bigger eave overhang
      // must produce a longer common rafter. Before this fix, eaveOverhang
      // was ignored entirely for rectangular roofs and both spans would be
      // identical regardless of the overhang setting.
      expect(bigRafter!.args[2]).toBeGreaterThan(smallRafter!.args[2]);
    });

    it('insets rafter members below the theoretical roof surface by at least half their own depth', () => {
      const roof = rectRoof();
      const members = generateTimberFrameForRoof(roof, []);
      const rafter = members.find(s => s.name?.includes('Common Rafter (Front)'));
      expect(rafter).toBeDefined();

      // Theoretical (un-inset) midpoint of this rafter's run, from apex
      // (currX, roofH, 0) to the eave point (currX, 0, halfD + eaveOverhang):
      // halfD = 3, eaveOverhang = 0.3 -> eave Z = 3.3.
      const roofH = 2.4;
      const eaveZ = 3 + 0.3;
      const theoreticalMid = new THREE.Vector3(rafter!.position[0], roofH / 2, eaveZ / 2);
      const actualPos = new THREE.Vector3(...rafter!.position);
      const insetDistance = theoreticalMid.distanceTo(actualPos);

      // rafterDepth is 0.145m (half = 0.0725m); the old behavior only
      // inset by revealDistance (0.025m default), leaving ~0.0475m of the
      // rafter's outer face above the theoretical roof surface.
      expect(insetDistance).toBeGreaterThan(0.08);
    });

    it('keeps rafter geometry finite and sane for a very small room at the minimum roof height', () => {
      // Boundary case: a tiny 1.5m x 1.5m room at the 0.60m ridge-height
      // floor archRoofGenerator.ts clamps to. The rafter inset (reveal +
      // half depth) is a large fraction of this roof's total rise, so
      // without a clamp relative to the member's own span it could pull
      // the rafter's center to an implausible/degenerate position.
      const smallRoof = rectRoof({ args: [1.5, 0.6, 1.5], roofData: { ridgeHeight: 0.6, eaveOverhang: 0.3 } });
      const members = generateTimberFrameForRoof(smallRoof, []);
      const rafter = members.find(s => s.name?.includes('Common Rafter (Front)'));
      expect(rafter).toBeDefined();
      if (!rafter) return;

      for (const v of rafter.position) expect(Number.isFinite(v)).toBe(true);
      for (const v of rafter.args as number[]) expect(Number.isFinite(v)).toBe(true);
      // The rafter must stay within the roof's own vertical envelope -
      // above the wall top (y=0 in this local roof space) and at or below
      // the ridge height, never inset past either boundary.
      expect(rafter.position[1]).toBeGreaterThanOrEqual(0);
      expect(rafter.position[1]).toBeLessThanOrEqual(0.6);
      expect((rafter.args as number[])[2]).toBeGreaterThan(0);
    });

    it('insets roof noggins below the theoretical roof surface, same as rafters', () => {
      // Roof noggins connect two adjacent rafters' own (un-inset) surface
      // points at mid-span - since a noggin isn't tagged "rafter", it only
      // got the small fixed revealDistance inset instead of the deeper
      // rafter-style inset, leaving it sitting almost exactly on the
      // theoretical roof surface (unlike the rafters on either side of
      // it, which are properly tucked underneath).
      const roof = rectRoof();
      const members = generateTimberFrameForRoof(roof, []);
      const noggin = members.find(s => s.tags?.includes('timber-roof-noggin'));
      expect(noggin).toBeDefined();

      const rafter = members.find(s => s.name?.includes('Common Rafter (Front)'));
      expect(rafter).toBeDefined();

      // A properly-inset noggin should sit close to its neighboring
      // rafters' own (also inset) height, not up near the raw surface -
      // the rafter's own regression test above already establishes an
      // un-inset vs. inset gap of 0.08m+, so a noggin within that same
      // tolerance of its neighbor rafter confirms it got the same
      // treatment rather than sitting nearly on the raw surface.
      expect(Math.abs(noggin!.position[1] - rafter!.position[1])).toBeLessThan(0.03);
    });

    it('recomputes roof timber framing when only roofData changes (eaveOverhang), not just args', () => {
      // A host wall alongside the roof, matching how a real scene is
      // assembled - without it, getArchFingerprint's roof-detection filter
      // is the only thing under test here, and a roof-less fixture can
      // pass for the wrong reason (fingerprint always "" regardless of
      // roofData, since nothing else is in the shape list).
      const wall: Shape = { id: 'w1', type: 'wall', position: [3, 1.2, 0], args: [6, 2.4, 0.2], color: '#fff' };
      const roof = rectRoof({ roofData: { ridgeHeight: 2.4, eaveOverhang: 0.3 } });
      const initialFrame = generateTimberFrameForRoof(roof, []);
      const shapesWithTimber = [wall, roof, ...initialFrame.map(s => ({ ...s, tags: [...(s.tags || []), 'timber-frame'] }))];

      // Prime lastArchFingerprint deterministically with the pre-edit
      // scene, since it's shared module state across every test in this
      // file - without priming, a leftover fingerprint from an unrelated
      // test could make this pass (or fail) for the wrong reason.
      updateTimberFramesIfPresent(shapesWithTimber);

      // Same args, only roofData.eaveOverhang changes.
      const editedRoof = { ...roof, roofData: { ridgeHeight: 2.4, eaveOverhang: 1.2 } };
      const updatedShapes = updateTimberFramesIfPresent([wall, editedRoof, ...shapesWithTimber.slice(2)]);

      const updatedRafter = updatedShapes.find(s => s.name?.includes('Common Rafter (Front)') && s.tags?.includes('timber-frame'));
      const originalRafter = initialFrame.find(s => s.name?.includes('Common Rafter (Front)'));
      expect(updatedRafter).toBeDefined();
      expect(originalRafter).toBeDefined();
      // If the fingerprint didn't pick up the roofData change, the old
      // (shorter-eave) rafter shapes would have been left untouched.
      expect(updatedRafter!.args[2]).toBeGreaterThan(originalRafter!.args[2]);
    });
  });
});
