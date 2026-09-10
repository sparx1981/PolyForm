export type {
  CivilToolMode,
  ToolMode,
  TerrainModifierType,
  PadPrimitiveType,
  BatterFalloffType,
  CurbDitchProfile,
  RoadMarkingPreset,
  ParkingAngle,
  ParkingStallConfig,
  CutFillMetrics,
  PadModifier,
  RoadModifier,
  SurfaceModifier,
  TerrainModifier,
} from '../../types';

export const DEFAULT_CURB_DITCH_PROFILE = {
  width: 0.15,
  height: 0.15,
  ditchWidth: 1.2,
  ditchDepth: 0.35,
  hasCurb: true,
  hasDitch: false,
} as const;

export const DEFAULT_PARKING_STALL_CONFIG = {
  angle: 90 as const,
  stallWidth: 2.75,
  stallDepth: 5.5,
  stripeColor: '#FFFFFF',
  doubleRow: false,
};
