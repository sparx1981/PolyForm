import { z } from 'zod';
import type { ProjectState } from '../../src/lib/storage/projectFile';
import { MemoryStore, ToolError, type Caller } from './store';
import { registerTools, type ToolContext } from './tools';

/**
 * Builds a whole model in memory from a list of the connector's own tools, with no database. The tools are
 * the same ones Claude calls one at a time, so the objects come out identical; the result is a project file
 * rather than a saved model. Used when the database is unavailable.
 */
export interface BuildStep {
  tool: string;
  args?: Record<string, unknown>;
}

export const MAX_STEPS = 500;
/**
 * Claude gives up on a tool call after about 60 s, however long the host allows, and a result it never receives is
 * wasted. Leave room to export and save to Drive after the build.
 */
export const BUILD_BUDGET_MS = 45_000;

/** Tools that make no sense inside a build: they read or save the stored models, or take pictures. */
const NOT_IN_A_BUILD = new Set(['create_model', 'list_models', 'screenshot', 'preview_model', 'build_model', 'export_model']);

type Tool = { schema: z.ZodObject<any>; run: (args: any) => Promise<{ content: { type: string; text?: string }[]; isError?: boolean }> };

/** "$3.created.0.id" is the first created object's id from step 3; "*" collects a field from every item (spliced into a list it appears in). */
function resolveRefs(value: unknown, results: unknown[], step: number): unknown {
  if (typeof value === 'string') {
    const m = value.match(/^\$(\d+)((?:\.[^.\s]+)*)$/);
    if (!m) return value;
    const from = Number(m[1]);
    if (from < 1 || from >= step) throw new ToolError(`Step ${step}: "${value}" refers to step ${from}, which has not run yet. A step can only refer to an earlier one.`);
    let current: any = results[from - 1];
    const path = m[2] ? m[2].slice(1).split('.') : [];
    for (let i = 0; i < path.length; i++) {
      const key = path[i];
      if (key === '*') {
        if (!Array.isArray(current)) throw new ToolError(`Step ${step}: "${value}" uses * on something that is not a list.`);
        const rest = path.slice(i + 1);
        return current.map(item => rest.reduce((v: any, k) => v?.[k], item));
      }
      current = current?.[key];
      if (current === undefined) throw new ToolError(`Step ${step}: "${value}" found nothing in the result of step ${from}.`);
    }
    return current;
  }
  if (Array.isArray(value)) {
    // A "*" reference inside a list stands for all its items: ["$3.created.*.id"] is the list of ids, not a list of lists.
    return value.flatMap(v => {
      const resolved = resolveRefs(v, results, step);
      return typeof v === 'string' && v.includes('.*') && Array.isArray(resolved) ? resolved : [resolved];
    });
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, results, step)]));
  }
  return value;
}

export interface OfflineResult {
  project: ProjectState;
  steps: number;
  /** What each step reported doing, in order. */
  log: string[];
  overview: unknown;
  health: unknown;
  geometry: unknown;
}

export async function buildOffline(
  caller: Caller,
  name: string,
  steps: BuildStep[],
  extras: Pick<ToolContext, 'siteIO' | 'findPlace'> = {},
  budgetMs = BUILD_BUDGET_MS,
): Promise<OfflineResult> {
  if (steps.length > MAX_STEPS) throw new ToolError(`At most ${MAX_STEPS} steps in one build; this has ${steps.length}.`);
  const started = Date.now();
  const store = new MemoryStore();
  const who: Caller = { uid: caller.uid, email: caller.email, name: caller.name };
  const tools = new Map<string, Tool>();
  registerTools({
    registerTool: (toolName: string, config: any, run: any) => tools.set(toolName, { schema: z.object(config.inputSchema ?? {}).strict(), run }),
  } as any, { caller: who, store, ...extras });

  const modelId = await store.createModel(who, name);
  const results: unknown[] = [];
  const log: string[] = [];

  const run = async (toolName: string, args: Record<string, unknown>, label: string) => {
    const tool = tools.get(toolName);
    if (!tool) throw new ToolError(`${label}: there is no tool called "${toolName}".`);
    // Every tool that works on a model takes `model`; the build has only one, so it is filled in.
    const withModel = 'model' in tool.schema.shape && args.model === undefined ? { ...args, model: modelId } : args;
    const parsed = tool.schema.safeParse(withModel);
    if (!parsed.success) {
      const problems = parsed.error.issues.map(i => `${i.path.join('.') || '(arguments)'}: ${i.message}`).join('; ');
      throw new ToolError(`${label} (${toolName}): the arguments are not valid: ${problems}. Nothing was saved.`);
    }
    const result = await tool.run(parsed.data);
    const text = result.content.find(c => c.type === 'text')?.text ?? '';
    if (result.isError) throw new ToolError(`${label} (${toolName}) failed: ${text} Nothing was saved.`);
    try { return JSON.parse(text); } catch { return text; }
  };

  for (let i = 0; i < steps.length; i++) {
    const n = i + 1;
    const step = steps[i];
    if (NOT_IN_A_BUILD.has(step.tool)) {
      throw new ToolError(`Step ${n}: "${step.tool}" cannot be used inside a build. The model is created for you and every step works on it.`);
    }
    if (Date.now() - started > budgetMs) {
      throw new ToolError(`The build ran out of time after ${i} of ${steps.length} steps. Nothing was saved. Send fewer steps (the slow ones are usually import_site, add_stairs and furnish_room).`);
    }
    const args = resolveRefs(step.args ?? {}, results, n) as Record<string, unknown>;
    const out = await run(step.tool, args, `Step ${n}`);
    results.push(out);
    log.push(`${n}. ${step.tool}: ${typeof out === 'object' && out ? (out as any).done ?? 'done' : String(out).slice(0, 120)}`);
  }

  const overview = await run('get_model', {}, 'Summary');
  const health = await run('check_model_health', {}, 'Health check');
  const geometry = await run('check_geometry', {}, 'Geometry check');
  const { project } = await store.exportProject(who, modelId);
  return { project, steps: steps.length, log, overview, health, geometry };
}
