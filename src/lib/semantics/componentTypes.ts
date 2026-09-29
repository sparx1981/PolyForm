/**
 * Semantic contracts for richer PolyForm objects. These deliberately sit
 * above Shape/kernel geometry so architecture remains deterministic while
 * furniture, imported BIM and generated assets can carry behaviour.
 */

export type SemanticObjectKind =
  | 'furniture'
  | 'fixture'
  | 'soft-furnishing'
  | 'character'
  | 'bim-reference'
  | 'generated-asset';

export type PlacementHost = 'floor' | 'wall' | 'ceiling' | 'surface' | 'room' | 'free';

export interface PlacementProfile {
  hosts: PlacementHost[];
  preferredHost?: PlacementHost;
  wallOffsetM?: number;
  floorClearanceM?: number;
  /** Functional clearance footprint beyond the visible object bounds. */
  clearanceM?: { front?: number; back?: number; left?: number; right?: number };
  allowOverlapWith?: SemanticObjectKind[];
}

export type SimulationType = 'cloth' | 'fluid' | 'softbody' | 'character';

export interface SimulationProfile {
  type: SimulationType;
  /** Static/baked geometry remains authoritative when simulation is unavailable. */
  enabledInEditor?: boolean;
  enabledInPresentation?: boolean;
  /** Allows generated upholstery/cloth to settle once and then become ordinary geometry. */
  bakeable?: boolean;
}

export interface ComponentDefinition<P extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  name: string;
  kind: SemanticObjectKind;
  defaultParams: P;
  placement: PlacementProfile;
  simulation?: SimulationProfile;
  bom?: {
    group: string;
    item: string;
    unit?: string;
  };
}

export interface ComponentInstance<P extends Record<string, unknown> = Record<string, unknown>> {
  definitionId: string;
  params: P;
  roomId?: string;
  source?: {
    type: 'polyform' | 'uploaded' | 'generated' | 'ifc';
    externalId?: string;
    sourceFile?: string;
  };
}
