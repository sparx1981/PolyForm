/**
 * PolyForm — section planes (SketchUp's Section Plane tool).
 *
 * A section plane is an object in the model: a point and a direction. While it's active it
 * slices the model - everything on the far side stays, everything between it and the viewer
 * is cut away - and walls it cuts through show a solid fill, like a drawing. Unlike the
 * camera's clipping, it stays where you put it as you orbit, cuts only the model (not the
 * grid, sky or helpers), and is saved with the model. Several can be kept; one cuts at a time.
 *
 * A section plane is saved as a 'measurement' shape whose args are `SectionArgs` (kind
 * 'section'), next to guide lines, so it is left out of bills of materials, walk-mode
 * collisions and exports like other annotations.
 *
 * This file is the pure part. components/SectionCutter.tsx applies the cut to the scene, and
 * Viewport.tsx wires the Section tool to the pointer.
 */

import * as THREE from 'three';
import type { Shape } from '../types';
import { buildingKindWord, siteBuildingGroups } from '../lib/worldSite/siteGroups';

export type V3 = [number, number, number];

export interface SectionArgs {
  kind: 'section';
  /** A point on the plane. */
  point: V3;
  /** Unit normal, pointing into the part of the model that stays. */
  normal: V3;
  /** Whether this plane is cutting the model now (at most one is). */
  active: boolean;
  /** Side of the square drawn to show the plane, metres. */
  size: number;
  /** Layers (see `sectionLayers`) this plane leaves alone. Missing = it cuts everything. */
  exempt?: string[];
}

/** A group of things a section can cut or leave alone. */
export interface SectionLayer { id: string; label: string }

/** Which layer a shape belongs to: the ground, an imported building by kind, or your own design. */
export function sectionLayerOfShape(shape: Pick<Shape, 'type' | 'siteBuildingData'>): string {
  if (shape.type === 'terrain') return 'ground';
  if (shape.type === 'site_building') return `site:${buildingKindWord(shape.siteBuildingData?.kind).replace(/\s+/g, '-')}`;
  return 'design';
}

/** The layers a section can be told to leave alone, for what is in the model now. */
export function sectionLayers(shapes: readonly Shape[], overlayOn: boolean): SectionLayer[] {
  const layers: SectionLayer[] = [];
  if (shapes.some(s => s.type === 'terrain')) layers.push({ id: 'ground', label: 'Ground / terrain' });
  if (overlayOn) layers.push({ id: 'overlay', label: 'Map overlay' });
  for (const g of siteBuildingGroups(shapes)) layers.push({ id: `site:${g.key}`, label: `${g.label} (${g.shapes.length})` });
  layers.push({ id: 'design', label: 'My design' });
  return layers;
}

export const cutsLayer = (args: Pick<SectionArgs, 'exempt'>, layer: string): boolean => !args.exempt?.includes(layer);

/** The section with one layer switched on or off. */
export function withLayerCut(args: SectionArgs, layer: string, cut: boolean): SectionArgs {
  const rest = (args.exempt ?? []).filter(l => l !== layer);
  const exempt = cut ? rest : [...rest, layer];
  const { exempt: _old, ...base } = args;
  return exempt.length ? { ...base, exempt } : base;
}

export function isSectionShape(shape: Pick<Shape, 'type' | 'args'>): boolean {
  return shape.type === 'measurement' && (shape.args as { kind?: string } | undefined)?.kind === 'section';
}

/** The plane three.js clips with: points on its positive side are kept. */
export function clippingPlaneOf(args: SectionArgs): THREE.Plane {
  const n = new THREE.Vector3(...args.normal).normalize();
  return new THREE.Plane().setFromNormalAndCoplanarPoint(n, new THREE.Vector3(...args.point));
}

/** The active section, if any (hidden ones don't cut). */
export function activeSection(shapes: readonly Shape[]): { id: string; args: SectionArgs } | null {
  const s = shapes.find(sh => isSectionShape(sh) && !sh.hidden && (sh.args as SectionArgs).active);
  return s ? { id: s.id, args: s.args as SectionArgs } : null;
}

/** Rounds a normal onto a world axis when it's within ~5 degrees of one. */
function tidy(n: THREE.Vector3): THREE.Vector3 {
  for (const axis of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]) {
    const d = n.dot(axis);
    if (Math.abs(d) > 0.996) return axis.multiplyScalar(Math.sign(d));
  }
  return n.clone().normalize();
}

/**
 * A new section lined up with the face under the pointer. It keeps the side away from the
 * camera, so placing one on the wall you're looking at cuts that wall open to show inside.
 */
export function sectionOnFace(point: THREE.Vector3, faceNormal: THREE.Vector3, cameraPosition: THREE.Vector3, size: number): SectionArgs {
  const n = tidy(faceNormal);
  if (n.dot(point.clone().sub(cameraPosition)) < 0) n.negate();
  return { kind: 'section', point: [point.x, point.y, point.z], normal: [n.x + 0, n.y + 0, n.z + 0], active: true, size };
}

export function flipSection(args: SectionArgs): SectionArgs {
  return { ...args, normal: [-args.normal[0] + 0, -args.normal[1] + 0, -args.normal[2] + 0] };
}

/** The same plane moved `distance` along its normal. */
export function moveSection(args: SectionArgs, distance: number): SectionArgs {
  const [nx, ny, nz] = args.normal;
  return { ...args, point: [args.point[0] + nx * distance, args.point[1] + ny * distance, args.point[2] + nz * distance] };
}

/**
 * How far along the plane's normal the pointer ray is dragging, measured from `from` (where
 * the drag started): the point on the normal line nearest the ray.
 */
export function dragDistance(from: THREE.Vector3, normal: THREE.Vector3, ray: THREE.Ray): number {
  const n = normal.clone().normalize();
  const w0 = from.clone().sub(ray.origin);
  const b = n.dot(ray.direction);
  const d = n.dot(w0), e = ray.direction.dot(w0);
  const denom = 1 - b * b;
  if (denom < 1e-9) return 0; // looking straight along the normal
  return (b * e - d) / denom;
}

/** Everything the section cuts away is out of reach: a pick through it hits what's behind. */
export function dropCutAway<T extends { object: THREE.Object3D; point: THREE.Vector3 }>(hits: T[], plane: THREE.Plane): T[] {
  return hits.filter(h => {
    const material = (h.object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    const clipped = (Array.isArray(material) ? material : material ? [material] : []).some(m => m.clippingPlanes?.includes(plane));
    return !clipped || plane.distanceToPoint(h.point) >= -1e-6;
  });
}

// ---------------------------------------------------------------------------
// Picking through a cut
// ---------------------------------------------------------------------------

let pickPlane: THREE.Plane | null = null;
let installed = false;

/**
 * Every raycast in the app skips what the active section has cut away, so a click lands on
 * what you can see. Installed once; `plane` null turns the filter off.
 */
export function setSectionPickPlane(plane: THREE.Plane | null): void {
  pickPlane = plane;
  if (installed || !plane) return;
  installed = true;
  const proto = THREE.Raycaster.prototype as unknown as {
    intersectObject: (...a: unknown[]) => THREE.Intersection[];
    intersectObjects: (...a: unknown[]) => THREE.Intersection[];
  };
  const one = proto.intersectObject;
  const many = proto.intersectObjects;
  proto.intersectObject = function (this: THREE.Raycaster, ...a: unknown[]) {
    const hits = one.apply(this, a);
    if (!pickPlane) return hits;
    const kept = dropCutAway<THREE.Intersection>(hits, pickPlane);
    // The caller may have passed its own array to fill: keep that contract.
    const target = a[2] as THREE.Intersection[] | undefined;
    if (Array.isArray(target) && target === hits) { target.length = 0; target.push(...kept); return target; }
    return kept;
  };
  proto.intersectObjects = function (this: THREE.Raycaster, ...a: unknown[]) {
    const hits = many.apply(this, a);
    if (!pickPlane) return hits;
    const kept = dropCutAway<THREE.Intersection>(hits, pickPlane);
    const target = a[2] as THREE.Intersection[] | undefined;
    if (Array.isArray(target) && target === hits) { target.length = 0; target.push(...kept); return target; }
    return kept;
  };
}
