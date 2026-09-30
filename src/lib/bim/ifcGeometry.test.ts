import { describe, expect, it } from 'vitest';
import { IfcGeometryProviderRegistry, createIfcGeometryShapes } from './ifcGeometry';

const IFC = `ISO-10303-21;
HEADER; FILE_SCHEMA(('IFC4')); ENDSEC;
DATA;
#1=IFCPROJECT('project',$,'Project',$,$,$,$,$,$);
#2=IFCBUILDINGSTOREY('floor',$,'Ground',$,$,$,$,$,$,$);
#10=IFCWALL('wall-guid',$,'North Wall',$,$,$,$,$);
#20=IFCRELAGGREGATES('rel',$,$,$,#1,(#2));
#21=IFCRELCONTAINEDINSPATIALSTRUCTURE('contained',$,$,$,(#10),#2);
ENDSEC; END-ISO-10303-21;`;

const triangle = { positions: [0,0,0, 2,0,0, 0,2,0] };

describe('IFC geometry adapter', () => {
  it('attaches IFC metadata and spatial path to provider geometry', () => {
    const imported = createIfcGeometryShapes({
      metadataText: IFC,
      elements: [{ stepId: 10, geometry: triangle }],
    }, 'mock-ifc');
    expect(imported.shapes).toHaveLength(1);
    expect(imported.shapes[0].customData.ifc).toMatchObject({
      stepId: 10,
      globalId: 'wall-guid',
      type: 'IFCWALL',
      name: 'North Wall',
    });
    expect(imported.shapes[0].customData.ifc.spatialPath.map((x: any) => x.name)).toEqual(['Project','Ground','North Wall']);
    expect(imported.shapes[0].customData.assetProvenance.source).toBe('ifc');
  });

  it('supports swappable IFC geometry loaders', async () => {
    const registry = new IfcGeometryProviderRegistry();
    registry.register({
      id: 'mock',
      load: async () => ({ metadataText: IFC, elements: [{ stepId: 10, geometry: triangle }] }),
    });
    const imported = await registry.import('mock', new Uint8Array([1,2,3]));
    expect(registry.list()).toEqual(['mock']);
    expect(imported.shapes[0].customData.ifc.globalId).toBe('wall-guid');
  });

  it('reports geometry that has no matching IFC metadata', () => {
    const imported = createIfcGeometryShapes({
      metadataText: IFC,
      elements: [{ stepId: 999, geometry: triangle }],
    });
    expect(imported.missingMetadataStepIds).toEqual([999]);
  });
});
