/**
 * PolyForm — groups and components of drawn geometry.
 *
 * Make Group turns selected drawn faces into ONE OBJECT, like a wall or a tree: it moves,
 * turns, copies, hides and takes tags as a whole, and - because its faces now live in their
 * own graph - nothing drawn against it sticks to it or cuts into it. Double-click it to edit
 * inside; Explode turns it back into ordinary drawn faces.
 *
 * A component is a group whose copies share one definition: editing the inside of any copy
 * changes them all. Make Unique splits one copy off with its own definition.
 *
 * How it's stored: a 'kernel_group' shape whose `kernelGraph` is the serialized geometry in
 * the group's own frame, placed by the shape's position/rotation/scale. Copies of a component
 * carry the same `componentId` and the same graph (the save offloads identical geometry once).
 * Keeping the geometry on the shape means undo, saving, the Outliner, tags and exports all
 * treat a group like every other object.
 */

import * as THREE from 'three';
import type { FaceId, Graph } from '../lib/geometry/types';
import type { Shape } from '../types';
import { deserializeGraph, serializeGraph, type SerializedGraph } from '../lib/geometry/serialize';
import { removeEdge, removeFace, removeOrphanVertices } from '../lib/geometry/topology';
import { snapshot } from '../lib/geometry/heal';
import { deleteGroupFacesAndEdges } from './kernelSelection';
import {
  captureFaces, graphSignature, recreateFaces, type WallConversionUndoLink,
} from './kernelConvertToWall';
import type { KernelArcHost } from './kernelArcHost';

export const GROUP_TYPE = 'kernel_group' as const;

export function isGroupShape(shape: Pick<Shape, 'type'> & { kernelGraph?: unknown }): boolean {
  return shape.type === GROUP_TYPE && !!shape.kernelGraph;
}

export const isComponent = (shape: Shape): boolean => isGroupShape(shape) && !!shape.componentId;

/** Where a shape sits in the world: its position, rotation (or quaternion) and scale. */
export function shapeMatrix(shape: Pick<Shape, 'position' | 'rotation' | 'quaternion' | 'scale'>): THREE.Matrix4 {
  const q = shape.quaternion
    ? new THREE.Quaternion(...shape.quaternion)
    : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(shape.rotation ?? [0, 0, 0])));
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...(shape.position ?? [0, 0, 0])),
    q,
    new THREE.Vector3(...(shape.scale ?? [1, 1, 1])),
  );
}

/**
 * The same geometry moved by `m`: every point, face plane, texture placement and arc. A
 * mirroring matrix turns each outline over, so the recorded winding flips with it.
 */
export function transformSerializedGraph(data: SerializedGraph, m: THREE.Matrix4): SerializedGraph {
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(m);
  const det = m.determinant();
  const scale = Math.cbrt(Math.abs(det)) || 1;
  const p = new THREE.Vector3(), n = new THREE.Vector3(), d = new THREE.Vector3();
  const point = (x: number, y: number, z: number) => p.set(x, y, z).applyMatrix4(m);
  const normal = (x: number, y: number, z: number) => n.set(x, y, z).applyMatrix3(normalMatrix).normalize();
  const vector = (x: number, y: number, z: number) => d.set(x, y, z).transformDirection(m).multiplyScalar(Math.hypot(x, y, z) * scale);
  return {
    ...data,
    vertices: data.vertices.map(v => { point(v.x, v.y, v.z); return { ...v, x: p.x, y: p.y, z: p.z }; }),
    loops: data.loops.map(l => ({ ...l, signedArea: l.signedArea * scale * scale * (det < 0 ? -1 : 1) })),
    faces: data.faces.map(f => {
      point(f.px, f.py, f.pz);
      normal(f.nx, f.ny, f.nz);
      let uv = f.uv;
      if (uv) {
        const o = point(uv.ox, uv.oy, uv.oz).clone();
        const u = vector(uv.ux, uv.uy, uv.uz).clone();
        const w = vector(uv.vx, uv.vy, uv.vz).clone();
        uv = { ox: o.x, oy: o.y, oz: o.z, ux: u.x, uy: u.y, uz: u.z, vx: w.x, vy: w.y, vz: w.z };
      }
      const fp = point(f.px, f.py, f.pz);
      return { ...f, px: fp.x, py: fp.y, pz: fp.z, nx: n.x, ny: n.y, nz: n.z, uv };
    }),
    curves: data.curves.map(c => {
      const cp = point(c.cx, c.cy, c.cz).clone();
      normal(c.nx, c.ny, c.nz);
      return { ...c, cx: cp.x, cy: cp.y, cz: cp.z, nx: n.x, ny: n.y, nz: n.z, radius: c.radius * scale };
    }),
  };
}

/** A copy of just these faces (with their edges and arcs), ids and paint kept. */
export function extractFaces(g: Graph, faceIds: Iterable<FaceId>): SerializedGraph {
  const keep = new Set(faceIds);
  const copy = deserializeGraph(serializeGraph(g));
  for (const id of [...copy.faces.keys()]) if (!keep.has(id)) removeFace(copy, id);
  for (const [id, e] of [...copy.edges]) if (e.uses.length === 0) removeEdge(copy, id);
  removeOrphanVertices(copy);
  return serializeGraph(copy);
}

/** A group's own origin: the middle of its footprint, at its lowest point. */
export function groupOrigin(data: SerializedGraph): THREE.Vector3 {
  const box = new THREE.Box3();
  for (const v of data.vertices) box.expandByPoint(new THREE.Vector3(v.x, v.y, v.z));
  if (box.isEmpty()) return new THREE.Vector3();
  const c = box.getCenter(new THREE.Vector3());
  return new THREE.Vector3(c.x, box.min.y, c.z);
}

const newId = () => Math.random().toString(36).substr(2, 9);

export interface MadeGroup {
  shape: Shape;
  /** Pairs the new object's undo step with taking the faces out of the drawing. */
  link: WallConversionUndoLink;
}

/**
 * Takes the faces out of the drawing and returns the object holding them. The caller adds the
 * shape and registers the link, so one undo brings the faces back and removes the object.
 */
export function makeGroup(host: KernelArcHost, faceIds: readonly FaceId[], opts: { component: boolean; name: string }): MadeGroup | null {
  const g = host.graph;
  const faces = faceIds.filter(id => g.faces.has(id));
  if (faces.length === 0) return null;
  const data = extractFaces(g, faces);
  const origin = groupOrigin(data);
  const local = transformSerializedGraph(data, new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z));

  const before = snapshot(g);
  const removed = captureFaces(g, faces);
  deleteGroupFacesAndEdges(g, faces);
  host.refreshIndex();
  const after = snapshot(g);

  const id = newId();
  const shape = {
    id,
    name: opts.name,
    type: GROUP_TYPE,
    position: [origin.x, origin.y, origin.z],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    args: {},
    color: '#ffffff',
    kernelGraph: local,
    ...(opts.component ? { componentId: newId(), componentName: opts.name } : {}),
  } as unknown as Shape;
  return {
    shape,
    link: { wallIds: [id], before, after, beforeSig: graphSignature(before.graph), afterSig: graphSignature(g), removed },
  };
}

/**
 * Puts a group's faces back into the drawing where the group sits (as their own object, so
 * they don't weld to what they touch), with their paint. The caller removes the shape and
 * registers the link.
 */
export function explodeGroup(host: KernelArcHost, shape: Shape): WallConversionUndoLink | null {
  if (!isGroupShape(shape)) return null;
  const world = deserializeGraph(transformSerializedGraph(shape.kernelGraph as SerializedGraph, shapeMatrix(shape)));
  const added = captureFaces(world, world.faces.keys());
  const g = host.graph;
  const before = snapshot(g);
  recreateFaces({ graph: g, tolerances: host.tolerances, index: host.spatialIndex }, added, host.deriveOptions);
  host.refreshIndex();
  const after = snapshot(g);
  return {
    wallIds: [],
    goneIds: [shape.id],
    before, after,
    beforeSig: graphSignature(before.graph), afterSig: graphSignature(g),
    removed: [],
    added,
  };
}

/** Every copy of a component takes the edited inside; a plain group only itself. */
export function applyGroupEdit(shapes: readonly Shape[], edited: Shape, graph: SerializedGraph): Shape[] {
  return shapes.map(s => {
    const same = s.id === edited.id || (!!edited.componentId && s.componentId === edited.componentId);
    return same && isGroupShape(s) ? { ...s, kernelGraph: graph } : s;
  });
}

/** Splits one copy off its component, with its own definition. */
export function makeUnique(shape: Shape): Shape {
  return { ...shape, componentId: newId(), componentName: `${shape.componentName ?? shape.name ?? 'Component'} (unique)` };
}

/** The components in the model: one entry per definition, with how many copies it has. */
export function componentDefinitions(shapes: readonly Shape[]): { componentId: string; name: string; count: number; firstId: string }[] {
  const out = new Map<string, { componentId: string; name: string; count: number; firstId: string }>();
  for (const s of shapes) {
    if (!isComponent(s)) continue;
    const had = out.get(s.componentId!);
    if (had) had.count++;
    else out.set(s.componentId!, { componentId: s.componentId!, name: s.componentName || s.name || 'Component', count: 1, firstId: s.id });
  }
  return [...out.values()];
}
