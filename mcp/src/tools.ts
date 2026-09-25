import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Shape } from '../../src/types';
import { MATERIAL_PRESETS, getMaterialPreset } from '../../src/lib/materialPresets';
import { PLAIN_FINISHES } from '../../src/lib/materials/plainFinishes';
import { PLANT_SPECIES_CATALOG } from '../../src/lib/plantLibrary';
import { LANDSCAPE_TEXTURES } from '../../src/lib/landscapeTextures';
import { FENCE_STYLES, WOOD_FINISHES } from '../../src/lib/fence/fenceTypes';
import { buildRoofAssemblyForRoom } from '../../src/lib/archRoofGenerator';
import { ToolError, type Caller, type ModelStore } from './store';
import { floorPlans, withStoryTags } from './plans';
import { svgToPng } from './raster';
import {
  carryHosted, describe, detail, fenceRun, findShape, groundAt, newId, openingInWall, withQuaternions, withTerrainTexture, patioOrDeck, summarize, transformShape, waterBody, withSdk, type Vec3,
} from './ops';

export interface ScreenshotOptions {
  view: 'perspective' | 'plan' | 'front' | 'back' | 'left' | 'right';
  width: number;
  height: number;
  focus?: string;
}

export interface Renderer {
  screenshot(caller: Caller, modelId: string, opts: ScreenshotOptions): Promise<Buffer>;
}

export interface ToolContext {
  caller: Caller;
  store: ModelStore;
  renderer?: Renderer;
  /** SVG to PNG (plans); swapped out in tests. */
  rasterize?: (svg: string) => Promise<Buffer>;
}

const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const point2 = z.tuple([z.number(), z.number()]).describe('[x, z] on the ground, metres');
const modelRef = z.string().describe('Model id, or its name');
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/).describe('Hex colour, e.g. #a3a7aa');

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
const text = (value: unknown): { content: Content[] } => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
});

/** Wraps a tool body so a ToolError reaches Claude as a readable error rather than a crash. */
function safe<A>(fn: (args: A) => Promise<{ content: Content[] }>) {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (e) {
      const message = e instanceof ToolError ? e.message : `Something went wrong: ${(e as Error).message}`;
      return { content: [{ type: 'text' as const, text: message }], isError: true };
    }
  };
}

/** Same test the app's roof button uses to find the roof it replaces. */
const isRoofShape = (s: Shape) =>
  s.type === 'roof' || s.tags?.some(t => t.startsWith('roof-') || t === 'roof') || s.name?.toLowerCase().includes('roof')
  || s.id.startsWith('roof_') || s.id.startsWith('tiles_roof_');

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const DESTROY = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

export function registerTools(server: McpServer, ctx: ToolContext) {
  const { caller, store } = ctx;

  /** Loads a model, changes its objects, and reports what was made. */
  async function change(ref: string, note: string, fn: (shapes: Shape[]) => { shapes: Shape[]; made?: Shape[]; message?: string }) {
    const model = await store.loadModel(caller, ref);
    let out: ReturnType<typeof fn> = { shapes: [] };
    await store.changeShapes(caller, model.id, note, shapes => withStoryTags(withQuaternions((out = fn(shapes)).shapes)));
    return text({
      model: `${model.name} (${model.id})`,
      done: out.message ?? note,
      created: out.made?.map(describe),
      tip: 'undo_last_change reverses this. When the design is finished, call preview_model to show the result.',
    });
  }

  const add = (made: Shape | Shape[]) => (shapes: Shape[]) => {
    const list = Array.isArray(made) ? made : [made];
    return { shapes: [...shapes, ...list], made: list };
  };

  // ── Reading ───────────────────────────────────────────────────────────

  server.registerTool('list_models', {
    title: 'List my models',
    description: 'Lists your PolyForm models, most recently changed first.',
    annotations: READ,
  }, safe(async () => text(await store.listModels(caller))));

  server.registerTool('get_model', {
    title: 'Describe a model',
    description: 'Overview of a model: how many of each kind of object, its extent, and totals (wall and fence length, patio and deck area). Units are metres; y is up.',
    inputSchema: { model: modelRef },
    annotations: READ,
  }, safe(async ({ model }) => {
    const m = await store.loadModel(caller, model);
    return text({ id: m.id, name: m.name, updatedAt: m.updatedAt, ...summarize(m.shapes) });
  }));

  server.registerTool('list_objects', {
    title: 'List objects in a model',
    description: 'Lists objects with id, name, type, position [x, y, z] (metres, y up), size and colour. Filter by type or name.',
    inputSchema: {
      model: modelRef,
      type: z.string().optional().describe('Only this type, e.g. wall, door, window, box, patio, fence, terrain, tree, roof'),
      name_contains: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(100),
    },
    annotations: READ,
  }, safe(async ({ model, type, name_contains, limit }) => {
    const m = await store.loadModel(caller, model);
    const wanted = name_contains?.toLowerCase();
    const rows = m.shapes
      .filter(s => (!type || s.type === type) && (!wanted || (s.name ?? '').toLowerCase().includes(wanted)))
      .map(describe);
    return text({ total: rows.length, objects: rows.slice(0, limit) });
  }));

  server.registerTool('get_object', {
    title: 'Show one object',
    description: 'All settings of one object (mesh data left out).',
    inputSchema: { model: modelRef, object: z.string().describe('Object id or exact name') },
    annotations: READ,
  }, safe(async ({ model, object }) => {
    const m = await store.loadModel(caller, model);
    return text(detail(findShape(m.shapes, object)));
  }));

  server.registerTool('list_catalog', {
    title: 'List building options',
    description: 'Ids you can use elsewhere: plants (add_plant), materials (textured presets for set_appearance), finishes (plain plastic/metal/glass/paint for set_appearance), terrain_textures, fence_styles.',
    inputSchema: { kind: z.enum(['plants', 'materials', 'finishes', 'terrain_textures', 'fence_styles']) },
    annotations: READ,
  }, safe(async ({ kind }) => {
    switch (kind) {
      case 'plants': return text(PLANT_SPECIES_CATALOG.map(p => ({ id: p.id, name: p.name, category: p.category, heightM: p.defaultHeight })));
      case 'materials': return text(MATERIAL_PRESETS.map(m => ({ id: m.id, name: m.name })));
      case 'finishes': return text(Object.entries(PLAIN_FINISHES).flatMap(([family, list]) => list.map(f => ({ id: f.id, name: f.name, family }))));
      case 'terrain_textures': return text(LANDSCAPE_TEXTURES.map(t => ({ id: t.id, name: t.name })));
      case 'fence_styles': return text({ styles: FENCE_STYLES.map(s => ({ id: s.id, name: s.label })), woodFinishes: WOOD_FINISHES });
    }
  }));

  server.registerTool('screenshot', {
    title: 'Take a screenshot',
    description: 'Renders the model with the PolyForm app and returns a picture, so you can see it. Takes 15–40 seconds.',
    inputSchema: {
      model: modelRef,
      view: z.enum(['perspective', 'plan', 'front', 'back', 'left', 'right']).default('perspective'),
      focus: z.string().optional().describe('Object id to frame instead of the whole model'),
      width: z.number().int().min(320).max(1600).default(1024),
      height: z.number().int().min(240).max(1200).default(640),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safe(async ({ model, view, focus, width, height }) => {
    if (!ctx.renderer) throw new ToolError('Screenshots are not set up on this server (POLYFORM_APP_URL is missing).');
    const m = await store.loadModel(caller, model);
    const png = await ctx.renderer.screenshot(caller, m.id, { view, focus, width, height });
    return { content: [
      { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
      { type: 'text', text: `${m.name}, ${view} view.` },
    ] };
  }));

  server.registerTool('preview_model', {
    title: 'Preview a finished design',
    description: 'Call this once when you finish creating or changing a design, so the user can see it without opening PolyForm. Returns a 3D perspective picture and, for buildings (models with walls), a floor plan of each level with rooms, their areas, doors, windows and stairs. Name the rooms you built with room_labels.',
    inputSchema: {
      model: modelRef,
      room_labels: z.array(z.object({
        level: z.number().int().min(1).describe('1 = ground floor'),
        at: point2.describe('[x, z] of any point inside the room'),
        name: z.string(),
      })).default([]),
      include_3d: z.boolean().default(true),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safe(async ({ model, room_labels, include_3d }) => {
    const m = await store.loadModel(caller, model);
    const plans = floorPlans(m.shapes, room_labels as any);
    const rasterize = ctx.rasterize ?? svgToPng;
    const content: Content[] = [];
    const notes: string[] = [];
    const planImages = await Promise.all(plans.map(p => rasterize(p.svg)));
    let perspective: Buffer | null = null;
    if (include_3d) {
      if (!ctx.renderer) notes.push('3D picture: screenshots are not set up on this server.');
      else {
        try {
          perspective = await ctx.renderer.screenshot(caller, m.id, { view: 'perspective', width: 1024, height: 640 });
        } catch (e) {
          notes.push(`3D picture unavailable: ${(e as Error).message}`);
        }
      }
    }
    if (!plans.length && !perspective) throw new ToolError(notes.join(' ') || 'Nothing to preview: the model has no walls and 3D pictures are off.');
    content.push({ type: 'text', text: JSON.stringify({
      model: `${m.name} (${m.id})`,
      levels: plans.map(p => ({ level: p.level, floorAt: p.elevation, rooms: p.rooms })),
      notes: notes.length ? notes : undefined,
      tip: 'Show these pictures to the user. Unnamed rooms can be named with room_labels.',
    }, null, 2) });
    if (perspective) content.push({ type: 'image', data: perspective.toString('base64'), mimeType: 'image/png' });
    planImages.forEach(png => content.push({ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }));
    return { content };
  }));

  // ── Models ────────────────────────────────────────────────────────────

  server.registerTool('create_model', {
    title: 'Create a model',
    description: 'Starts a new, empty model. It appears in the app under Cloud Models.',
    inputSchema: { name: z.string().min(1).max(200) },
    annotations: WRITE,
  }, safe(async ({ name }) => text({ id: await store.createModel(caller, name), name })));

  // ── Building ──────────────────────────────────────────────────────────

  server.registerTool('add_shape', {
    title: 'Add a simple shape',
    description: 'Adds a box, cylinder, sphere, cone, pyramid, torus or dome. Position is the centre of the shape, in metres, y up (so a 1 m box sitting on the ground has y = 0.5).',
    inputSchema: {
      model: modelRef,
      shape: z.enum(['box', 'cylinder', 'sphere', 'cone', 'pyramid', 'torus', 'dome']),
      width: z.number().positive().optional().describe('box: x size'),
      height: z.number().positive().optional().describe('box, cylinder, cone, pyramid: y size'),
      depth: z.number().positive().optional().describe('box: z size'),
      radius: z.number().positive().optional().describe('round shapes'),
      tube: z.number().positive().optional().describe('torus: tube radius'),
      position: vec3.default([0, 0.5, 0]),
      color: colour.optional(),
      name: z.string().optional(),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, `Added a ${a.shape}`, shapes => {
    const r = a.radius ?? 0.5, h = a.height ?? 1;
    const run = withSdk(shapes, sdk => {
      switch (a.shape) {
        case 'box': return sdk.createBox({ width: a.width ?? 1, height: h, depth: a.depth ?? 1, position: a.position });
        case 'cylinder': return sdk.createCylinder({ radius: r, height: h, position: a.position });
        case 'sphere': return sdk.createSphere({ radius: r, position: a.position });
        case 'cone': return sdk.createCone({ radius: r, height: h, position: a.position });
        case 'pyramid': return sdk.createPyramid({ radius: r, height: h, position: a.position });
        case 'torus': return sdk.createDonut({ radius: r, tube: a.tube ?? r / 4, position: a.position });
        case 'dome': return sdk.createDome({ radius: r, position: a.position });
      }
    });
    const made = run.created.map(s => ({ ...s, color: a.color ?? '#cbd5e1', name: a.name ?? s.name ?? a.shape }));
    return { shapes: [...shapes, ...made], made };
  })));

  server.registerTool('add_room', {
    title: 'Add a room',
    description: 'Four walls around a rectangle (width along x, length along z) plus a floor slab, centred on position (y is the floor level).',
    inputSchema: {
      model: modelRef,
      width: z.number().min(1),
      length: z.number().min(1),
      height: z.number().positive().default(2.8),
      wall_thickness: z.number().positive().default(0.2),
      position: vec3.default([0, 0, 0]),
      floor: z.boolean().default(true),
      ceiling: z.boolean().default(false),
      wall_color: colour.optional(),
      floor_color: colour.optional(),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, `Added a ${a.width} × ${a.length} m room`, shapes => {
    const run = withSdk(shapes, sdk => sdk.architecture.createRoom({
      width: a.width, length: a.length, height: a.height, wallThickness: a.wall_thickness, position: a.position,
      includeFloor: a.floor, includeCeiling: a.ceiling, wallColor: a.wall_color, floorColor: a.floor_color,
    }));
    return { shapes: run.shapes, made: run.created };
  })));

  server.registerTool('add_wall', {
    title: 'Add a wall',
    description: 'A straight wall from start to end ([x, y, z], y = the floor it stands on).',
    inputSchema: {
      model: modelRef,
      start: vec3,
      end: vec3,
      height: z.number().positive().default(2.8),
      thickness: z.number().positive().default(0.2),
      color: colour.optional(),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, 'Added a wall', shapes => {
    const run = withSdk(shapes, sdk => sdk.architecture.createWall({ start: a.start, end: a.end, height: a.height, thickness: a.thickness, color: a.color }));
    return { shapes: run.shapes, made: run.created };
  })));

  server.registerTool('add_opening', {
    title: 'Add a door or window to a wall',
    description: 'Sets a door or window into a wall; the wall cuts its own opening. along = distance from the wall\'s start end to the centre of the opening (default: middle).',
    inputSchema: {
      model: modelRef,
      wall: z.string().describe('Wall object id'),
      kind: z.enum(['door', 'window']),
      along: z.number().min(0).optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      sill_height: z.number().min(0).optional().describe('Windows: height of the bottom edge above the floor (default 0.9 m)'),
      color: colour.optional(),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, `Added a ${a.kind}`, shapes => {
    const opening = openingInWall(findShape(shapes, a.wall), a.kind, { along: a.along, width: a.width, height: a.height, sill: a.sill_height, color: a.color });
    return add(opening)(shapes);
  })));

  server.registerTool('add_roof', {
    title: 'Add a roof',
    description: 'Builds a full roof assembly (covering, gables or hips, ridge cap, fascia, soffits) over walls, as the app\'s roof tool does. It fits the footprint the walls enclose (rectangular, L-shaped or other) and sits on the tallest wall. By default it uses every wall and replaces any existing roof.',
    inputSchema: {
      model: modelRef,
      roof_type: z.enum(['gable', 'hip', 'parapet']).default('gable'),
      walls: z.array(z.string()).optional().describe('Wall ids to roof over (default: all walls)'),
      pitch_deg: z.number().min(5).max(70).default(35),
      overhang: z.number().min(0).max(2).default(0.3),
      color: colour.optional(),
      tiles: z.enum(['none', 'flat', 'roman', 'pantile', 'scallop', 'diamond', 'standing-seam']).default('none').describe('3D roof covering: flat = slate/shingle, roman = barrel tiles'),
      replace_existing: z.boolean().default(true),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, `Added a ${a.roof_type} roof`, shapes => {
    const walls = a.walls ? a.walls.map(ref => findShape(shapes, ref)) : shapes.filter(s => s.type === 'wall');
    if (!walls.length || walls.some(w => w.type !== 'wall')) throw new ToolError('A roof needs walls to sit on; add a room or walls first.');
    const parapet = a.roof_type === 'parapet';
    const assembly = buildRoofAssemblyForRoom(walls, {
      roofType: a.roof_type,
      pitchAngleDeg: parapet ? 0 : a.pitch_deg,
      usePitchAngle: !parapet,
      eaveOverhang: a.overhang,
      color: a.color ?? (parapet ? '#475569' : '#991b1b'),
      fasciaColor: '#ffffff',
      tileShape: a.tiles,
    }, shapes);
    if (!assembly) throw new ToolError('Those walls do not enclose a footprint a roof can cover.');
    const kept = a.replace_existing ? shapes.filter(s => !isRoofShape(s)) : shapes;
    return { shapes: [...kept, ...assembly.allShapes], made: assembly.allShapes };
  })));

  server.registerTool('add_stairs', {
    title: 'Add stairs',
    description: 'A flight of stairs. position = [x, floor level, z] of the bottom: for a straight flight, the centre of the first step\'s front edge; the flight climbs towards +z (use transform_objects rotate_deg to turn it). Other styles are centred on position.',
    inputSchema: {
      model: modelRef,
      style: z.enum(['straight', 'l-shape', 'u-shape', 'c-shape', 'winder', 'spiral', 'curved', 'bifurcated']).default('straight'),
      rise: z.number().positive().default(2.7).describe('Total height climbed'),
      width: z.number().positive().default(1),
      position: vec3.default([0, 0, 0]),
      railing: z.enum(['none', 'left', 'right', 'both']).default('both'),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, 'Added stairs', shapes => {
    // The stair mesh is centred on its position, halfway up; convert from the bottom.
    const run = withSdk(shapes, sdk => sdk.architecture.createStairs({ style: a.style, height: a.rise, width: a.width, position: [0, 0, 0], railing: a.railing }));
    const [x, y, z] = a.position;
    const made = run.created.map(s => {
      const length = Array.isArray(s.args) ? Number(s.args[2]) || 0 : 0;
      return { ...s, position: [x, y + a.rise / 2, a.style === 'straight' ? z + length / 2 : z] as Vec3 };
    });
    return { shapes: [...shapes, ...made], made };
  })));

  server.registerTool('add_terrain', {
    title: 'Add terrain',
    description: 'A piece of ground (grass by default) centred on position.',
    inputSchema: {
      model: modelRef,
      width: z.number().min(2).max(1000).default(40),
      depth: z.number().min(2).max(1000).default(40),
      topography: z.enum(['flat', 'rolling', 'ridge', 'terraced']).default('flat'),
      texture: z.string().default('lush_grass').describe('Terrain texture id (list_catalog terrain_textures)'),
      position: vec3.default([0, 0, 0]),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, 'Added terrain', shapes => {
    const resolution = Math.min(128, Math.max(16, Math.round(Math.max(a.width, a.depth))));
    const run = withSdk(shapes, sdk => sdk.landscape.createTerrain({ width: a.width, depth: a.depth, resolution, topography: a.topography, position: a.position }));
    const made = run.created.map(s => withTerrainTexture(s, a.texture));
    return { shapes: [...shapes, ...made], made };
  })));

  server.registerTool('add_plant', {
    title: 'Add trees or plants',
    description: 'Places plants (list_catalog plants for species ids) at ground points; y is taken from the terrain.',
    inputSchema: {
      model: modelRef,
      species: z.string(),
      points: z.array(point2).min(1).max(200),
      scale: z.number().min(0.2).max(4).default(1),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, `Added ${a.points.length} × ${a.species}`, shapes => {
    if (!PLANT_SPECIES_CATALOG.some(p => p.id === a.species)) throw new ToolError(`Unknown plant "${a.species}". See list_catalog plants.`);
    const species = PLANT_SPECIES_CATALOG.find(p => p.id === a.species)!;
    const ground = groundAt(shapes);
    // As the app's planting tool does: species only, no baked mesh (the app draws it), which
    // keeps each plant a few hundred bytes instead of about a megabyte.
    const kind = species.category === 'tree' ? 'tree' : species.category === 'rock' ? 'rock' : 'bush';
    const made: Shape[] = a.points.map(([x, zz]) => ({
      id: newId(),
      name: species.name,
      type: kind,
      position: [x, ground(x, zz), zz] as Vec3,
      quaternion: [0, 0, 0, 1],
      scale: [a.scale, a.scale, a.scale] as Vec3,
      args: [1, 1, 1],
      color: species.foliageColor || '#2d6a4f',
      roughness: 0.7,
      metalness: 0.1,
      plantSpeciesId: species.id,
    }));
    return add(made)(shapes);
  })));

  server.registerTool('add_fence', {
    title: 'Add a fence',
    description: 'A fence along ground points; it follows the terrain. Styles: list_catalog fence_styles.',
    inputSchema: {
      model: modelRef,
      points: z.array(point2).min(2),
      closed: z.boolean().default(false),
      style: z.string().default('post-rail'),
      height: z.number().min(0.4).max(3).default(1.25),
      color: colour.optional(),
      finish: z.string().optional().describe('Wood finish for rustic styles'),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, 'Added a fence', shapes => {
    if (!FENCE_STYLES.some(s => s.id === a.style)) throw new ToolError(`Unknown fence style "${a.style}". See list_catalog fence_styles.`);
    return add(fenceRun(shapes, a.points as [number, number][], { closed: a.closed, style: a.style as any, height: a.height, color: a.color, finish: a.finish }))(shapes);
  })));

  server.registerTool('add_pond', {
    title: 'Add a pond or lake',
    description: 'Water filling an outline of ground points; it digs its own basin into the terrain.',
    inputSchema: {
      model: modelRef,
      points: z.array(point2).min(3),
      depth: z.number().min(0.2).max(20).default(1.2),
      clarity: z.enum(['clear', 'lake', 'pond', 'murky']).default('lake'),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, 'Added a pond', shapes => add(waterBody(shapes, a.points as [number, number][], { depth: a.depth, clarity: a.clarity }))(shapes))));

  server.registerTool('add_patio', {
    title: 'Add a patio or deck',
    description: 'A paved patio (set into the ground) or a raised timber deck over an outline of ground points. Drawn against a building, it is level with the house floor.',
    inputSchema: {
      model: modelRef,
      kind: z.enum(['patio', 'deck']),
      points: z.array(point2).min(3),
      paving: z.enum(['slabs', 'block', 'natural', 'porcelain', 'gravel']).optional(),
      slab_size: z.tuple([z.number(), z.number()]).optional().describe('Slab size [x, z] in metres, e.g. [0.6, 0.6]'),
      board: z.enum(['softwood', 'hardwood', 'composite', 'weathered', 'painted']).optional(),
      deck_height: z.number().min(0.05).max(3).default(0.45),
      railing: z.enum(['none', 'timber', 'glass', 'cable']).optional(),
      lights: z.boolean().optional(),
      color: colour.optional(),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, `Added a ${a.kind}`, shapes => {
    const settings: any = {};
    if (a.paving) settings.paving = a.paving;
    if (a.slab_size) settings.slabSize = a.slab_size;
    if (a.board) settings.board = a.board;
    if (a.railing) settings.railing = a.railing;
    if (a.color) settings.color = a.color;
    if (a.lights !== undefined) settings.lights = { enabled: a.lights };
    return add(patioOrDeck(shapes, a.points as [number, number][], { kind: a.kind, deckHeight: a.deck_height, settings }))(shapes);
  })));

  // ── Editing ───────────────────────────────────────────────────────────

  server.registerTool('transform_objects', {
    title: 'Move, turn or resize objects',
    description: 'Moves (to a position or by an offset), turns (degrees about the vertical axis) or scales objects. Doors and windows move with their wall.',
    inputSchema: {
      model: modelRef,
      objects: z.array(z.string()).min(1),
      position: vec3.optional().describe('New centre (only with one object)'),
      offset: vec3.optional().describe('Move by [dx, dy, dz]'),
      rotate_deg: z.number().optional().describe('Turn about the vertical axis by this many degrees'),
      scale: z.number().positive().optional(),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, `Moved ${a.objects.length} object(s)`, shapes => {
    if (a.position && a.objects.length > 1) throw new ToolError('Give position for one object at a time, or use offset.');
    let next = shapes;
    const made: Shape[] = [];
    for (const ref of a.objects) {
      const before = findShape(next, ref);
      const after = transformShape(before, { position: a.position as Vec3 | undefined, offset: a.offset as Vec3 | undefined, rotateYDeg: a.rotate_deg, scale: a.scale });
      next = carryHosted(before, after, next.map(s => (s.id === before.id ? after : s)));
      made.push(after);
    }
    return { shapes: next, made, message: `Moved ${made.length} object(s)` };
  })));

  server.registerTool('set_appearance', {
    title: 'Change colour or material',
    description: 'Sets colour, a textured material preset, or a plain finish (plastic, metal, glass, paint) on objects. See list_catalog materials / finishes.',
    inputSchema: {
      model: modelRef,
      objects: z.array(z.string()).min(1),
      color: colour.optional(),
      material: z.string().optional().describe('Material preset id or plain finish id'),
      opacity: z.number().min(0.05).max(1).optional(),
      terrain_texture: z.string().optional().describe('For terrain: a texture id from list_catalog terrain_textures'),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, 'Changed appearance', shapes => {
    const finish = a.material ? Object.values(PLAIN_FINISHES).flat().find(f => f.id === a.material) : undefined;
    if (a.material && !finish && !getMaterialPreset(a.material)) throw new ToolError(`Unknown material "${a.material}". See list_catalog materials or finishes.`);
    const ids = new Set(a.objects.map(ref => findShape(shapes, ref).id));
    let next = shapes;
    if (a.material && !finish) next = withSdk(next, sdk => ids.forEach(id => sdk.materials.applyMaterial(id, a.material))).shapes;
    next = next.map(s => {
      if (!ids.has(s.id)) return s;
      let out = { ...s };
      if (finish) {
        out = { ...out, color: finish.color, roughness: finish.roughness, metalness: finish.metalness, opacity: finish.opacity, materialPreset: undefined,
          textureUrl: undefined, normalMapUrl: undefined, roughnessMapUrl: undefined, metalnessMapUrl: undefined, aoMapUrl: undefined, displacementMapUrl: undefined, materialBindingId: undefined };
      }
      if (a.color) out.color = a.color;
      if (a.opacity !== undefined) out.opacity = a.opacity;
      if (a.terrain_texture && out.type === 'terrain') out = withTerrainTexture(out, a.terrain_texture);
      return out;
    });
    return { shapes: next, made: next.filter(s => ids.has(s.id)) };
  })));

  server.registerTool('rename_object', {
    title: 'Rename an object',
    inputSchema: { model: modelRef, object: z.string(), name: z.string().min(1).max(120) },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, `Renamed to ${a.name}`, shapes => {
    const id = findShape(shapes, a.object).id;
    const next = shapes.map(s => (s.id === id ? { ...s, name: a.name } : s));
    return { shapes: next, made: next.filter(s => s.id === id) };
  })));

  server.registerTool('delete_objects', {
    title: 'Delete objects',
    description: 'Removes objects. Deleting a wall also removes its doors and windows. undo_last_change brings them back.',
    inputSchema: { model: modelRef, objects: z.array(z.string()).min(1) },
    annotations: DESTROY,
  }, safe(async (a) => change(a.model, `Deleted ${a.objects.length} object(s)`, shapes => {
    const ids = new Set(a.objects.map(ref => findShape(shapes, ref).id));
    const next = shapes.filter(s => !ids.has(s.id) && !(s.hostWallId && ids.has(s.hostWallId)));
    return { shapes: next, message: `Deleted ${shapes.length - next.length} object(s)` };
  })));

  server.registerTool('undo_last_change', {
    title: 'Undo the last connector change',
    description: 'Reverses the most recent change made through this connector to a model (up to 20 steps back). Changes made in the app are not affected.',
    inputSchema: { model: modelRef },
    annotations: DESTROY,
  }, safe(async ({ model }) => {
    const m = await store.loadModel(caller, model);
    const note = await store.undo(caller, m.id);
    return text(note ? `Undid: ${note}` : 'Nothing to undo for this model.');
  }));
}
