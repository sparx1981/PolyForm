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

## MCP relationship

The MCP connector uses the same builders/SDK for model-safe remote workflows, but is intentionally task-oriented rather than exposing arbitrary browser code or provider registration. Its complete tool inventory is in `mcp/README.md`.

## Maintenance rule

When an SDK method is added or removed:

1. Update the `SDK` interface and implementation in `src/services/developerService.ts`.
2. Update `SDK_REFERENCE` in `src/components/marketing/sdkFullReference.tsx`.
3. Add or update an executable test/example.
4. If the capability is suitable for remote automation, update the MCP tool and `mcp/README.md`.
5. Run `npm test` and `npm run lint`; for MCP also run its own tests/typecheck.
