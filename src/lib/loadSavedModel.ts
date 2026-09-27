import { readAssetProjectState } from './assets/projectCodec';
import { normalizeGraphicsSettings } from './graphics/graphicsSettings';
import type { useApp } from '../AppContext';

/**
 * Applies a saved model document (as stored in Firestore's `models` collection) to the live
 * app state - shared by TopBar's "Open" gallery and the marketing site's My Designs page.
 */
export function applySavedModelToAppState(model: any, api: ReturnType<typeof useApp>) {
  const assetState = readAssetProjectState(model);
  api.setShapes(model.shapes || []);
  api.setTags(model.tags || []);
  api.setScenes(model.scenes || []);
  if (model.customMaterials) api.setCustomMaterials(model.customMaterials);
  api.setGraphicsSettings(normalizeGraphicsSettings(model.graphicsSettings));
  if (model.animations) api.setAnimations(model.animations);
  if (model.notes) api.setNotes(model.notes);
  if (model.customLights) api.setCustomLights(model.customLights);
  const legacySkybox = assetState.environment.legacySkybox;
  api.setEnvironment(assetState.environment);
  api.setMaterialBindings(assetState.materialBindings);
  if (legacySkybox) api.setSkybox(legacySkybox as Parameters<typeof api.setSkybox>[0]);
  api.setSkyboxBlur(assetState.environment.blur);
  api.setSkyboxRotation(assetState.environment.rotationRadians * 180 / Math.PI);
  api.setEnvironmentIntensity(assetState.environment.intensity);
  api.setCurrentModelId(model.id || null);
  api.setCurrentModelName(model.name || null);
}
