# Developer SDK recipes

Each block is intended to be pasted independently into PolyForm's Developer Console.

## 1. Create a room and furnish it

```js
sdk.architecture.createRoom({
  width: 6,
  length: 5,
  height: 2.8,
  includeFloor: true,
});

const rooms = sdk.interiors.listRooms();
const room = rooms[0];
console.log(room);

sdk.interiors.furnishRoom(room.id, 'living-room');
```

## 2. Demonstrate cloth and soft-body settling

```js
const sofa = sdk.interiors.addFurniture('sofa', {
  position: [-1.3, 0, 0],
});

const curtain = sdk.interiors.addFurniture('curtain', {
  position: [1.5, 0, -2.3],
});

sdk.interiors.bakeSimulation(sofa.id, 0.42);
sdk.interiors.bakeSimulation(curtain.id, 0.32);
```

## 3. Create a flowing garden stream

```js
sdk.landscape.addPond(
  [[0, 0], [9, 0], [9, 2], [0, 2]],
  {
    depth: 0.7,
    clarity: 'clear',
    flow: {
      mode: 'stream',
      direction: [1, 0],
      speed: 0.65,
      turbulence: 0.3,
    },
  },
);
```

## 4. Inspect model health

```js
const report = sdk.reconstruction.checkModelHealth();
console.log('Errors:', report.errors);
console.log('Warnings:', report.warnings);
console.log(report);
```

## 5. Calibrate a reference plan

```js
const calibration = {
  pixelA: [100, 100],
  pixelB: [900, 100],
  knownDistanceM: 8,
};

const scale = sdk.referencePlans.calibrate(
  { pixelWidth: 1200, pixelHeight: 800 },
  calibration,
);

console.log(scale);

// To add the underlay, provide an imageUrl/data URL in the source:
// sdk.referencePlans.add(
//   { kind: 'image', name: 'Ground floor', imageUrl, pixelWidth: 1200, pixelHeight: 800 },
//   calibration,
//   { opacity: 0.55, locked: true },
// );
```

## 6. Parse IFC metadata before importing geometry

```js
const model = sdk.bim.parseIfcMetadata(ifcText);
console.log(model);

// Geometry import requires a registered provider:
// sdk.bim.registerGeometryProvider(provider);
// const imported = await sdk.bim.importGeometry(provider.id, ifcBytes);
```

## 7. WorldView street life and automatic lighting

```js
sdk.worldView.setStreetLife({ level: 'normal', inEditor: true });
sdk.worldView.autoStreetLights(true);

console.log(sdk.worldView.listRoutes());
```

## 8. Validate externally generated geometry

```js
const result = sdk.externalAssets.validate(assetInput);
console.log(result);

if (!result.errors.length) {
  const shape = sdk.externalAssets.add(assetInput);
  sdk.select(shape.id);
}
```

## 9. Recognise a local orthogonal floor plan

```js
const draft = sdk.reconstruction.recogniseOrthogonalPlan(
  { width: imageWidth, height: imageHeight, data: rgbaPixels },
  { metresPerPixel: 0.02, threshold: 150 },
);

console.log('Walls recognised:', draft.walls.length);
```

## 10. Profile a repeatable viewport workload

```js
sdk.performance.setEnabled(true);
sdk.performance.startBenchmark();

// Read the latest completed run later in the same interactive session.
const latest = sdk.performance.latest();
if (latest) {
  console.log(sdk.performance.toMarkdown(latest));
}
```

## 11. Build civil roads and a parking pad

```js
const road = sdk.civil.addRoad({
  points: [[0, 0, 0], [12, 0.2, 0], [20, 0.6, 5]],
  width: 7,
  markings: 'bike-lanes',
});

const pad = sdk.civil.addPad({
  center: [8, 1.2, 8],
  dimensions: [20, 14],
  batterProfile: 'curved',
});

sdk.civil.setPadSurface(pad.id, {
  pattern: 'parking-striping',
  parkingConfig: { angle: 60, stallWidth: 2.7, stallDepth: 5.5, stripeColor: '#ffffff', doubleRow: true },
});
```

For signatures and return types, use Developer Suite → Documentation or `docs/DEVELOPER_SDK.md`.
