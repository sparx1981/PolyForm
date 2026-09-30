/** Example snippets and interface text for the Developers page playground. All of it is editable in the CMS. */

export interface PlaygroundExample { id: string; title: string; text: string; code: string }

export const PLAYGROUND_TEXT = {
  eyebrow: 'Try it live',
  heading: 'Run the SDK in your browser.',
  intro: 'Pick an example, change a number and press Run. The preview draws what your script builds. It is a lightweight version of the sdk, so the full SDK in PolyForm does much more.',
  examplesLabel: 'Examples',
  editorLabel: 'Script',
  run: 'Run',
  running: 'Running…',
  reset: 'Reset',
  consoleLabel: 'Console',
  consoleEmpty: 'Output from console.log appears here.',
  previewLabel: 'Preview',
  previewEmpty: 'Nothing to draw yet. Press Run.',
  previewHint: 'Drag to orbit, scroll to zoom.',
  objects: 'objects',
  errorPrefix: 'Error:',
  noWebgl: 'Your browser could not start the 3D preview.',
  cta: 'Open PolyForm to use the full SDK',
} as const;

export const PLAYGROUND_EXAMPLES: PlaygroundExample[] = [
  {
    id: 'room-roof',
    title: 'Room with a roof',
    text: 'Walls, a floor and a pitched roof from a handful of numbers. Try a different pitch or roof type.',
    code: `// A garden room: four walls, a floor and a roof
const room = sdk.architecture.createRoom({
  width: 5,
  length: 4,
  height: 2.6,
  wallColor: '#f5efe6',
  floorColor: '#8b7d6b',
});

sdk.architecture.createRoof({
  roofType: 'gable',   // try 'hip' or 'parapet'
  width: 5,
  depth: 4,
  pitchAngleDeg: 32,
  position: [0, 2.6, 0],
  color: '#b45309',
});

console.log('Walls built:', room.wallShapes.length);`,
  },
  {
    id: 'columns',
    title: 'A row of columns',
    text: 'A loop turns one column into a colonnade. Change the count or the spacing.',
    code: `// A colonnade with a loop
const count = 7;
const spacing = 1.6;

for (let i = 0; i < count; i++) {
  const x = (i - (count - 1) / 2) * spacing;
  sdk.createCylinder({ radius: 0.28, height: 3.2, position: [x, 1.6, 0] });
}

// A beam across the top
sdk.createBox({
  width: (count - 1) * spacing + 1,
  height: 0.3,
  depth: 0.7,
  position: [0, 3.35, 0],
  color: '#e7e5e4',
});

console.log('Shapes:', sdk.scene.getStats().shapeCount);`,
  },
  {
    id: 'stairs',
    title: 'Spiral steps',
    text: 'Each tread is a short wall from the centre post outwards, turned a little more each time. Change the number of steps or the turn.',
    code: `// A spiral staircase around a central post
const steps = 22;
const rise = 0.17;
const turn = 0.34;   // radians per step
const reach = 1.5;   // how far each tread sticks out

sdk.createCylinder({ radius: 0.16, height: steps * rise + 0.6, position: [0, (steps * rise + 0.6) / 2, 0] });

for (let i = 0; i < steps; i++) {
  const angle = i * turn;
  sdk.architecture.createWall({
    start: [0, rise * (i + 1), 0],
    end: [Math.cos(angle) * reach, rise * (i + 1), Math.sin(angle) * reach],
    height: 0.08,
    thickness: 0.6,
    color: i % 2 ? '#d6d3d1' : '#a8a29e',
  });
}

console.log('Top of the stairs is', (steps * rise).toFixed(2), 'm up');`,
  },
  {
    id: 'materials',
    title: 'Colours and finishes',
    text: 'Paint shapes from a palette. Swap the colours or the order to restyle the whole row.',
    code: `// Paint a row of blocks from a palette
const palette = ['#0f766e', '#0ea5e9', '#f59e0b', '#e11d48', '#7c3aed'];

palette.forEach((colour, i) => {
  const block = sdk.createBox({ width: 1, height: 1 + i * 0.5, depth: 1, position: [i * 1.4 - 2.8, (1 + i * 0.5) / 2, 0] });
  sdk.applyColor(block, colour);
});

// A plinth under everything
const plinth = sdk.createBox({ width: 8, height: 0.2, depth: 2, position: [0, -0.1, 0] });
sdk.applyColor(plinth, '#e7e5e4');

console.log('Coloured', palette.length, 'blocks');`,
  },
];
