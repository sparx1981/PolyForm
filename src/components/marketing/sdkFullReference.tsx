/**
 * The complete `sdk` object surface, grouped the way the Developer Console's
 * "Documentation and Spec" tab groups it (by subsystem namespace). Kept in sync by hand with
 * the `SDK` interface in `src/services/developerService.ts` - every signature and grouping here
 * is real, not illustrative.
 */
export interface SdkMethod {
  name: string;
  signature: string;
  returns: string;
  description: string;
}

export interface SdkTag {
  id: string;
  title: string;
  description: string;
  methods: SdkMethod[];
}

const m = (name: string, signature: string, returns: string, description: string): SdkMethod => ({ name, signature, returns, description });

export const SDK_REFERENCE: SdkTag[] = [
  {
    id: 'core', title: 'Core',
    description: 'Primitives, materials, lighting, notes and view control. Available directly on `sdk`, with no namespace prefix.',
    methods: [
      m('createRectangle', 'sdk.createRectangle({ width, height, position? })', 'Shape', 'Create a flat rectangle.'),
      m('createBox', 'sdk.createBox({ width, height, depth, position? })', 'Shape', 'Create a box.'),
      m('createSphere', 'sdk.createSphere({ radius, position? })', 'Shape', 'Create a sphere.'),
      m('createCone', 'sdk.createCone({ radius, height, position? })', 'Shape', 'Create a cone.'),
      m('createPyramid', 'sdk.createPyramid({ radius, height, position? })', 'Shape', 'Create a pyramid.'),
      m('createDonut', 'sdk.createDonut({ radius, tube, position? })', 'Shape', 'Create a torus (donut).'),
      m('createDome', 'sdk.createDome({ radius, position? })', 'Shape', 'Create a dome.'),
      m('createCylinder', 'sdk.createCylinder({ radius, height, radiusTop?, position? })', 'Shape', 'Create a cylinder, optionally tapered into a cone.'),
      m('createPoly', 'sdk.createPoly({ vertices, position? })', 'Shape', 'Create a polygon from world-space points, ready for Extrude.'),
      m('addObject', 'sdk.addObject(type, props)', 'Shape', 'Add a raw shape of any catalog type.'),
      m('pushPull', 'sdk.pushPull(shape, amount)', 'Shape', 'Extrude or intrude a shape (the Extrude tool).'),
      m('applyColor', 'sdk.applyColor(shape, color)', 'void', 'Colour a shape.'),
      m('setTag', 'sdk.setTag(shape, key, value)', 'void', 'Set a custom key/value tag on a shape.'),
      m('setName', 'sdk.setName(shape, name)', 'void', 'Rename a shape.'),
      m('getObjectByName', 'sdk.getObjectByName(name)', 'Shape | undefined', 'Find a shape by its name.'),
      m('getSelectedObject', 'sdk.getSelectedObject()', 'Shape | null', 'Get the currently selected shape.'),
      m('select', 'sdk.select(idOrIds)', 'void', 'Select one or more objects by id.'),
      m('deleteObject', 'sdk.deleteObject(id)', 'void', 'Delete an object.'),
      m('saveScene', 'sdk.saveScene(name)', 'void', 'Save the current model.'),
      m('setSkybox', 'sdk.setSkybox(type, blur?, rotation?, intensity?)', 'void', 'Set the sky/environment preset.'),
      m('setFog', 'sdk.setFog(settings)', 'void', 'Configure scene fog.'),
      m('addLight', 'sdk.addLight(lightData)', 'void', 'Add a light to the scene.'),
      m('setBevelType', "sdk.setBevelType(type)", 'void', "Set the default bevel style ('radius' or 'chamfer')."),
      m('setBevel', 'sdk.setBevel(shape, { amount?, type?, segments? })', 'void', "Bevel a shape's edges."),
      m('divideSurface', 'sdk.divideSurface(shapeId, faceIndex, divisions?)', 'void', 'Subdivide a face into a grid.'),
      m('addProjectorLight', 'sdk.addProjectorLight(lightData)', 'void', 'Add a projector light that casts an image or video.'),
      m('performCSG', "sdk.performCSG(targetId, cutterId, operation)", 'void', "Boolean-combine two shapes ('SUBTRACTION', 'UNION' or 'INTERSECTION')."),
      m('deformObject', 'sdk.deformObject(id, { radius, strength, direction })', 'void', 'Sculpt an object with a radial deform brush.'),
      m('addNote', 'sdk.addNote(text, position)', 'void', 'Pin a note to the model.'),
      m('setNoteVisibility', 'sdk.setNoteVisibility(id, visible)', 'void', 'Show or hide a note.'),
      m('toggleAllNotes', 'sdk.toggleAllNotes(visible)', 'void', 'Show or hide every note.'),
      m('addRectLight', 'sdk.addRectLight(color, intensity, position, scale?)', 'void', 'Add a rectangular area light.'),
      m('animateSun', 'sdk.animateSun(cycleSpeed?)', 'void', 'Animate the sun across the sky.'),
      m('toggleFloor', 'sdk.toggleFloor(enabled)', 'void', 'Show or hide the ground floor.'),
      m('toggleGrid', 'sdk.toggleGrid(enabled)', 'void', 'Show or hide the reference grid.'),
      m('setZoom', 'sdk.setZoom(zoom)', 'void', 'Set the camera zoom.'),
      m('resetView', 'sdk.resetView(view)', 'void', "Snap the camera to a standard view ('perspective', 'plan', 'front', 'rear', 'left' or 'right')."),
      m('setCameraDefaults', 'sdk.setCameraDefaults(position, target)', 'void', "Set the camera's home position."),
      m('focusObject', 'sdk.focusObject(id)', 'void', 'Frame an object in the camera.'),
      m('getSyncStatus', 'sdk.getSyncStatus()', "'synced' | 'syncing' | 'error' | 'offline'", 'Get whether the model is synced.'),
      m('getCollaborators', 'sdk.getCollaborators()', 'Collaborator[]', 'List the people active in the model.'),
      m('diagLog', 'sdk.diagLog(category, message, values?)', 'void', 'Write an entry to the AI Diagnostic Log.'),
      m('setContactFriction', 'sdk.setContactFriction(enabled)', 'void', 'Toggle move-contact friction (pauses briefly when two surfaces touch).'),
      m('generateModel', 'sdk.generateModel(prompt)', 'void', 'Trigger AI Generate from a text prompt.'),
      m('openWebpage', 'sdk.openWebpage(url)', 'void', 'Open a URL in a floating window.'),
      m('log', 'sdk.log(message)', 'void', "Print to the console's output panel."),
    ],
  },
  {
    id: 'architecture', title: 'architecture',
    description: 'Walls, rooms, doors, windows, stairs, roofs and timber framing.',
    methods: [
      m('createRoof', 'sdk.architecture.createRoof({ roofType?, width, depth, ridgeHeight?, pitchAngleDeg?, … })', 'Shape', 'Create a parametric roof (gable, hip or parapet flat).'),
      m('updateRoof', 'sdk.architecture.updateRoof(roofId, params)', 'void', "Update an existing roof's parameters."),
      m('listRoofs', 'sdk.architecture.listRoofs()', 'Shape[]', 'List every roof in the model.'),
      m('createStairs', 'sdk.architecture.createStairs({ style?, width?, height?, length?, numSteps?, … })', 'Shape', 'Create a parametric staircase flight.'),
      m('createRailing', 'sdk.architecture.createRailing({ length?, height?, position?, color? })', 'Shape', 'Create a safety railing.'),
      m('createRoom', 'sdk.architecture.createRoom({ width, length, height?, wallThickness?, … })', '{ roomId, wallShapes, floorShape?, ceilingShape? }', 'Create a room: its walls, floor and ceiling.'),
      m('createWall', 'sdk.architecture.createWall({ start?, end?, length?, height?, thickness?, … })', 'Shape', 'Create a single wall.'),
      m('createDoor', 'sdk.architecture.createDoor({ width?, height?, depth?, position?, color? })', 'Shape', 'Create a door assembly that cuts its own opening.'),
      m('createWindow', 'sdk.architecture.createWindow({ width?, height?, depth?, position?, color? })', 'Shape', 'Create a window frame that cuts its own opening.'),
      m('setWallTransparency', 'sdk.architecture.setWallTransparency({ overall?, exterior?, interior? })', 'void', 'Set how see-through walls are.'),
      m('generateTimberFraming', 'sdk.architecture.generateTimberFraming({ roofId?, spacing?, rafterWidth?, … })', 'Shape[]', 'Generate studs, plates, headers, noggins, rafters and ridges.'),
      m('clearTimberFraming', 'sdk.architecture.clearTimberFraming()', 'void', 'Remove all generated timber framing.'),
      m('configureRoofDefaults', 'sdk.architecture.configureRoofDefaults(settings)', 'void', 'Set the defaults new roofs are created with.'),
      m('getRoofDefaults', 'sdk.architecture.getRoofDefaults()', 'RoofConfigDefaults', 'Read the current roof defaults.'),
      m('configureStairsDefaults', 'sdk.architecture.configureStairsDefaults(settings)', 'void', 'Set the defaults new stairs are created with.'),
      m('getStairsDefaults', 'sdk.architecture.getStairsDefaults()', 'StairsConfigDefaults', 'Read the current stairs defaults.'),
      m('configureTimberFramingSettings', 'sdk.architecture.configureTimberFramingSettings(settings)', 'void', 'Set the defaults timber framing is generated with.'),
      m('getTimberFramingSettings', 'sdk.architecture.getTimberFramingSettings()', 'TimberFramingConfigDefaults', 'Read the current timber framing defaults.'),
      m('configureWallSettings', 'sdk.architecture.configureWallSettings(settings)', 'void', 'Set the defaults new walls are created with.'),
      m('getWallSettings', 'sdk.architecture.getWallSettings()', 'WallConfigDefaults', 'Read the current wall defaults.'),
      m('setActiveStory', 'sdk.architecture.setActiveStory(story)', 'void', 'Set which storey new geometry is added to.'),
      m('getActiveStory', 'sdk.architecture.getActiveStory()', 'number', 'Read the active storey.'),
      m('configureDoorDefaults', 'sdk.architecture.configureDoorDefaults(settings)', 'void', 'Set the defaults new doors are created with.'),
      m('getDoorDefaults', 'sdk.architecture.getDoorDefaults()', 'DoorConfigDefaults', 'Read the current door defaults.'),
      m('configureWindowDefaults', 'sdk.architecture.configureWindowDefaults(settings)', 'void', 'Set the defaults new windows are created with.'),
      m('getWindowDefaults', 'sdk.architecture.getWindowDefaults()', 'WindowConfigDefaults', 'Read the current window defaults.'),
    ],
  },
  {
    id: 'landscape', title: 'landscape',
    description: 'Terrain, planting and site furniture.',
    methods: [
      m('addPlant', 'sdk.landscape.addPlant(speciesId?, { position?, scale?, rotation?, variation?, color? })', 'Shape', 'Plant a tree, shrub or other species from the plant catalog.'),
      m('addSiteFurniture', "sdk.landscape.addSiteFurniture(type, { position?, rotation?, color?, … })", 'Shape', "Add a bench, lamp, fence run, rock or railing ('bench' | 'lamp' | 'fence' | 'rock' | 'railing')."),
      m('createTerrain', 'sdk.landscape.createTerrain({ width, depth, resolution, topography, … })', 'Shape', "Create terrain ('flat', 'rolling', 'ridge' or 'terraced')."),
      m('applyTerrainTexture', 'sdk.landscape.applyTerrainTexture(textureId)', 'void', 'Paint a texture preset onto the terrain.'),
      m('listPlantCatalog', 'sdk.landscape.listPlantCatalog()', 'PlantSpecies[]', 'List the plant species available to addPlant.'),
      m('listTerrainTextures', 'sdk.landscape.listTerrainTextures()', 'LandscapeTexturePreset[]', 'List the terrain texture presets.'),
      m('configureLandscapeDefaults', 'sdk.landscape.configureLandscapeDefaults(settings)', 'void', 'Set landscape-wide defaults.'),
      m('getLandscapeDefaults', 'sdk.landscape.getLandscapeDefaults()', 'LandscapeConfigDefaults', 'Read the current landscape defaults.'),
      m('configureSculptSettings', "sdk.landscape.configureSculptSettings({ radius?, strength?, mode? })", 'void', "Set the terrain sculpting brush's radius, strength and mode."),
      m('getSculptSettings', 'sdk.landscape.getSculptSettings()', 'object', 'Read the current sculpting brush settings.'),
      m('configureRoadSettings', 'sdk.landscape.configureRoadSettings({ width?, curbHeight?, material? })', 'void', 'Set the defaults for the path/road tool.'),
      m('getRoadSettings', 'sdk.landscape.getRoadSettings()', 'object', 'Read the current path/road settings.'),
    ],
  },
  {
    id: 'materials', title: 'materials',
    description: 'PBR materials and edge-line rendering.',
    methods: [
      m('applyMaterial', 'sdk.materials.applyMaterial(target, material)', 'void', 'Apply a named preset or a PBR material spec to a shape.'),
      m('setEdgeLines', 'sdk.materials.setEdgeLines({ enabled?, color?, opacity?, thickness? })', 'void', 'Configure the dark edge lines between adjacent faces.'),
      m('listPresets', 'sdk.materials.listPresets()', 'string[]', 'List the available material preset names.'),
      m('configureMaterialDefaults', 'sdk.materials.configureMaterialDefaults(settings)', 'void', 'Set the defaults new materials are created with.'),
      m('getMaterialDefaults', 'sdk.materials.getMaterialDefaults()', 'MaterialConfigDefaults', 'Read the current material defaults.'),
    ],
  },
  {
    id: 'measurement', title: 'measurement',
    description: 'Dimensions, distance and units.',
    methods: [
      m('addDimension', 'sdk.measurement.addDimension(start, end, label?)', 'Shape', 'Add a dimension label between two points.'),
      m('measureDistance', 'sdk.measurement.measureDistance(p1, p2)', '{ distance, dx, dy, dz, horizontalRun, rise, pitchDeg, formatted }', 'Measure the distance, run, rise and pitch between two points.'),
      m('setUnit', "sdk.measurement.setUnit(unit)", 'void', "Set the display unit ('m', 'ft', 'in' or 'mm')."),
      m('getUnit', 'sdk.measurement.getUnit()', 'string', 'Read the current display unit.'),
      m('configureMeasurementSettings', 'sdk.measurement.configureMeasurementSettings(settings)', 'void', 'Set measurement-wide defaults.'),
      m('getMeasurementSettings', 'sdk.measurement.getMeasurementSettings()', 'MeasurementConfigDefaults', 'Read the current measurement defaults.'),
    ],
  },
  {
    id: 'toolbars', title: 'toolbars',
    description: "Build your own toolbars with your own icons (the Developer Extensibility Suite's Custom toolbars).",
    methods: [
      m('create', 'sdk.toolbars.create({ id?, title, position?, orientation?, items?, … })', 'CustomToolbarDef', 'Create a custom toolbar.'),
      m('addButton', 'sdk.toolbars.addButton(toolbarId, item)', 'void', 'Add a button to a custom toolbar.'),
      m('addToBasicToolbar', 'sdk.toolbars.addToBasicToolbar(item)', 'void', "Add a button to the app's own basic toolbar."),
      m('configureToolbar', 'sdk.toolbars.configureToolbar(toolbarId, settings)', 'void', "Update a custom toolbar's settings."),
      m('configureButton', 'sdk.toolbars.configureButton(toolbarId, buttonId, settings)', 'void', "Update a custom toolbar button's settings."),
      m('configureBasicToolbarButton', 'sdk.toolbars.configureBasicToolbarButton(buttonId, settings)', 'void', "Update a basic-toolbar button's settings."),
      m('getToolbar', 'sdk.toolbars.getToolbar(toolbarId)', 'CustomToolbarDef | undefined', 'Look up a custom toolbar by id.'),
      m('getButton', 'sdk.toolbars.getButton(toolbarId, buttonId)', 'CustomToolbarButton | undefined', 'Look up a toolbar button by id.'),
      m('removeButton', 'sdk.toolbars.removeButton(toolbarId, buttonId)', 'void', 'Remove a button from a custom toolbar.'),
      m('removeFromBasicToolbar', 'sdk.toolbars.removeFromBasicToolbar(buttonId)', 'void', 'Remove a button from the basic toolbar.'),
      m('removeToolbar', 'sdk.toolbars.removeToolbar(toolbarId)', 'void', 'Remove a custom toolbar entirely.'),
      m('list', 'sdk.toolbars.list()', 'CustomToolbarDef[]', 'List every custom toolbar.'),
      m('getBasicToolbarButtons', 'sdk.toolbars.getBasicToolbarButtons()', 'CustomToolbarItem[]', 'List the buttons on the basic toolbar.'),
      m('clear', 'sdk.toolbars.clear()', 'void', 'Remove every custom toolbar.'),
    ],
  },
  {
    id: 'selection', title: 'selection',
    description: 'Selecting, grouping and transforming objects.',
    methods: [
      m('select', 'sdk.selection.select(idOrIds)', 'void', 'Select one or more objects.'),
      m('deselectAll', 'sdk.selection.deselectAll()', 'void', 'Clear the selection.'),
      m('getSelected', 'sdk.selection.getSelected()', 'Shape[]', 'List the currently selected shapes.'),
      m('group', 'sdk.selection.group(ids, groupName?)', 'string', 'Group objects together; returns the new group id.'),
      m('ungroup', 'sdk.selection.ungroup(groupIdOrIds)', 'void', 'Ungroup one or more groups.'),
      m('duplicateObject', 'sdk.selection.duplicateObject(id, offset?)', 'Shape | null', 'Duplicate an object, optionally offset.'),
      m('hideObject', 'sdk.selection.hideObject(id, hidden)', 'void', 'Show or hide an object.'),
      m('isolateObject', 'sdk.selection.isolateObject(id)', 'void', 'Hide everything except one object.'),
      m('unhideAll', 'sdk.selection.unhideAll()', 'void', 'Show every hidden object.'),
      m('transformObject', 'sdk.selection.transformObject(id, { position?, rotation?, scale? })', 'void', 'Move, rotate or scale an object.'),
      m('alignObjects', "sdk.selection.alignObjects(ids, axis, alignment)", 'void', "Align objects along an axis ('x' | 'y' | 'z', 'min' | 'center' | 'max')."),
      m('setFilter', "sdk.selection.setFilter(filter)", 'void', "Restrict what clicking selects ('all' | 'shapes' | 'surfaces')."),
      m('setMode', "sdk.selection.setMode(mode)", 'void', "Set the selection tool's drag mode ('lasso' | 'marquee')."),
    ],
  },
  {
    id: 'camera', title: 'camera',
    description: 'Camera projection, views and depth clipping.',
    methods: [
      m('setProjection', "sdk.camera.setProjection(mode)", 'void', "Switch between 'perspective' and 'orthographic'."),
      m('resetView', 'sdk.camera.resetView(view)', 'void', 'Snap the camera to a standard view.'),
      m('setDepthClipping', 'sdk.camera.setDepthClipping({ enabled?, near?, far? })', 'void', "Set the camera's near/far clipping planes."),
      m('setAutoOrbit', 'sdk.camera.setAutoOrbit(enabled, speed?)', 'void', 'Turn on automatic orbiting of the camera.'),
      m('focusObject', 'sdk.camera.focusObject(id)', 'void', 'Frame an object in the camera.'),
      m('setCameraDefaults', 'sdk.camera.setCameraDefaults(position, target)', 'void', "Set the camera's home position."),
      m('setZoom', 'sdk.camera.setZoom(zoom)', 'void', 'Set the camera zoom.'),
    ],
  },
  {
    id: 'ai', title: 'ai',
    description: 'AI Generate, AI Renderer and the assistant panel.',
    methods: [
      m('generateModel', 'sdk.ai.generateModel(prompt)', 'void', 'Generate objects from a text description.'),
      m('openRenderer', 'sdk.ai.openRenderer(prompt?, style?)', 'void', 'Open AI Renderer for a high-fidelity render of the viewport.'),
      m('askAssistant', 'sdk.ai.askAssistant(query?)', 'void', 'Open the AI assistant panel with an optional starting question.'),
    ],
  },
  {
    id: 'scene', title: 'scene',
    description: 'Scene export/import, history and stats.',
    methods: [
      m('exportJSON', 'sdk.scene.exportJSON()', 'string', 'Export the whole scene as JSON.'),
      m('importJSON', 'sdk.scene.importJSON(jsonString)', 'void', 'Replace the scene from exported JSON.'),
      m('clearScene', 'sdk.scene.clearScene(confirm?)', 'void', 'Clear the scene.'),
      m('getStats', 'sdk.scene.getStats()', '{ shapeCount, typeCounts, estimatedVertices, memoryEstimateKB, bounds }', 'Get scene statistics.'),
      m('undo', 'sdk.scene.undo()', 'void', 'Step back one change.'),
      m('redo', 'sdk.scene.redo()', 'void', 'Step forward one change.'),
      m('saveScene', 'sdk.scene.saveScene(name)', 'void', 'Save the current model.'),
      m('getShapeGeometry', 'sdk.scene.getShapeGeometry(id)', '{ positions, normals, uvs? } | null', "Read a shape's raw geometry, by id."),
    ],
  },
  {
    id: 'outliner', title: 'outliner',
    description: 'Introspect the grouping and hierarchy the Outliner panel shows.',
    methods: [
      m('list', 'sdk.outliner.list()', '{ id, name, type, tags? }[]', 'List every entry in the Outliner.'),
      m('find', 'sdk.outliner.find(predicate)', '{ id, name, type, tags? } | null', 'Find the first Outliner entry matching a predicate.'),
    ],
  },
  {
    id: 'blockKit', title: 'blockKit',
    description: "PolyForm's built-in LEGO-style stud-block catalog and placement tool.",
    methods: [
      m('list', 'sdk.blockKit.list()', '{ id, label, category }[]', 'List every block part in the catalog.'),
      m('getGeometry', 'sdk.blockKit.getGeometry(partId)', '{ positions, normals, uvs? } | null', "Read a block part's raw geometry."),
      m('place', 'sdk.blockKit.place(partId, color?)', 'void', 'Arm the placement tool for a block part.'),
      m('setPreventOverlap', 'sdk.blockKit.setPreventOverlap(enabled)', 'void', 'Toggle whether placement refuses to overlap an existing block.'),
    ],
  },
  {
    id: 'worldView', title: 'worldView',
    description: 'The Google Maps overlay under the model.',
    methods: [
      m('importMap', 'sdk.worldView.importMap({ lat, lng, zoom?, altitude?, radius? })', 'void', 'Lay a map under the model at a location.'),
      m('setLocation', 'sdk.worldView.setLocation(lat, lng)', 'void', 'Move the map to a new location.'),
      m('setRadius', 'sdk.worldView.setRadius(radius)', 'void', 'Set how much ground the map covers.'),
      m('setZoom', 'sdk.worldView.setZoom(zoom)', 'void', 'Set the map zoom level.'),
      m('setAltitude', 'sdk.worldView.setAltitude(altitude)', 'void', 'Set the altitude the map sits at.'),
    ],
  },
];

export const SDK_METHOD_COUNT = SDK_REFERENCE.reduce((n, tag) => n + tag.methods.length, 0);
