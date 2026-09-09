import type {
  TimberFrameParams,
  StructuralValidationRules,
  ProjectMetadata,
  LayerStackItem,
  FloorLayerStackItem,
  JointLibraryEntry,
} from '../types';

export const DEFAULT_TIMBER_FRAME_PARAMS: TimberFrameParams = {
  studSpacing: 0.40, // 400mm c/c standard stud spacing (in meters)
  memberWidth: 0.045, // 45mm nominal timber member width (in meters)
  memberDepth: 0.140, // 140mm nominal timber member depth (in meters)
  species: 'Spruce-Pine-Fir',
  grade: 'C24',
  headerDepthRule: 'code-table',
  revealDistance: 0.025, // 25mm reveal inset offset from wall/roof surface plane (in meters)
  advancedModeEnabled: false,
  offsetJoists: false,
  offsetFloorJoists: false,
  offsetWallJoists: false,
  offsetFloorNoggins: false,
  offsetWallNoggins: false,
};

// -----------------------------------------------------------------------------
// Specification Parameter Defaults (§8)
// -----------------------------------------------------------------------------

export const STANDARD_TIMBER_SIZES: Array<{ width_mm: number; depth_mm: number; name: string }> = [
  { width_mm: 38, depth_mm: 89, name: '38x89' },
  { width_mm: 38, depth_mm: 140, name: '38x140' },
  { width_mm: 38, depth_mm: 184, name: '38x184' },
  { width_mm: 38, depth_mm: 235, name: '38x235' },
  { width_mm: 45, depth_mm: 95, name: '45x95' },
  { width_mm: 45, depth_mm: 145, name: '45x145' },
  { width_mm: 45, depth_mm: 195, name: '45x195' },
  { width_mm: 45, depth_mm: 220, name: '45x220' },
];

export const STANDARD_PURCHASABLE_LENGTHS_MM: number[] = [2400, 3000, 3600, 4200, 4800];
export const SAW_KERF_MM = 3;
export const COINCIDENCE_EPSILON_MM = 0.5;
export const HARDWARE_CLASH_CLEARANCE_MM = 5;
export const DEFAULT_ROUGH_OPENING_TOLERANCE_MM = 10;
export const MAX_NOGGING_INTERVAL_MM = 1350;
export const BEARING_TOLERANCE_MM = 10;

export const DEFAULT_PROJECT_METADATA: ProjectMetadata = {
  project_id: 'default-project-metadata',
  wind_zone: 'Zone 2 (Basic wind speed 23 m/s)',
  snow_load_kn_m2: 0.75,
  seismic_category: 'A',
  exposure_category: 'B',
  species_grade_defaults: {
    species: 'Spruce-Pine-Fir (SPF)',
    grade: 'C24',
  },
};

export const DEFAULT_WALL_LAYER_STACK: LayerStackItem[] = [
  { name: 'Exterior Cladding', thickness_mm: 20, material: 'Timber Weatherboard', side: 'exterior' },
  { name: 'Cavity / Rainscreen Gap', thickness_mm: 25, material: 'Ventilated Air Cavity', side: 'exterior' },
  { name: 'Breather Membrane', thickness_mm: 1, material: 'Vapour Permeable Polypropylene', side: 'exterior' },
  { name: 'Sheathing (OSB/3)', thickness_mm: 11, material: 'OSB/3 Board', side: 'exterior' },
  { name: 'Structural Zone', thickness_mm: 140, material: 'C24 Kiln-Dried Timber', side: 'structural' },
  { name: 'Service Void', thickness_mm: 25, material: 'Internal Battened Cavity', side: 'interior' },
  { name: 'Plasterboard', thickness_mm: 12.5, material: 'Gypsum Wallboard', side: 'interior' },
];

export const DEFAULT_ROOF_LAYER_STACK: LayerStackItem[] = [
  { name: 'Roof Covering', thickness_mm: 25, material: 'Interlocking Concrete Tiles', side: 'exterior' },
  { name: 'Battens & Counter-battens', thickness_mm: 38, material: 'Softwood Battens', side: 'exterior' },
  { name: 'Roofing Underlay', thickness_mm: 1, material: 'Breather Underlay', side: 'exterior' },
  { name: 'Sarking Board', thickness_mm: 15, material: 'OSB/3 Sarking', side: 'exterior' },
  { name: 'Structural Rafter Zone', thickness_mm: 195, material: 'C24 Structural Softwood', side: 'structural' },
  { name: 'Insulation & Service Cavity', thickness_mm: 50, material: 'PIR Insulation Void', side: 'interior' },
  { name: 'Ceiling Lining', thickness_mm: 12.5, material: 'Plasterboard Lining', side: 'interior' },
];

export const DEFAULT_FLOOR_LAYER_STACK: FloorLayerStackItem[] = [
  { name: 'Floor Covering', thickness_mm: 15, material: 'Hardwood / Engineered Flooring', side: 'above' },
  { name: 'Decking / Subfloor Board', thickness_mm: 22, material: 'P5 Moisture-Resistant Chipboard', side: 'above' },
  { name: 'Structural Zone (Joists)', thickness_mm: 195, material: 'C24 Kiln-Dried Timber / I-Joist', side: 'structural', structural_zone: true },
  { name: 'Service Void', thickness_mm: 25, material: 'Resilient Acoustic Battens Void', side: 'below' },
  { name: 'Ceiling Finish', thickness_mm: 12.5, material: 'Gypsum Plasterboard', side: 'below' },
];

export const DEFAULT_FLOOR_JOIST_SPACING_MM = 400;
export const DEFAULT_FLOOR_STRUTTING_INTERVAL_MM = 2000;
export const DEFAULT_FLOOR_IMPOSED_LOAD_KN_M2 = 1.5;
export const DEFAULT_FLOOR_DEFLECTION_LIMIT = 'L/360';
export const DEFAULT_HEADROOM_MIN_MM = 2000;
export const SERVICE_HOLE_MAX_DIAMETER_RATIO = 0.25;
export const SERVICE_NOTCH_MAX_DEPTH_RATIO = 0.125;
export const MIN_STRUT_ANGLE_DEG = 45;
export const MIN_VENTILATION_GAP_MM = 50;

export const JOINT_LIBRARY: Record<string, JointLibraryEntry> = {
  'stud-to-sole-plate': {
    connection_type: 'toe-nail',
    hardware_sku: 'NAIL-PASLODE-3.1X90',
    clearance_mm: 5,
    description: 'Skew-nailed with 2x 3.1x90mm ring-shank nails or base clip bracket',
  },
  'stud-to-top-plate': {
    connection_type: 'toe-nail',
    hardware_sku: 'NAIL-PASLODE-3.1X90',
    clearance_mm: 5,
    description: 'Direct-nailed through top plate with 2x 3.1x90mm nails',
  },
  'header-to-jack': {
    connection_type: 'bracket',
    hardware_sku: 'SIMPSON-L90-BRACKET',
    clearance_mm: 5,
    description: 'Simpson Strong-Tie L90 Angle Bracket',
  },
  'rafter-to-wall-plate': {
    connection_type: 'birdsmouth',
    hardware_sku: 'SIMPSON-H2.5A-TIE',
    clearance_mm: 5,
    description: 'Birdsmouth seat cut with Simpson H2.5A hurricane/rafter tie bracket',
  },
  'joist-to-rim': {
    connection_type: 'hanger',
    hardware_sku: 'SIMPSON-JHA270-47',
    clearance_mm: 5,
    description: 'Simpson JHA270/47 Face-Fix Joist Hanger',
  },
  'ridge-to-rafter': {
    connection_type: 'rafter-tie',
    hardware_sku: 'SIMPSON-RTA12-CONNECTOR',
    clearance_mm: 5,
    description: 'Ridge board with opposed rafter gusset tie plates',
  },
  'corner-post': {
    connection_type: 'corner-bracket',
    hardware_sku: 'SIMPSON-ML24Z-ANGLE',
    clearance_mm: 5,
    description: 'Heavy duty reinforcing angle plate for external corners',
  },
};

export const STRUCTURAL_VALIDATION_RULES: StructuralValidationRules = {
  maxStudSpacing: 0.60, // 600mm max permissible stud spacing under Eurocode 5 / BS 5268 / IRC
  maxStudSpacingMm: 600,
  headerDepthBrackets: [
    {
      maxOpeningWidth: 1.0,
      minHeaderDepth: 0.14,
      maxOpeningWidthMm: 1000,
      minHeaderDepthMm: 140,
      description: 'Up to 1.0m (1000mm) opening span: 140mm header depth',
    },
    {
      maxOpeningWidth: 1.5,
      minHeaderDepth: 0.19,
      maxOpeningWidthMm: 1500,
      minHeaderDepthMm: 190,
      description: '1.0m to 1.5m (1500mm) opening span: 190mm header depth',
    },
    {
      maxOpeningWidth: 2.0,
      minHeaderDepth: 0.24,
      maxOpeningWidthMm: 2000,
      minHeaderDepthMm: 240,
      description: '1.5m to 2.0m (2000mm) opening span: 240mm header depth',
    },
    {
      maxOpeningWidth: 3.0,
      minHeaderDepth: 0.29,
      maxOpeningWidthMm: 3000,
      minHeaderDepthMm: 290,
      description: '2.0m to 3.0m (3000mm) opening span: 290mm header depth',
    },
  ],
};
