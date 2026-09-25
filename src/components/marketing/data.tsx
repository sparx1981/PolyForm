import type { LucideIcon } from 'lucide-react';
import {
  ArrowDown, PenLine, House, Leaf, SunMedium, Footprints, Users, Globe, Mountain, CloudRain, Sparkles,
  Ruler, Wand2, FolderOpen, Eye, Camera, LayoutDashboard, Hammer, PencilRuler, Terminal, BookOpen, FileText,
  Circle, LayoutGrid, AppWindow, Activity, Cloud, HardDrive, Building2, FileBox, Share2, Map,
  MousePointer2, Eraser, PaintBucket, Square, ArrowUpFromLine, Move, RotateCw,
} from 'lucide-react';

export type SpecItem = { name: string; key: string; text: string };

export type ShowcaseTab = {
  icon: LucideIcon;
  label: string;
  title: string;
  body: string;
  points: string[];
  shot: string;
};

export const SHOWCASE_TABS: ShowcaseTab[] = [
  {
    icon: PenLine, label: 'Model', title: 'Draw it, then pull it up',
    body: 'Lines, rectangles, circles and polygons become faces. Extrude turns them into solids, and Subtract carves one shape out of another.',
    points: ['Extrude (P), Subtract (X) and Deform (D)', 'Snaps to endpoints, midpoints and axes', 'Type exact sizes in the status bar as you draw'],
    shot: 'Screenshot: a rectangle being pulled into a box',
  },
  {
    icon: House, label: 'Architecture', title: 'Walls, rooms and roofs',
    body: 'Walls, rooms and floors, doors and windows that cut their own openings, stairs, and roofs that fit any footprint.',
    points: ['Gable, hip and parapet flat roofs', 'Stack Story Level for the next floor', 'Timber Frame Engine for studs, plates and rafters'],
    shot: 'Screenshot: two-storey house with its roof',
  },
  {
    icon: Leaf, label: 'Landscape', title: 'Gardens and landscape',
    body: 'Shape the terrain, lay grass and paths, plant trees and flowers, and add fences, patios, decks and ponds.',
    points: ['Terrain from isolines or sculpting brushes', 'Parametric grass and wildflower meadows', 'Grading pads with cut and fill volumes', 'Patio and deck quantities for estimating'],
    shot: 'Screenshot: garden with pond, patio and planting',
  },
  {
    icon: SunMedium, label: 'Light and weather', title: 'Light, weather and materials',
    body: 'Real sunlight and shadows, rain and snow, and realistic materials for brick, timber, stone and glass.',
    points: ['Skyboxes, fog and custom lights, including projectors', 'Clouds, mist and wind', 'Poly Haven material library'],
    shot: 'Screenshot: the house at golden hour, or in the rain',
  },
  {
    icon: Footprints, label: 'Walk through', title: 'Walk through it',
    body: 'Step inside at eye level and walk from room to room, or orbit the whole design.',
    points: ['Gravity, collision and stairs', 'Move with WASD; jump, sprint and crouch', 'On-screen joystick on touch devices'],
    shot: 'Screenshot: first-person view inside the house',
  },
  {
    icon: Users, label: 'Collaborate', title: 'Design it together',
    body: 'Invite people by email or a join link and edit the same model live. See where they are pointing and what they are moving as it happens.',
    points: ['Live cursors and move previews', 'Project messaging inside the modeller', 'Notes pinned to the model'],
    shot: 'Screenshot: two collaborators’ cursors on one model',
  },
];

export type FeatureSection = {
  id: string;
  icon: LucideIcon;
  title: string;
  body: string;
  items: SpecItem[];
};

const it = (name: string, key: string, text: string): SpecItem => ({ name, key, text });

export const FEATURE_SECTIONS: FeatureSection[] = [
  {
    id: 'modelling', icon: PenLine, title: 'Modelling tools',
    body: 'Draw on the ground or on any face, then push, pull, carve and shape. Every tool has a hotkey, and the status bar takes exact dimensions as you go.',
    items: [
      it('Line', 'L', 'Connected segments that snap to axes and vertices.'),
      it('Rectangle', 'R', 'Drag, or click once and type width and depth.'),
      it('Circle and polygon', 'C', 'Trace shapes on the ground or on a face.'),
      it('Extrude', 'P', 'Extrude faces into solids, or push them back in.'),
      it('Subtract', 'X', 'Carve a hole using one object as the cutter.'),
      it('Bevel, fillet and chamfer', '', 'Round or flatten edges.'),
      it('Deform', 'D', 'Sculpt vertices with a soft brush.'),
      it('Move, Rotate, Scale', 'M · Q · S', 'Gizmo transforms, with optional contact friction.'),
      it('3D primitives', '', 'Sphere, cone, pyramid, torus and dome.'),
    ],
  },
  {
    id: 'architecture', icon: House, title: 'Architecture',
    body: 'Walls, rooms and floors, doors and windows that cut their own openings, stairs, and roofs that fit any footprint.',
    items: [
      it('Wall Tool', '', 'Set thickness and height, click each corner.'),
      it('Door Assembly', '', 'Frames and cuts its own opening.'),
      it('Window Frame', '', 'Frames and cuts its own opening.'),
      it('Staircase Flight', '', 'Parametric stairs and single steps or risers.'),
      it('Stack Story Level', '', 'Duplicate walls onto the next floor.'),
      it('Parametric Roof Generator', '', 'Gable, hip and parapet flat roofs with fascia and eaves.'),
      it('Timber Frame Engine', '', 'Studs, plates, headers, noggins, rafters and ridges.'),
      it('Scale Figure', '', 'A person for reference; walk-through in Walk Mode.'),
    ],
  },
  {
    id: 'terrain', icon: Mountain, title: 'Terrain',
    body: 'Plot the ground, form it from isolines or a mesh, and sculpt it with brushes. Level pads for the building and see how much earth moves.',
    items: [
      it('Plot Terrain', '', 'Set out the ground around the model.'),
      it('Form from Isolines/Mesh', '', 'Build terrain from contours or an existing mesh.'),
      it('Embed & Fit', '', 'Sit the building into the ground.'),
      it('Sculpting Brushes', '', 'Raise, lower and smooth, with fenced or masked brushing.'),
      it('Path & Road Tools', '', 'Spline paths and roads cut into the terrain.'),
      it('Grading Pads', '', 'Parametric pads with cut and fill volumes.'),
      it('Zone & Subdivision', '', 'Divide the plot into zones.'),
      it('Dynamic Materials & Shading', '', 'Paint grass, soil and surfaces onto the ground.'),
    ],
  },
  {
    id: 'landscape', icon: Leaf, title: 'Garden and landscape',
    body: 'Plant trees and shrubs, grow grass and wildflowers, and build the garden: fences, ponds, patios, decks, railings, lights, benches and boulders.',
    items: [
      it('Plant Tree / Bush', '', 'Trees and shrubs that sway in the wind.'),
      it('Grass', '', 'Parametric grass that grows to fit the ground, swaying in the wind.'),
      it('Wildflowers', '', 'Parametric wildflower meadows scattered and coloured procedurally.'),
      it('Fence', '', 'Draw a run; posts and panels follow the ground.'),
      it('Pond / Lake', '', 'The ground is dug into a basin and filled with water.'),
      it('Patio / Decking', '', 'Paving set into the ground, or a timber deck on posts.'),
      it('Safety Railing', '', 'Timber, glass or cable.'),
      it('Light Fixture', '', 'Garden lights that glow at night.'),
      it('Bench and Boulder', '', 'Park benches and faceted rocks.'),
      it('Quantities', '', 'Area, perimeter, slab count and board length.'),
    ],
  },
  {
    id: 'location', icon: Globe, title: 'Site location',
    body: 'WorldView lays a Google Maps overlay at the origin, under your model. Search for an address or type coordinates, and set how much ground it covers.',
    items: [
      it('Address search', '', 'Find the site by address.'),
      it('Latitude and longitude', '', 'Place the map precisely.'),
      it('Map Coverage', '50–450 m', 'Default 100 m.'),
      it('Scriptable', '', 'sdk.worldView.importMap()'),
    ],
  },
  {
    id: 'light', icon: SunMedium, title: 'Light and materials',
    body: 'Real sunlight and shadows, skyboxes and fog, your own lights, and realistic materials for brick, timber, stone and glass.',
    items: [
      it('Skybox', '', 'Golden Hour, Woodland and more; blur, intensity, rotation.'),
      it('Sun and shadows', '', 'Sun intensity, animation speed and ambient occlusion.'),
      it('Custom lights', '', 'Spot, point, directional and projector.'),
      it('Projector', '', 'Casts an image or looping video; static or spinning.'),
      it('Fog', '', 'Standard or Super Mega, with density and height.'),
      it('Materials', '', 'Poly Haven library, plain finishes and PBR controls.'),
    ],
  },
  {
    id: 'weather', icon: CloudRain, title: 'Weather',
    body: 'Turn on weather for an area around the model and set the wind. Each layer has its own density, size, colour and speed.',
    items: [
      it('Rain and snow', '', 'Fall speed, gravity and turbulence.'),
      it('Clouds', '', 'Puffy, wispy or layered; fast or volumetric.'),
      it('Mist', '', 'Altitude and thickness.'),
      it('Wind', 'm/s', 'East–west and north–south.'),
      it('Wet glass', '', 'Rain runs down the glazing.'),
    ],
  },
  {
    id: 'animation', icon: Sparkles, title: 'Animation and scenes',
    body: 'Place particle effects and wildlife in the scene, and save camera scenes to fly between viewpoints when you present.',
    items: [
      it('Effects', '', 'Confetti, fire, smoke, sparks and magic aura.'),
      it('Wildlife', '', 'Birds taking off from a perch, starling flocks, and bees.'),
      it('Scale and density', '', 'Size each effect to the design.'),
      it('Looping', '', 'Loop, or play once.'),
      it('Scenes', '', 'Saved viewpoints with thumbnails; click to fly there.'),
    ],
  },
  {
    id: 'walk', icon: Footprints, title: 'Walk through it',
    body: 'Walk Mode puts you inside at eye level, with gravity and collision, so you can climb the stairs and stand on the deck.',
    items: [
      it('Walk Mode', 'WASD', 'Space to jump, Shift to sprint, C to crouch, Esc to exit.'),
      it('Look Around', '', 'Turn the camera without moving.'),
      it('Portal Navigation', '', 'Jump between points in the model.'),
      it('Camera Depth Clipping', '', 'Near and far clipping planes.'),
    ],
  },
  {
    id: 'measure', icon: Ruler, title: 'Measure and plan',
    body: 'Tape measure, protractor, plan and elevation views, and a split view to see two angles at once.',
    items: [
      it('Tape measure', '', 'Measure between any two points.'),
      it('Protractor', '', 'Measure and set angles.'),
      it('Plan and elevation', '', 'Orthographic views of the model.'),
      it('Units', 'mm · cm · m', 'Choose in Settings.'),
    ],
  },
  {
    id: 'collaboration', icon: Users, title: 'Collaboration',
    body: 'Invite people to a saved design and work on it together in real time.',
    items: [
      it('Invite by email', '', 'Or generate a join link for invited people.'),
      it('Live cursors', '', 'Colour-coded per person, with name pills.'),
      it('Move previews', '', 'See a labelled ghost as someone moves an object.'),
      it('Project Messaging', '', 'Chat docked in the panel stack, or floating.'),
      it('Notes', 'N', 'Pinned to geometry, with a completed state.'),
      it('Access', '', 'Owners can revoke any collaborator.'),
    ],
  },
  {
    id: 'ai', icon: Wand2, title: 'AI tools',
    body: 'Generate objects from a description, render the current view, or turn a photo into a 3D model.',
    items: [
      it('AI Generate', '', 'Describe a model; it is placed around what is already there.'),
      it('AI Renderer', '', 'A high-fidelity render of the viewport.'),
      it('Photo to 3D', '', 'From Import / Export in the menu.'),
    ],
  },
  {
    id: 'files', icon: FolderOpen, title: 'Files and storage',
    body: 'Choose where each model lives. Every model appears in one list, wherever it is stored.',
    items: [
      it('PolyForm cloud', '', 'Live collaboration: invite people and design together.'),
      it('Google Drive', '', 'Keep large projects as files in your own Drive.'),
      it('Trimble Connect', '', 'Store designs alongside the rest of your project.'),
      it('Import', '.skp · 3D', 'Bring SKP and other 3D files in.'),
      it('Export', 'glTF · STL · SKP', 'For viewers, 3D printing and SKP.'),
      it('Sharing', '', 'Public models, with an optional password.'),
    ],
  },
];

export const WORKS_WITH: { icon: LucideIcon; label: string }[] = [
  { icon: Map, label: 'Google Maps' },
  { icon: HardDrive, label: 'Google Drive' },
  { icon: Building2, label: 'Trimble Connect' },
  { icon: Sparkles, label: 'Claude' },
  { icon: FileBox, label: 'SKP files' },
  { icon: Share2, label: 'glTF and STL' },
];

export const WORKFLOW_STEPS: { n: string; icon: LucideIcon; title: string; body: string }[] = [
  { n: '01', icon: Globe, title: 'Find the site', body: 'Search an address and lay the real map under your model with WorldView.' },
  { n: '02', icon: House, title: 'Build the house', body: 'Draw walls, drop in doors and windows, add stairs, stack storeys and raise the roof.' },
  { n: '03', icon: Leaf, title: 'Shape the garden', body: 'Sculpt the terrain, cut the paths, dig the pond and lay the patio against the back door.' },
  { n: '04', icon: Footprints, title: 'See it and walk in', body: 'Set the sun and the weather, save scenes, then walk through at eye level.' },
];

export const STORAGE_OPTIONS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Cloud, title: 'PolyForm cloud', text: 'Live collaboration: invite people and design together.' },
  { icon: HardDrive, title: 'Google Drive', text: 'Keep large projects as files in your own Drive.' },
  { icon: Building2, title: 'Trimble Connect', text: 'Store designs alongside the rest of your project.' },
];

export type CodeLine = { t: string; comment: boolean };
const code = (lines: string[]): CodeLine[] => lines.map(t => ({ t: t || ' ', comment: t.trim().startsWith('//') }));

export const CODE_SHORT: CodeLine[] = code([
  '// Build a box, then pull it up',
  'const box = sdk.createBox({ width: 2, height: 1, depth: 2 });',
  'sdk.pushPull(box, 1.5);',
  "sdk.applyColor(box, '#0063A3');",
]);

export const CODE_LONG: CodeLine[] = code([
  '// A garden room on a real site',
  'sdk.worldView.importMap({ lat: 51.5007, lng: -0.1246, zoom: 18, altitude: 0 });',
  '',
  'const room = sdk.createBox({ width: 4, height: 0.2, depth: 3, position: [0, 0, 0] });',
  'sdk.pushPull(room, 2.4);',
  "sdk.setBevel(room, { amount: 0.05, type: 'round', segments: 4 });",
  "sdk.applyColor(room, '#e8e1d5');",
  '',
  '// Cut a doorway',
  'const cutter = sdk.createBox({ width: 0.9, height: 2.1, depth: 0.5, position: [0, 1.05, 1.5] });',
  "sdk.performCSG(room.id, cutter.id, 'SUBTRACTION');",
  '',
  'console.log(sdk.getSyncStatus()); // synced',
]);

export const TOOL_CALLS = ['create_model', 'add_room', 'add_opening', 'add_stairs', 'add_roof', 'preview_model'];

export const HOW_IT_WORKS: { n: string; title: string; body: string }[] = [
  { n: '01', title: 'Connect PolyForm to Claude', body: 'Add PolyForm as a custom connector in Claude and sign in with your Google account.' },
  { n: '02', title: 'Ask in plain words', body: 'Describe the building, the garden or the change you want. Claude builds it in your account.' },
  { n: '03', title: 'Check, then open it', body: 'Claude shows a 3D view and a floor plan of every level. Open the model in PolyForm to keep going.' },
];

export const CAPABILITY_GROUPS: { icon: LucideIcon; kind: string; text: string; tools: string[] }[] = [
  { icon: Eye, kind: 'Read', text: 'List your models and inspect what is in them.', tools: ['list_models', 'get_model', 'list_objects', 'get_object', 'list_catalog'] },
  { icon: Camera, kind: 'See', text: 'Take pictures from perspective, plan, front, back, left or right.', tools: ['screenshot'] },
  { icon: LayoutDashboard, kind: 'Preview', text: 'A 3D picture plus a floor plan of each level, with rooms, doors, windows and stairs.', tools: ['preview_model'] },
  { icon: Hammer, kind: 'Build', text: 'Rooms, walls, openings, roofs, stairs, terrain, planting, fences, ponds and patios.', tools: ['create_model', 'add_room', 'add_wall', 'add_opening', 'add_roof', 'add_stairs', 'add_terrain', 'add_plant', 'add_fence', 'add_pond', 'add_patio'] },
  { icon: PencilRuler, kind: 'Edit', text: 'Move, restyle, rename and delete objects, or step back a change.', tools: ['transform_objects', 'set_appearance', 'rename_object', 'delete_objects', 'undo_last_change'] },
];

export const SETUP_STEPS: { n: string; title: string; body: string }[] = [
  { n: '1', title: 'Open Claude’s connectors', body: 'In Claude, go to Settings → Connectors and choose Add custom connector.' },
  { n: '2', title: 'Paste the PolyForm address', body: 'Enter the connector address, ending in /mcp.' },
  { n: '3', title: 'Sign in', body: 'Claude opens a PolyForm sign-in page. Use your Google account.' },
  { n: '4', title: 'Ask for a design', body: 'Start a chat and describe what you want built.' },
];

export const DEV_TOOLS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Terminal, title: 'Console', text: 'Write and run scripts against the open model. The window drags, docks and collapses.' },
  { icon: BookOpen, title: 'Library', text: 'Save scripts, make them public, and copy other people’s into your own library.' },
  { icon: FileText, title: 'Documentation and Spec', text: 'Every SDK method and property, next to the editor.' },
  { icon: Circle, title: 'Code Recorder', text: 'Turn what you draw into SDK code.' },
  { icon: LayoutGrid, title: 'Custom toolbars', text: 'Build your own toolbars with your own icons.' },
  { icon: AppWindow, title: 'Embedded webpages', text: 'Open a URL in a floating window with sdk.openWebpage().' },
  { icon: Activity, title: 'AI Diagnostic Log', text: 'Live scene telemetry with category filters. Ctrl+Shift+L.' },
];

export const SDK_METHODS: { sig: string; text: string }[] = [
  { sig: 'sdk.createBox({ width, height, depth, position })', text: 'Create a box.' },
  { sig: 'sdk.createPoly({ vertices: [[x, y, z], …] })', text: 'Create a polygon from world-space points. Ready for Extrude.' },
  { sig: 'sdk.pushPull(shape, amount)', text: 'Extrude or intrude a shape.' },
  { sig: 'sdk.applyColor(shape, color)', text: 'Colour a shape.' },
  { sig: 'sdk.setBevel(shape, { amount, type, segments })', text: 'Bevel a shape’s edges.' },
  { sig: 'sdk.performCSG(targetId, cutterId, "SUBTRACTION")', text: 'Carve one shape out of another.' },
  { sig: 'sdk.worldView.importMap({ lat, lng, zoom, altitude })', text: 'Lay a map under the model.' },
  { sig: 'sdk.openWebpage(url)', text: 'Open a URL in a floating window.' },
  { sig: 'sdk.getSyncStatus()', text: "Returns 'synced', 'syncing', 'error' or 'offline'." },
  { sig: 'sdk.getCollaborators()', text: 'List the people active in the model.' },
];

export const HERO_RAIL_ICONS: { icon: LucideIcon; active?: boolean }[] = [
  { icon: MousePointer2 }, { icon: Eraser }, { icon: PaintBucket }, { icon: PenLine },
  { icon: Square }, { icon: ArrowUpFromLine, active: true }, { icon: Move }, { icon: RotateCw }, { icon: Ruler }, { icon: Globe },
];
export const HERO_PANEL_TITLES = ['ENTITY INFO', 'OUTLINER', 'MATERIALS', 'SCENES', 'VISUALISATION', 'COLLABORATION'];

export const ArrowDownIcon = ArrowDown;
