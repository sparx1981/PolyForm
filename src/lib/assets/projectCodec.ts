import type { EnvironmentState, MaterialInstance } from './types';
import { legacyEnvironmentState } from './legacyAdapter';

export interface AssetProjectState {
  assetSchemaVersion: 1;
  assetCatalogRelease: string;
  environment: EnvironmentState;
  materialBindings: Record<string, MaterialInstance>;
  migration?: { sourceVersion: number; mappingVersion?: string; migratedAt?: string };
}

export function readAssetProjectState(project: Record<string, unknown>): AssetProjectState {
  if (project.assetSchemaVersion === 1 && project.environment && typeof project.environment === 'object') {
    return {
      assetSchemaVersion: 1,
      assetCatalogRelease: typeof project.assetCatalogRelease === 'string' ? project.assetCatalogRelease : 'unknown',
      environment: project.environment as EnvironmentState,
      materialBindings: project.materialBindings && typeof project.materialBindings === 'object'
        ? project.materialBindings as Record<string, MaterialInstance> : {},
      ...(project.migration && typeof project.migration === 'object' ? { migration: project.migration as AssetProjectState['migration'] } : {}),
    };
  }
  return {
    assetSchemaVersion: 1,
    assetCatalogRelease: 'legacy',
    environment: legacyEnvironmentState(
      typeof project.skybox === 'string' ? project.skybox : 'none',
      typeof project.environmentIntensity === 'number' ? project.environmentIntensity : 1,
      typeof project.skyboxRotation === 'number' ? project.skyboxRotation : 0,
      typeof project.skyboxBlur === 'number' ? project.skyboxBlur : 0,
    ),
    materialBindings: {},
  };
}
