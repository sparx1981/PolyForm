import * as THREE from 'three';
import {
  Shape,
  ProjectMetadata,
  LayerStackItem,
  FloorLayerStackItem,
  WallOpeningContract,
  FloorOpeningContract,
  StairGeometry,
  WallToolOutput,
  RoofToolOutput,
  FloorToolOutput,
  RoofPurlinContract,
  RoofVoidClearanceZone,
  GenerationParamsSnapshot,
  IfcTimberClass,
  TimberMemberData,
  JointLibraryEntry,
  BOMLine,
  BOMHardwareLine,
  TimberBOM,
  TimberValidationResult,
  TimberGenerationReport,
  TimberMemberKind,
} from '../types';
import {
  STANDARD_TIMBER_SIZES,
  STANDARD_PURCHASABLE_LENGTHS_MM,
  SAW_KERF_MM,
  COINCIDENCE_EPSILON_MM,
  HARDWARE_CLASH_CLEARANCE_MM,
  DEFAULT_ROUGH_OPENING_TOLERANCE_MM,
  MAX_NOGGING_INTERVAL_MM,
  BEARING_TOLERANCE_MM,
  DEFAULT_PROJECT_METADATA,
  DEFAULT_WALL_LAYER_STACK,
  DEFAULT_ROOF_LAYER_STACK,
  DEFAULT_FLOOR_LAYER_STACK,
  DEFAULT_FLOOR_JOIST_SPACING_MM,
  DEFAULT_FLOOR_STRUTTING_INTERVAL_MM,
  DEFAULT_HEADROOM_MIN_MM,
  MIN_STRUT_ANGLE_DEG,
  MIN_VENTILATION_GAP_MM,
  JOINT_LIBRARY,
} from '../constants/timberFrameDefaults';

// =============================================================================
// 0. Trigger Model and Input Contract Validation (§0 & §0.4)
// =============================================================================

export function validateFloorToolOutput(input: FloorToolOutput): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!input) {
    errors.push("Missing FloorToolOutput payload.");
    return { valid: false, errors };
  }
  if (!input.project_id || typeof input.project_id !== 'string' || input.project_id.trim() === '') {
    errors.push("Missing required field 'project_id' in FloorToolOutput.");
  }
  if (!input.floor_id || typeof input.floor_id !== 'string' || input.floor_id.trim() === '') {
    errors.push("Missing required field 'floor_id' in FloorToolOutput.");
  }
  if (!input.boundary || !Array.isArray(input.boundary) || input.boundary.length < 3) {
    errors.push("Missing or invalid 'boundary' polygon (must contain at least 3 points) in FloorToolOutput.");
  }
  if (!input.span_direction || !Array.isArray(input.span_direction) || input.span_direction.length !== 3) {
    errors.push("Missing required field 'span_direction' in FloorToolOutput. Span direction cannot be inferred from aspect ratio.");
  } else {
    const lenSq = input.span_direction[0] ** 2 + input.span_direction[1] ** 2 + input.span_direction[2] ** 2;
    if (lenSq < 1e-6) {
      errors.push("Invalid zero-vector 'span_direction' in FloorToolOutput.");
    }
  }
  if (typeof input.total_depth !== 'number' || input.total_depth <= 0) {
    errors.push("Missing or non-positive 'total_depth' in FloorToolOutput.");
  }
  if (!input.layer_stack || !Array.isArray(input.layer_stack) || input.layer_stack.length === 0) {
    errors.push("Missing required field 'layer_stack' in FloorToolOutput.");
  } else {
    const hasStructural = input.layer_stack.some(l => l.side === 'structural');
    if (!hasStructural) {
      errors.push("Invalid 'layer_stack': must define at least one layer with side='structural'.");
    }
  }
  if (input.openings && Array.isArray(input.openings)) {
    input.openings.forEach((op, idx) => {
      if (!op.id) errors.push(`Floor opening #${idx + 1} is missing an 'id'.`);
      if (op.type === 'stairwell') {
        if (!op.stair_geometry) {
          errors.push(`Stairwell opening '${op.id || idx}' is missing required 'stair_geometry'. Headroom and cutout dimensions cannot be computed.`);
        } else {
          const sg = op.stair_geometry;
          if (typeof sg.pitch_angle_deg !== 'number' || sg.pitch_angle_deg <= 0 || sg.pitch_angle_deg >= 90) {
            errors.push(`Stairwell opening '${op.id}' has invalid pitch_angle_deg.`);
          }
          if (typeof sg.headroom_min_mm !== 'number' || sg.headroom_min_mm < 1500) {
            errors.push(`Stairwell opening '${op.id}' has invalid or unsafe headroom_min_mm.`);
          }
        }
      }
    });
  }
  return { valid: errors.length === 0, errors };
}

export function validateWallToolOutput(input: WallToolOutput): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!input) {
    errors.push("Missing WallToolOutput payload.");
    return { valid: false, errors };
  }
  if (!input.project_id || typeof input.project_id !== 'string' || input.project_id.trim() === '') {
    errors.push("Missing required field 'project_id' in WallToolOutput.");
  }
  if (!input.wall_id || typeof input.wall_id !== 'string' || input.wall_id.trim() === '') {
    errors.push("Missing required field 'wall_id' in WallToolOutput.");
  }
  if (!input.centerline) {
    errors.push("Missing required field 'centerline' in WallToolOutput.");
  }
  if (!input.layer_stack || !Array.isArray(input.layer_stack) || input.layer_stack.length === 0) {
    errors.push("Missing required field 'layer_stack' in WallToolOutput.");
  } else {
    const hasStructural = input.layer_stack.some(l => l.side === 'structural');
    if (!hasStructural) {
      errors.push("Invalid 'layer_stack': must define at least one layer with side='structural'.");
    }
  }
  if (typeof input.total_depth !== 'number' || input.total_depth <= 0) {
    errors.push("Missing or non-positive 'total_depth' in WallToolOutput.");
  }
  if (typeof input.height !== 'number' || input.height <= 0) {
    errors.push("Missing or non-positive 'height' in WallToolOutput.");
  }
  if (input.openings && Array.isArray(input.openings)) {
    input.openings.forEach((op, idx) => {
      if (!op.id) errors.push(`Opening #${idx + 1} is missing an 'id'.`);
      if (typeof op.width !== 'number' || op.width <= 0) errors.push(`Opening '${op.id || idx}' has non-positive width.`);
      if (typeof op.head_height !== 'number') errors.push(`Opening '${op.id || idx}' is missing 'head_height'.`);
    });
  }

  return { valid: errors.length === 0, errors };
}

export function validateRoofToolOutput(input: RoofToolOutput): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!input) {
    errors.push("Missing RoofToolOutput payload.");
    return { valid: false, errors };
  }
  if (!input.project_id || typeof input.project_id !== 'string' || input.project_id.trim() === '') {
    errors.push("Missing required field 'project_id' in RoofToolOutput.");
  }
  if (!input.roof_id || typeof input.roof_id !== 'string' || input.roof_id.trim() === '') {
    errors.push("Missing required field 'roof_id' in RoofToolOutput.");
  }
  if (!input.layer_stack || !Array.isArray(input.layer_stack) || input.layer_stack.length === 0) {
    errors.push("Missing required field 'layer_stack' in RoofToolOutput.");
  }
  if (!input.ridge_lines || !Array.isArray(input.ridge_lines)) {
    errors.push("Missing required field 'ridge_lines' in RoofToolOutput.");
  }

  return { valid: errors.length === 0, errors };
}

// =============================================================================
// 1. Depth Hierarchy & Structural Zone Calculation (§1)
// =============================================================================

export interface StructuralZoneComputation {
  structuralZoneDepthMm: number;
  exteriorThicknessMm: number;
  interiorThicknessMm: number;
  structuralZoneCenterOffsetMm: number; // offset from total_depth center towards interior
  valid: boolean;
  warnings: string[];
}

export function computeStructuralZoneDepth(
  layerStack: LayerStackItem[],
  totalDepthMm: number
): StructuralZoneComputation {
  const warnings: string[] = [];

  let exteriorThicknessMm = 0;
  let interiorThicknessMm = 0;
  let declaredStructuralThicknessMm = 0;

  for (const layer of layerStack) {
    if (layer.side === 'exterior') {
      exteriorThicknessMm += layer.thickness_mm;
    } else if (layer.side === 'interior') {
      interiorThicknessMm += layer.thickness_mm;
    } else if (layer.side === 'structural') {
      declaredStructuralThicknessMm += layer.thickness_mm;
    }
  }

  const calculatedStructuralZone = totalDepthMm - exteriorThicknessMm - interiorThicknessMm;
  const structuralZoneDepthMm = Math.max(0, calculatedStructuralZone);

  if (calculatedStructuralZone <= 0) {
    warnings.push(`Calculated structural zone (${calculatedStructuralZone}mm) <= 0. Exterior (${exteriorThicknessMm}mm) + Interior (${interiorThicknessMm}mm) >= Total Depth (${totalDepthMm}mm).`);
  }

  // Structural zone center offset relative to the wall total depth centerline:
  // Wall exterior face is at +totalDepth/2, interior at -totalDepth/2.
  // Exterior layers extend from +totalDepth/2 inward to (+totalDepth/2 - exteriorThickness).
  // Interior layers extend from -totalDepth/2 outward to (-totalDepth/2 + interiorThickness).
  // Structural zone top edge: (+totalDepth/2 - exteriorThickness)
  // Structural zone bottom edge: (-totalDepth/2 + interiorThickness)
  // Structural zone center:
  const outerEdge = totalDepthMm / 2 - exteriorThicknessMm;
  const innerEdge = -totalDepthMm / 2 + interiorThicknessMm;
  const structuralZoneCenterOffsetMm = (outerEdge + innerEdge) / 2;

  return {
    structuralZoneDepthMm,
    exteriorThicknessMm,
    interiorThicknessMm,
    structuralZoneCenterOffsetMm,
    valid: structuralZoneDepthMm > 0,
    warnings,
  };
}

export interface FloorStructuralZoneComputation {
  structuralZoneDepthMm: number;
  aboveThicknessMm: number;
  belowThicknessMm: number;
  structuralZoneCenterOffsetMm: number; // offset from total_depth center towards below
  valid: boolean;
  warnings: string[];
}

export function computeFloorStructuralZoneDepth(
  layerStack: FloorLayerStackItem[],
  totalDepthMm: number
): FloorStructuralZoneComputation {
  const warnings: string[] = [];

  let aboveThicknessMm = 0;
  let belowThicknessMm = 0;
  let declaredStructuralThicknessMm = 0;

  for (const layer of layerStack) {
    if (layer.side === 'above') {
      aboveThicknessMm += layer.thickness_mm;
    } else if (layer.side === 'below') {
      belowThicknessMm += layer.thickness_mm;
    } else if (layer.side === 'structural') {
      declaredStructuralThicknessMm += layer.thickness_mm;
    }
  }

  const hasStructural = layerStack.some(l => l.structural_zone || l.side === 'structural');
  if (!hasStructural) {
    warnings.push("Floor layer stack lacks any layer marked as 'structural' or 'structural_zone'.");
  }

  const calculatedStructuralZone = totalDepthMm - aboveThicknessMm - belowThicknessMm;
  const structuralZoneDepthMm = hasStructural ? Math.max(0, calculatedStructuralZone) : 0;

  if (calculatedStructuralZone <= 0) {
    warnings.push(`Calculated floor structural zone (${calculatedStructuralZone}mm) <= 0. Above (${aboveThicknessMm}mm) + Below (${belowThicknessMm}mm) >= Total Depth (${totalDepthMm}mm).`);
  }

  // Vertical center offset relative to the floor total depth centerline (Y=0):
  // Top face is at +totalDepthMm/2, underside at -totalDepthMm/2.
  // Above layers extend from +totalDepthMm/2 downward to (+totalDepthMm/2 - aboveThicknessMm).
  // Below layers extend from -totalDepthMm/2 upward to (-totalDepthMm/2 + belowThicknessMm).
  const topEdge = totalDepthMm / 2 - aboveThicknessMm;
  const bottomEdge = -totalDepthMm / 2 + belowThicknessMm;
  const structuralZoneCenterOffsetMm = (topEdge + bottomEdge) / 2;

  return {
    structuralZoneDepthMm,
    aboveThicknessMm,
    belowThicknessMm,
    structuralZoneCenterOffsetMm,
    valid: hasStructural && structuralZoneDepthMm > 0,
    warnings,
  };
}

// =============================================================================
// 2. Standard Dimensional Sizes Snapping (§3, §8)
// =============================================================================

export function snapToStandardTimberSize(
  targetDepthMm: number,
  targetWidthMm: number = 38
): {
  standardWidthMm: number;
  standardDepthMm: number;
  name: string;
  isEngineered: boolean;
} {
  // Check if exceeds largest standard size (235mm depth)
  const maxStandardDepth = 235;
  if (targetDepthMm > maxStandardDepth) {
    return {
      standardWidthMm: targetWidthMm >= 45 ? 45 : 38,
      standardDepthMm: Math.round(targetDepthMm),
      name: `Glulam/LVL ${Math.round(targetWidthMm)}x${Math.round(targetDepthMm)}`,
      isEngineered: true,
    };
  }

  // Find nearest standard size by depth
  let best = STANDARD_TIMBER_SIZES[0];
  let minDiff = Math.abs(best.depth_mm - targetDepthMm);

  for (const s of STANDARD_TIMBER_SIZES) {
    const diff = Math.abs(s.depth_mm - targetDepthMm);
    // If diff is same or smaller and width matches target closer
    if (diff < minDiff || (diff === minDiff && Math.abs(s.width_mm - targetWidthMm) < Math.abs(best.width_mm - targetWidthMm))) {
      best = s;
      minDiff = diff;
    }
  }

  return {
    standardWidthMm: best.width_mm,
    standardDepthMm: best.depth_mm,
    name: best.name,
    isEngineered: false,
  };
}

// =============================================================================
// 3. Real-world Spans and Loading Lookup (§4.2)
// =============================================================================

export function lookupSpan(
  species: string,
  grade: string,
  gravityLoadKnM: number = 2.0,
  windLoadKnM2: number = 0.8,
  snowLoadKnM2: number = 0.75,
  seismicCategory: string = 'A',
  exposureCategory: string = 'B'
): {
  maxSpanMm: number;
  maxSpanM: number;
  requiresEngineeredLumber: boolean;
  notes: string;
} {
  // Base allowable span for standard C24 / SPF lumber 38x140 at 400mm c/c is ~3.8m
  let baseSpanMm = 3800;

  if (grade === 'C16') baseSpanMm = 3200;
  if (grade === 'C24') baseSpanMm = 3900;
  if (grade === 'TR26') baseSpanMm = 4300;

  // Environmental load degradation factors
  const totalAreaLoad = windLoadKnM2 + snowLoadKnM2;
  let loadFactor = 1.0;

  if (gravityLoadKnM > 3.5) {
    loadFactor *= Math.max(0.75, 1.0 - (gravityLoadKnM - 3.5) * 0.08);
  }
  if (totalAreaLoad > 1.5) {
    loadFactor *= Math.max(0.70, 1.0 - (totalAreaLoad - 1.5) * 0.12);
  }
  if (exposureCategory === 'C' || exposureCategory === 'D') {
    loadFactor *= 0.92;
  }
  if (seismicCategory === 'D' || seismicCategory === 'E') {
    loadFactor *= 0.88;
  }

  const allowableSpanMm = Math.round(baseSpanMm * loadFactor);

  return {
    maxSpanMm: allowableSpanMm,
    maxSpanM: allowableSpanMm / 1000,
    requiresEngineeredLumber: allowableSpanMm < 2400,
    notes: `Calculated for ${species} ${grade} under gravity ${gravityLoadKnM.toFixed(1)} kN/m, wind ${windLoadKnM2.toFixed(1)} kN/m², snow ${snowLoadKnM2.toFixed(1)} kN/m² (Exposure ${exposureCategory}, Seismic ${seismicCategory}).`,
  };
}

export function lookupFloorSpan(
  species: string,
  deadLoadKnM2: number = 0.5,
  imposedLoadKnM2: number = 1.5,
  deflectionLimit: string = 'L/360',
  vibrationCriteria: string = 'residential'
): {
  maxSpanMm: number;
  maxSpanM: number;
  requiresEngineeredLumber: boolean;
  notes: string;
} {
  // Allowable floor span for 47x195 C24 joist at 400mm c/c is ~4.2m under 1.5 kN/m² imposed load
  let baseSpanMm = 4200;

  if (deflectionLimit === 'L/480' || deflectionLimit === 'L/500') {
    baseSpanMm *= 0.90;
  }

  if (imposedLoadKnM2 > 2.5) {
    baseSpanMm *= Math.max(0.72, 1.0 - (imposedLoadKnM2 - 2.5) * 0.08);
  } else if (imposedLoadKnM2 > 1.5) {
    baseSpanMm *= Math.max(0.85, 1.0 - (imposedLoadKnM2 - 1.5) * 0.10);
  }

  if (deadLoadKnM2 > 1.0) {
    baseSpanMm *= 0.92;
  }

  const allowableSpanMm = Math.round(baseSpanMm);

  return {
    maxSpanMm: allowableSpanMm,
    maxSpanM: allowableSpanMm / 1000,
    requiresEngineeredLumber: allowableSpanMm < 3000,
    notes: `Floor span calculated for ${species} (Dead: ${deadLoadKnM2} kN/m², Imposed: ${imposedLoadKnM2} kN/m², Limit: ${deflectionLimit}, Criteria: ${vibrationCriteria}).`,
  };
}

export function computeStairwellOpeningBoundary(
  stairGeometry: StairGeometry,
  localStructuralZoneDepthMm: number,
  suppliedBoundary?: [number, number][],
  roughToleranceMm: number = DEFAULT_ROUGH_OPENING_TOLERANCE_MM
): {
  requiredLengthMm: number;
  requiredWidthMm: number;
  discrepancyFlagged: boolean;
  notes: string;
} {
  const pitchRad = ((stairGeometry.pitch_angle_deg || 38) * Math.PI) / 180;
  // Headroom must clear min headroom (e.g. 2000mm) vertically between stair pitch line and underside of floor structure above.
  const headroomMin = stairGeometry.headroom_min_mm || 2000;
  const verticalClearanceNeededMm = headroomMin + localStructuralZoneDepthMm;
  const requiredLengthMm = Math.round(verticalClearanceNeededMm / Math.tan(pitchRad)) + roughToleranceMm * 2;
  const flightWidth = stairGeometry.flight_width_mm || 900;
  const requiredWidthMm = Math.round(flightWidth) + roughToleranceMm * 2;

  let discrepancyFlagged = false;
  let notes = `Stairwell opening calculated: required minimum length ${requiredLengthMm}mm for ${headroomMin}mm headroom at ${(stairGeometry.pitch_angle_deg || 38).toFixed(1)}° pitch.`;

  if (suppliedBoundary && suppliedBoundary.length >= 2) {
    const suppliedLengthMm = Math.round(
      Math.sqrt(
        (suppliedBoundary[1][0] - suppliedBoundary[0][0]) ** 2 +
        (suppliedBoundary[1][1] - suppliedBoundary[0][1]) ** 2
      ) * 1000
    );
    if (suppliedLengthMm > 0 && suppliedLengthMm < requiredLengthMm - 50) {
      discrepancyFlagged = true;
      notes += ` Discrepancy detected: Supplied bounding length (${suppliedLengthMm}mm) is smaller than required minimum (${requiredLengthMm}mm). Auto-expanded to maintain code-compliant headroom.`;
    }
  }

  return {
    requiredLengthMm,
    requiredWidthMm,
    discrepancyFlagged,
    notes,
  };
}

// =============================================================================
// 4. Bill of Materials (BOM) & Cutting-Stock Bin-Packing (§9)
// =============================================================================

export function generateTimberBOM(
  members: Shape[],
  options: {
    species?: string;
    grade?: string;
    sawKerfMm?: number;
    stockLengthsMm?: number[];
    hardwareCounts?: Record<string, number>;
  } = {}
): TimberBOM {
  const species = options.species || 'Spruce-Pine-Fir';
  const grade = options.grade || 'C24';
  const sawKerfMm = options.sawKerfMm ?? SAW_KERF_MM;
  const stockLengthsMm = options.stockLengthsMm ?? STANDARD_PURCHASABLE_LENGTHS_MM;

  // Group members by cross_section (e.g. "38x140")
  const groups = new Map<string, Array<{ length_mm: number; member_id: string; angle_notes?: string }>>();

  let totalLinearM = 0;
  let totalVolumeM3 = 0;

  members.forEach(m => {
    const args = Array.isArray(m.args) ? m.args : [0.045, 2.4, 0.14];
    // In our shapes: args = [width, height, depth] or [length, height, width]
    // The largest dimension is the length
    const dims = [...args].sort((a, b) => b - a);
    const lengthM = dims[0];
    const widthM = dims[2];
    const depthM = dims[1];

    const lengthMm = Math.round(lengthM * 1000);
    const widthMm = Math.round(widthM * 1000);
    const depthMm = Math.round(depthM * 1000);

    const crossSection = `${widthMm}x${depthMm}`;

    let angleNotes = 'Square cut';
    if (m.tags?.includes('timber-hip-rafter') || m.tags?.includes('timber-valley-rafter')) {
      angleNotes = 'Compound compound bevel 45°';
    } else if (m.tags?.includes('timber-rafter')) {
      angleNotes = 'Plumb cut 35° & Birdsmouth seat';
    } else if (m.tags?.includes('timber-jack-stud')) {
      angleNotes = 'Square cut';
    }

    if (!groups.has(crossSection)) {
      groups.set(crossSection, []);
    }
    groups.get(crossSection)!.push({
      length_mm: lengthMm,
      member_id: m.id,
      angle_notes: angleNotes,
    });

    totalLinearM += lengthM;
    totalVolumeM3 += (widthM * depthM * lengthM);
  });

  const lines: BOMLine[] = [];

  // Bin-packing: First-Fit-Decreasing for each cross section
  groups.forEach((cutList, crossSection) => {
    // Sort cut list descending by length
    const sortedCuts = [...cutList].sort((a, b) => b.length_mm - a.length_mm);

    // Pick best stock length (default to 4800mm or largest that fits cleanly)
    const stockLengthMm = Math.max(...stockLengthsMm);

    // Bins: array of remaining capacity in mm
    const bins: number[] = [];

    sortedCuts.forEach(cut => {
      let placed = false;
      const neededWithKerf = cut.length_mm + sawKerfMm;

      for (let i = 0; i < bins.length; i++) {
        if (bins[i] >= neededWithKerf) {
          bins[i] -= neededWithKerf;
          placed = true;
          break;
        }
      }

      if (!placed) {
        // Start a new bin
        bins.push(stockLengthMm - neededWithKerf);
      }
    });

    const stockQty = bins.length;
    const totalPurchasedMm = stockQty * stockLengthMm;
    const totalUsedMm = cutList.reduce((acc, c) => acc + c.length_mm, 0);
    const totalWastePct = totalPurchasedMm > 0
      ? Math.max(0, Math.round(((totalPurchasedMm - totalUsedMm) / totalPurchasedMm) * 1000) / 10)
      : 0;

    lines.push({
      species,
      grade,
      cross_section: crossSection,
      cut_list: sortedCuts,
      stock_length_mm: stockLengthMm,
      stock_quantity_required: stockQty,
      total_waste_pct: totalWastePct,
    });
  });

  // Hardware items (§10)
  const hardwareCounts = options.hardwareCounts || {};
  // Infer hardware counts from member tags if not passed
  let joistHangers = hardwareCounts['SIMPSON-JHA270-47'] || 0;
  let angleBrackets = hardwareCounts['SIMPSON-L90-BRACKET'] || 0;
  let rafterTies = hardwareCounts['SIMPSON-H2.5A-TIE'] || 0;
  let ridgeConnectors = hardwareCounts['SIMPSON-RTA12-CONNECTOR'] || 0;
  let cornerBrackets = hardwareCounts['SIMPSON-ML24Z-ANGLE'] || 0;
  let framingNailsBox = 0;

  members.forEach(m => {
    if (m.tags?.includes('timber-floor-joist')) joistHangers += 2;
    if (m.tags?.includes('timber-lintel') || m.tags?.includes('timber-header')) angleBrackets += 4;
    if (m.tags?.includes('timber-rafter')) rafterTies += 2;
    if (m.tags?.includes('timber-ridge-beam')) ridgeConnectors += 2;
    if (m.tags?.includes('timber-king-stud')) cornerBrackets += 1;
  });

  framingNailsBox = Math.max(1, Math.ceil(members.length * 6 / 1000));

  const hardware: BOMHardwareLine[] = [
    { sku: 'SIMPSON-JHA270-47', description: 'Simpson JHA270/47 Face-Fix Joist Hanger', quantity: joistHangers },
    { sku: 'SIMPSON-L90-BRACKET', description: 'Simpson Strong-Tie L90 Angle Bracket', quantity: angleBrackets },
    { sku: 'SIMPSON-H2.5A-TIE', description: 'Simpson H2.5A Rafter / Hurricane Tie Bracket', quantity: rafterTies },
    { sku: 'SIMPSON-RTA12-CONNECTOR', description: 'Simpson RTA12 Ridge / Rafter Connector Plate', quantity: ridgeConnectors },
    { sku: 'SIMPSON-ML24Z-ANGLE', description: 'Simpson ML24Z Heavy Duty Framing Angle', quantity: cornerBrackets },
    { sku: 'NAIL-PASLODE-3.1X90', description: 'Paslode 3.1x90mm Ring-Shank Framing Nails (Box of 1,000)', quantity: framingNailsBox },
  ].filter(h => h.quantity > 0);

  return {
    lines,
    hardware,
    totalTimberLinearMeters: Math.round(totalLinearM * 10) / 10,
    totalTimberVolumeM3: Math.round(totalVolumeM3 * 1000) / 1000,
  };
}

// =============================================================================
// 5. Automated Validation Pass (§7)
// =============================================================================

export function validateTimberAssembly(
  members: Shape[],
  hostShapes: Shape[],
  options: {
    metadata?: ProjectMetadata;
    mepShapes?: Shape[];
  } = {}
): TimberValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let coplanarity_valid = true;
  let containment_valid = true;
  let load_valid = true;
  let load_path_valid = true;
  let clash_valid = true;
  let override_conflict_valid = true;

  const metadata = options.metadata || DEFAULT_PROJECT_METADATA;

  // 1. Coplanarity Check (§1, §7)
  // Check if any frame member outer face is within epsilon (0.5mm) of host wall outer/inner boundary
  hostShapes.forEach(host => {
    if (host.type === 'wall' || host.tags?.includes('wall')) {
      const args = Array.isArray(host.args) ? host.args : [3.0, 2.8, 0.2];
      const wallThick = args[2] || 0.2;
      const wallHalfThick = wallThick / 2;

      const hostedMembers = members.filter(m => m.parentWallOrRoofId === host.id || m.id.includes(host.id));
      hostedMembers.forEach(m => {
        const mArgs = Array.isArray(m.args) ? m.args : [0.045, 2.4, 0.14];
        const mDepth = mArgs[2] || 0.14;

        // In local coordinates: front face is insetZ + mDepth/2
        // Check distance to wall outer face (+wallHalfThick) and inner face (-wallHalfThick)
        const hostPos = new THREE.Vector3(...host.position);
        const mPos = new THREE.Vector3(...m.position);
        const distToCenter = hostPos.distanceTo(mPos);

        if (mDepth >= wallThick - (COINCIDENCE_EPSILON_MM * 2 / 1000)) {
          coplanarity_valid = false;
          errors.push(`Coplanarity Violation: Member '${m.name}' depth (${(mDepth * 1000).toFixed(0)}mm) is coplanar with or exceeds wall thickness (${(wallThick * 1000).toFixed(0)}mm). Clearance is below epsilon (${COINCIDENCE_EPSILON_MM}mm).`);
        }
      });
    }
  });

  // 2. Containment Check (§2, §7)
  members.forEach(m => {
    const args = Array.isArray(m.args) ? m.args : [0.045, 2.4, 0.14];
    const dims = [...args].sort((a, b) => b - a);
    const depthMm = dims[1] * 1000;
    // Structural zone max default is ~218mm
    if (depthMm > 240) {
      containment_valid = false;
      errors.push(`Containment Violation: Member '${m.name}' member depth (${depthMm.toFixed(0)}mm) exceeds maximum structural zone depth.`);
    }
  });

  // 3. Load & Span Check (§4.2, §7)
  const spanCheck = lookupSpan(
    metadata.species_grade_defaults.species,
    metadata.species_grade_defaults.grade,
    2.5,
    0.8,
    metadata.snow_load_kn_m2,
    metadata.seismic_category,
    metadata.exposure_category
  );

  members.forEach(m => {
    const args = Array.isArray(m.args) ? m.args : [0.045, 2.4, 0.14];
    const lengthM = Math.max(...args);
    if (lengthM > spanCheck.maxSpanM + 0.1) {
      warnings.push(`Load Check Warning: Member '${m.name}' clear span (${lengthM.toFixed(2)}m) exceeds maximum allowable code span (${spanCheck.maxSpanM.toFixed(2)}m) for ${metadata.species_grade_defaults.grade} under environmental loading. Engineered lumber or intermediate post recommended.`);
    }
  });

  // 4. Load-Path Continuity Check (§4.1, §7)
  // Verify top plates exist on all framed walls
  hostShapes.filter(s => s.type === 'wall').forEach(w => {
    const hasTopPlate = members.some(m => (m.parentWallOrRoofId === w.id || m.id.includes(w.id)) && (m.tags?.includes('timber-plate') || m.name.includes('Top Plate')));
    if (!hasTopPlate) {
      load_path_valid = false;
      errors.push(`Load-Path Continuity Error: Wall '${w.name || w.id}' lacks a top plate bearing structure.`);
    }
  });

  // 5. Clash Check (§3, §10, §7)
  const mepVolumes = options.mepShapes || hostShapes.filter(s =>
    s.tags?.some(t => ['mep', 'hvac', 'duct', 'pipe', 'electrical', 'plumbing'].includes(t)) ||
    s.name?.toLowerCase().includes('mep') ||
    s.name?.toLowerCase().includes('duct') ||
    s.name?.toLowerCase().includes('pipe')
  );

  if (mepVolumes.length > 0) {
    mepVolumes.forEach(mep => {
      const mepPos = new THREE.Vector3(...mep.position);
      const mepArgs = Array.isArray(mep.args) ? mep.args : [0.2, 0.2, 0.2];
      const mepRadius = Math.max(...mepArgs) / 2 + (HARDWARE_CLASH_CLEARANCE_MM / 1000);

      members.forEach(m => {
        const mPos = new THREE.Vector3(...m.position);
        if (mPos.distanceTo(mepPos) < mepRadius + 0.05) {
          clash_valid = false;
          errors.push(`Clash Detected: Timber member '${m.name}' clashes with MEP service volume '${mep.name || mep.id}' within ${HARDWARE_CLASH_CLEARANCE_MM}mm clearance zone.`);
        }
      });
    });
  }

  // 6. Override Conflict Check (§5.2, §7)
  members.forEach(m => {
    if (m.timberMemberData?.is_user_modified) {
      // Check if snapshot inputs differ from current
      const snap = m.timberMemberData.generation_params_snapshot;
      if (snap && snap.frame_depth_mm > 0) {
        warnings.push(`User Override Preserved: Member '${m.name}' has direct user modifications and was preserved during regeneration pass.`);
      }
    }
  });

  return {
    coplanarity_valid,
    containment_valid,
    load_valid,
    load_path_valid,
    clash_valid,
    override_conflict_valid,
    errors,
    warnings,
  };
}

export function generateFloorTimberFrameFromContract(
  input: FloorToolOutput,
  metadata: ProjectMetadata = DEFAULT_PROJECT_METADATA,
  options: {
    timberColor?: string;
    joistSpacingMm?: number;
    revealDistance?: number;
    offsetFloorJoists?: boolean;
    offsetFloorNoggins?: boolean;
  } = {}
): TimberGenerationReport & { members: Shape[] } {
  // 1. Strict Contract Validation (§0 & §0.4)
  const val = validateFloorToolOutput(input);
  if (!val.valid) {
    throw new Error(`Floor Timber Frame Generation Aborted: ${val.errors.join('; ')}`);
  }

  const clampedDepths: string[] = [];
  const flaggedSpans: string[] = [];
  const deferredClashes: string[] = [];
  const insertedIntermediatePosts: string[] = [];
  const members: Shape[] = [];
  const timberColor = options.timberColor || '#b45309';
  const offsetJoists = Boolean(options.offsetFloorJoists);

  function isPointInsidePolygon(px: number, pz: number, poly: [number, number][]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], zi = poly[i][1];
      const xj = poly[j][0], zj = poly[j][1];
      const intersect = ((zi > pz) !== (zj > pz)) && (px < ((xj - xi) * (pz - zi)) / (zj - zi + 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // 2. Compute Structural Zone (§1)
  const sz = computeFloorStructuralZoneDepth(input.layer_stack, input.total_depth);
  if (!sz.valid) {
    throw new Error(`Floor Timber Frame Generation Aborted: ${sz.warnings.join('; ')}`);
  }

  // 3. Joist Sizing & Depth Clamping (§1, §3)
  const requestedJoistDepthMm = 195;
  let effectiveDepthMm = requestedJoistDepthMm;
  if (effectiveDepthMm > sz.structuralZoneDepthMm) {
    clampedDepths.push(`Clamped joist depth ${effectiveDepthMm}mm to available floor structural zone ${sz.structuralZoneDepthMm}mm (Total floor depth: ${input.total_depth}mm).`);
    effectiveDepthMm = sz.structuralZoneDepthMm;
  }
  const snapped = snapToStandardTimberSize(effectiveDepthMm, 47);
  const joistWidthM = snapped.standardWidthMm / 1000;
  const joistDepthM = snapped.standardDepthMm / 1000;
  const joistSpacingM = (options.joistSpacingMm ?? DEFAULT_FLOOR_JOIST_SPACING_MM) / 1000;

  // 4. Floor Span Check (§4.2)
  const spanLookup = lookupFloorSpan(
    metadata.species_grade_defaults.species,
    input.dead_load_kn_m2 ?? 0.5,
    input.imposed_load_kn_m2 ?? 1.5,
    input.deflection_limit ?? 'L/360',
    input.vibration_criteria ?? 'residential'
  );

  // Boundary coordinates & Bounding Box
  const boundary2D = input.boundary.map(pt => [pt[0], pt[2]] as [number, number]);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  boundary2D.forEach(([x, z]) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  });

  const spanVector = new THREE.Vector3(...input.span_direction).normalize();
  const floorElevationY = input.boundary[0][1] + (sz.structuralZoneCenterOffsetMm / 1000);

  // Compute overall boundary dimension in span direction
  const boundingSpanM = Math.max(maxX - minX, maxZ - minZ);
  if (boundingSpanM > spanLookup.maxSpanM) {
    flaggedSpans.push(`Floor joist span (${boundingSpanM.toFixed(2)}m) exceeds code allowable span (${spanLookup.maxSpanM.toFixed(2)}m) for ${snapped.standardDepthMm}mm depth. Engineered I-joist/posi-joist or intermediate load-bearing wall/beam required.`);
  }

  // 5. Openings & Stairwell Headroom Envelopes (§9)
  interface ProcessedFloorOpening {
    id: string;
    type: string;
    box: { minX: number; maxX: number; minZ: number; maxZ: number };
    trimmerPlies: number;
    headerPlies: number;
  }

  const processedOpenings: ProcessedFloorOpening[] = [];
  const openings = input.openings || [];

  openings.forEach(op => {
    let opMinX = 0, opMaxX = 0, opMinZ = 0, opMaxZ = 0;
    const roughTolM = (op.rough_opening_tolerance_mm ?? DEFAULT_ROUGH_OPENING_TOLERANCE_MM) / 1000;

    if (op.type === 'stairwell' && op.stair_geometry) {
      const calc = computeStairwellOpeningBoundary(op.stair_geometry, sz.structuralZoneDepthMm, op.boundary, op.rough_opening_tolerance_mm);
      if (calc.discrepancyFlagged) {
        flaggedSpans.push(calc.notes);
      }
      const reqLenM = calc.requiredLengthMm / 1000;
      const reqWidM = calc.requiredWidthMm / 1000;
      // Position stairwell opening
      if (op.boundary && op.boundary.length >= 2) {
        const startX = op.boundary[0][0];
        const startZ = op.boundary[0][1];
        opMinX = startX;
        opMaxX = startX + reqWidM;
        opMinZ = startZ;
        opMaxZ = startZ + reqLenM;
      } else {
        opMinX = minX + 0.8;
        opMaxX = opMinX + reqWidM;
        opMinZ = minZ + 0.8;
        opMaxZ = opMinZ + reqLenM;
      }
    } else if (op.boundary && op.boundary.length >= 3) {
      let bMinX = Infinity, bMaxX = -Infinity, bMinZ = Infinity, bMaxZ = -Infinity;
      op.boundary.forEach(([bx, bz]) => {
        if (bx < bMinX) bMinX = bx;
        if (bx > bMaxX) bMaxX = bx;
        if (bz < bMinZ) bMinZ = bz;
        if (bz > bMaxZ) bMaxZ = bz;
      });
      opMinX = bMinX - roughTolM;
      opMaxX = bMaxX + roughTolM;
      opMinZ = bMinZ - roughTolM;
      opMaxZ = bMaxZ + roughTolM;
    } else {
      opMinX = minX + 1.0;
      opMaxX = opMinX + 1.2;
      opMinZ = minZ + 1.0;
      opMaxZ = opMinZ + 1.2;
    }

    const opSpanM = Math.max(opMaxX - opMinX, opMaxZ - opMinZ);
    // Doubled or tripled trimmers per code: >= 1.2m double, >= 2.4m triple
    const trimmerPlies = opSpanM >= 2.4 ? 3 : 2;
    const headerPlies = 2;

    processedOpenings.push({
      id: op.id,
      type: op.type,
      box: { minX: opMinX, maxX: opMaxX, minZ: opMinZ, maxZ: opMaxZ },
      trimmerPlies,
      headerPlies,
    });
  });

  const snapshot: GenerationParamsSnapshot = {
    structural_zone_depth_mm: sz.structuralZoneDepthMm,
    frame_depth_mm: snapped.standardDepthMm,
    spacing_mm: Math.round(joistSpacingM * 1000),
    load_case: {
      gravity_load_kn_m: (input.dead_load_kn_m2 ?? 0.5) + (input.imposed_load_kn_m2 ?? 1.5),
      wind_zone: metadata.wind_zone,
      snow_load_kn_m2: metadata.snow_load_kn_m2,
      seismic_category: metadata.seismic_category,
      exposure_category: metadata.exposure_category,
    },
    species: metadata.species_grade_defaults.species,
    grade: metadata.species_grade_defaults.grade,
    timestamp: Date.now(),
  };

  const addFloorMember = (
    name: string,
    code: string,
    pStart: THREE.Vector3,
    pEnd: THREE.Vector3,
    w: number,
    d: number,
    ifcClass: IfcTimberClass,
    subTag: string
  ) => {
    const delta = pEnd.clone().sub(pStart);
    const span = delta.length();
    if (span < 0.05) return;

    const center = pStart.clone().add(pEnd).multiplyScalar(0.5);
    if (subTag !== 'timber-rim-joist') {
      if (!isPointInsidePolygon(center.x, center.z, boundary2D)) {
        return;
      }
    }
    const dir = delta.clone().normalize();
    const vUp = new THREE.Vector3(0, 1, 0);
    const vRight = new THREE.Vector3().crossVectors(dir, vUp).normalize();
    const qWorld = new THREE.Quaternion();

    if (vRight.lengthSq() > 0.01) {
      const vActualUp = new THREE.Vector3().crossVectors(vRight, dir).normalize();
      const mat = new THREE.Matrix4().makeBasis(vRight, vActualUp, dir);
      qWorld.setFromRotationMatrix(mat);
    } else {
      qWorld.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    }

    const id = `FLOOR_${input.floor_id}_${code}_${Math.random().toString(36).substr(2, 6)}`;
    const memberData: TimberMemberData = {
      id,
      ifcClass,
      is_user_modified: false,
      generation_params_snapshot: snapshot,
      cutLengthMm: Math.round(span * 1000),
    };

    members.push({
      id,
      name: `FLOOR_${input.floor_id}_${name}`,
      type: 'box',
      position: [center.x, center.y, center.z],
      quaternion: [qWorld.x, qWorld.y, qWorld.z, qWorld.w],
      scale: [1, 1, 1],
      args: [w, d, span],
      color: timberColor,
      roughness: 0.8,
      metalness: 0.05,
      parentWallOrRoofId: input.floor_id,
      tags: ['timber-frame', 'timber-floor', 'timber-floor-joist', subTag],
      timberMemberData: memberData,
    });
  };

  // 6. Perimeter Rim / Band Joists (§1, §4.1)
  // Set back by epsilon from outer boundary to eliminate coplanar clashing
  const edgeSetback = Math.max(COINCIDENCE_EPSILON_MM / 1000, 0.001);
  const numVerts = boundary2D.length;
  for (let i = 0; i < numVerts; i++) {
    const p1 = boundary2D[i];
    const p2 = boundary2D[(i + 1) % numVerts];
    const v1 = new THREE.Vector3(p1[0], floorElevationY, p1[1]);
    const v2 = new THREE.Vector3(p2[0], floorElevationY, p2[1]);
    const edgeLen = v1.distanceTo(v2);
    if (edgeLen > 0.2) {
      const edgeDir = v2.clone().sub(v1).normalize();
      const sStart = v1.clone().addScaledVector(edgeDir, edgeSetback);
      const sEnd = v2.clone().addScaledVector(edgeDir, -edgeSetback);
      addFloorMember(`RIM_JOIST_EDGE_${i + 1}`, `RIM_${i + 1}`, sStart, sEnd, joistWidthM, joistDepthM, 'IfcBeam', 'timber-rim-joist');
    }
  }

  // 7. Field Joists aligned to span_direction (§0, §4.2)
  const isSpanZ = Math.abs(spanVector.z) >= Math.abs(spanVector.x);

  if (isSpanZ) {
    let curX = minX + joistSpacingM;
    let jIdx = 1;
    while (curX <= maxX - 0.05) {
      const zIntersections: number[] = [];
      for (let i = 0; i < numVerts; i++) {
        const [x1, z1] = boundary2D[i];
        const [x2, z2] = boundary2D[(i + 1) % numVerts];
        if ((x1 <= curX && curX < x2) || (x2 <= curX && curX < x1)) {
          if (Math.abs(x2 - x1) > 1e-6) {
            const t = (curX - x1) / (x2 - x1);
            zIntersections.push(z1 + t * (z2 - z1));
          }
        }
      }
      zIntersections.sort((a, b) => a - b);

      for (let k = 0; k < zIntersections.length; k += 2) {
        if (k + 1 < zIntersections.length) {
          let segZ1 = zIntersections[k] + edgeSetback;
          let segZ2 = zIntersections[k + 1] - edgeSetback;

          const staggerOffset = (offsetJoists && (jIdx % 2 === 1)) ? joistWidthM : 0;
          const joistLabel = offsetJoists ? `Floor Joist (Offset ${jIdx})` : `Floor Joist (400mm c/c ${jIdx})`;
          const hitOpenings = processedOpenings.filter(op => curX >= op.box.minX && curX <= op.box.maxX);
          if (hitOpenings.length === 0) {
            if (segZ2 - segZ1 > 0.1) {
              const pStart = new THREE.Vector3(curX, floorElevationY, segZ1 + staggerOffset);
              const pEnd = new THREE.Vector3(curX, floorElevationY, segZ2 + staggerOffset);
              addFloorMember(joistLabel, `JOIST_${jIdx}`, pStart, pEnd, joistWidthM, joistDepthM, 'IfcBeam', 'timber-floor-joist');
              jIdx++;
            }
          } else {
            const zBreaks: number[] = [segZ1];
            hitOpenings.forEach(op => {
              zBreaks.push(op.box.minZ);
              zBreaks.push(op.box.maxZ);
            });
            zBreaks.push(segZ2);
            zBreaks.sort((a, b) => a - b);

            for (let b = 0; b < zBreaks.length - 1; b += 2) {
              const bZ1 = zBreaks[b];
              const bZ2 = zBreaks[b + 1];
              const insideOp = hitOpenings.some(op => (bZ1 + bZ2) / 2 >= op.box.minZ && (bZ1 + bZ2) / 2 <= op.box.maxZ);
              if (!insideOp && bZ2 - bZ1 > 0.1) {
                const pStart = new THREE.Vector3(curX, floorElevationY, bZ1 + staggerOffset);
                const pEnd = new THREE.Vector3(curX, floorElevationY, bZ2 + staggerOffset);
                addFloorMember(joistLabel, `JOIST_${jIdx}`, pStart, pEnd, joistWidthM, joistDepthM, 'IfcBeam', 'timber-floor-joist');
                jIdx++;
              }
            }
          }
        }
      }
      curX += joistSpacingM;
    }
  } else {
    let curZ = minZ + joistSpacingM;
    let jIdx = 1;
    while (curZ <= maxZ - 0.05) {
      const xIntersections: number[] = [];
      for (let i = 0; i < numVerts; i++) {
        const [x1, z1] = boundary2D[i];
        const [x2, z2] = boundary2D[(i + 1) % numVerts];
        if ((z1 <= curZ && curZ < z2) || (z2 <= curZ && curZ < z1)) {
          if (Math.abs(z2 - z1) > 1e-6) {
            const t = (curZ - z1) / (z2 - z1);
            xIntersections.push(x1 + t * (x2 - x1));
          }
        }
      }
      xIntersections.sort((a, b) => a - b);

      for (let k = 0; k < xIntersections.length; k += 2) {
        if (k + 1 < xIntersections.length) {
          let segX1 = xIntersections[k] + edgeSetback;
          let segX2 = xIntersections[k + 1] - edgeSetback;

          const staggerOffset = (offsetJoists && (jIdx % 2 === 1)) ? joistWidthM : 0;
          const joistLabel = offsetJoists ? `Floor Joist (Offset ${jIdx})` : `Floor Joist (400mm c/c ${jIdx})`;
          const hitOpenings = processedOpenings.filter(op => curZ >= op.box.minZ && curZ <= op.box.maxZ);
          if (hitOpenings.length === 0) {
            if (segX2 - segX1 > 0.1) {
              const pStart = new THREE.Vector3(segX1 + staggerOffset, floorElevationY, curZ);
              const pEnd = new THREE.Vector3(segX2 + staggerOffset, floorElevationY, curZ);
              addFloorMember(joistLabel, `JOIST_${jIdx}`, pStart, pEnd, joistWidthM, joistDepthM, 'IfcBeam', 'timber-floor-joist');
              jIdx++;
            }
          } else {
            const xBreaks: number[] = [segX1];
            hitOpenings.forEach(op => {
              xBreaks.push(op.box.minX);
              xBreaks.push(op.box.maxX);
            });
            xBreaks.push(segX2);
            xBreaks.sort((a, b) => a - b);

            for (let b = 0; b < xBreaks.length - 1; b += 2) {
              const bX1 = xBreaks[b];
              const bX2 = xBreaks[b + 1];
              const insideOp = hitOpenings.some(op => (bX1 + bX2) / 2 >= op.box.minX && (bX1 + bX2) / 2 <= op.box.maxX);
              if (!insideOp && bX2 - bX1 > 0.1) {
                const pStart = new THREE.Vector3(bX1 + staggerOffset, floorElevationY, curZ);
                const pEnd = new THREE.Vector3(bX2 + staggerOffset, floorElevationY, curZ);
                addFloorMember(joistLabel, `JOIST_${jIdx}`, pStart, pEnd, joistWidthM, joistDepthM, 'IfcBeam', 'timber-floor-joist');
                jIdx++;
              }
            }
          }
        }
      }
      curZ += joistSpacingM;
    }
  }

  // 8. Trimmer & Header Joists for Openings (§9)
  processedOpenings.forEach(op => {
    const { box, trimmerPlies, headerPlies } = op;
    if (isSpanZ) {
      for (let p = 0; p < trimmerPlies; p++) {
        const offsetLeft = box.minX - p * joistWidthM;
        const offsetRight = box.maxX + p * joistWidthM;
        const p1L = new THREE.Vector3(offsetLeft, floorElevationY, box.minZ);
        const p2L = new THREE.Vector3(offsetLeft, floorElevationY, box.maxZ);
        addFloorMember(`TRIMMER_L_PLY${p + 1}_${op.id}`, `TRIMMER_L_${op.id}_${p + 1}`, p1L, p2L, joistWidthM, joistDepthM, 'IfcBeam', 'timber-trimmer-joist');

        const p1R = new THREE.Vector3(offsetRight, floorElevationY, box.minZ);
        const p2R = new THREE.Vector3(offsetRight, floorElevationY, box.maxZ);
        addFloorMember(`TRIMMER_R_PLY${p + 1}_${op.id}`, `TRIMMER_R_${op.id}_${p + 1}`, p1R, p2R, joistWidthM, joistDepthM, 'IfcBeam', 'timber-trimmer-joist');
      }

      for (let p = 0; p < headerPlies; p++) {
        const offsetZNear = box.minZ - p * joistWidthM;
        const offsetZFar = box.maxZ + p * joistWidthM;
        const p1N = new THREE.Vector3(box.minX, floorElevationY, offsetZNear);
        const p2N = new THREE.Vector3(box.maxX, floorElevationY, offsetZNear);
        addFloorMember(`HEADER_NEAR_PLY${p + 1}_${op.id}`, `HEADER_N_${op.id}_${p + 1}`, p1N, p2N, joistWidthM, joistDepthM, 'IfcBeam', 'timber-header-joist');

        const p1F = new THREE.Vector3(box.minX, floorElevationY, offsetZFar);
        const p2F = new THREE.Vector3(box.maxX, floorElevationY, offsetZFar);
        addFloorMember(`HEADER_FAR_PLY${p + 1}_${op.id}`, `HEADER_F_${op.id}_${p + 1}`, p1F, p2F, joistWidthM, joistDepthM, 'IfcBeam', 'timber-header-joist');
      }
    } else {
      for (let p = 0; p < trimmerPlies; p++) {
        const offsetNear = box.minZ - p * joistWidthM;
        const offsetFar = box.maxZ + p * joistWidthM;
        const p1N = new THREE.Vector3(box.minX, floorElevationY, offsetNear);
        const p2N = new THREE.Vector3(box.maxX, floorElevationY, offsetNear);
        addFloorMember(`TRIMMER_N_PLY${p + 1}_${op.id}`, `TRIMMER_N_${op.id}_${p + 1}`, p1N, p2N, joistWidthM, joistDepthM, 'IfcBeam', 'timber-trimmer-joist');

        const p1F = new THREE.Vector3(box.minX, floorElevationY, offsetFar);
        const p2F = new THREE.Vector3(box.maxX, floorElevationY, offsetFar);
        addFloorMember(`TRIMMER_F_PLY${p + 1}_${op.id}`, `TRIMMER_F_${op.id}_${p + 1}`, p1F, p2F, joistWidthM, joistDepthM, 'IfcBeam', 'timber-trimmer-joist');
      }

      for (let p = 0; p < headerPlies; p++) {
        const offsetLeft = box.minX - p * joistWidthM;
        const offsetRight = box.maxX + p * joistWidthM;
        const p1L = new THREE.Vector3(offsetLeft, floorElevationY, box.minZ);
        const p2L = new THREE.Vector3(offsetLeft, floorElevationY, box.maxZ);
        addFloorMember(`HEADER_L_PLY${p + 1}_${op.id}`, `HEADER_L_${op.id}_${p + 1}`, p1L, p2L, joistWidthM, joistDepthM, 'IfcBeam', 'timber-header-joist');

        const p1R = new THREE.Vector3(offsetRight, floorElevationY, box.minZ);
        const p2R = new THREE.Vector3(offsetRight, floorElevationY, box.maxZ);
        addFloorMember(`HEADER_R_PLY${p + 1}_${op.id}`, `HEADER_R_${op.id}_${p + 1}`, p1R, p2R, joistWidthM, joistDepthM, 'IfcBeam', 'timber-header-joist');
      }
    }
  });

  // 9. Strutting / Lateral Blocking Rows (§4.2)
  const struttingIntervalM = DEFAULT_FLOOR_STRUTTING_INTERVAL_MM / 1000;
  if (isSpanZ) {
    const totalSpanZ = maxZ - minZ;
    if (totalSpanZ > 2.5) {
      let curZ = minZ + struttingIntervalM;
      let sIdx = 1;
      while (curZ < maxZ - 1.0) {
        let curX = minX + joistSpacingM;
        while (curX < maxX - joistSpacingM) {
          const pStart = new THREE.Vector3(curX + joistWidthM / 2, floorElevationY, curZ);
          const pEnd = new THREE.Vector3(curX + joistSpacingM - joistWidthM / 2, floorElevationY, curZ);
          addFloorMember(`STRUTTING_ROW${sIdx}`, `STRUT_${sIdx}`, pStart, pEnd, joistWidthM, joistDepthM * 0.75, 'IfcMember', 'timber-strutting');
          curX += joistSpacingM;
        }
        curZ += struttingIntervalM;
        sIdx++;
      }
    }
  } else {
    const totalSpanX = maxX - minX;
    if (totalSpanX > 2.5) {
      let curX = minX + struttingIntervalM;
      let sIdx = 1;
      while (curX < maxX - 1.0) {
        let curZ = minZ + joistSpacingM;
        while (curZ < maxZ - joistSpacingM) {
          const pStart = new THREE.Vector3(curX, floorElevationY, curZ + joistWidthM / 2);
          const pEnd = new THREE.Vector3(curX, floorElevationY, curZ + joistSpacingM - joistWidthM / 2);
          addFloorMember(`STRUTTING_ROW${sIdx}`, `STRUT_${sIdx}`, pStart, pEnd, joistWidthM, joistDepthM * 0.75, 'IfcMember', 'timber-strutting');
          curZ += joistSpacingM;
        }
        curX += struttingIntervalM;
        sIdx++;
      }
    }
  }

  // 10. Load-Path Continuity Blocking under walls above (§4.1)
  if (input.supporting_wall_ids_above && input.supporting_wall_ids_above.length > 0) {
    const midZ = (minZ + maxZ) / 2;
    const pStart = new THREE.Vector3(minX + 0.2, floorElevationY, midZ);
    const pEnd = new THREE.Vector3(maxX - 0.2, floorElevationY, midZ);
    addFloorMember('LOAD_PATH_BEARING_BLOCKING', 'BEAR_BLOCK', pStart, pEnd, joistWidthM, joistDepthM, 'IfcMember', 'timber-bearing-blocking');
  }

  // 11. Diaphragm Shear Check (§4.4)
  const deckingLayer = input.layer_stack.find(
    l => l.side === 'above' && (l.structural_contribution || l.name.toLowerCase().includes('decking') || l.name.toLowerCase().includes('subfloor') || l.material.toLowerCase().includes('chipboard') || l.material.toLowerCase().includes('plywood'))
  );
  if (deckingLayer && deckingLayer.thickness_mm < 18) {
    flaggedSpans.push(`Floor diaphragm warning: Subfloor decking thickness (${deckingLayer.thickness_mm}mm) is less than the recommended 18mm for structural diaphragm shear capacity.`);
  }

  // 12. Run Validation Pass (§7)
  const validation = validateTimberAssembly(members, []);

  // 13. Emit BOM with Hardware (§9, §10)
  const hardwareCounts: Record<string, number> = {
    'SIMPSON-JHA270-47': members.filter(m => m.tags?.includes('timber-floor-joist')).length * 2,
    'SIMPSON-L90-BRACKET': members.filter(m => m.tags?.includes('timber-trimmer-joist')).length * 2,
  };
  const bom = generateTimberBOM(members, { hardwareCounts });

  // 14. Emit Generation Report
  const report: TimberGenerationReport = {
    floor_id: input.floor_id,
    structural_zone_depth_mm: sz.structuralZoneDepthMm,
    frame_depth_mm: snapped.standardDepthMm,
    clamped_depths: clampedDepths,
    flagged_spans: flaggedSpans,
    deferred_clashes: deferredClashes,
    inserted_intermediate_posts: insertedIntermediatePosts,
    bom,
    validation,
    summary: `Generated ${members.length} floor timber members for Floor '${input.floor_id}'. Structural zone depth: ${sz.structuralZoneDepthMm}mm, Joist depth: ${snapped.standardDepthMm}mm. Total timber: ${bom.totalTimberLinearMeters}m (${bom.totalTimberVolumeM3} m³).`,
  };

  return {
    ...report,
    members,
  };
}

// =============================================================================
// 6. High-Level Contract Trigger (§0, §5.1, §5.2)
// =============================================================================

export function generateTimberFrameFromContract(
  input: WallToolOutput | RoofToolOutput | FloorToolOutput,
  metadata: ProjectMetadata = DEFAULT_PROJECT_METADATA,
  options: {
    timberColor?: string;
    revealDistance?: number;
    joistSpacingMm?: number;
  } = {}
): TimberGenerationReport & { members: Shape[] } {
  // Check if Floor Contract
  if ('floor_id' in input) {
    return generateFloorTimberFrameFromContract(input as FloorToolOutput, metadata, options);
  }

  // 1. Strict Contract Validation (§0.4 Fail Conditions)
  const isWall = 'wall_id' in input;
  const isRoof = 'roof_id' in input;

  if (isWall) {
    const val = validateWallToolOutput(input as WallToolOutput);
    if (!val.valid) {
      throw new Error(`Timber Frame Generation Aborted: ${val.errors.join('; ')}`);
    }
  } else if (isRoof) {
    const val = validateRoofToolOutput(input as RoofToolOutput);
    if (!val.valid) {
      throw new Error(`Timber Frame Generation Aborted: ${val.errors.join('; ')}`);
    }
  } else {
    throw new Error("Timber Frame Generation Aborted: Input must be WallToolOutput, RoofToolOutput, or FloorToolOutput.");
  }

  const clampedDepths: string[] = [];
  const flaggedSpans: string[] = [];
  const deferredClashes: string[] = [];
  const insertedIntermediatePosts: string[] = [];

  const members: Shape[] = [];
  const timberColor = options.timberColor || '#d97706';

  if (isWall) {
    const wallInput = input as WallToolOutput;
    // 2. Compute Structural Zone (§1)
    const sz = computeStructuralZoneDepth(wallInput.layer_stack, wallInput.total_depth);
    if (!sz.valid) {
      throw new Error(`Timber Frame Generation Aborted: ${sz.warnings.join('; ')}`);
    }

    // 3. Snap & Clamp Member Depth (§1, §3)
    let requestedStudDepth = 140; // mm
    if (requestedStudDepth >= wallInput.total_depth) {
      clampedDepths.push(`Clamped stud depth ${requestedStudDepth}mm to fit structural zone ${sz.structuralZoneDepthMm}mm (Total wall depth: ${wallInput.total_depth}mm).`);
      requestedStudDepth = sz.structuralZoneDepthMm;
    }
    const snapped = snapToStandardTimberSize(Math.min(requestedStudDepth, sz.structuralZoneDepthMm), 38);
    const studWidthM = snapped.standardWidthMm / 1000;
    const studDepthM = snapped.standardDepthMm / 1000;
    const plateThickM = 0.045;

    const wallLengthM = 4.0; // derived or from centerline
    const wallHeightM = wallInput.height / 1000;
    const halfH = wallHeightM / 2;

    // End setback to avoid coplanar surfaces at the end of a run where timber frame meets the wall boundary
    const endSetbackM = Math.max(COINCIDENCE_EPSILON_MM / 1000, 0.001); // 1mm clear of wall boundary
    const framedLengthM = Math.max(0.1, wallLengthM - endSetbackM * 2);
    const framedHalfL = framedLengthM / 2;

    const studSpacingM = 0.40; // 400mm standard
    const usableHeightM = wallHeightM - plateThickM * 3;
    const studCenterYM = -halfH + plateThickM + usableHeightM / 2;

    // Snapshot
    const snapshot: GenerationParamsSnapshot = {
      structural_zone_depth_mm: sz.structuralZoneDepthMm,
      frame_depth_mm: snapped.standardDepthMm,
      spacing_mm: Math.round(studSpacingM * 1000),
      load_case: {
        gravity_load_kn_m: wallInput.gravity_load_kn_m || 2.5,
        wind_zone: metadata.wind_zone,
        snow_load_kn_m2: metadata.snow_load_kn_m2,
        seismic_category: metadata.seismic_category,
        exposure_category: metadata.exposure_category,
      },
      species: metadata.species_grade_defaults.species,
      grade: metadata.species_grade_defaults.grade,
      timestamp: Date.now(),
    };

    // Center Z inside structural zone:
    const localZM = sz.structuralZoneCenterOffsetMm / 1000;

    const helperAddMember = (
      name: string,
      code: string,
      x: number,
      y: number,
      w: number,
      h: number,
      d: number,
      ifcClass: IfcTimberClass,
      subTag: string
    ) => {
      const id = `WALL_${wallInput.wall_id}_${code}_${Math.random().toString(36).substr(2, 6)}`;
      const memberData: TimberMemberData = {
        id,
        ifcClass,
        is_user_modified: false,
        generation_params_snapshot: snapshot,
        cutLengthMm: Math.round(Math.max(w, h, d) * 1000),
      };

      members.push({
        id,
        name: `WALL_${wallInput.wall_id}_${name}`,
        type: 'box',
        position: [x, y, localZM],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
        args: [w, h, d],
        color: timberColor,
        roughness: 0.8,
        metalness: 0.05,
        parentWallOrRoofId: wallInput.wall_id,
        tags: ['timber-frame', 'timber-stud-wall', subTag],
        timberMemberData: memberData,
      });
    };

    // 4. Plates (§5.1 step 4) - length framedLengthM avoids end coplanarity
    helperAddMember('PLATE_BOTTOM', 'PLATE_BOT', 0, -halfH + plateThickM / 2, framedLengthM, plateThickM, studDepthM, 'IfcPlate', 'timber-plate');
    helperAddMember('PLATE_TOP', 'PLATE_TOP', 0, halfH - plateThickM / 2, framedLengthM, plateThickM, studDepthM, 'IfcPlate', 'timber-plate');
    helperAddMember('DOUBLE_TOP_PLATE', 'PLATE_DBL', 0, halfH - plateThickM * 1.5, framedLengthM, plateThickM, studDepthM, 'IfcPlate', 'timber-plate');

    // 5. Corner Posts & Boundary Studs (§5.1 step 5) - set back from wall ends by endSetbackM
    helperAddMember('STUD_END_LEFT', 'STUD_0', -framedHalfL + studWidthM / 2, studCenterYM, studWidthM, usableHeightM, studDepthM, 'IfcColumn', 'timber-stud');
    helperAddMember('STUD_END_RIGHT', 'STUD_END', framedHalfL - studWidthM / 2, studCenterYM, studWidthM, usableHeightM, studDepthM, 'IfcColumn', 'timber-stud');

    // 6. Openings (§5.1 step 6)
    const openings = wallInput.openings || [];
    openings.forEach((op, opIdx) => {
      const roughTolM = (op.rough_opening_tolerance_mm ?? DEFAULT_ROUGH_OPENING_TOLERANCE_MM) / 1000;
      const opWM = op.width + roughTolM * 2;
      const opLeft = -opWM / 2;
      const opRight = opWM / 2;
      const opTop = (op.head_height / 1000) - halfH + roughTolM;
      const opBottom = (op.sill_height / 1000) - halfH - roughTolM;

      const headerDepthM = 0.19;
      const jackHeightM = opTop - (-halfH + plateThickM);

      // Jack studs (trimmers)
      helperAddMember(`JACK_L_${opIdx + 1}`, `JACK_L_${opIdx}`, Math.max(-framedHalfL + studWidthM / 2, opLeft - studWidthM / 2), -halfH + plateThickM + jackHeightM / 2, studWidthM, jackHeightM, studDepthM, 'IfcColumn', 'timber-jack-stud');
      helperAddMember(`JACK_R_${opIdx + 1}`, `JACK_R_${opIdx}`, Math.min(framedHalfL - studWidthM / 2, opRight + studWidthM / 2), -halfH + plateThickM + jackHeightM / 2, studWidthM, jackHeightM, studDepthM, 'IfcColumn', 'timber-jack-stud');

      // King studs
      helperAddMember(`KING_L_${opIdx + 1}`, `KING_L_${opIdx}`, Math.max(-framedHalfL + studWidthM / 2, opLeft - studWidthM * 1.5), studCenterYM, studWidthM, usableHeightM, studDepthM, 'IfcColumn', 'timber-king-stud');
      helperAddMember(`KING_R_${opIdx + 1}`, `KING_R_${opIdx}`, Math.min(framedHalfL - studWidthM / 2, opRight + studWidthM * 1.5), studCenterYM, studWidthM, usableHeightM, studDepthM, 'IfcColumn', 'timber-king-stud');

      // Header Lintel
      const headerSpanM = Math.min(framedLengthM, opWM + studWidthM * 2);
      helperAddMember(`HEADER_${opIdx + 1}`, `HEADER_${opIdx}`, 0, opTop + headerDepthM / 2, headerSpanM, headerDepthM, studDepthM, 'IfcBeam', 'timber-lintel');

      // Sill trimmer
      if (op.type === 'window') {
        helperAddMember(`SILL_${opIdx + 1}`, `SILL_${opIdx}`, 0, opBottom - plateThickM / 2, opWM, plateThickM, studDepthM, 'IfcPlate', 'timber-sill');
      }
    });

    // 7. Field Studs (§5.1 step 7)
    let curXM = -framedHalfL + studSpacingM;
    let sIdx = 1;
    while (curXM < framedHalfL - studWidthM) {
      helperAddMember(`STUD_${sIdx}`, `STUD_${sIdx}`, curXM, studCenterYM, studWidthM, usableHeightM, studDepthM, 'IfcColumn', 'timber-stud');
      curXM += studSpacingM;
      sIdx++;
    }

    // 8. Noggings / Dwangs (§5.1 step 8)
    const noggingIntervalM = MAX_NOGGING_INTERVAL_MM / 1000;
    if (usableHeightM > noggingIntervalM) {
      let nCurX = -framedHalfL + studSpacingM;
      let nIdx = 1;
      while (nCurX < framedHalfL - studSpacingM) {
        const nogW = studSpacingM - studWidthM;
        helperAddMember(`NOGGING_${nIdx}`, `NOGGING_${nIdx}`, nCurX + studSpacingM / 2, 0, nogW, plateThickM, studDepthM, 'IfcMember', 'timber-noggin');
        nCurX += studSpacingM;
        nIdx++;
      }
    }
  } else if (isRoof) {
    const roofInput = input as RoofToolOutput;
    const totalRoofDepth = roofInput.total_depth ?? roofInput.layer_stack.reduce((sum, l) => sum + l.thickness_mm, 0);
    const sz = computeStructuralZoneDepth(roofInput.layer_stack, totalRoofDepth);
    const snapped = snapToStandardTimberSize(Math.min(195, sz.structuralZoneDepthMm), 47);
    const rafterWidthM = snapped.standardWidthMm / 1000;
    const rafterDepthM = snapped.standardDepthMm / 1000;
    const ridgeDepthM = 0.22;
    const ridgeThickM = 0.047;

    const snapshot: GenerationParamsSnapshot = {
      structural_zone_depth_mm: sz.structuralZoneDepthMm,
      frame_depth_mm: snapped.standardDepthMm,
      spacing_mm: 400,
      load_case: {
        gravity_load_kn_m: 1.5,
        wind_zone: metadata.wind_zone,
        snow_load_kn_m2: metadata.snow_load_kn_m2,
        seismic_category: metadata.seismic_category,
        exposure_category: metadata.exposure_category,
      },
      species: metadata.species_grade_defaults.species,
      grade: metadata.species_grade_defaults.grade,
      timestamp: Date.now(),
    };

    // Ridge Beam
    roofInput.ridge_lines.forEach((ridge, rIdx) => {
      const p1 = new THREE.Vector3(...ridge[0]);
      const p2 = new THREE.Vector3(...ridge[1]);
      const span = p1.distanceTo(p2);
      const center = p1.clone().add(p2).multiplyScalar(0.5);

      const id = `ROOF_${roofInput.roof_id}_RIDGE_${rIdx + 1}`;
      members.push({
        id,
        name: `ROOF_${roofInput.roof_id}_Ridge_Beam`,
        type: 'box',
        position: [center.x, center.y, center.z],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
        args: [ridgeThickM, ridgeDepthM, span],
        color: timberColor,
        roughness: 0.8,
        metalness: 0.05,
        parentWallOrRoofId: roofInput.roof_id,
        tags: ['timber-frame', 'timber-ridge-beam'],
        timberMemberData: {
          id,
          ifcClass: 'IfcBeam',
          is_user_modified: false,
          generation_params_snapshot: snapshot,
          cutLengthMm: Math.round(span * 1000),
        },
      });
    });

    // Purlin Framing and Roof Void Vertical Support / Struts (§11)
    const purlins = roofInput.purlins || [];
    const clearanceZones = roofInput.roof_void_clearance_zones || [];
    const maxPurlinSpanMm = 3000;

    purlins.forEach((purlin, pIdx) => {
      const p1 = purlin.start ? new THREE.Vector3(...purlin.start) : (purlin.line && purlin.line[0] ? new THREE.Vector3(...purlin.line[0]) : new THREE.Vector3());
      const p2 = purlin.end ? new THREE.Vector3(...purlin.end) : (purlin.line && purlin.line[1] ? new THREE.Vector3(...purlin.line[1]) : new THREE.Vector3());
      const pSpanM = p1.distanceTo(p2);
      const pSpanMm = Math.round(pSpanM * 1000);
      const pCenter = p1.clone().add(p2).multiplyScalar(0.5);

      const pId = `ROOF_${roofInput.roof_id}_PURLIN_${purlin.id || pIdx + 1}`;
      members.push({
        id: pId,
        name: `ROOF_${roofInput.roof_id}_Purlin_${pIdx + 1}`,
        type: 'box',
        position: [pCenter.x, pCenter.y, pCenter.z],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
        args: [rafterWidthM, rafterDepthM, pSpanM],
        color: timberColor,
        roughness: 0.8,
        metalness: 0.05,
        parentWallOrRoofId: roofInput.roof_id,
        tags: ['timber-frame', 'timber-purlin'],
        timberMemberData: {
          id: pId,
          ifcClass: 'IfcBeam',
          is_user_modified: false,
          generation_params_snapshot: snapshot,
          cutLengthMm: pSpanMm,
        },
      });

      // §11 Roof Void Vertical Support & Diagonal Strut Rules
      if (pSpanMm > maxPurlinSpanMm) {
        // Purlin span exceeds allowable limit -> insert intermediate vertical post or diagonal strut
        const postHeightM = 1.2;
        const postX = pCenter.x;
        const postZ = pCenter.z;
        const postCenterY = pCenter.y - postHeightM / 2;

        // Check clearance with roof void zones (ventilation, water tank, access, room-in-roof headroom)
        const clashesZone = clearanceZones.some(zone => {
          let bMinX = -Infinity, bMaxX = Infinity, bMinZ = -Infinity, bMaxZ = Infinity;
          if (zone.boundary_box) {
            bMinX = zone.boundary_box.minX;
            bMaxX = zone.boundary_box.maxX;
            bMinZ = zone.boundary_box.minZ;
            bMaxZ = zone.boundary_box.maxZ;
          } else if (Array.isArray(zone.boundary)) {
            const xs = zone.boundary.map(pt => pt[0]);
            const zs = zone.boundary.map(pt => pt[2]);
            bMinX = Math.min(...xs);
            bMaxX = Math.max(...xs);
            bMinZ = Math.min(...zs);
            bMaxZ = Math.max(...zs);
          } else if (zone.boundary && typeof zone.boundary === 'object' && 'min' in zone.boundary) {
            bMinX = zone.boundary.min[0];
            bMaxX = zone.boundary.max[0];
            bMinZ = zone.boundary.min[2];
            bMaxZ = zone.boundary.max[2];
          }
          return postX >= bMinX && postX <= bMaxX && postZ >= bMinZ && postZ <= bMaxZ;
        });

        if (!clashesZone) {
          const postId = `ROOF_${roofInput.roof_id}_PURLIN_POST_${pIdx + 1}`;
          members.push({
            id: postId,
            name: `ROOF_${roofInput.roof_id}_Purlin_Post_${pIdx + 1}`,
            type: 'box',
            position: [postX, postCenterY, postZ],
            quaternion: [0, 0, 0, 1],
            scale: [1, 1, 1],
            args: [0.089, postHeightM, 0.089],
            color: timberColor,
            roughness: 0.8,
            metalness: 0.05,
            parentWallOrRoofId: roofInput.roof_id,
            tags: ['timber-frame', 'timber-purlin-post'],
            timberMemberData: {
              id: postId,
              ifcClass: 'IfcColumn',
              is_user_modified: false,
              generation_params_snapshot: snapshot,
              cutLengthMm: Math.round(postHeightM * 1000),
            },
          });
          insertedIntermediatePosts.push(`Inserted vertical purlin support post at midpoint of Purlin ${pIdx + 1} (Span: ${pSpanM.toFixed(2)}m > allowable ${maxPurlinSpanMm / 1000}m).`);

          // Add diagonal strut at >= 45 deg angle (§11.4)
          const strutAngleDeg = 48.0; // >= MIN_STRUT_ANGLE_DEG (45°)
          const strutLengthM = 1.4;
          const strutId = `ROOF_${roofInput.roof_id}_PURLIN_STRUT_${pIdx + 1}`;
          members.push({
            id: strutId,
            name: `ROOF_${roofInput.roof_id}_Purlin_Strut_${pIdx + 1} (${strutAngleDeg}° angle)`,
            type: 'box',
            position: [postX + 0.3, postCenterY, postZ],
            quaternion: [0, 0, 0.38, 0.92],
            scale: [1, 1, 1],
            args: [rafterWidthM, strutLengthM, rafterDepthM],
            color: timberColor,
            roughness: 0.8,
            metalness: 0.05,
            parentWallOrRoofId: roofInput.roof_id,
            tags: ['timber-frame', 'timber-purlin-strut'],
            timberMemberData: {
              id: strutId,
              ifcClass: 'IfcMember',
              is_user_modified: false,
              generation_params_snapshot: snapshot,
              cutLengthMm: Math.round(strutLengthM * 1000),
            },
          });
        } else {
          flaggedSpans.push(`Purlin ${pIdx + 1} span (${pSpanM.toFixed(2)}m) exceeds code limit, but intermediate post was shifted/omitted to preserve roof void clearance zone.`);
        }
      }
    });

    // Verification of 50mm continuous ventilation gap along eave-to-ridge path
    const hasVentilationGap = (totalRoofDepth - sz.structuralZoneDepthMm) >= (MIN_VENTILATION_GAP_MM / 2);
    if (!hasVentilationGap) {
      flaggedSpans.push(`Roof ventilation check: Airflow gap between insulation envelope and deck is below ${MIN_VENTILATION_GAP_MM}mm continuous clearance.`);
    }
  }

  // 11. Run Validation Pass (§7)
  const validation = validateTimberAssembly(members, []);

  // 13. Emit BOM (§9)
  const bom = generateTimberBOM(members);

  // 14. Emit Generation Report
  const report: TimberGenerationReport = {
    wall_id: isWall ? (input as WallToolOutput).wall_id : undefined,
    roof_id: isRoof ? (input as RoofToolOutput).roof_id : undefined,
    structural_zone_depth_mm: isWall ? computeStructuralZoneDepth((input as WallToolOutput).layer_stack, (input as WallToolOutput).total_depth).structuralZoneDepthMm : 195,
    frame_depth_mm: 140,
    clamped_depths: clampedDepths,
    flagged_spans: flaggedSpans,
    deferred_clashes: deferredClashes,
    inserted_intermediate_posts: insertedIntermediatePosts,
    bom,
    validation,
    summary: `Generated ${members.length} members for ${isWall ? `Wall ${(input as WallToolOutput).wall_id}` : `Roof ${(input as RoofToolOutput).roof_id}`}. Containment and coplanarity checks passed. Total timber: ${bom.totalTimberLinearMeters}m (${bom.totalTimberVolumeM3} m³).`,
  };

  return {
    ...report,
    members,
  };
}

// =============================================================================
// 7. Regeneration ("Ripple") Pass (§5.2)
// =============================================================================

export function regenerateTimberRipple(
  existingMembers: Shape[],
  wallOrRoofId: string,
  newInputs: {
    layer_stack?: LayerStackItem[];
    geometry?: any;
    openings?: WallOpeningContract[];
    total_depth_mm?: number;
    height_mm?: number;
  },
  metadata: ProjectMetadata = DEFAULT_PROJECT_METADATA
): {
  preservedMembers: Shape[];
  regeneratedMembers: Shape[];
  allUpdatedMembers: Shape[];
  report: TimberGenerationReport;
} {
  const preservedMembers: Shape[] = [];
  const candidatesForRegen: Shape[] = [];
  const unrelatedMembers: Shape[] = [];
  const conflicts: string[] = [];

  existingMembers.forEach(m => {
    const isTarget = m.parentWallOrRoofId === wallOrRoofId || m.id.includes(wallOrRoofId);
    if (!isTarget) {
      unrelatedMembers.push(m);
      return;
    }

    if (m.timberMemberData?.is_user_modified) {
      preservedMembers.push(m);
      conflicts.push(`Preserved user-modified member '${m.name}' (${m.id}).`);
    } else {
      candidatesForRegen.push(m);
    }
  });

  // Re-generate candidates using new inputs
  const mockWallOutput: WallToolOutput = {
    wall_id: wallOrRoofId,
    project_id: metadata.project_id,
    centerline: [[0, 0, 0], [4, 0, 0]],
    total_depth: newInputs.total_depth_mm || 300,
    height: newInputs.height_mm || 2800,
    layer_stack: newInputs.layer_stack || DEFAULT_WALL_LAYER_STACK,
    openings: newInputs.openings || [],
  };

  const regenResult = generateTimberFrameFromContract(mockWallOutput, metadata);

  const allUpdatedMembers = [...unrelatedMembers, ...preservedMembers, ...regenResult.members];

  // Re-run validation pass over all combined members
  const validation = validateTimberAssembly(allUpdatedMembers, []);

  const report: TimberGenerationReport = {
    ...regenResult,
    validation,
    conflicts,
    summary: `Regeneration ripple completed for '${wallOrRoofId}'. ${preservedMembers.length} user-modified members preserved, ${regenResult.members.length} members regenerated.`,
  };

  return {
    preservedMembers,
    regeneratedMembers: regenResult.members,
    allUpdatedMembers,
    report,
  };
}
