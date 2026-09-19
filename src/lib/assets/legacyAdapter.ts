import type { EnvironmentState, MaterialInstance, MaterialRef } from './types';

export type LegacyDecision = 'replace' | 'retain';
export interface LegacyMapping {
  legacyNamespace: 'architectural' | 'terrain' | 'road' | 'premade-name' | 'plant-slot' | 'environment';
  legacyKey: string;
  targetAssetId?: `ph:material:${string}` | `ph:hdri:${string}`;
  targetRevision?: string;
  slot?: string;
  uvPolicy: 'preserve' | 'physical-scale' | 'authored';
  overridePolicy: 'preserve' | 'catalog-defaults';
  decision: LegacyDecision;
  reason: string;
  reviewedBy: string;
}

export interface LegacyMapFile { schemaVersion: 1; mappings: LegacyMapping[] }

export function resolveLegacyMaterial(map: LegacyMapFile, namespace: LegacyMapping['legacyNamespace'], key: string): MaterialInstance | null {
  const match = map.mappings.find(item => item.legacyNamespace === namespace && item.legacyKey === key);
  if (!match || match.decision !== 'replace' || !match.targetAssetId?.startsWith('ph:material:') || !match.targetRevision) return null;
  return { ref: { assetId: match.targetAssetId as MaterialRef['assetId'], revision: match.targetRevision } };
}

export function legacyEnvironmentState(skybox: string, intensity = 1, rotationDegrees = 0, blur = 0): EnvironmentState {
  return {
    ref: null,
    intensity,
    backgroundIntensity: intensity,
    rotationRadians: rotationDegrees * Math.PI / 180,
    blur,
    background: skybox !== 'none',
    quality: '2k',
    legacySkybox: skybox,
  };
}
