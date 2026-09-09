import { describe, it, expect } from 'vitest';
import {
  validateWallToolOutput,
  validateRoofToolOutput,
  validateFloorToolOutput,
  computeStructuralZoneDepth,
  computeFloorStructuralZoneDepth,
  snapToStandardTimberSize,
  lookupSpan,
  lookupFloorSpan,
  generateTimberBOM,
  validateTimberAssembly,
  generateTimberFrameFromContract,
  generateFloorTimberFrameFromContract,
  regenerateTimberRipple,
} from './timberFrameContracts';
import {
  DEFAULT_PROJECT_METADATA,
  DEFAULT_WALL_LAYER_STACK,
  DEFAULT_ROOF_LAYER_STACK,
  DEFAULT_FLOOR_LAYER_STACK,
  STANDARD_TIMBER_SIZES,
  COINCIDENCE_EPSILON_MM,
} from '../constants/timberFrameDefaults';
import { WallToolOutput, RoofToolOutput, FloorToolOutput, Shape } from '../types';
import { generateTimberFraming } from './timberFrameGenerator';

describe('Timber Frame System Specification (§0 - §10)', () => {
  // ---------------------------------------------------------------------------
  // §0: Trigger Model and Input Contract Validation
  // ---------------------------------------------------------------------------
  describe('§0 Input Contract & Fail Conditions', () => {
    it('aborts and reports errors when required fields are missing in WallToolOutput', () => {
      const invalidWall: any = {
        wall_id: 'wall-101',
        // missing project_id
        // missing centerline
        // missing layer_stack
        total_depth: 300,
        height: 2800,
      };

      const res = validateWallToolOutput(invalidWall);
      expect(res.valid).toBe(false);
      expect(res.errors.some(e => e.includes('project_id'))).toBe(true);
      expect(res.errors.some(e => e.includes('centerline'))).toBe(true);
      expect(res.errors.some(e => e.includes('layer_stack'))).toBe(true);
    });

    it('rejects layer_stack that lacks a structural zone', () => {
      const wallNoStructural: WallToolOutput = {
        wall_id: 'wall-102',
        project_id: 'proj-1',
        centerline: [[0, 0, 0], [4, 0, 0]],
        total_depth: 300,
        height: 2800,
        layer_stack: [
          { name: 'Exterior Cladding', thickness_mm: 25, material: 'Timber', side: 'exterior' },
          { name: 'Interior Plaster', thickness_mm: 15, material: 'Gypsum', side: 'interior' },
        ],
        openings: [],
      };

      const res = validateWallToolOutput(wallNoStructural);
      expect(res.valid).toBe(false);
      expect(res.errors.some(e => e.includes("side='structural'"))).toBe(true);
    });

    it('throws explicit error when generating from incomplete contract instead of silently guessing', () => {
      const incompleteWall: any = {
        wall_id: 'wall-103',
        // missing project_id
      };

      expect(() => {
        generateTimberFrameFromContract(incompleteWall, DEFAULT_PROJECT_METADATA);
      }).toThrow(/Timber Frame Generation Aborted/);
    });
  });

  // ---------------------------------------------------------------------------
  // §1: Depth Hierarchy & Structural Zone Calculation
  // ---------------------------------------------------------------------------
  describe('§1 Depth Hierarchy & Structural Zone', () => {
    it('accurately computes structural zone depth subtracting exterior and interior layers', () => {
      // Wall total depth = 300mm.
      // Exterior = 20 + 25 + 1 + 11 = 57mm.
      // Interior = 25 + 12.5 = 37.5mm.
      // Structural zone = 300 - 57 - 37.5 = 205.5mm.
      const sz = computeStructuralZoneDepth(DEFAULT_WALL_LAYER_STACK, 300);
      expect(sz.valid).toBe(true);
      expect(sz.exteriorThicknessMm).toBe(57);
      expect(sz.interiorThicknessMm).toBe(37.5);
      expect(sz.structuralZoneDepthMm).toBe(205.5);
    });

    it('flags warning and invalid when exterior + interior thickness exceeds total depth', () => {
      const badStack = [
        { name: 'Exterior Thick Stone', thickness_mm: 150, material: 'Stone', side: 'exterior' as const },
        { name: 'Interior Brick', thickness_mm: 160, material: 'Brick', side: 'interior' as const },
      ];
      const sz = computeStructuralZoneDepth(badStack, 300);
      expect(sz.valid).toBe(false);
      expect(sz.structuralZoneDepthMm).toBe(0);
      expect(sz.warnings.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // §3 & §8: Standard Dimensional Sizes Snapping
  // ---------------------------------------------------------------------------
  describe('§3 & §8 Standard Dimensional Sizes Snapping', () => {
    it('snaps nominal depths to standard timber section dimensions', () => {
      const snap140 = snapToStandardTimberSize(138, 38);
      expect(snap140.standardDepthMm).toBe(140);
      expect(snap140.standardWidthMm).toBe(38);
      expect(snap140.name).toBe('38x140');
      expect(snap140.isEngineered).toBe(false);

      const snap195 = snapToStandardTimberSize(192, 45);
      expect(snap195.standardDepthMm).toBe(195);
      expect(snap195.standardWidthMm).toBe(45);
      expect(snap195.name).toBe('45x195');
    });

    it('identifies engineered lumber (Glulam/LVL) when required depth exceeds standard stock', () => {
      const deepLumber = snapToStandardTimberSize(300, 45);
      expect(deepLumber.isEngineered).toBe(true);
      expect(deepLumber.name).toContain('Glulam/LVL');
      expect(deepLumber.standardDepthMm).toBe(300);
    });
  });

  // ---------------------------------------------------------------------------
  // §4: Real-world Spans & Environmental Loading Lookup
  // ---------------------------------------------------------------------------
  describe('§4 Allowable Spans & Environmental Loading', () => {
    it('computes allowable spans and adjusts for heavy wind/snow/seismic conditions', () => {
      const baseline = lookupSpan('SPF', 'C24', 2.0, 0.5, 0.5, 'A', 'B');
      const extreme = lookupSpan('SPF', 'C24', 4.5, 1.8, 1.5, 'D', 'D');

      expect(baseline.maxSpanMm).toBeGreaterThan(3200);
      expect(extreme.maxSpanMm).toBeLessThan(baseline.maxSpanMm);
      expect(extreme.notes).toContain('Exposure D');
    });
  });

  // ---------------------------------------------------------------------------
  // §6: Naming Conventions & IFC Classification
  // ---------------------------------------------------------------------------
  describe('§6 IFC Classification and Deterministic Schema', () => {
    it('generates deterministic IDs and assigns correct IFC classifications to all members', () => {
      const wallInput: WallToolOutput = {
        wall_id: 'W_EAST_10',
        project_id: 'PRJ_HOUSE_01',
        centerline: [[0, 0, 0], [4, 0, 0]],
        total_depth: 300,
        height: 2800,
        layer_stack: DEFAULT_WALL_LAYER_STACK,
        openings: [
          {
            id: 'WIN_1',
            type: 'window',
            head_height: 2100,
            sill_height: 900,
            width: 1.2,
            rough_opening_tolerance_mm: 10,
          },
        ],
      };

      const result = generateTimberFrameFromContract(wallInput, DEFAULT_PROJECT_METADATA);
      expect(result.members.length).toBeGreaterThan(5);

      result.members.forEach(member => {
        expect(member.name).toContain('WALL_W_EAST_10_');
        expect(member.timberMemberData).toBeDefined();
        const data = member.timberMemberData!;
        expect(['IfcColumn', 'IfcBeam', 'IfcPlate', 'IfcMember']).toContain(data.ifcClass);
        expect(data.is_user_modified).toBe(false);
        expect(data.generation_params_snapshot).toBeDefined();
        expect(data.generation_params_snapshot.frame_depth_mm).toBeGreaterThan(0);
      });

      // Headers should be IfcBeam, Studs should be IfcColumn, Plates should be IfcPlate
      const plates = result.members.filter(m => m.timberMemberData?.ifcClass === 'IfcPlate');
      const columns = result.members.filter(m => m.timberMemberData?.ifcClass === 'IfcColumn');
      const beams = result.members.filter(m => m.timberMemberData?.ifcClass === 'IfcBeam');

      expect(plates.length).toBeGreaterThan(0);
      expect(columns.length).toBeGreaterThan(0);
      expect(beams.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // §7: Automated Validation Pass
  // ---------------------------------------------------------------------------
  describe('§7 Automated Validation Pass', () => {
    it('validates coplanarity, containment, and load path continuity', () => {
      const wallInput: WallToolOutput = {
        wall_id: 'W_VAL_01',
        project_id: 'PRJ_VAL',
        centerline: [[0, 0, 0], [4, 0, 0]],
        total_depth: 300,
        height: 2800,
        layer_stack: DEFAULT_WALL_LAYER_STACK,
        openings: [],
      };

      const result = generateTimberFrameFromContract(wallInput, DEFAULT_PROJECT_METADATA);
      expect(result.validation).toBeDefined();
      expect(result.validation.coplanarity_valid).toBe(true);
      expect(result.validation.containment_valid).toBe(true);
      expect(result.validation.errors.length).toBe(0);
    });

    it('detects clashes with MEP service volumes', () => {
      const member: Shape = {
        id: 'stud-1',
        name: 'Stud 1',
        type: 'box',
        position: [1.0, 1.4, 0],
        args: [0.045, 2.4, 0.14],
        color: '#d97706',
      };

      const mepDuct: Shape = {
        id: 'mep-duct-1',
        name: 'HVAC Supply Duct',
        type: 'box',
        position: [1.02, 1.4, 0],
        args: [0.3, 0.3, 0.3],
        color: '#3b82f6',
        tags: ['mep', 'hvac'],
      };

      const val = validateTimberAssembly([member], [mepDuct]);
      expect(val.clash_valid).toBe(false);
      expect(val.errors.some(e => e.includes('Clash Detected'))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // §9: Bill of Materials (BOM) & Cutting-Stock Bin-Packing
  // ---------------------------------------------------------------------------
  describe('§9 Bill of Materials (BOM) & Bin-Packing', () => {
    it('generates stock bin-packing, cut lists, waste percentages, and hardware lines', () => {
      const testMembers: Shape[] = [
        { id: 'm1', name: 'Stud 1', type: 'box', position: [0, 0, 0], args: [0.045, 2.4, 0.14], color: '#d97706', tags: ['timber-frame', 'timber-stud'] },
        { id: 'm2', name: 'Stud 2', type: 'box', position: [0, 0, 0], args: [0.045, 2.4, 0.14], color: '#d97706', tags: ['timber-frame', 'timber-stud'] },
        { id: 'm3', name: 'Plate', type: 'box', position: [0, 0, 0], args: [4.0, 0.045, 0.14], color: '#d97706', tags: ['timber-frame', 'timber-plate'] },
        { id: 'm4', name: 'Lintel', type: 'box', position: [0, 0, 0], args: [1.6, 0.19, 0.14], color: '#d97706', tags: ['timber-frame', 'timber-lintel'] },
        { id: 'm5', name: 'Floor Joist', type: 'box', position: [0, 0, 0], args: [0.045, 0.19, 3.8], color: '#d97706', tags: ['timber-frame', 'timber-floor-joist'] },
      ];

      const bom = generateTimberBOM(testMembers);
      expect(bom.lines.length).toBeGreaterThan(0);
      expect(bom.totalTimberLinearMeters).toBeGreaterThan(10);
      expect(bom.totalTimberVolumeM3).toBeGreaterThan(0);

      // Verify each BOM line has valid cut list and stock calculation
      bom.lines.forEach(line => {
        expect(line.cut_list.length).toBeGreaterThan(0);
        expect(line.stock_quantity_required).toBeGreaterThan(0);
        expect(line.total_waste_pct).toBeGreaterThanOrEqual(0);
      });

      // Verify hardware aggregation
      expect(bom.hardware.length).toBeGreaterThan(0);
      expect(bom.hardware.some(h => h.sku === 'SIMPSON-JHA270-47')).toBe(true);
      expect(bom.hardware.some(h => h.sku === 'NAIL-PASLODE-3.1X90')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // §5.2: Regeneration ("Ripple") Pass & User Override Preservation
  // ---------------------------------------------------------------------------
  describe('§5.2 Regeneration Ripple & User Override Preservation', () => {
    it('strictly preserves user-modified members during regeneration', () => {
      const wallId = 'W_RIPPLE_01';
      const originalStud: Shape = {
        id: `WALL_${wallId}_STUD_SPECIAL`,
        name: `WALL_${wallId}_Customized Stud`,
        type: 'box',
        position: [0.5, 1.4, 0],
        args: [0.045, 2.4, 0.14],
        color: '#d97706',
        parentWallOrRoofId: wallId,
        timberMemberData: {
          id: `WALL_${wallId}_STUD_SPECIAL`,
          ifcClass: 'IfcColumn',
          is_user_modified: true, // User edited this member!
          generation_params_snapshot: {
            structural_zone_depth_mm: 140,
            frame_depth_mm: 140,
            spacing_mm: 400,
            load_case: { gravity_load_kn_m: 2.5, wind_zone: '2', snow_load_kn_m2: 0.75, seismic_category: 'A' },
          },
        },
      };

      const regularStud: Shape = {
        id: `WALL_${wallId}_STUD_GEN`,
        name: `WALL_${wallId}_Regular Stud`,
        type: 'box',
        position: [0.9, 1.4, 0],
        args: [0.045, 2.4, 0.14],
        color: '#d97706',
        parentWallOrRoofId: wallId,
        timberMemberData: {
          id: `WALL_${wallId}_STUD_GEN`,
          ifcClass: 'IfcColumn',
          is_user_modified: false,
          generation_params_snapshot: {
            structural_zone_depth_mm: 140,
            frame_depth_mm: 140,
            spacing_mm: 400,
            load_case: { gravity_load_kn_m: 2.5, wind_zone: '2', snow_load_kn_m2: 0.75, seismic_category: 'A' },
          },
        },
      };

      const rippleResult = regenerateTimberRipple([originalStud, regularStud], wallId, {
        total_depth_mm: 300,
        height_mm: 2800,
      });

      // The user-modified member must be preserved
      expect(rippleResult.preservedMembers.length).toBe(1);
      expect(rippleResult.preservedMembers[0].id).toBe(`WALL_${wallId}_STUD_SPECIAL`);
      expect(rippleResult.report.conflicts?.length).toBeGreaterThan(0);
      expect(rippleResult.allUpdatedMembers.some(m => m.id === `WALL_${wallId}_STUD_SPECIAL`)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // §11: Floor Timber Framing Specification & Generation
  // ---------------------------------------------------------------------------
  describe('§11 Floor Timber Framing Rules & Generation', () => {
    it('validates floor contract and rejects invalid boundaries or missing structural zones', () => {
      // Missing boundary
      const invalidFloor: any = {
        floor_id: 'fl-err',
        project_id: 'PRJ-1',
        total_depth: 270,
        layer_stack: DEFAULT_FLOOR_LAYER_STACK,
        span_direction: [0, 0, 1],
      };
      expect(validateFloorToolOutput(invalidFloor).valid).toBe(false);

      // Non-existent structural zone in layer stack
      const noStructuralStack = DEFAULT_FLOOR_LAYER_STACK.filter(l => l.side !== 'structural' && !l.structural_zone);
      const szResult = computeFloorStructuralZoneDepth(noStructuralStack, 270);
      expect(szResult.valid).toBe(false);
      expect(szResult.structuralZoneDepthMm).toBe(0);
    });

    it('computes floor structural zone depth and span capacity correctly', () => {
      const szResult = computeFloorStructuralZoneDepth(DEFAULT_FLOOR_LAYER_STACK, 270);
      expect(szResult.valid).toBe(true);
      expect(szResult.structuralZoneDepthMm).toBeGreaterThan(150);

      const spanResult = lookupFloorSpan('C16', 0.5, 1.5, 'L/360', 'residential');
      expect(spanResult.maxSpanM).toBeGreaterThan(3.0);
    });

    it('generates complete specification-compliant floor framing with rim joists, trimmers, and strutting', () => {
      const floorContract: FloorToolOutput = {
        floor_id: 'FL-GROUND-01',
        project_id: 'PRJ-TEST',
        boundary: [
          [0, 0, 0],
          [5.0, 0, 0],
          [5.0, 0, 4.0],
          [0, 0, 4.0],
        ],
        span_direction: [0, 0, 1],
        total_depth: 270,
        layer_stack: DEFAULT_FLOOR_LAYER_STACK,
        openings: [
          {
            id: 'stair-01',
            type: 'stairwell',
            stair_geometry: {
              pitch_angle_deg: 38,
              headroom_min_mm: 2000,
              riser_height_mm: 190,
              tread_going_mm: 250,
            },
            bounding_box: [1.2, 1.0, 2.2, 3.0],
            boundary: [
              [1.2, 1.0],
              [2.2, 1.0],
              [2.2, 3.0],
              [1.2, 3.0],
            ],
          },
        ],
        supporting_wall_ids_below: ['w-g-1', 'w-g-2'],
        supporting_wall_ids_above: ['w-first-1'],
        imposed_load_kn_m2: 1.5,
        deflection_limit: 'L/360',
      };

      const floorResult = generateFloorTimberFrameFromContract(
        floorContract,
        DEFAULT_PROJECT_METADATA,
        { joistSpacingMm: 400 }
      );

      expect(floorResult.members.length).toBeGreaterThan(10);

      // Check perimeter rim joists
      const rimJoists = floorResult.members.filter(m => m.tags?.includes('timber-rim-joist'));
      expect(rimJoists.length).toBeGreaterThanOrEqual(4);

      // Check field joists
      const fieldJoists = floorResult.members.filter(m => m.tags?.includes('timber-floor-joist') && !m.tags?.includes('timber-rim-joist'));
      expect(fieldJoists.length).toBeGreaterThan(4);

      // Check doubled opening trimmers around stair opening
      const trimmers = floorResult.members.filter(m => m.tags?.includes('timber-trimmer-joist'));
      expect(trimmers.length).toBeGreaterThanOrEqual(2);

      // Check header joists across opening
      const headers = floorResult.members.filter(m => m.tags?.includes('timber-header-joist'));
      expect(headers.length).toBeGreaterThanOrEqual(2);

      // Check strutting / lateral blocking
      const strutting = floorResult.members.filter(m => m.tags?.includes('timber-strutting'));
      expect(strutting.length).toBeGreaterThan(0);

      // Check load-path continuity blocking under walls above
      const bearingBlocking = floorResult.members.filter(m => m.tags?.includes('timber-bearing-blocking'));
      expect(bearingBlocking.length).toBeGreaterThan(0);

      // Check BOM hardware items (Simpson joist hangers)
      expect(floorResult.bom.hardware.some(h => h.sku.includes('SIMPSON') || h.description.includes('Hanger'))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // §12: Wall Anti-Coplanarity & End-of-Run Setback
  // ---------------------------------------------------------------------------
  describe('§12 Wall End Coplanar Surface Setback', () => {
    it('enforces setback on wall members to prevent clashing at wall ends', () => {
      const wallLength = 4.0;
      const wallHeight = 2.8;
      const wallThickness = 0.2;
      const halfL = wallLength / 2;
      const setbackM = Math.max(COINCIDENCE_EPSILON_MM / 1000, 0.001);

      const wallShape: Shape = {
        id: 'wall-setback-test',
        name: 'Test Wall',
        type: 'wall',
        position: [0, wallHeight / 2, 0],
        args: [wallLength, wallHeight, wallThickness],
        color: '#ffffff',
      };

      const result = generateTimberFraming([wallShape], {
        includeWalls: true,
        includeFloors: false,
        includeRoof: false,
        studSpacing: 0.40,
      });

      expect(result.shapes.length).toBeGreaterThan(5);

      // Verify that every wall timber member is strictly contained within [-halfL + setback, halfL - setback]
      result.shapes.forEach(member => {
        const x = member.position[0];
        const memberWidth = Array.isArray(member.args) ? member.args[0] : 0.045;
        const leftEdge = x - memberWidth / 2;
        const rightEdge = x + memberWidth / 2;

        expect(leftEdge).toBeGreaterThanOrEqual(-halfL + setbackM - 1e-5);
        expect(rightEdge).toBeLessThanOrEqual(halfL - setbackM + 1e-5);
      });
    });
  });
});
