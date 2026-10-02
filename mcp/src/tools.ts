import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Shape } from '../../src/types';
import { MATERIAL_PRESETS, getMaterialPreset } from '../../src/lib/materialPresets';
import { PLAIN_FINISHES } from '../../src/lib/materials/plainFinishes';
import { PLANT_SPECIES_CATALOG } from '../../src/lib/plantLibrary';
import { LANDSCAPE_TEXTURES } from '../../src/lib/landscapeTextures';
import { FENCE_STYLES, WOOD_FINISHES } from '../../src/lib/fence/fenceTypes';
import { buildRoofAssemblyForRoom, type RoofParams } from '../../src/lib/archRoofGenerator';
import { buildingLevels } from '../../src/lib/presentation/floorPlans';
import { initRoofSkeleton } from '../../src/lib/roofSkeleton';
import { buildRoofsForBuilding } from '../../src/lib/buildingRoofs';
import type { GraphicsSettings } from '../../src/lib/graphics/graphicsSettings';
import { ToolError, type Caller, type ModelStore } from './store';
import { floorPlans } from './plans';
import { analyzeWallConversion, planWithThickness, heightWarnings, PIECE_MIN_FOR_DOOR, PIECE_MIN_FOR_WINDOW, type WallConversionPlan } from '../../src/tools/kernelConvertToWall';
import { deleteGroupFacesAndEdges, groupContaining } from '../../src/tools/kernelSelection';
import type { FaceId } from '../../src/lib/geometry/types';
import { checkLayout } from './layout';
import { checkGeometry } from './geometry';
import { assertFitsUnderCeiling, checkStair, headroomIssues, placeStairInRoom, retagStories, storyForElevation } from './checks';
import { applyStairwellHolesToSlabs } from '../../src/lib/archStairwell';
import { detectRooms } from '../../src/lib/spatial/rooms';
import { dormerFit, dormersOf, evenlySpaced, type Dormer } from '../../src/lib/dormers';
import { eavePolygon, facingEdge, roofEdges, RoofSurface } from '../../src/lib/roofSurface';
import { extrasOf, isRoofExtra, withRoofExtras } from '../../src/lib/roofExtras';
import { svgToPng } from './raster';
import { nodeSiteIO } from './site';
import { buildSite, findSiteGround, replaceSite, type SiteIO } from '../../src/lib/worldSite/site';
import { withDrawnRoute, withSiteSettings, withoutRoutes } from '../../src/lib/worldSite/streets';
import { applyAutoStreetLights } from '../../src/lib/worldSite/streetLights';
import { findPlace } from '../../src/lib/worldSite/fetchSite';
import { KernelArcHost } from '../../src/tools/kernelArcHost';
import { deserializeGraph, serializeGraph } from '../../src/lib/geometry/serialize';
import { MAX_SITE_SIZE, MIN_SITE_SIZE } from '../../src/lib/worldSite/geo';
import {
  carryHosted, describe, detail, fenceRun, findShape, groundAt, newId, openingInWall, arcPoints, buildWallShapes, monoPitchSite, pickRoof, porchOverDoor, roofWindow, wallPlanAlong, wallRaisedBy, withQuaternions, withTerrainTexture, patioOrDeck, summarize, transformShape, waterBody, withSdk, type Vec3,
} from './ops';

export interface ScreenshotOptions {
  view: 'perspective' | 'plan' | 'front' | 'back' | 'left' | 'right';
  width: number;
  height: number;
  focus?: string;
  /** Give up after this long (the whole render). */
  timeoutMs?: number;
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
  /** Where World View site data comes from; swapped out in tests. */
  siteIO?: SiteIO;
  /** Finds a place from an address or postcode; swapped out in tests. */
  findPlace?: (text: string) => Promise<{ lat: number; lng: number; address: string } | null>;
}

const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const point2 = z.tuple([z.number(), z.number()]).describe('[x, z] on the ground, metres');
const modelRef = z.string().describe('Model id (from list_models or create_model). A name also works but is slower, so pass the id.');
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/).describe('Hex colour, e.g. #a3a7aa');

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
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

function withTimeout<T>(work: Promise<T>, ms: number, why: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(why)), ms); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
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

  /**
   * What every change ends with, as the app does after every edit: walls and slabs on the storey they
   * stand at, and a stairwell cut in the floor above each flight of stairs.
   */
  const finish = (shapes: Shape[]) => {
    const tagged = retagStories(shapes);
    return tagged.some(s => s.type === 'staircase') ? applyStairwellHolesToSlabs(tagged) : tagged;
  };

  /** Loads a model, changes its objects, and reports what was made. */
  async function change(ref: string, note: string, fn: (shapes: Shape[]) => { shapes: Shape[]; made?: Shape[]; message?: string }) {
    let out: ReturnType<typeof fn> = { shapes: [] };
    const model = await store.changeShapes(caller, ref, note, shapes => finish(withQuaternions((out = fn(shapes)).shapes)));
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

  /** Runs one SDK drawing operation against the model's persisted kernel graph. */
  async function changeKernel<T>(ref: string, note: string, run: (sdk: any) => T) {
    const model = await store.loadModel(caller, ref);
    let result!: T;
    let stored: unknown | null = model.kernel;
    await store.changeKernel(caller, model.id, note, kernel => {
      const host = new KernelArcHost(
        { upAxis: { x: 0, y: 1, z: 0 } },
        deserializeGraph((kernel ?? null) as any),
      );
      result = withSdk(model.shapes, run, { kernelHost: host, bumpKernel: () => {} }).result;
      stored = serializeGraph(host.graph);
      return stored;
    });
    return { model, result, kernel: stored };
  }

  /** Loads a model, changes its graphics settings (weather, vegetation wind), and reports what changed. */
  async function changeSettings(ref: string, note: string, fn: (settings: GraphicsSettings) => GraphicsSettings) {
    const model = await store.changeGraphicsSettings(caller, ref, note, fn);
    return text({
      model: `${model.name} (${model.id})`,
      done: note,
      tip: 'undo_last_change reverses this. When the design is finished, call preview_model to show the result.',
    });
  }

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

  server.registerTool('list_rooms', {
    title: 'List detected rooms',
    description: 'Lists enclosed rooms detected from the model walls, including the stable room id used by furnish_room, level, area and perimeter.',
    inputSchema: { model: modelRef },
    annotations: READ,
  }, safe(async ({ model }) => {
    const m = await store.loadModel(caller, model);
    const rooms = withSdk(m.shapes, sdk => sdk.interiors.listRooms()).result;
    return text(rooms.map((room: any, index: number) => ({
      index,
      id: room.id,
      name: room.name,
      level: room.level,
      areaM2: room.areaM2,
      perimeterM: room.perimeterM,
      elevation: room.elevation,
      walls: room.boundaryWallIds,
      openings: room.openingIds,
    })));
  }));

  server.registerTool('list_drawn_faces', {
    title: 'List drawn kernel faces',
    description: 'Lists faces made with PolyForm drawing tools, including stable face ids, area, colour, visibility and holes.',
    inputSchema: { model: modelRef },
    annotations: READ,
  }, safe(async ({ model }) => {
    const m = await store.loadModel(caller, model);
    const host = new KernelArcHost({ upAxis: { x: 0, y: 1, z: 0 } }, deserializeGraph((m.kernel ?? null) as any));
    return text(withSdk(m.shapes, sdk => sdk.drawing.listFaces(), { kernelHost: host, bumpKernel: () => {} }).result);
  }));

  server.registerTool('list_civil_modifiers', {
    title: 'List civil/site modifiers',
    description: 'Lists PolyForm civil terrain modifiers such as roads and grading pads, including pad surface/parking settings.',
    inputSchema: { model: modelRef },
    annotations: READ,
  }, safe(async ({ model }) => {
    const m = await store.loadModel(caller, model);
    return text(m.terrainModifiers);
  }));

  server.registerTool('check_model_health', {
    title: 'Check model health',
    description: 'Runs PolyForm reconstruction/model-health checks and returns errors and warnings before further editing or generation.',
    inputSchema: { model: modelRef },
    annotations: READ,
  }, safe(async ({ model }) => {
    const m = await store.loadModel(caller, model);
    return text(withSdk(m.shapes, sdk => sdk.reconstruction.checkModelHealth()).result);
  }));

  server.registerTool('check_layout', {
    title: 'Check how the building works',
    description: 'Checks how a building is used, which check_model_health does not: whether each hinged door has room to swing, whether a person can walk from the front door (and up the stairs) to every room at 0.75 m wide and 0.9 m wide, whether furniture blocks a doorway or passage, headroom over the stairs, and rooms with no window. Returns what was checked and what could not be. Run it after furnishing and after adding stairs. Widths are modelling defaults; pass circulation_width or local_width if the user gave their own. It is not an accessibility or building-code check and must never be reported as one.',
    inputSchema: {
      model: modelRef,
      circulation_width: z.number().min(0.5).max(2).optional().describe('Main route width to test, metres (default 0.9)'),
      local_width: z.number().min(0.4).max(2).optional().describe('Minimum width into any room, metres (default 0.75)'),
    },
    annotations: READ,
  }, safe(async ({ model, circulation_width, local_width }) => {
    const m = await store.loadModel(caller, model);
    return text(checkLayout(m.shapes, { circulationWidth: circulation_width, localWidth: local_width }));
  }));

  server.registerTool('check_geometry', {
    title: 'Check the geometry is sound',
    description: 'Checks that the model\'s geometry is sound, which check_model_health only partly does: numbers that are not numbers and paper-thin solids; doors and windows that run outside their wall, overlap each other, sit at a wall corner, or (doors) stand off the floor; wall ends that stop a few centimetres short of the wall they should meet; furniture floating above or sunk into the floor; and upper-floor walls a few centimetres off the wall below. Returns what was checked and what could not be. Run it after building the structure (before furnishing) and again at the end. It reports problems; it never changes the model.',
    inputSchema: { model: modelRef },
    annotations: READ,
  }, safe(async ({ model }) => {
    const m = await store.loadModel(caller, model);
    return text(checkGeometry(m.shapes));
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
          // Claude waits about a minute for a tool; leave the plans time to arrive if the picture can't.
          perspective = await withTimeout(ctx.renderer.screenshot(caller, m.id, { view: 'perspective', width: 1024, height: 640, timeoutMs: 35_000 }), 40_000,
            'the app did not finish drawing in time (check POLYFORM_APP_URL and APP_BYPASS_SECRET)');
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

  // ── Drawing kernel ─────────────────────────────────────────────────────

  server.registerTool('draw_line', {
    title: 'Draw a kernel line',
    description: 'Draws a PolyForm Line-tool segment. Closing connected lines can create a face automatically.',
    inputSchema: { model: modelRef, from: vec3, to: vec3 },
    annotations: WRITE,
  }, safe(async (a) => {
    const changed = await changeKernel(a.model, 'Drew a line', sdk => sdk.drawing.line(a.from, a.to));
    return text({ model: `${changed.model.name} (${changed.model.id})`, done: 'Drew a line', edges: changed.result, tip: 'undo_last_change reverses this.' });
  }));

  server.registerTool('draw_primitive', {
    title: 'Draw a kernel primitive or surface',
    description: 'Draws the same Rectangle, Circle, Polygon, Triangle, Pie, Freehand or arbitrary flat Surface geometry as PolyForm drawing tools.',
    inputSchema: {
      model: modelRef,
      kind: z.enum(['rectangle', 'circle', 'polygon', 'triangle', 'pie', 'freehand', 'surface']),
      centre: vec3.optional(),
      width: z.number().positive().optional(),
      depth: z.number().positive().optional(),
      radius: z.number().positive().optional(),
      sides: z.number().int().min(3).max(256).optional(),
      rotation_deg: z.number().optional(),
      start_angle_deg: z.number().optional(),
      sweep_deg: z.number().optional(),
      segments: z.number().int().min(3).max(512).optional(),
      normal: vec3.optional(),
      points: z.array(vec3).optional(),
      closed: z.boolean().default(false),
    },
    annotations: WRITE,
  }, safe(async (a) => {
    const changed = await changeKernel(a.model, `Drew ${a.kind}`, sdk => {
      switch (a.kind) {
        case 'rectangle':
          if (a.width === undefined || a.depth === undefined) throw new ToolError('rectangle needs width and depth.');
          return sdk.drawing.rectangle({ centre: a.centre, width: a.width, depth: a.depth, normal: a.normal, rotationDeg: a.rotation_deg });
        case 'circle':
          if (a.radius === undefined) throw new ToolError('circle needs radius.');
          return sdk.drawing.circle({ centre: a.centre, radius: a.radius, segments: a.segments, normal: a.normal });
        case 'polygon':
          if (a.radius === undefined || a.sides === undefined) throw new ToolError('polygon needs radius and sides.');
          return sdk.drawing.polygon({ centre: a.centre, radius: a.radius, sides: a.sides, rotationDeg: a.rotation_deg, normal: a.normal });
        case 'triangle':
          if (a.radius === undefined) throw new ToolError('triangle needs radius.');
          return sdk.drawing.triangle({ centre: a.centre, radius: a.radius, rotationDeg: a.rotation_deg, normal: a.normal });
        case 'pie':
          if (a.radius === undefined || a.sweep_deg === undefined) throw new ToolError('pie needs radius and sweep_deg.');
          return sdk.drawing.pie({ centre: a.centre, radius: a.radius, startAngleDeg: a.start_angle_deg, sweepDeg: a.sweep_deg, segments: a.segments, normal: a.normal });
        case 'freehand':
          if (!a.points || a.points.length < 2) throw new ToolError('freehand needs at least two points.');
          return sdk.drawing.freehand(a.points, a.closed);
        case 'surface':
          if (!a.points || a.points.length < 3) throw new ToolError('surface needs at least three points.');
          return sdk.drawing.surface(a.points);
      }
    });
    return text({ model: `${changed.model.name} (${changed.model.id})`, done: `Drew ${a.kind}`, faces: changed.result, tip: 'undo_last_change reverses this.' });
  }));

  server.registerTool('edit_drawn_faces', {
    title: 'Edit drawn kernel faces',
    description: 'Runs PolyForm kernel editing operations on face ids: Push/Pull, Offset, Chamfer, Fillet, Boolean, Paint or Erase.',
    inputSchema: {
      model: modelRef,
      operation: z.enum(['push-pull', 'offset', 'chamfer', 'fillet', 'merge', 'subtract', 'intersect', 'paint', 'erase']),
      faces: z.array(z.number().int().positive()).min(1),
      distance: z.number().optional().describe('Push/Pull or Offset distance in metres'),
      amount: z.number().positive().optional().describe('Chamfer amount or Fillet radius in metres'),
      color: colour.optional().describe('Paint colour'),
    },
    annotations: WRITE,
  }, safe(async (a) => {
    const changed = await changeKernel(a.model, `Edited drawn faces: ${a.operation}`, sdk => {
      switch (a.operation) {
        case 'push-pull':
          if (a.faces.length !== 1 || a.distance === undefined) throw new ToolError('push-pull needs exactly one face and distance.');
          return sdk.drawing.pushPull(a.faces[0], a.distance);
        case 'offset':
          if (a.faces.length !== 1 || a.distance === undefined) throw new ToolError('offset needs exactly one face and distance.');
          return sdk.drawing.offset(a.faces[0], a.distance);
        case 'chamfer':
          if (a.amount === undefined) throw new ToolError('chamfer needs amount.');
          return sdk.drawing.chamfer(a.faces, a.amount);
        case 'fillet':
          if (a.amount === undefined) throw new ToolError('fillet needs amount.');
          return sdk.drawing.fillet(a.faces, a.amount);
        case 'merge':
        case 'subtract':
        case 'intersect':
          return sdk.drawing.boolean(a.faces, a.operation);
        case 'paint':
          if (!a.color) throw new ToolError('paint needs color.');
          sdk.drawing.paint(a.faces, a.color);
          return true;
        case 'erase':
          sdk.drawing.erase(a.faces);
          return true;
      }
    });
    return text({ model: `${changed.model.name} (${changed.model.id})`, done: `Edited drawn faces: ${a.operation}`, result: changed.result, tip: 'undo_last_change reverses this.' });
  }));

  server.registerTool('follow_me', {
    title: 'Sweep a drawn face with Follow Me',
    description: 'Sweeps a profile face along an existing edge, a face outline, or an explicit point path using PolyForm Follow Me.',
    inputSchema: {
      model: modelRef,
      profile_face: z.number().int().positive(),
      edge_id: z.number().int().positive().optional(),
      face_id: z.number().int().positive().optional(),
      points: z.array(vec3).min(2).optional(),
      closed: z.boolean().default(false),
    },
    annotations: WRITE,
  }, safe(async (a) => {
    const selectors = Number(a.edge_id !== undefined) + Number(a.face_id !== undefined) + Number(a.points !== undefined);
    if (selectors !== 1) throw new ToolError('Give exactly one Follow Me path: edge_id, face_id, or points.');
    const path = a.edge_id !== undefined ? { edgeId: a.edge_id }
      : a.face_id !== undefined ? { faceId: a.face_id }
      : { points: a.points, closed: a.closed };
    const changed = await changeKernel(a.model, 'Applied Follow Me', sdk => sdk.drawing.followMe(a.profile_face, path));
    return text({ model: `${changed.model.name} (${changed.model.id})`, done: 'Applied Follow Me', result: changed.result, tip: 'undo_last_change reverses this.' });
  }));

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
    description: 'Four walls around a rectangle (width along x, length along z) plus a floor slab, centred on position (y is the floor level). For an upper floor set position y to that floor\'s height (e.g. 2.8 for the first floor above 2.8 m walls): the walls are filed under the right level automatically and only the ground floor gets a foundation. Upper floors must sit inside the footprint of the floor below unless the design really overhangs.',
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
    // Which storey this is, from the height it stands at; the ground floor is the only one with a foundation.
    const story = storyForElevation(shapes, a.position[1]);
    const run = withSdk(shapes, sdk => sdk.architecture.createRoom({
      width: a.width, length: a.length, height: a.height, wallThickness: a.wall_thickness, position: a.position,
      includeFloor: a.floor, includeCeiling: a.ceiling, wallColor: a.wall_color, floorColor: a.floor_color,
      story, includeFoundation: story === 1,
    }));
    return { shapes: run.shapes, made: run.created };
  })));

  server.registerTool('add_interior_furniture', {
    title: 'Add interior furniture',
    description: 'Adds PolyForm native parametric furniture: bed, sofa, cabinet or curtain. Sofas/beds support baked soft-body settling and curtains support baked cloth settling.',
    inputSchema: {
      model: modelRef,
      type: z.enum(['bed', 'sofa', 'cabinet', 'curtain']),
      position: vec3.default([0, 0, 0]),
      rotation_deg: z.number().default(0),
      color: colour.optional(),
      settle_soft: z.boolean().default(true),
      settle_strength: z.number().min(0).max(1).default(0.35),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, `Added interior ${a.type}`, shapes => {
    const run = withSdk(shapes, sdk => {
      const item = sdk.interiors.addFurniture(a.type, {
        position: a.position,
        rotation: a.rotation_deg * Math.PI / 180,
        color: a.color,
      });
      const sim = item.customData?.semanticComponent?.simulation;
      return a.settle_soft && sim?.bakeable ? sdk.interiors.bakeSimulation(item.id, a.settle_strength) : item;
    });
    assertFitsUnderCeiling(run.shapes, run.created);
    return { shapes: run.shapes, made: run.created };
  })));

  server.registerTool('furnish_room', {
    title: 'Furnish a detected room',
    description: 'Collision-aware Interior Studio furnishing. Call list_rooms first and pass its room id. Presets: bedroom, living-room (scales to the room; soft-furnishings and minimal are older names for it), storage, office, home-office, kitchen, bathroom, toilet and workshop (garage/workshop). Kitchen, bathroom and toilet fixtures sit on walls and share a wet wall; items that do not fit are reported as left out.',
    inputSchema: {
      model: modelRef,
      room: z.string().describe('Room id from list_rooms'),
      preset: z.enum(['bedroom', 'living-room', 'soft-furnishings', 'storage', 'minimal', 'office', 'home-office', 'kitchen', 'bathroom', 'toilet', 'workshop']),
      settle_soft: z.boolean().default(true),
      lighting: z.boolean().default(false).describe('Also add lighting suited to the room type: ceiling lights, lamps on bedside and side tables, pendants over the dining table, vanity lights over basins, task lights on desks and benches. Replaces this room\'s earlier interior lights.'),
      settle_strength: z.number().min(0).max(1).optional().describe('Override settling strength; when omitted PolyForm uses the Interior Studio defaults: 0.32 for cloth and 0.42 for soft bodies'),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, `Furnished room (${a.preset})`, shapes => {
    const run = withSdk(shapes, sdk => {
      const plan = sdk.interiors.furnishRoom(a.room, a.preset, { lighting: a.lighting });
      if (a.settle_soft) {
        for (const item of plan.shapes) {
          const sim = item.customData?.semanticComponent?.simulation;
          if (sim?.bakeable) {
            const strength = a.settle_strength ?? (sim.type === 'cloth' ? 0.32 : 0.42);
            sdk.interiors.bakeSimulation(item.id, strength);
          }
        }
      }
      return plan;
    });
    const plan = run.result;
    // Furnishing knows about walls and other furniture, not the sloping roof: drop anything that would stand through it.
    const tooTall = headroomIssues(run.shapes, run.created);
    const dropped = new Set(tooTall.map(i => i.item.id));
    const left = tooTall.length ? ` Left out ${tooTall.length} item(s) too tall for the ceiling or sloping roof there: ${tooTall.map(i => `${i.item.name ?? i.item.type} (${i.height} m tall, ${i.headroom} m headroom)`).join(', ')}.` : '';
    return {
      shapes: run.shapes.filter(s => !dropped.has(s.id)),
      made: run.created.filter(s => !dropped.has(s.id)),
      message: `Placed ${plan.shapes.length - tooTall.length} item(s); ${plan.unplaced.length} could not be placed without a collision.${left}${plan.lights?.length ? ` Added ${plan.lights.length} light fixture(s) for the room type.` : ''}`,
    };
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

  /** What a set of wall pieces can take: how many are long enough for a door or a window. */
  const openingNote = (lengths: number[]) => {
    const doors = lengths.filter(l => l >= PIECE_MIN_FOR_DOOR).length, windows = lengths.filter(l => l >= PIECE_MIN_FOR_WINDOW).length;
    return `${lengths.length} wall pieces from ${round(Math.min(...lengths))} to ${round(Math.max(...lengths))} m long: ${doors} can take a door (at least ${PIECE_MIN_FOR_DOOR} m), ${windows} a window (at least ${PIECE_MIN_FOR_WINDOW} m). Use add_opening on a piece id. For longer pieces use fewer segments.`;
  };

  server.registerTool('add_curved_wall', {
    title: 'Add a curved or bent wall',
    description: 'Builds real walls along an arc or a list of points: a bay, a curved porch wall, a rotunda, a bent wall. Each stretch is a wall piece with its ends cut so the corners close, the same walls the app makes from Convert To Wall, so doors, windows, roofs and floor plans work on them. Give centre + radius + sweep_deg for an arc (angle 0 along +x, increasing towards +z; sweep 360 makes a closed round wall), or points (plan [x, z] list) with closed. y is the floor level. Choose the outside face with outer_side. A curve is a run of short straight pieces: a door needs a piece at least 1.1 m long and a window 0.7 m, so for a wall that will have openings use fewer, longer segments (the reply says how many pieces can take one).',
    inputSchema: {
      model: modelRef,
      centre: point2.optional().describe('Arc centre [x, z]'),
      radius: z.number().min(0.3).max(100).optional(),
      start_angle_deg: z.number().default(0),
      sweep_deg: z.number().min(-360).max(360).optional().describe('How far round the arc goes; 360 or -360 closes it'),
      segments: z.number().int().min(2).max(120).optional().describe('Pieces round the arc (default one per 15 degrees)'),
      points: z.array(point2).min(2).max(200).optional().describe('Centreline [x, z] points instead of an arc'),
      closed: z.boolean().default(false).describe('Join the last point back to the first (points only)'),
      outer_side: z.enum(['left', 'right', 'convex']).default('convex').describe('Which way the outside face looks. Arcs: convex = away from the centre. Points: right/left of the direction of travel, with north up and z down the plan (walking east, right is south).'),
      y: z.number().default(0).describe('Floor level the wall stands on'),
      height: z.number().positive().default(2.7),
      thickness: z.number().min(0.05).max(1).default(0.2),
      color: colour.optional(),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, 'Added a curved wall', shapes => {
    let line: { x: number; z: number }[];
    let closed = a.closed, curved = false;
    let radialCentre: { x: number; z: number } | undefined;
    if (a.points) {
      line = (a.points as [number, number][]).map(([x, zz]) => ({ x, z: zz }));
    } else {
      if (!a.centre || a.radius === undefined || a.sweep_deg === undefined) throw new ToolError('Give centre, radius and sweep_deg for an arc, or points for a bent wall.');
      const segments = a.segments ?? Math.max(2, Math.ceil(Math.abs(a.sweep_deg) / 15));
      closed = Math.abs(a.sweep_deg) >= 359.999;
      line = arcPoints(a.centre as [number, number], a.radius, a.start_angle_deg, a.sweep_deg, segments);
      if (closed) line.pop();
      curved = true;
      radialCentre = { x: a.centre[0], z: a.centre[1] };
    }
    if (a.outer_side === 'convex' && !radialCentre) throw new ToolError('outer_side convex only applies to an arc; for points choose left or right.');
    const plan = wallPlanAlong(line, a.thickness, { closed, side: a.outer_side === 'left' ? 'left' : 'right', baseY: a.y, radialCentre: a.outer_side === 'convex' ? radialCentre : undefined, curved });
    const shortest = Math.min(...plan.pieces.map(p => p.length));
    if (shortest < 0.3) throw new ToolError(`A piece would be only ${round(shortest)} m long. Use fewer segments, or a larger radius.`);
    const story = storyForElevation(shapes, a.y);
    const walls = buildWallShapes(plan, { height: a.height, color: a.color ?? '#e2e8f0', story, makeId: newId, existingWallCount: shapes.filter(s => s.type === 'wall').length })
      .map((w, i) => ({ ...w, name: `${curved ? 'Curved' : 'Bent'} Wall ${i + 1}` }));
    return { shapes: [...shapes, ...walls], made: walls, message: `Added a ${curved ? 'curved' : 'bent'} wall: ${openingNote(plan.pieces.map(p => p.length))}` };
  })));

  server.registerTool('convert_to_walls', {
    title: 'Turn a drawn shape into walls',
    description: 'Does what Convert To Wall does in the app: a shape drawn flat, given a wall thickness with edit_drawn_faces offset (and, usually, pulled straight up with push-pull to a flat, level top) becomes real wall pieces, one per straight edge with mitred corners (a curve becomes a run of short pieces), and the drawn shape is removed. Pass any face id of the shape from list_drawn_faces. If the shape has not been pulled up, pass height. thickness (optional) changes the wall thickness from the drawn one. The shape must be an offset ring of constant thickness; free-form shapes with varying thickness or sloping tops cannot become walls and stay drawn geometry. This is two changes (the walls, then the removal of the drawn shape), so undo_last_change twice reverses it. For a plain curved or bent wall, add_curved_wall is simpler.',
    inputSchema: {
      model: modelRef,
      face: z.number().int().positive().describe('A face id of the drawn shape, from list_drawn_faces'),
      height: z.number().positive().optional().describe('Wall height, needed when the ring has not been pulled up'),
      thickness: z.number().min(0.02).max(1).optional().describe('Change the wall thickness from the drawn one'),
      color: colour.optional(),
    },
    annotations: WRITE,
  }, safe(async (a) => {
    const model = await store.loadModel(caller, a.model);
    const host = new KernelArcHost({ upAxis: { x: 0, y: 1, z: 0 } }, deserializeGraph((model.kernel ?? null) as any));
    const face = a.face as unknown as FaceId;
    if (!host.graph.faces.has(face)) throw new ToolError(`There is no drawn face ${a.face}. Use list_drawn_faces to get the ids.`);
    const analysed = analyzeWallConversion(host.graph, face, groupContaining(host.graph, face));
    if ('reason' in analysed) throw new ToolError(`That shape cannot become walls: ${analysed.reason}`);
    let plan: WallConversionPlan = analysed;
    if (a.thickness !== undefined) {
      const changed = planWithThickness(plan, a.thickness);
      if ('reason' in changed) throw new ToolError(changed.reason);
      plan = changed;
    }
    const height = plan.height ?? a.height;
    if (height === undefined) throw new ToolError('This outline has not been pulled up, so say how high the walls are: pass height.');
    const notes = [...plan.warnings, ...heightWarnings(height, plan.baseY)].map(w => w.message);
    const walls = buildWallShapes(plan, {
      height, color: a.color ?? plan.color ?? '#e2e8f0', story: storyForElevation(model.shapes, plan.baseY), makeId: newId,
      existingWallCount: model.shapes.filter(s => s.type === 'wall').length,
    }).map((w, i) => ({ ...w, name: `${plan.pieces[i]?.curved ? 'Curved' : 'Converted'} Wall ${i + 1}` }));
    await store.changeShapes(caller, model.id, 'Converted a drawn shape to walls', shapes => finish(withQuaternions([...shapes, ...walls])));
    try {
      await store.changeKernel(caller, model.id, 'Removed the drawn shape that became walls', kernel => {
        const h = new KernelArcHost({ upAxis: { x: 0, y: 1, z: 0 } }, deserializeGraph((kernel ?? null) as any));
        if (plan.sourceFaces.some(id => !h.graph.faces.has(id))) throw new ToolError('The drawn shape changed while it was being converted. Nothing was changed.');
        deleteGroupFacesAndEdges(h.graph, plan.sourceFaces);
        h.refreshIndex();
        return serializeGraph(h.graph);
      });
    } catch (e) {
      await store.undo(caller, model.id);
      throw e;
    }
    return text({
      model: `${model.name} (${model.id})`,
      done: `Converted to ${walls.length} wall${walls.length === 1 ? '' : 's'} (${Math.round(plan.thickness * 1000)} mm thick, ${round(height)} m high). ${openingNote(plan.pieces.map(p => p.length))}`,
      notes: notes.length ? notes : undefined,
      created: walls.map(describe),
      tip: 'undo_last_change twice reverses this (the walls, then the drawn shape). When the design is finished, call preview_model.',
    });
  }));

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
    description: 'Builds a full roof assembly (covering, gables or hips, ridge cap, fascia, soffits) over walls, as the app\'s roof tool does. roof_type mono is a single slope: one plane that rises to the wall on the side opposite falls_toward and falls away to the eave on falls_toward (default south, low pitch 15 degrees), with the high wall carried up to meet it; it roofs the top storey only. It is the app\'s own lean-to roof, so the roof panel can edit it. It fits the footprint the walls enclose (any shape). By default it roofs the whole building storey by storey (the main roof on the top storey, and a lean-to on any part of a lower storey that sticks out beyond the one above) and replaces any existing roof; with walls given, it roofs just those.',
    inputSchema: {
      model: modelRef,
      roof_type: z.enum(['gable', 'hip', 'parapet', 'mono']).default('gable'),
      falls_toward: z.enum(['south', 'north', 'east', 'west']).default('south').describe('mono only: the side the roof slopes down to (south = +z); its high wall is the opposite side'),
      walls: z.array(z.string()).optional().describe('Wall ids to roof over (default: all walls)'),
      pitch_deg: z.number().min(5).max(70).optional().describe('Slope in degrees (default 35, or 15 for mono)'),
      overhang: z.number().min(0).max(2).default(0.3),
      color: colour.optional(),
      tiles: z.enum(['none', 'flat', 'roman', 'pantile', 'scallop', 'diamond', 'standing-seam']).default('none').describe('3D roof covering: flat = slate/shingle, roman = barrel tiles'),
      replace_existing: z.boolean().default(true),
    },
    annotations: WRITE,
  }, safe(async (a) => (await initRoofSkeleton(), change(a.model, `Added a ${a.roof_type} roof`, shapes => {
    const mono = a.roof_type === 'mono';
    const onTop = mono && !a.walls ? buildingLevels(shapes).at(-1)?.walls ?? [] : undefined;
    const walls = a.walls ? a.walls.map(ref => findShape(shapes, ref)) : onTop ?? shapes.filter(s => s.type === 'wall');
    if (!walls.length || walls.some(w => w.type !== 'wall')) throw new ToolError('A roof needs walls to sit on; add a room or walls first.');
    const parapet = a.roof_type === 'parapet';
    const params: RoofParams = {
      roofType: mono ? 'gable' : a.roof_type as RoofParams['roofType'],
      pitchAngleDeg: parapet ? 0 : a.pitch_deg ?? (mono ? 15 : 35),
      usePitchAngle: !parapet,
      eaveOverhang: a.overhang,
      color: a.color ?? (parapet ? '#475569' : '#991b1b'),
      fasciaColor: '#ffffff',
      tileShape: a.tiles,
    };
    let made: Shape[] | undefined;
    if (mono) {
      // One plane up to the high wall (the app's lean-to roof), and that wall carried up to meet it.
      const site = monoPitchSite(shapes, walls, a.falls_toward);
      const roof = buildRoofAssemblyForRoom(walls, { ...params, extension: site.extension }, shapes);
      if (!roof) throw new ToolError('Those walls do not enclose a footprint a single-slope roof can cover.');
      const rise = Number(roof.roofShape.roofData?.ridgeHeight ?? 0);
      made = [...roof.allShapes, ...site.highWalls.map(w => wallRaisedBy(w, rise))];
    } else {
      // Over every wall: storey by storey, like the app's roof button (the main roof on the top
      // storey, and a lean-to on any part of a lower storey that sticks out beyond the one above).
      const building = a.walls ? null : buildRoofsForBuilding(shapes, params);
      made = building?.shapes ?? buildRoofAssemblyForRoom(walls, params, shapes)?.allShapes;
    }
    if (!made) throw new ToolError('Those walls do not enclose a footprint a roof can cover.');
    const kept = a.replace_existing ? shapes.filter(s => !isRoofShape(s)) : shapes;
    return { shapes: [...kept, ...made], made };
  }))));

  server.registerTool('add_roof_window', {
    title: 'Add Velux roof windows',
    description: 'Places PolyForm\'s real Velux roof window (skylight) lying in the slope of a roof made by add_roof, turned to the pitch, with the roof cutting its own opening. Always use this for roof windows, skylights and rooflights: never draw them from boxes or kernel shapes. Give at (world [x, z] points over the roof slope) or facing + count (spaced evenly across that slope, a little up from the eave). Default size 0.78 × 1.18 m. A window cannot cross a ridge or hip; if it is refused, move it or make it smaller. For a window standing up out of the roof with its own little roof, use add_dormers instead.',
    inputSchema: {
      model: modelRef,
      roof: z.string().optional().describe('Roof id from list_objects (needed only when there is more than one roof)'),
      at: z.array(point2).min(1).max(12).optional().describe('World [x, z] of each window centre, over the roof'),
      facing: z.enum(['south', 'north', 'east', 'west']).optional().describe('Which slope to space the windows along: the direction it faces (south = +z)'),
      count: z.number().int().min(1).max(6).default(1),
      width: z.number().positive().max(2).optional(),
      height: z.number().positive().max(2).optional(),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, 'Added roof windows', shapes => {
    const roof = pickRoof(shapes, a.roof);
    if (!a.at && !a.facing) throw new ToolError('Say where: at (points over the roof) or facing (which slope) with count.');
    const points: [number, number][] = (a.at as [number, number][] | undefined)
      ?? evenlySpaced(roof, a.count, a.facing!, { width: a.width ?? 0.78 }).map(d => [d.x + roof.position[0], d.z + roof.position[2]] as [number, number]);
    const made = points.map(p => roofWindow(roof, p, { width: a.width, height: a.height }));
    return { shapes: [...shapes, ...made], made, message: `Added ${made.length} Velux roof window(s).` };
  })));

  server.registerTool('add_dormers', {
    title: 'Add dormers',
    description: 'Adds dormers (a window box standing up out of a pitched roof, with its own roof) to a roof made by add_roof; the roof is cut open for each. Types: gable, hipped, flat. A full-width flat dormer across a slope (common on the back of a house) is full_width: true with type flat. Each dormer must sit wholly on one slope, clear of hips and the ridge; if one will not fit you are told why and nothing is added. Dormers are real objects with glass, walls, roofs and linings, so never fake them with boxes.',
    inputSchema: {
      model: modelRef,
      roof: z.string().optional().describe('Roof id from list_objects (needed only when there is more than one roof)'),
      facing: z.enum(['south', 'north', 'east', 'west']).describe('Which slope the dormers go on: the direction it faces (south = +z)'),
      count: z.number().int().min(1).max(4).default(1),
      type: z.enum(['gable', 'hipped', 'flat']).default('gable'),
      width: z.number().min(0.6).max(12).optional().describe('Front wall width, metres (default 1.6)'),
      height: z.number().min(0.8).max(2.5).optional().describe('Front wall height, metres (default 1.3)'),
      flush: z.boolean().optional().describe('Front wall straight up from the wall below, breaking the eave (default false; true for full_width)'),
      full_width: z.boolean().default(false).describe('One dormer across the whole slope, set in from each end'),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, `Added ${a.type} dormers`, shapes => {
    const roof = pickRoof(shapes, a.roof);
    // Only what was asked for: an explicit undefined would wipe the dormer defaults.
    const spaced = (width?: number) => {
      const base: Partial<Dormer> = { type: a.type, flush: a.flush ?? a.full_width };
      if (width !== undefined) base.width = width;
      if (a.height !== undefined) base.height = a.height;
      return evenlySpaced(roof, a.full_width ? 1 : a.count, a.facing, base);
    };
    let fresh = spaced(a.width);
    if (!fresh.length) throw new ToolError(`The roof has no ${a.facing}-facing slope to put dormers on.`);
    if (a.full_width) {
      // Across the whole slope: as wide as the slope stays one plane from the middle, less the dormer's own eaves.
      const surface = new RoofSurface(roof);
      try {
        const edge = facingEdge(roofEdges(eavePolygon(roof), surface), a.facing)!;
        const mid = fresh[0];
        const reach = (sign: number) => {
          const slopeAt = (t: number) => surface.at(mid.x + sign * edge.u[0] * t, mid.z + sign * edge.u[1] * t);
          const here = slopeAt(0);
          let t = 0;
          while (t < 30) {
            const next = slopeAt(t + 0.1);
            if (!here || !next || next.normal.dot(here.normal) < 0.995) break;
            t += 0.1;
          }
          return t;
        };
        const room = Math.min(reach(1), reach(-1)) * 2;
        let width = Math.floor((room - 2 * 0.45) * 10) / 10;
        let fit = dormerFit(roof, { ...fresh[0], width });
        while (!fit.layout && width > 1) { width = Math.floor((width - 0.3) * 10) / 10; fit = dormerFit(roof, { ...fresh[0], width }); }
        if (!fit.layout) throw new ToolError(`A full-width dormer does not fit that slope: ${fit.reason} Nothing was added.`);
        fresh = spaced(width);
      } finally {
        surface.dispose();
      }
    }
    const problems = fresh.map((d, i) => ({ i, fit: dormerFit(roof, d) })).filter(x => !x.fit.layout);
    if (problems.length) throw new ToolError(`Dormer ${problems[0].i + 1} does not fit: ${problems[0].fit.reason} Nothing was added.`);
    const extras = extrasOf(roof);
    const next = withRoofExtras(shapes, roof.id, { ...extras, dormers: 0, dormerList: [...dormersOf(roof), ...fresh] });
    const made = next.filter(s => isRoofExtra(s) && s.parentShapeId === roof.id);
    return { shapes: next, made, message: `Added ${fresh.length} ${a.type} dormer(s) on the ${a.facing} slope.` };
  })));

  server.registerTool('set_roof_extras', {
    title: 'Add gutters, a chimney or solar panels to a roof',
    description: 'Adds or removes the roof extras the app\'s roof panel has: gutters with downpipes, a chimney, and solar panels on a slope. Pass only what you want to change; the rest of the roof\'s extras (including dormers) are kept. chimney_x and chimney_z place the chimney across the roof from -1 to 1 of each half-extent (0, 0 is the middle; x runs along the building\'s x axis, z along its z axis). Solar panels go on the slope facing solar_facing (south = +z). Always use this rather than drawing a chimney, gutters or panels from boxes.',
    inputSchema: {
      model: modelRef,
      roof: z.string().optional().describe('Roof id from list_objects (needed only when there is more than one roof)'),
      gutters: z.boolean().optional(),
      gutter_color: colour.optional(),
      chimney: z.boolean().optional(),
      chimney_x: z.number().min(-1).max(1).optional(),
      chimney_z: z.number().min(-1).max(1).optional(),
      chimney_color: colour.optional(),
      solar: z.boolean().optional(),
      solar_facing: z.enum(['south', 'north', 'east', 'west']).optional(),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, 'Set roof extras', shapes => {
    const roof = pickRoof(shapes, a.roof);
    const extras = { ...extrasOf(roof) };
    if (a.gutters !== undefined) extras.gutters = a.gutters;
    if (a.gutter_color) extras.gutterColor = a.gutter_color;
    if (a.chimney !== undefined) extras.chimney = a.chimney;
    if (a.chimney_x !== undefined) extras.chimneyX = a.chimney_x;
    if (a.chimney_z !== undefined) extras.chimneyZ = a.chimney_z;
    if (a.chimney_color) extras.chimneyColor = a.chimney_color;
    if (a.solar !== undefined) extras.solar = a.solar;
    if (a.solar_facing) extras.solarFacing = a.solar_facing;
    if (extras.dormerList === undefined && dormersOf(roof).length) extras.dormerList = dormersOf(roof);
    const next = withRoofExtras(shapes, roof.id, extras);
    const made = next.filter(s => isRoofExtra(s) && s.parentShapeId === roof.id);
    const on = [extras.gutters && 'gutters', extras.chimney && 'chimney', extras.solar && 'solar panels'].filter(Boolean);
    return { shapes: next, made, message: `Roof extras now: ${on.length ? on.join(', ') : 'none'}.` };
  })));

  server.registerTool('add_porch', {
    title: 'Add a porch over a door',
    description: 'Builds a porch over a door: a landing in front of it (with a step down if the floor is raised), posts at the outer corners and a canopy roof resting on the wall above the door. It is built on the outside of the wall automatically. Styles: gable (small pitched roof; its ridge runs along the longer side, so a deeper-than-wide porch has a gable facing out), lean-to (a sloping canopy falling away from the wall), flat (a flat canopy). Match a reference image by choosing the style, width, depth, post shape and post count (2, or 4 with two against the wall). Pass the id of the front door from list_objects. Put porch dimensions in metres: a typical porch is 1.8 to 2.6 m wide and 1.2 to 1.8 m deep.',
    inputSchema: {
      model: modelRef,
      door: z.string().describe('Id of the door the porch shelters (a door set in a wall)'),
      style: z.enum(['gable', 'lean-to', 'flat']).default('gable'),
      width: z.number().min(1).max(8).optional().describe('Across the front, metres (default: door width + 1 m)'),
      depth: z.number().min(0.8).max(4).default(1.5).describe('How far it stands out from the wall, metres'),
      posts: z.union([z.literal(2), z.literal(4)]).default(2),
      post_shape: z.enum(['round', 'square']).default('square'),
      pitch_deg: z.number().min(5).max(50).optional(),
      color: colour.optional().describe('Posts, landing trim colour'),
      roof_color: colour.optional(),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, 'Added a porch', shapes => {
    const made = porchOverDoor(shapes, findShape(shapes, a.door), {
      style: a.style, width: a.width, depth: a.depth, posts: a.posts, post: a.post_shape, pitchDeg: a.pitch_deg, color: a.color, roofColor: a.roof_color,
    });
    return { shapes: [...shapes, ...made], made, message: `Added a ${a.style} porch (${made.length} parts).` };
  })));

  server.registerTool('add_stairs', {
    title: 'Add stairs',
    description: 'A flight of stairs with the same style, structure, step-count and parametric controls as PolyForm\'s stair tool. The stairs are checked: they must sit wholly inside one room on the floor they start from (they may not poke out of the house or cut through a wall into another room), and the floor above gets a stairwell opening automatically. Easiest: pass room (an id from list_rooms) and PolyForm finds a spot that fits, trying a straight flight, then an L, then a U. Otherwise give position = [x, floor level, z] of the bottom (for a straight flight the centre of the first step\'s front edge) and rotation_deg to turn it: 0 climbs towards +z, 90 towards +x, 180 towards -z, 270 towards -x. A straight flight for a 2.7 m rise is about 3.6 m long, so check the room is long enough. Never place stairs through a bedroom unless the user asked for it. Set rise to the floor-to-floor height. Only pass allow_outside for an external stair.',
    inputSchema: {
      model: modelRef,
      style: z.enum(['straight', 'l-shape', 'u-shape', 'c-shape', 'winder', 'spiral', 'curved', 'bifurcated']).default('straight'),
      rise: z.number().positive().default(2.7).describe('Total height climbed: the floor-to-floor height'),
      width: z.number().positive().default(1),
      length: z.number().positive().optional().describe('Horizontal run in metres; when parametric is true this is recalculated from the ergonomic settings'),
      num_steps: z.number().int().min(4).max(100).optional(),
      structure: z.enum(['closed', 'open', 'floating', 'mono-stringer']).default('closed'),
      railing: z.enum(['none', 'left', 'right', 'both']).default('both'),
      parametric: z.boolean().default(true),
      ideal_step_height: z.number().min(0.1).max(0.3).optional().describe('Target riser height in metres for parametric stairs'),
      stride_constant: z.number().min(0.4).max(0.9).optional().describe('Blondel stride constant in metres for parametric stairs'),
      handrail_height: z.number().min(0.5).max(1.5).optional(),
      color: colour.optional(),
      position: vec3.default([0, 0, 0]),
      rotation_deg: z.number().default(0).describe('Turns the flight about its starting point: 0 climbs towards +z, 90 towards +x, 180 towards -z, 270 towards -x'),
      room: z.string().optional().describe('Room id from list_rooms: place the stairs inside this room automatically (position and rotation_deg are then ignored)'),
      allow_outside: z.boolean().default(false).describe('Allow the stairs outside the walls, for an external stair only'),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, 'Added stairs', shapes => {
    const make = (style: string) => withSdk(shapes, sdk => sdk.architecture.createStairs({
      style,
      height: a.rise,
      width: a.width,
      length: a.length,
      numSteps: a.num_steps,
      structure: a.structure,
      railing: a.railing,
      isParametric: a.parametric,
      idealStepHeight: a.ideal_step_height,
      strideConstant: a.stride_constant,
      handrailHeight: a.handrail_height,
      color: a.color,
      position: [0, 0, 0],
    })).created;
    const warnings: string[] = [];
    let made: Shape[];
    if (a.room) {
      const room = detectRooms(shapes).find(r => r.id === a.room);
      if (!room) throw new ToolError(`No room "${a.room}". Use list_rooms to get the id.`);
      const styles = a.style === 'straight' ? ['straight', 'l-shape', 'u-shape'] : [a.style];
      const variants = styles.map(style => make(style)[0]).filter(Boolean).map(v => ({ ...v, position: [0, a.rise / 2, 0] as Vec3 }));
      const placed = placeStairInRoom(shapes, room, variants);
      if (!placed) throw new ToolError(`No stairs fit inside ${room.name ?? 'that room'} (${round(room.size[0])} × ${round(room.size[1])} m). A straight flight for a ${a.rise} m rise needs about 3.6 × ${a.width} m clear, an L or U about 2.2 × 2.2 m. Pick a bigger room, or a different style such as spiral.`);
      made = [placed];
    } else {
      // The stair mesh is centred on its position, halfway up; a straight flight starts at its front edge.
      const turn = a.rotation_deg * Math.PI / 180;
      const [x, y, z] = a.position;
      made = make(a.style).map(s => {
        const length = Array.isArray(s.args) ? Number(s.args[2]) || 0 : 0;
        const half = a.style === 'straight' ? length / 2 : 0;
        return { ...s, position: [x + Math.sin(turn) * half, y + a.rise / 2, z + Math.cos(turn) * half] as Vec3, rotation: [0, turn, 0] as Vec3 };
      });
      const stair = made.find(s => s.type === 'staircase');
      if (stair) {
        const check = checkStair(shapes, stair, { allowOutside: a.allow_outside });
        if (check.errors.length) {
          throw new ToolError(`${check.errors.join(' ')} Nothing was added. Pass room (an id from list_rooms) to place them automatically, or change position and rotation_deg.`);
        }
        warnings.push(...check.warnings);
      }
    }
    return { shapes: [...shapes, ...made], made, message: `Added stairs.${warnings.length ? ` Check: ${warnings.join(' ')}` : ''}` };
  })));

  server.registerTool('add_railing', {
    title: 'Add a railing',
    description: 'Adds the same standalone architectural railing generated by PolyForm\'s railing tool.',
    inputSchema: {
      model: modelRef,
      length: z.number().positive().default(2),
      height: z.number().positive().default(1),
      position: vec3.default([0, 0, 0]),
      color: colour.optional(),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, 'Added a railing', shapes => {
    const run = withSdk(shapes, sdk => sdk.architecture.createRailing({
      length: a.length,
      height: a.height,
      position: a.position,
      color: a.color,
    }));
    return { shapes: run.shapes, made: run.created };
  })));

  server.registerTool('add_road', {
    title: 'Add a civil road alignment',
    description: 'Adds the same persisted Civil road modifier as PolyForm Terrain Studio, including grade, curb/ditch profile, markings and batter distance.',
    inputSchema: {
      model: modelRef,
      points: z.array(vec3).min(2),
      name: z.string().min(1).max(120).optional(),
      width: z.number().min(0.1).optional(),
      max_grade_percent: z.number().min(0).optional(),
      banking_angle: z.number().optional(),
      curb_width: z.number().min(0).optional(),
      curb_height: z.number().min(0).optional(),
      ditch_width: z.number().min(0).optional(),
      ditch_depth: z.number().min(0).optional(),
      has_curb: z.boolean().optional(),
      has_ditch: z.boolean().optional(),
      markings: z.enum(['none', 'center-dashed', 'center-solid', 'bike-lanes', 'pedestrian-walkway']).optional(),
      material: z.string().optional(),
      batter_distance: z.number().min(0).optional(),
      enabled: z.boolean().optional(),
    },
    annotations: WRITE,
  }, safe(async (a) => {
    let made: any = null;
    const m = await store.loadModel(caller, a.model);
    await store.changeTerrainModifiers(caller, m.id, 'Added a civil road', modifiers => {
      let next = modifiers;
      const run = withSdk(m.shapes, sdk => {
        made = sdk.civil.addRoad({
          points: a.points,
          name: a.name,
          width: a.width,
          maxGradePercent: a.max_grade_percent,
          bankingAngle: a.banking_angle,
          profile: {
            width: a.curb_width,
            height: a.curb_height,
            ditchWidth: a.ditch_width,
            ditchDepth: a.ditch_depth,
            hasCurb: a.has_curb,
            hasDitch: a.has_ditch,
          },
          markings: a.markings,
          material: a.material,
          batterDistance: a.batter_distance,
          enabled: a.enabled,
        });
      }, {
        terrainModifiers: modifiers,
        setTerrainModifiers: (value: any[]) => { next = value; },
      });
      void run;
      return next;
    });
    return text({ model: `${m.name} (${m.id})`, done: 'Added a civil road', modifier: made, tip: 'undo_last_change reverses this.' });
  }));

  server.registerTool('add_grading_pad', {
    title: 'Add a grading pad',
    description: 'Adds the same persisted Civil grading-pad modifier as PolyForm Terrain Studio.',
    inputSchema: {
      model: modelRef,
      center: vec3,
      primitive: z.enum(['rectangle', 'circle']).default('rectangle'),
      dimensions: z.tuple([z.number().positive(), z.number().positive()]).optional(),
      rotation_y: z.number().optional().describe('Rotation in radians'),
      target_elevation: z.number().optional(),
      batter_distance: z.number().min(0).optional(),
      batter_profile: z.enum(['linear', 'curved', 'stepped']).optional(),
      name: z.string().min(1).max(120).optional(),
      enabled: z.boolean().optional(),
    },
    annotations: WRITE,
  }, safe(async (a) => {
    let made: any = null;
    const m = await store.loadModel(caller, a.model);
    await store.changeTerrainModifiers(caller, m.id, 'Added a grading pad', modifiers => {
      let next = modifiers;
      withSdk(m.shapes, sdk => {
        made = sdk.civil.addPad({
          center: a.center,
          primitive: a.primitive,
          dimensions: a.dimensions,
          rotationY: a.rotation_y,
          targetElevation: a.target_elevation,
          batterDistance: a.batter_distance,
          batterProfile: a.batter_profile,
          name: a.name,
          enabled: a.enabled,
        });
      }, {
        terrainModifiers: modifiers,
        setTerrainModifiers: (value: any[]) => { next = value; },
      });
      return next;
    });
    return text({ model: `${m.name} (${m.id})`, done: 'Added a grading pad', modifier: made, tip: 'undo_last_change reverses this.' });
  }));

  server.registerTool('set_pad_surface', {
    title: 'Set grading-pad surface',
    description: 'Adds, edits or clears the pad surface modifier used for parking striping, hatch, asphalt or gravel.',
    inputSchema: {
      model: modelRef,
      pad: z.string(),
      clear: z.boolean().default(false),
      pattern: z.enum(['parking-striping', 'hatch', 'asphalt', 'gravel']).optional(),
      enabled: z.boolean().optional(),
      name: z.string().min(1).max(120).optional(),
      parking_angle: z.union([z.literal(0), z.literal(30), z.literal(45), z.literal(60), z.literal(90)]).optional(),
      stall_width: z.number().positive().optional(),
      stall_depth: z.number().positive().optional(),
      stripe_color: colour.optional(),
      double_row: z.boolean().optional(),
    },
    annotations: WRITE,
  }, safe(async (a) => {
    const m = await store.loadModel(caller, a.model);
    const pad = m.terrainModifiers.find(mod => mod.id === a.pad || mod.name?.toLowerCase() === a.pad.toLowerCase());
    if (!pad || pad.type !== 'pad') throw new ToolError(`No grading pad "${a.pad}". Use list_civil_modifiers to find ids.`);
    await store.changeTerrainModifiers(caller, m.id, 'Updated grading pad surface', modifiers => {
      let next = modifiers;
      withSdk(m.shapes, sdk => sdk.civil.setPadSurface(pad.id, a.clear ? null : {
        pattern: a.pattern ?? 'parking-striping',
        enabled: a.enabled,
        name: a.name,
        parkingConfig: {
          angle: a.parking_angle,
          stallWidth: a.stall_width,
          stallDepth: a.stall_depth,
          stripeColor: a.stripe_color,
          doubleRow: a.double_row,
        },
      }), {
        terrainModifiers: modifiers,
        setTerrainModifiers: (value: any[]) => { next = value; },
      });
      return next;
    });
    const updated = (await store.loadModel(caller, m.id)).terrainModifiers.find(mod => mod.id === pad.id);
    return text({ model: `${m.name} (${m.id})`, done: 'Updated grading pad surface', modifier: updated, tip: 'undo_last_change reverses this.' });
  }));

  server.registerTool('update_civil_modifier', {
    title: 'Update a civil modifier',
    description: 'Updates common persisted settings on an existing civil road or grading pad.',
    inputSchema: {
      model: modelRef,
      modifier: z.string(),
      name: z.string().min(1).max(120).optional(),
      enabled: z.boolean().optional(),
      width: z.number().min(0.1).optional(),
      max_grade_percent: z.number().min(0).optional(),
      target_elevation: z.number().optional(),
      batter_distance: z.number().min(0).optional(),
    },
    annotations: WRITE,
  }, safe(async (a) => {
    const m = await store.loadModel(caller, a.model);
    const current = m.terrainModifiers.find(mod => mod.id === a.modifier || mod.name?.toLowerCase() === a.modifier.toLowerCase());
    if (!current) throw new ToolError(`No civil modifier "${a.modifier}". Use list_civil_modifiers to find ids.`);
    await store.changeTerrainModifiers(caller, m.id, 'Updated civil modifier', modifiers => {
      let next = modifiers;
      const changes: any = {};
      if (a.name !== undefined) changes.name = a.name;
      if (a.enabled !== undefined) changes.enabled = a.enabled;
      if (a.width !== undefined && current.type === 'road') changes.width = a.width;
      if (a.max_grade_percent !== undefined && current.type === 'road') changes.maxGradePercent = a.max_grade_percent;
      if (a.target_elevation !== undefined && current.type === 'pad') changes.targetElevation = a.target_elevation;
      if (a.batter_distance !== undefined) changes.batterDistance = a.batter_distance;
      withSdk(m.shapes, sdk => sdk.civil.update(current.id, changes), {
        terrainModifiers: modifiers,
        setTerrainModifiers: (value: any[]) => { next = value; },
      });
      return next;
    });
    const updated = (await store.loadModel(caller, m.id)).terrainModifiers.find(mod => mod.id === current.id);
    return text({ model: `${m.name} (${m.id})`, done: 'Updated civil modifier', modifier: updated, tip: 'undo_last_change reverses this.' });
  }));

  server.registerTool('remove_civil_modifier', {
    title: 'Remove a civil modifier',
    description: 'Removes a civil road or grading pad by id or exact name.',
    inputSchema: { model: modelRef, modifier: z.string() },
    annotations: WRITE,
  }, safe(async (a) => {
    const m = await store.loadModel(caller, a.model);
    const current = m.terrainModifiers.find(mod => mod.id === a.modifier || mod.name?.toLowerCase() === a.modifier.toLowerCase());
    if (!current) throw new ToolError(`No civil modifier "${a.modifier}". Use list_civil_modifiers to find ids.`);
    await store.changeTerrainModifiers(caller, m.id, 'Removed civil modifier', modifiers => {
      let next = modifiers;
      withSdk(m.shapes, sdk => sdk.civil.remove(current.id), {
        terrainModifiers: modifiers,
        setTerrainModifiers: (value: any[]) => { next = value; },
      });
      return next;
    });
    return text({ model: `${m.name} (${m.id})`, done: `Removed ${current.name ?? current.id}`, tip: 'undo_last_change reverses this.' });
  }));

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

  server.registerTool('import_site', {
    title: 'Import a real site',
    description: 'Brings a real place into the model: its ground (an editable terrain, heights relative to the centre, which is y = 0) and its existing buildings as white models from OpenStreetMap, each its own object (type site_building) that can be moved or deleted. In England and the Netherlands, national LiDAR gives 1 m ground, measured building heights and fitted roofs (buildings the survey shows as open ground are flagged heightCheck); in the USA, 1 m ground. Up to 200 m square. Importing again replaces the previous site; the rest of the model is kept. North is -z.',
    inputSchema: {
      model: modelRef,
      place: z.string().optional().describe('Address, UK postcode, or "lat, lng"'),
      lat: z.number().min(-85).max(85).optional(),
      lng: z.number().min(-180).max(180).optional(),
      size: z.number().min(MIN_SITE_SIZE).max(MAX_SITE_SIZE).default(100).describe('Side of the square area, metres'),
      ground: z.enum(['plain', 'satellite']).default('plain').describe('How the ground looks in the app (satellite needs the app\'s Google Maps key)'),
      buildings: z.boolean().default(true).describe('false: the ground only'),
      street_life: z.enum(['off', 'quiet', 'normal', 'busy']).default('normal').describe('Moving cars and people along the real roads and paths, shown in presentations'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, safe(async (a) => {
    let found: { lat: number; lng: number; address: string } | null = null;
    if (a.lat !== undefined && a.lng !== undefined) found = { lat: a.lat, lng: a.lng, address: a.place ?? `${a.lat.toFixed(6)}, ${a.lng.toFixed(6)}` };
    else if (a.place) found = await (ctx.findPlace ?? (t => findPlace(t)))(a.place);
    else throw new ToolError('Give a place (address, postcode or "lat, lng"), or lat and lng.');
    if (!found) throw new ToolError(`Couldn't find "${a.place}". Try a postcode, a fuller address, or lat and lng.`);
    const built = await buildSite(ctx.siteIO ?? nodeSiteIO, {
      origin: { lat: found.lat, lng: found.lng }, size: a.size, address: found.address, groundStyle: a.ground, skipBuildings: !a.buildings,
    });
    const site = built.ground.terrainData!.site!;
    site.streetLife = a.street_life;
    return change(a.model, `Imported the site at ${found.address}`, shapes => ({
      shapes: replaceSite(shapes, built),
      made: [built.ground],
      message: `Imported ${a.size} × ${a.size} m of ground at ${found!.address} with ${built.buildings.length} existing buildings (list_objects shows them as site_building).${built.warnings.length ? ` Note: ${built.warnings.join(' ')}` : ''}`,
    }));
  }));

  server.registerTool('set_street_life', {
    title: 'Set street life',
    description: 'Moving cars, people and birds on the imported site (import_site first). Cars drive the real roads, keeping to the country\'s side, slow for bends, indicate and stop for people; white figures walk the footpaths and pavements, wait for cars, and sit on any benches; two flocks of birds fly overhead. They move in presentations and on the client page unless off; in_editor also shows them while editing. auto_street_lights places lamp posts along the roads (LED, cobra head, double arm) and gate and path lights at some houses, or removes them (needs the map\'s roads: show street life in the app once first). add_routes are extra routes of your own as [x, z] points in metres: kind "path" for people (e.g. across a new garden) or "road" for cars (e.g. a new drive).',
    inputSchema: {
      model: modelRef,
      level: z.enum(['off', 'quiet', 'normal', 'busy']).optional(),
      in_editor: z.boolean().optional(),
      auto_street_lights: z.boolean().optional().describe('Place (true) or remove (false) Auto Street Light lamps along the roads and at some houses'),
      add_routes: z.array(z.object({
        kind: z.enum(['path', 'road']),
        points: z.array(z.tuple([z.number(), z.number()])).min(2),
      })).optional(),
      remove_drawn_routes: z.boolean().optional().describe('Remove every route drawn by hand (map roads and paths stay)'),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, 'Set street life', shapes => {
    const ground = findSiteGround(shapes);
    if (!ground) throw new ToolError('This model has no imported site; use import_site first.');
    let next = shapes;
    if (a.remove_drawn_routes) next = withoutRoutes(next, (ground.terrainData!.site!.routes ?? []).filter(r => r.source === 'drawn').map(r => r.id));
    for (const r of a.add_routes ?? []) next = withDrawnRoute(next, r.kind, r.points as [number, number][]);
    next = withSiteSettings(next, {
      ...(a.level ? { streetLife: a.level } : {}),
      ...(a.in_editor !== undefined ? { streetLifeInEditor: a.in_editor } : {}),
    });
    if (a.auto_street_lights !== undefined) {
      if (a.auto_street_lights && !findSiteGround(next)!.terrainData!.site!.routes) throw new ToolError('The map\'s roads are not loaded yet. Open the model in PolyForm and show street life once, then try again.');
      next = applyAutoStreetLights(next, a.auto_street_lights);
    }
    const site = findSiteGround(next)!.terrainData!.site!;
    const routes = site.routes ?? [];
    return {
      shapes: next,
      made: [],
      message: `Street life ${site.streetLife ?? 'normal'}${site.streetLifeInEditor ? ', also in the editor' : ''}${site.autoStreetLights ? ', with street lights' : ''}; ${routes.filter(r => r.kind === 'road').length} driving and ${routes.filter(r => r.kind === 'path').length} walking routes${routes.length ? '' : ' (the app loads the map\'s roads and paths when it first shows street life)'}.`,
    };
  })));

  server.registerTool('flatten_terrain', {
    title: 'Flatten terrain',
    description: 'Levels a terrain to one height, undoing any raised or dug ground, and keeps its material, grass and flowers. The app then sets the ground under building floors as usual.',
    inputSchema: {
      model: modelRef,
      terrain: z.string().optional().describe('Terrain object id (default: the model\'s only terrain)'),
      height: z.number().min(-50).max(50).default(0).describe('Ground height, metres'),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, `Flattened the terrain to ${a.height} m`, shapes => {
    const terrains = shapes.filter(s => s.type === 'terrain');
    const target = a.terrain ? findShape(shapes, a.terrain) : terrains.length === 1 ? terrains[0] : null;
    if (!target) throw new ToolError(terrains.length ? `This model has ${terrains.length} terrains; say which with terrain.` : 'This model has no terrain.');
    if (target.type !== 'terrain' || !target.terrainData) throw new ToolError(`"${target.name ?? target.id}" is not a terrain.`);
    const { heightMap: _unused, ...data } = target.terrainData as any;
    const flat = new Array(data.heights.length).fill(a.height);
    const next = { ...target, terrainData: { ...data, heights: flat, baseHeights: [...flat], topography: 'flat' } } as Shape;
    return { shapes: shapes.map(s => (s.id === target.id ? next : s)), made: [next] };
  })));

  const WEATHER_KINDS = ['rain', 'snow', 'clouds', 'mist'] as const;
  const weatherLayer = () => z.object({
    enabled: z.boolean(),
    density: z.number().min(0).max(1).optional(),
    speed: z.number().min(0).max(40).optional(),
    color: colour.optional(),
  }).optional();

  server.registerTool('set_weather', {
    title: 'Set weather',
    description: 'Turns weather layers (rain, snow, clouds, mist) on or off around the model, and sets the wind. Applies to the whole model, not one object.',
    inputSchema: {
      model: modelRef,
      enabled: z.boolean().optional().describe('Master switch for weather; layers only show while this is on'),
      wind: z.tuple([z.number().min(-20).max(20), z.number().min(-20).max(20)]).optional().describe('[east-west, north-south] in m/s'),
      rain: weatherLayer(),
      snow: weatherLayer(),
      clouds: weatherLayer(),
      mist: weatherLayer(),
    },
    annotations: WRITE,
  }, safe(async (a) => changeSettings(a.model, 'Changed weather', settings => {
    const next: GraphicsSettings = { ...settings, weather: { ...settings.weather, layers: { ...settings.weather.layers } } };
    if (a.enabled !== undefined) next.weather.enabled = a.enabled;
    if (a.wind) { next.weather.windX = a.wind[0]; next.weather.windZ = a.wind[1]; }
    for (const kind of WEATHER_KINDS) {
      const layer = a[kind];
      if (!layer) continue;
      next.weather.layers[kind] = {
        ...next.weather.layers[kind], enabled: layer.enabled,
        ...(layer.density !== undefined && { density: layer.density }),
        ...(layer.speed !== undefined && { speed: layer.speed }),
        ...(layer.color && { color: layer.color }),
      };
    }
    return next;
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
    title: 'Add a pond, lake or flowing water body',
    description: 'Water filling an outline of ground points; it digs its own basin into the terrain. Set flow_mode to stream for a directional current.',
    inputSchema: {
      model: modelRef,
      points: z.array(point2).min(3),
      depth: z.number().min(0.2).max(20).default(1.2),
      clarity: z.enum(['clear', 'lake', 'pond', 'murky']).default('lake'),
      flow_mode: z.enum(['still', 'stream']).default('still'),
      flow_direction: point2.optional().describe('Plan direction [x, z] for stream/current flow; normalised by the renderer'),
      flow_speed: z.number().min(0).max(4).optional().describe('Surface current speed in metres/second'),
      turbulence: z.number().min(0).max(1).optional().describe('Extra small-scale disturbance from 0 to 1'),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, a.flow_mode === 'stream' ? 'Added flowing water' : 'Added a pond', shapes => add(waterBody(
    shapes,
    a.points as [number, number][],
    {
      depth: a.depth,
      clarity: a.clarity,
      flow: a.flow_mode === 'stream' ? {
        mode: 'stream',
        direction: a.flow_direction as [number, number] | undefined,
        speed: a.flow_speed,
        turbulence: a.turbulence,
      } : { mode: 'still' },
    },
  ))(shapes))));

  server.registerTool('update_pond', {
    title: 'Edit a pond, lake or flowing water body',
    description: 'Edits the same saved water settings as PolyForm\'s Water controls: depth, clarity, level, basin digging and directional flow.',
    inputSchema: {
      model: modelRef,
      object: z.string().describe('Water object id or exact name'),
      depth: z.number().min(0.01).max(20).optional(),
      clarity: z.enum(['clear', 'lake', 'pond', 'murky']).optional(),
      level: z.number().optional().describe('Water surface elevation in metres'),
      dig: z.boolean().optional().describe('Whether the water body digs its basin into terrain'),
      flow_mode: z.enum(['still', 'stream']).optional(),
      flow_direction: point2.optional(),
      flow_speed: z.number().min(0).max(4).optional(),
      turbulence: z.number().min(0).max(1).optional(),
      clear_flow: z.boolean().default(false).describe('Remove saved flow settings entirely'),
      name: z.string().min(1).max(120).optional(),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, 'Updated water body', shapes => {
    const source = findShape(shapes, a.object);
    if (source.type !== 'water' || !source.waterData) throw new ToolError(`"${a.object}" is not a water body.`);
    const flowRequested = a.flow_mode !== undefined || a.flow_direction !== undefined || a.flow_speed !== undefined || a.turbulence !== undefined;
    const flow = a.clear_flow ? null : flowRequested ? {
      mode: a.flow_mode ?? source.waterData.flow?.mode ?? 'stream',
      direction: a.flow_direction as [number, number] | undefined,
      speed: a.flow_speed,
      turbulence: a.turbulence,
    } : undefined;
    const run = withSdk(shapes, sdk => sdk.landscape.updatePond(source.id, {
      depth: a.depth,
      clarity: a.clarity,
      level: a.level,
      dig: a.dig,
      flow,
      name: a.name,
    }));
    const edited = run.shapes.find(s => s.id === source.id)!;
    return { shapes: run.shapes, made: [edited] };
  })));

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

  server.registerTool('update_patio', {
    title: 'Edit a patio or deck',
    description: 'Edits the same saved patio/deck settings as PolyForm\'s Patio controls, including finish, railing, lights and edge steps.',
    inputSchema: {
      model: modelRef,
      object: z.string().describe('Patio/deck object id or exact name'),
      level: z.number().optional(),
      name: z.string().min(1).max(120).optional(),
      paving: z.enum(['slabs', 'block', 'natural', 'porcelain', 'gravel']).optional(),
      slab_size: z.tuple([z.number().positive(), z.number().positive()]).optional(),
      board: z.enum(['softwood', 'hardwood', 'composite', 'weathered', 'painted']).optional(),
      railing: z.enum(['none', 'timber', 'glass', 'cable']).optional(),
      lights_enabled: z.boolean().optional(),
      light_spacing: z.number().positive().optional(),
      steps: z.array(z.object({
        edge: z.number().int().min(0),
        t: z.number().min(0).max(1),
        width: z.number().positive(),
      })).optional(),
    },
    annotations: WRITE,
  }, safe(async (a) => change(a.model, 'Updated patio or deck', shapes => {
    const source = findShape(shapes, a.object);
    if (source.type !== 'patio' || !source.patioData) throw new ToolError(`"${a.object}" is not a patio or deck.`);
    const settings: Record<string, unknown> = {};
    if (a.paving !== undefined) settings.paving = a.paving;
    if (a.slab_size !== undefined) settings.slabSize = a.slab_size;
    if (a.board !== undefined) settings.board = a.board;
    if (a.railing !== undefined) settings.railing = a.railing;
    if (a.lights_enabled !== undefined || a.light_spacing !== undefined) {
      settings.lights = {
        ...(source.patioData.lights ?? {}),
        ...(a.lights_enabled !== undefined ? { enabled: a.lights_enabled } : {}),
        ...(a.light_spacing !== undefined ? { spacing: a.light_spacing } : {}),
      };
    }
    const run = withSdk(shapes, sdk => sdk.landscape.updatePatio(source.id, {
      level: a.level,
      name: a.name,
      settings,
      steps: a.steps,
    }));
    const edited = run.shapes.find(s => s.id === source.id)!;
    return { shapes: run.shapes, made: [edited] };
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
    description: 'Sets colour, a textured material preset, or a plain finish (plastic, metal, glass, paint) on objects, including doors and windows. For terrain, also sets the ground texture, and turns procedural grass and wildflower meadows on or off. See list_catalog materials / finishes.',
    inputSchema: {
      model: modelRef,
      objects: z.array(z.string()).min(1),
      color: colour.optional(),
      material: z.string().optional().describe('Material preset id or plain finish id'),
      opacity: z.number().min(0.05).max(1).optional(),
      terrain_texture: z.string().optional().describe('For terrain: a texture id from list_catalog terrain_textures'),
      grass: z.object({
        enabled: z.boolean(),
        density: z.number().min(1).max(60).optional().describe('Instances per m²'),
        root_color: colour.optional(),
        tip_color: colour.optional(),
      }).optional().describe('For terrain: procedural grass'),
      flowers: z.object({
        enabled: z.boolean(),
        density: z.number().min(0.05).max(15).optional().describe('Instances per m²'),
        flower_type: z.enum(['mixed', 'poppy', 'alpine', 'buttercup', 'lavender', 'daisy']).optional(),
        primary_color: colour.optional(),
        secondary_color: colour.optional(),
      }).optional().describe('For terrain: a procedural wildflower meadow'),
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
      if (out.type === 'terrain') {
        if (a.terrain_texture) out = withTerrainTexture(out, a.terrain_texture);
        if (a.grass || a.flowers) {
          out = { ...out, terrainData: { ...out.terrainData } as typeof out.terrainData };
          if (a.grass && out.terrainData) {
            out.terrainData.grass = {
              ...out.terrainData.grass, enabled: a.grass.enabled,
              ...(a.grass.density !== undefined && { density: a.grass.density }),
              ...(a.grass.root_color && { rootColor: a.grass.root_color }),
              ...(a.grass.tip_color && { tipColor: a.grass.tip_color }),
            } as typeof out.terrainData.grass;
          }
          if (a.flowers && out.terrainData) {
            out.terrainData.flowers = {
              ...out.terrainData.flowers, enabled: a.flowers.enabled,
              ...(a.flowers.density !== undefined && { density: a.flowers.density }),
              ...(a.flowers.flower_type && { flowerType: a.flowers.flower_type }),
              ...(a.flowers.primary_color && { primaryColor: a.flowers.primary_color }),
              ...(a.flowers.secondary_color && { secondaryColor: a.flowers.secondary_color }),
            } as typeof out.terrainData.flowers;
          }
        }
      }
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
    const { note } = await store.undo(caller, model);
    return text(note ? `Undid: ${note}` : 'Nothing to undo for this model.');
  }));
}
