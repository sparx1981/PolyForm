import type {
  TimberFrameParams,
  StructuralValidationRules,
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
