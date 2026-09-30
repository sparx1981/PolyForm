# PolyForm Developer SDK

The `sdk` object is available in the Developer Console and in saved developer scripts. The authoritative method catalogue used by both the in-app Developer Suite and the public SDK documentation is `src/components/marketing/sdkFullReference.tsx`.

## Current namespaces

- `sdk` — core primitives, editing, lighting, notes, view and diagnostics
- `sdk.architecture` — walls, rooms, openings, stairs, roofs and timber framing
- `sdk.referencePlans` — calibrated image/PDF reference underlays
- `sdk.externalAssets` — validation and insertion of uploaded/generated geometry
- `sdk.bim` — IFC metadata, spatial paths and pluggable IFC geometry providers
- `sdk.reconstruction` — reconstruction drafts, providers, review, commit and health checks
- `sdk.interiors` — detected rooms, parametric furniture, smart furnishing, cloth/soft-body baking
- `sdk.landscape` — terrain, plants, fences, water, patios and site furniture
- `sdk.materials`, `sdk.measurement`, `sdk.selection`, `sdk.camera`, `sdk.scene`, `sdk.outliner`
- `sdk.blockKit`, `sdk.worldView`, `sdk.text`, `sdk.drawing`, `sdk.toolbars`, `sdk.ai`

The SDK documentation parity test, `src/components/marketing/sdkFullReference.test.ts`, checks that every namespace and declared method in the `SDK` interface is represented by the reference.

## Recent workflows

### Detect and furnish rooms

```js
const rooms = sdk.interiors.listRooms();
console.table(rooms.map(r => ({ id: r.id, level: r.level, area: r.areaM2 })));

const plan = sdk.interiors.furnishRoom(rooms[0].id, 'soft-furnishings');
for (const item of plan.shapes) {
  if (item.customData?.semanticComponent?.simulation?.bakeable) {
    sdk.interiors.bakeSimulation(item.id, 0.38);
  }
}
```

Available furnishing presets are `bedroom`, `living-room`, `soft-furnishings`, `storage` and `minimal`.

### Flowing water

```js
sdk.landscape.addPond(
  [[0, 0], [8, 0], [8, 2], [0, 2]],
  {
    depth: 0.8,
    clarity: 'clear',
    flow: {
      mode: 'stream',
      direction: [1, 0.2],
      speed: 0.7,
      turbulence: 0.35,
    },
  },
);
```

Use `{ mode: 'still' }` or omit `flow` for ordinary pond/lake behaviour.

### Reconstruction pipeline

```js
const draft = sdk.reconstruction.fromImageObservation(observation);
const review = sdk.reconstruction.reviewDraft(draft);

const decisions = Object.fromEntries(
  review.items.map(item => [item.id, item.status !== 'error']),
);

const approved = sdk.reconstruction.applyReview(draft, decisions);
const result = sdk.reconstruction.commitDraft(approved, { includeFurniture: true });
console.log(result, sdk.reconstruction.checkModelHealth());
```

Image-provider registration is deliberately separate from the built-in Reconstruction Studio UI. A provider implements the documented recognition interface, is registered with `registerImageProvider`, then can be called through `reconstructImage`.

### IFC metadata and geometry

```js
const summary = sdk.bim.parseIfcMetadata(ifcText);
console.log(summary);

sdk.bim.registerGeometryProvider(myIfcProvider);
const imported = await sdk.bim.importGeometry(myIfcProvider.id, ifcBytes);
console.log(imported.shapes.length);
```

The SDK contains a provider-neutral IFC adapter. A bundled WebIFC/ThatOpen tessellator is not implied by this API; a geometry provider must currently be registered before `importGeometry` can tessellate IFC bytes.

### Generated/external geometry

```js
const validation = sdk.externalAssets.validate(assetInput);
if (!validation.errors.length) {
  const shape = sdk.externalAssets.add(assetInput);
  sdk.select(shape.id);
}
```


### Tool-equivalent modelling APIs

The Developer SDK exposes deterministic operations for modelling tools that would otherwise require viewport gestures.

```js
// Closed room using the same room assembly and exact wall mitres as the Wall tool.
const room = sdk.architecture.createRoom({
  width: 7,
  length: 5,
  height: 2.8,
  wallThickness: 0.2,
  justification: 'exterior',
  story: 1,
  includeFloor: true,
  includeFoundation: true,
});

// Architectural Style Library choices are available directly during creation.
const door = sdk.architecture.createDoor({
  style: 'double-french',
  width: 1.8,
  hostWallId: room.wallShapes[0].id,
});
const window = sdk.architecture.createWindow({
  style: 'porthole',
  hostWallId: room.wallShapes[0].id,
});

// Human scale references use the same procedural figure generator as the app.
console.table(sdk.architecture.listScaleFigureCharacters());
sdk.architecture.createScaleFigure({
  characterId: 'engineer-sam',
  height: 1.9,
  position: [2, 0, 2],
});
```

For drawn kernel geometry, Follow Me uses the same commit path as the interactive tool:

```js
const [profile] = sdk.drawing.shape([
  [-0.2, 0, 0], [0.2, 0, 0], [0.2, 0.4, 0], [-0.2, 0.4, 0],
]);
sdk.drawing.followMe(profile, {
  points: [[0, 0, 0], [0, 0, 4], [4, 0, 4]],
});
```

### Sections and annotations

```js
const section = sdk.sections.create({
  point: [0, 1.2, 0],
  normal: [0, 1, 0],
  size: 15,
});
sdk.sections.move(section.id, 0.4);
sdk.sections.flip(section.id);
sdk.sections.setLayerCut(section.id, 'ground', false);

sdk.measurement.addDimension(
  [0, 0, 0],
  [4, 0, 0],
  { text: 'Grid A', offset: [0, 0.5, 0] },
);
sdk.measurement.addLeader([2, 1, 0], [3, 2, 0], 'Beam');
sdk.measurement.addGuide([0, 0, 2], [1, 0, 0], 2);
```

### Civil roads, pads and parking

Civil/site grading is stored as terrain modifiers rather than ordinary shapes. The SDK operates on that same state:

```js
const road = sdk.civil.addRoad({
  points: [[0, 0, 0], [12, 0.2, 0], [20, 0.6, 5]],
  width: 7,
  maxGradePercent: 8,
  markings: 'bike-lanes',
  profile: { hasCurb: true, curbHeight: 0.15 },
});

const pad = sdk.civil.addPad({
  center: [8, 1.2, 8],
  dimensions: [20, 14],
  targetElevation: 1.2,
  batterDistance: 3,
  batterProfile: 'linear',
});

sdk.civil.setPadSurface(pad.id, {
  pattern: 'parking-striping',
  parkingConfig: {
    angle: 60,
    stallWidth: 2.7,
    stallDepth: 5.5,
    stripeColor: '#ffffff',
    doubleRow: true,
  },
});
```

### Editing water, patios and navigation

```js
const pond = sdk.landscape.addPond([[0, 0], [8, 0], [8, 2], [0, 2]]);
sdk.landscape.updatePond(pond.id, {
  clarity: 'clear',
  flow: { mode: 'stream', direction: [1, 0.2], speed: 0.7, turbulence: 0.35 },
});

const deck = sdk.landscape.addPatio(
  [[0, 0], [5, 0], [5, 4], [0, 4]],
  { kind: 'deck' },
);
sdk.landscape.updatePatio(deck.id, {
  settings: { railing: 'glass', lights: { enabled: true, spacing: 1.2 } },
  steps: [{ edge: 1, t: 0.5, width: 1.1 }],
});

sdk.camera.setNavigationMode('walk');
sdk.camera.configureWalk({ movementSpeed: 4.1, mouseSensitivity: 0.55 });
```

## MCP relationship

The MCP connector uses the same builders/SDK for model-safe remote workflows, but is intentionally task-oriented rather than exposing arbitrary browser code or provider registration. Its complete tool inventory is in `mcp/README.md`.

## Maintenance rule

When an SDK method is added or removed:

1. Update the `SDK` interface and implementation in `src/services/developerService.ts`.
2. Update `SDK_REFERENCE` in `src/components/marketing/sdkFullReference.tsx`.
3. Add or update an executable test/example.
4. If the capability is suitable for remote automation, update the MCP tool and `mcp/README.md`.
5. Run `npm test` and `npm run lint`; for MCP also run its own tests/typecheck.
