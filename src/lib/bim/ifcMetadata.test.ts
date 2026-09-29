import { describe, expect, it } from 'vitest';
import { ifcSpatialPath, parseIfcMetadata } from './ifcMetadata';

const IFC = `ISO-10303-21;
HEADER;
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('proj',$,'PolyForm Project',$,$,$,$,$,$);
#2=IFCSITE('site',$,'Site',$,$,$,$,$,$,$,$,$,$,$);
#3=IFCBUILDING('bldg',$,'House',$,$,$,$,$,$,$,$,$);
#4=IFCBUILDINGSTOREY('storey',$,'Ground Floor',$,$,$,$,$,$,$);
#5=IFCSPACE('space',$,'Living Room',$,$,$,$,$,$,$);
#10=IFCWALL('wall-guid',$,'North Wall',$,$,$,$,$);
#11=IFCDOOR('door-guid',$,'Front Door',$,$,$,$,$,$,$);
#20=IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('60min'),$);
#21=IFCPROPERTYSET('pset-guid',$,'Pset_WallCommon',$,(#20));
#22=IFCRELDEFINESBYPROPERTIES('rel',$,$,$,(#10),#21);
#30=IFCRELAGGREGATES('r1',$,$,$,#1,(#2));
#31=IFCRELAGGREGATES('r2',$,$,$,#2,(#3));
#32=IFCRELAGGREGATES('r3',$,$,$,#3,(#4));
#33=IFCRELAGGREGATES('r4',$,$,$,#4,(#5));
#34=IFCRELCONTAINEDINSPATIALSTRUCTURE('r5',$,$,$,(#10,#11),#4);
ENDSEC;
END-ISO-10303-21;`;

describe('IFC metadata foundation', () => {
  it('builds a spatial hierarchy without loading IFC geometry', () => {
    const model = parseIfcMetadata(IFC);
    expect(model.schema).toBe('IFC4');
    expect(model.project?.name).toBe('PolyForm Project');
    expect(model.byStepId[4].children).toEqual(expect.arrayContaining([5, 10, 11]));
    expect(ifcSpatialPath(model, 10).map(x => x.name)).toEqual([
      'PolyForm Project', 'Site', 'House', 'Ground Floor', 'North Wall',
    ]);
  });

  it('preserves GUIDs, entity types and property sets', () => {
    const model = parseIfcMetadata(IFC);
    const wall = model.byStepId[10];
    expect(wall.globalId).toBe('wall-guid');
    expect(wall.type).toBe('IFCWALL');
    expect(wall.propertySets.Pset_WallCommon.FireRating).toBe('60min');
    expect(model.countsByType.IFCWALL).toBe(1);
  });
});
