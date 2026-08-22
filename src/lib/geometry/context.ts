/**
 * PolyForm geometry kernel — containers and edit context. §2.5, R8
 *
 * Everything in §2.2 describes geometry that STICKS. That is correct for what
 * the user is actively drawing and unusable as a whole-model policy: without
 * isolation, every object welds to every object it touches and a model
 * becomes one undifferentiated graph within an afternoon.
 *
 *   R8 — Stickiness stops at a container boundary. R1-R7 apply only between
 *   entities in the SAME graph. Two edges that coincide exactly but sit in
 *   different containers do not merge, do not split each other, and do not
 *   together bound a face.
 *
 * This is what makes 3D objects behave as objects. Two boxes built as
 * containers and pushed together interpenetrate and stay independent; two
 * boxes built as loose geometry in one graph weld and cut each other, exactly
 * as R2 and R4 require. The difference is CONTAINMENT, not dimensionality —
 * there is no separate rule for solids.
 */

import type {
  Container, ContainerId, EdgeId, Graph, Mat4, Vec3, VertexId,
} from './types';
import { createGraph, addVertex, addEdge, getVertex, removeEdge } from './topology';
import {
  IDENTITY, determinantSign, invert, inverseTranspose, isAnglePreserving,
  multiply, transformNormal, transformPoint,
} from './mat4';
import { tryNormalize } from './math';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export interface ContainerModel {
  root: Container;
  containers: Map<ContainerId, Container>;
  /** The graph drawing writes to. §2.5.2 */
  activeContext: ContainerId;
  nextContainerId: number;
}

export function createContainerModel(): ContainerModel {
  const rootId = 1 as ContainerId;
  const root: Container = {
    id: rootId,
    parent: null,
    children: [],
    name: 'Model',
    transform: IDENTITY,
    cachedWorld: IDENTITY,
    cachedWorldInverse: IDENTITY,
    cachedWorldInverseTranspose: IDENTITY,
    determinantSign: 1,
    graph: createGraph(),
  };
  return {
    root,
    containers: new Map([[rootId, root]]),
    activeContext: rootId,
    nextContainerId: 2,
  };
}

export const getContainer = (m: ContainerModel, id: ContainerId): Container => {
  const c = m.containers.get(id);
  if (!c) throw new Error(`Container ${id} not found`);
  return c;
};

export const activeGraph = (m: ContainerModel): Graph =>
  getContainer(m, m.activeContext).graph;

export function createContainer(
  m: ContainerModel,
  parent: ContainerId,
  name = 'Group',
  transform: Mat4 = IDENTITY,
): Container {
  const parentContainer = getContainer(m, parent);
  const id = m.nextContainerId++ as ContainerId;
  const container: Container = {
    id,
    parent,
    children: [],
    name,
    transform,
    cachedWorld: null,
    cachedWorldInverse: null,
    cachedWorldInverseTranspose: null,
    determinantSign: determinantSign(transform),
    graph: createGraph(),
  };
  m.containers.set(id, container);
  parentContainer.children.push(id);
  return container;
}

// ---------------------------------------------------------------------------
// Transforms — §2.5.2
// ---------------------------------------------------------------------------

/**
 * World matrix, composed down the nesting chain and cached.
 *
 * Never recompute inside a hit-test loop: that runs on every mouse move, and
 * a nested container would recompose its whole chain each time.
 */
export function worldMatrix(m: ContainerModel, id: ContainerId): Mat4 {
  const c = getContainer(m, id);
  if (c.cachedWorld) return c.cachedWorld;
  const world = c.parent === null
    ? c.transform
    : multiply(worldMatrix(m, c.parent), c.transform);
  c.cachedWorld = world;
  return world;
}

export function worldInverse(m: ContainerModel, id: ContainerId): Mat4 {
  const c = getContainer(m, id);
  if (c.cachedWorldInverse) return c.cachedWorldInverse;
  const inv = invert(worldMatrix(m, id));
  c.cachedWorldInverse = inv;
  return inv;
}

/**
 * The matrix NORMALS transform by. Not the same as the inverse.
 *
 * Under a non-uniform scale, transforming a normal as a direction produces a
 * plane that is visibly plausible and subtly skewed — which shows up as
 * On-Face snapping that misses. §2.5.2
 */
export function worldInverseTranspose(m: ContainerModel, id: ContainerId): Mat4 {
  const c = getContainer(m, id);
  if (c.cachedWorldInverseTranspose) return c.cachedWorldInverseTranspose;
  const it = inverseTranspose(worldMatrix(m, id));
  c.cachedWorldInverseTranspose = it;
  return it;
}

/** Invalidates a container and everything beneath it. */
export function invalidateTransforms(m: ContainerModel, id: ContainerId): void {
  const c = m.containers.get(id);
  if (!c) return;
  c.cachedWorld = null;
  c.cachedWorldInverse = null;
  c.cachedWorldInverseTranspose = null;
  for (const child of c.children) invalidateTransforms(m, child);
}

export function setTransform(m: ContainerModel, id: ContainerId, transform: Mat4): void {
  const c = getContainer(m, id);
  c.transform = transform;
  c.determinantSign = determinantSign(transform);
  invalidateTransforms(m, id);
}

export const localToWorld = (m: ContainerModel, id: ContainerId, p: Vec3): Vec3 =>
  transformPoint(p, worldMatrix(m, id));

export const worldToLocal = (m: ContainerModel, id: ContainerId, p: Vec3): Vec3 =>
  transformPoint(p, worldInverse(m, id));

export const normalToLocal = (m: ContainerModel, id: ContainerId, n: Vec3): Vec3 =>
  transformNormal(n, worldInverseTranspose(m, id));

/**
 * Converts a point found in one context into another's local frame.
 *
 * The cross-context snap path: hit-testing runs everywhere, insertion writes
 * only to the active context. Leaking a parent-frame point into a child graph
 * puts geometry somewhere visibly wrong the moment the container moves.
 */
export function convertPoint(
  m: ContainerModel,
  p: Vec3,
  from: ContainerId,
  to: ContainerId,
): Vec3 {
  if (from === to) return p;
  return worldToLocal(m, to, localToWorld(m, from, p));
}

export function convertNormal(
  m: ContainerModel,
  n: Vec3,
  from: ContainerId,
  to: ContainerId,
): Vec3 {
  if (from === to) return n;
  const world = transformNormal(n, worldInverseTranspose(m, from));
  return transformNormal(world, invert(worldInverseTranspose(m, to)));
}

// ---------------------------------------------------------------------------
// Edit context — §2.5.2
// ---------------------------------------------------------------------------

export interface ContextWarning {
  readonly kind: 'non-uniform-scale' | 'mirrored';
  readonly message: string;
  readonly containerId: ContainerId;
}

/**
 * Opens a container for editing.
 *
 * Warns on a non-uniform ancestor scale, because under one, "perpendicular in
 * world space" and "perpendicular in this container" are genuinely different
 * constraints. Axis locks will visibly not align with the world axes, and
 * without a cue that reads as broken snapping. §2.5.2
 */
export function enterContext(
  m: ContainerModel,
  id: ContainerId,
): { warnings: ContextWarning[] } {
  getContainer(m, id);
  m.activeContext = id;

  const warnings: ContextWarning[] = [];
  const world = worldMatrix(m, id);

  if (!isAnglePreserving(world)) {
    warnings.push({
      kind: 'non-uniform-scale',
      containerId: id,
      message:
        'This group has a non-uniform scale. Angles are not preserved, so axis ' +
        'locks and perpendicular inferences will not line up with the world axes. ' +
        'Normalising the scale into the geometry fixes it permanently.',
    });
  }
  if (determinantSign(world) < 0) {
    warnings.push({
      kind: 'mirrored',
      containerId: id,
      message:
        'This group is mirrored, so faces will appear reversed from outside it. ' +
        'The local geometry is correct — the transform describes the mirror.',
    });
  }
  return { warnings };
}

export function exitContext(m: ContainerModel): ContainerId {
  const c = getContainer(m, m.activeContext);
  m.activeContext = c.parent ?? m.root.id;
  return m.activeContext;
}

/** Root to active, for breadcrumbs and for dimming out-of-context geometry. */
export function contextPath(m: ContainerModel, id?: ContainerId): ContainerId[] {
  const path: ContainerId[] = [];
  let current: ContainerId | null = id ?? m.activeContext;
  while (current !== null) {
    path.unshift(current);
    current = m.containers.get(current)?.parent ?? null;
  }
  return path;
}

/**
 * Bakes a container's scale into its geometry and resets the matrix.
 *
 * The fix users actually want for a non-uniformly scaled group: afterwards
 * every inference behaves normally, permanently, rather than being worked
 * around at each use. §2.5.2
 */
export function normaliseScale(m: ContainerModel, id: ContainerId): boolean {
  const c = getContainer(m, id);
  if (isAnglePreserving(c.transform)) return false;
  for (const v of c.graph.vertices.values()) {
    v.position = transformPoint(v.position, c.transform);
  }
  for (const child of c.children) {
    const cc = getContainer(m, child);
    cc.transform = multiply(c.transform, cc.transform);
    invalidateTransforms(m, child);
  }
  c.transform = IDENTITY;
  c.determinantSign = 1;
  invalidateTransforms(m, id);
  return true;
}

// ---------------------------------------------------------------------------
// R8 verification
// ---------------------------------------------------------------------------

/**
 * True when two entities may interact under R1-R7.
 *
 * The single question every rule should ask before touching a pair. Kept as
 * one function so the answer cannot drift between call sites.
 */
export const mayInteract = (a: ContainerId, b: ContainerId): boolean => a === b;

/**
 * Coincident geometry across containers, for diagnostics.
 *
 * NOT a defect: it is R8 working. Reported because a user who expected two
 * objects to merge and finds they did not is owed an explanation, and
 * "explode one of them" is the answer.
 */
export function findCrossContextCoincidence(
  m: ContainerModel,
  tolerance: number,
): { a: ContainerId; b: ContainerId; point: Vec3 }[] {
  const out: { a: ContainerId; b: ContainerId; point: Vec3 }[] = [];
  const ids = [...m.containers.keys()].sort((x, y) => x - y);

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const ca = getContainer(m, ids[i]!);
      const cb = getContainer(m, ids[j]!);
      for (const va of ca.graph.vertices.values()) {
        const wa = localToWorld(m, ca.id, va.position);
        for (const vb of cb.graph.vertices.values()) {
          const wb = localToWorld(m, cb.id, vb.position);
          const d = Math.hypot(wa.x - wb.x, wa.y - wb.y, wa.z - wb.z);
          if (d <= tolerance) out.push({ a: ca.id, b: cb.id, point: wa });
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Explode — §2.5.3
// ---------------------------------------------------------------------------

export interface ExplodeResult {
  /** Edges landing in the parent graph. Feed these to derivation. */
  readonly touched: Set<EdgeId>;
  readonly vertexMap: Map<VertexId, VertexId>;
  readonly edgeMap: Map<EdgeId, EdgeId>;
}

/**
 * Dissolves a container into its parent.
 *
 * Stickiness now applies: coincident vertices merge, crossing edges split,
 * coplanar regions re-derive. This is the operation that makes previously
 * independent objects cut each other, and it is irreversible except by undo.
 *
 * Geometry is transformed into the parent's frame on the way across —
 * carrying local coordinates over unchanged would move everything.
 */
export function explode(m: ContainerModel, id: ContainerId): ExplodeResult {
  const c = getContainer(m, id);
  if (c.parent === null) throw new Error('Cannot explode the root container');
  const parent = getContainer(m, c.parent);

  const vertexMap = new Map<VertexId, VertexId>();
  const edgeMap = new Map<EdgeId, EdgeId>();
  const touched = new Set<EdgeId>();

  for (const [oldId, v] of [...c.graph.vertices].sort((a, b) => a[0] - b[0])) {
    const moved = transformPoint(v.position, c.transform);
    const nv = addVertex(parent.graph, moved, v.provenance);
    vertexMap.set(oldId, nv.id);
  }

  for (const [oldId, e] of [...c.graph.edges].sort((a, b) => a[0] - b[0])) {
    const v0 = vertexMap.get(e.v0);
    const v1 = vertexMap.get(e.v1);
    if (v0 === undefined || v1 === undefined || v0 === v1) continue;
    const ne = addEdge(parent.graph, v0, v1);
    ne.smooth = e.smooth;
    ne.hidden = e.hidden;
    edgeMap.set(oldId, ne.id);
    touched.add(ne.id);
  }

  // Children are re-parented, with their transforms composed so they do not
  // move: they were relative to a container that no longer exists.
  for (const childId of [...c.children]) {
    const child = getContainer(m, childId);
    child.parent = parent.id;
    child.transform = multiply(c.transform, child.transform);
    parent.children.push(childId);
    invalidateTransforms(m, childId);
  }

  parent.children = parent.children.filter((x) => x !== id);
  m.containers.delete(id);
  if (m.activeContext === id) m.activeContext = parent.id;

  return { touched, vertexMap, edgeMap };
}

// ---------------------------------------------------------------------------
// Group — §2.5.3
// ---------------------------------------------------------------------------

export interface GroupResult {
  readonly container: Container;
  /**
   * Edges duplicated because they were shared with geometry left behind.
   *
   * R8 forbids one edge spanning two graphs, so a shared edge must exist in
   * both. Users experience this as "grouping a face left a copy of its lines
   * behind" and it surprises them, so say so in the UI at the time. §2.5.3
   */
  readonly duplicatedEdges: EdgeId[];
  /** Edges remaining in the source graph. Feed to derivation. */
  readonly sourceTouched: Set<EdgeId>;
}

/**
 * Moves a selection of edges into a new container under the same parent.
 *
 * The container's transform is identity, so geometry does not move; the
 * selection is simply isolated from what remains.
 */
export function group(
  m: ContainerModel,
  from: ContainerId,
  edges: readonly EdgeId[],
  name = 'Group',
): GroupResult {
  const source = getContainer(m, from);
  const selected = new Set(edges.filter((e) => source.graph.edges.has(e)));
  const container = createContainer(m, source.parent ?? from, name, IDENTITY);

  const vertexMap = new Map<VertexId, VertexId>();
  const duplicatedEdges: EdgeId[] = [];
  const sourceTouched = new Set<EdgeId>();

  const mapVertex = (vid: VertexId): VertexId => {
    const existing = vertexMap.get(vid);
    if (existing !== undefined) return existing;
    const v = getVertex(source.graph, vid);
    const nv = addVertex(container.graph, { ...v.position }, v.provenance);
    vertexMap.set(vid, nv.id);
    return nv.id;
  };

  for (const eid of [...selected].sort((a, b) => a - b)) {
    const e = source.graph.edges.get(eid);
    if (!e) continue;

    const ne = addEdge(container.graph, mapVertex(e.v0), mapVertex(e.v1));
    ne.smooth = e.smooth;
    ne.hidden = e.hidden;

    // Is either endpoint still attached to unselected geometry? If so the
    // edge is shared, and R8 means it must exist in both graphs.
    const shared = [e.v0, e.v1].some((vid) =>
      getVertex(source.graph, vid).edges.some((other) => !selected.has(other)),
    );

    if (shared) {
      duplicatedEdges.push(eid);
      for (const vid of [e.v0, e.v1]) {
        for (const other of getVertex(source.graph, vid).edges) {
          if (!selected.has(other)) sourceTouched.add(other);
        }
      }
      // The original stays behind, so faces outside survive against their copy.
    } else {
      removeEdge(source.graph, eid);
    }
  }

  // Clean up vertices the source no longer uses.
  for (const [vid, v] of [...source.graph.vertices]) {
    if (v.edges.length === 0) source.graph.vertices.delete(vid);
  }

  return { container, duplicatedEdges, sourceTouched };
}

// ---------------------------------------------------------------------------
// Traversal
// ---------------------------------------------------------------------------

/** Every container, depth first, deterministically ordered. */
export function allContainers(m: ContainerModel, from?: ContainerId): ContainerId[] {
  const out: ContainerId[] = [];
  const walk = (id: ContainerId) => {
    out.push(id);
    const c = m.containers.get(id);
    if (!c) return;
    for (const child of [...c.children].sort((a, b) => a - b)) walk(child);
  };
  walk(from ?? m.root.id);
  return out;
}

/**
 * Every graph with the transform to reach world space, for hit-testing across
 * contexts. Insertion still targets only the active graph. §2.5.2
 */
export function graphsForHitTesting(
  m: ContainerModel,
): { id: ContainerId; graph: Graph; toWorld: Mat4; isActive: boolean }[] {
  return allContainers(m).map((id) => ({
    id,
    graph: getContainer(m, id).graph,
    toWorld: worldMatrix(m, id),
    isActive: id === m.activeContext,
  }));
}

export { tryNormalize };

// ---------------------------------------------------------------------------
// R8 enforcement
// ---------------------------------------------------------------------------

/**
 * Asserts that an operation touches exactly one graph.
 *
 * R8 is currently upheld structurally — each container owns a separate Graph
 * object, and insertion is handed one of them — rather than by a check. That
 * is the right design, but it means a future change could violate it silently:
 * pass two graphs' edges to one derivation and they would weld with nothing
 * to complain.
 *
 * Call this at any boundary that accepts geometry, so the violation surfaces
 * as an error rather than as two objects mysteriously fusing.
 */
export function assertSingleContext(
  m: ContainerModel,
  edges: Iterable<EdgeId>,
  expected?: ContainerId,
): ContainerId {
  const owners = new Set<ContainerId>();
  for (const eid of edges) {
    for (const id of allContainers(m)) {
      if (getContainer(m, id).graph.edges.has(eid)) owners.add(id);
    }
  }
  if (owners.size === 0) return expected ?? m.activeContext;
  if (owners.size > 1) {
    throw new Error(
      `R8 violated: this operation spans ${owners.size} containers ` +
        `(${[...owners].join(', ')}). Geometry in different containers must never ` +
        `merge, split or bound a face together. Explode one of them first.`,
    );
  }
  const [only] = [...owners];
  if (expected !== undefined && only !== expected) {
    throw new Error(
      `R8 violated: edges belong to container ${only} but the active context is ${expected}. ` +
        `Insertion must target the active context only.`,
    );
  }
  return only!;
}

/** Non-throwing form, for diagnostics panels. */
export function checkSingleContext(
  m: ContainerModel,
  edges: Iterable<EdgeId>,
): { ok: boolean; containers: ContainerId[] } {
  const owners = new Set<ContainerId>();
  for (const eid of edges) {
    for (const id of allContainers(m)) {
      if (getContainer(m, id).graph.edges.has(eid)) owners.add(id);
    }
  }
  const containers = [...owners].sort((a, b) => a - b);
  return { ok: containers.length <= 1, containers };
}
