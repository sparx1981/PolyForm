import type { Shape } from '../../types';
import {
  createExternalAssetShape,
  type GeneratedGeometryInput,
} from '../assets/externalAsset';
import {
  ifcSpatialPath,
  parseIfcMetadata,
  type IfcModelSummary,
} from './ifcMetadata';

export interface IfcGeometryElement {
  stepId: number;
  geometry: GeneratedGeometryInput;
  position?: [number, number, number];
  color?: string;
}

export interface IfcGeometryProviderResult {
  metadataText: string;
  elements: IfcGeometryElement[];
}

export interface IfcGeometryProvider {
  id: string;
  load(source: ArrayBuffer | Uint8Array): Promise<IfcGeometryProviderResult>;
}

export interface IfcGeometryImport {
  model: IfcModelSummary;
  shapes: Shape[];
  missingMetadataStepIds: number[];
}

export function createIfcGeometryShapes(
  result: IfcGeometryProviderResult,
  providerId = 'ifc-provider',
): IfcGeometryImport {
  const model = parseIfcMetadata(result.metadataText);
  const missingMetadataStepIds: number[] = [];
  const shapes = result.elements.map(element => {
    const entity = model.byStepId[element.stepId];
    if (!entity) missingMetadataStepIds.push(element.stepId);
    const path = entity ? ifcSpatialPath(model, element.stepId) : [];
    const shape = createExternalAssetShape({
      name: entity?.name || `IFC ${entity?.type ?? 'element'} #${element.stepId}`,
      geometry: element.geometry,
      position: element.position,
      color: element.color ?? '#d9dde2',
      provenance: {
        source: 'ifc',
        provider: providerId,
        externalId: entity?.globalId ?? String(element.stepId),
      },
    });
    shape.tags = [...(shape.tags ?? []), 'bim', entity?.type?.toLowerCase() ?? 'ifc-element'];
    shape.customData = {
      ...shape.customData,
      ifc: {
        stepId: element.stepId,
        globalId: entity?.globalId,
        type: entity?.type,
        name: entity?.name,
        description: entity?.description,
        propertySets: entity?.propertySets ?? {},
        spatialPath: path.map(item => ({
          stepId: item.stepId,
          type: item.type,
          name: item.name,
          globalId: item.globalId,
        })),
      },
    };
    return shape;
  });
  return { model, shapes, missingMetadataStepIds: [...new Set(missingMetadataStepIds)].sort((a,b) => a-b) };
}

export class IfcGeometryProviderRegistry {
  private providers = new Map<string, IfcGeometryProvider>();

  register(provider: IfcGeometryProvider): void {
    if (!provider.id.trim()) throw new Error('IFC geometry provider id is required.');
    this.providers.set(provider.id, provider);
  }

  list(): string[] {
    return [...this.providers.keys()].sort();
  }

  async import(
    providerId: string,
    source: ArrayBuffer | Uint8Array,
  ): Promise<IfcGeometryImport> {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Unknown IFC geometry provider: ${providerId}`);
    return createIfcGeometryShapes(await provider.load(source), providerId);
  }
}
