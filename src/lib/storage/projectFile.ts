/**
 * The complete `.polyform` project file: everything a model is made of, in one JSON document.
 * Used by Save File / Open File and by the Google Drive and Trimble Connect storage options, so
 * a model saved anywhere comes back exactly as it was (including drawn geometry, timber framing
 * and terrain edits, which version 3 files left out).
 */
export const PROJECT_FILE_FORMAT = 'polyform';
export const PROJECT_FILE_VERSION = 4;
export const PROJECT_FILE_MIME = 'application/json';
export const PROJECT_FILE_EXTENSION = '.polyform';

export interface ProjectState {
  name?: string;
  shapes: unknown[];
  tags: unknown[];
  scenes: unknown[];
  customMaterials: unknown[];
  graphicsSettings?: unknown;
  animations: unknown[];
  notes: unknown[];
  customLights: unknown[];
  timberFrameParams?: unknown;
  terrainModifiers: unknown[];
  environment?: unknown;
  materialBindings?: unknown;
  /** Serialized drawing-kernel graph (surfaces drawn with the line, rectangle and push/pull tools). */
  kernel?: unknown;
  assetSchemaVersion?: number;
  assetCatalogRelease?: string;
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export function buildProjectFile(state: ProjectState, savedAt = new Date()): string {
  return JSON.stringify({
    format: PROJECT_FILE_FORMAT,
    version: PROJECT_FILE_VERSION,
    appName: 'PolyForm 3D',
    savedAt: savedAt.toISOString(),
    ...state,
  });
}

export class ProjectFileError extends Error {}

/** Reads a project file (version 3 or 4, or a bare `{ shapes: [...] }` export). */
export function parseProjectFile(text: string): ProjectState {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProjectFileError('This file is not a PolyForm project (it is not valid JSON).');
  }
  if (!data || typeof data !== 'object' || (data.format !== PROJECT_FILE_FORMAT && !Array.isArray(data.shapes))) {
    throw new ProjectFileError('This file is not a PolyForm project.');
  }
  if (typeof data.version === 'number' && data.version > PROJECT_FILE_VERSION) {
    throw new ProjectFileError('This project was saved by a newer version of PolyForm.');
  }
  return {
    name: typeof data.name === 'string' ? data.name : undefined,
    shapes: list(data.shapes),
    tags: list(data.tags),
    scenes: list(data.scenes),
    customMaterials: list(data.customMaterials),
    graphicsSettings: data.graphicsSettings,
    animations: list(data.animations),
    notes: list(data.notes),
    customLights: list(data.customLights),
    timberFrameParams: data.timberFrameParams ?? undefined,
    terrainModifiers: list(data.terrainModifiers),
    environment: data.environment,
    materialBindings: data.materialBindings,
    kernel: data.kernel ?? null,
    assetSchemaVersion: data.assetSchemaVersion,
    assetCatalogRelease: data.assetCatalogRelease,
  };
}

/** A safe file name for a model name. */
export function projectFileName(modelName: string): string {
  const base = modelName.replace(/[^a-zA-Z0-9_\- ]/g, '_').trim() || 'PolyForm-Design';
  return `${base}${PROJECT_FILE_EXTENSION}`;
}
