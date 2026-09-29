/**
 * PolyForm — guide lines from the Tape Measure (SketchUp's construction lines).
 *
 * Click the body of an edge, a guide or a red/green/blue axis with the Tape Measure and move
 * away: a guide appears parallel to it, at the distance you move (or type). Guides are drawing
 * aids: the drawing tools snap onto them and onto the points where two guides cross. Clicking
 * a corner or empty space still measures, as before.
 *
 * A guide is saved as a 'measurement' shape whose args are `GuideArgs` (kind 'guide'), next to
 * the Protractor's guides (kind 'protractor'); both count as guides here.
 *
 * This file is the pure part: which edge a click means, where the guide goes, and where
 * guides cross. Viewport.tsx wires it to the pointer.
 */

import * as THREE from 'three';
import type { Shape } from '../types';

export type V3 = [number, number, number];

export interface GuideArgs {
  kind: 'guide';
  /** A point on the guide: the picked edge's point, moved by the offset. */
  point: V3;
  /** Unit direction along the guide. */
  direction: V3;
  /** Drawn and snapped-to extent (a long segment through `point`). */
  start: V3;
  end: V3;
  /** How far the guide sits from the line it was pulled off, metres. */
  distance: number;
}

/** How far a tape guide reaches each way from where it was pulled. */
export const TAPE_GUIDE_REACH = 100;

/** Any saved guide line: a tape guide or a Protractor's guide. */
export function isGuideShape(shape: Pick<Shape, 'type' | 'args'>): boolean {
  const kind = (shape.args as { kind?: string } | undefined)?.kind;
  return shape.type === 'measurement' && (kind === 'guide' || kind === 'protractor');
}

/** A guide's line as a segment, or null when the shape isn't a guide. */
export function guideSegment(shape: Pick<Shape, 'type' | 'args'>): [THREE.Vector3, THREE.Vector3] | null {
  if (!isGuideShape(shape)) return null;
  const a = shape.args as { start?: V3; end?: V3 };
  if (!Array.isArray(a.start) || !Array.isArray(a.end)) return null;
  return [new THREE.Vector3(...a.start), new THREE.Vector3(...a.end)];
}

/** The saved form of a guide through `point` along `direction`. */
export function makeGuideArgs(point: THREE.Vector3, direction: THREE.Vector3, distance: number, reach = TAPE_GUIDE_REACH): GuideArgs {
  const d = direction.clone().normalize();
  const t = (v: THREE.Vector3): V3 => [v.x, v.y, v.z];
  return {
    kind: 'guide',
    point: t(point),
    direction: t(d),
    start: t(point.clone().addScaledVector(d, -reach)),
    end: t(point.clone().addScaledVector(d, reach)),
    distance,
  };
}

// ---------------------------------------------------------------------------
// Which edge a click means
// ---------------------------------------------------------------------------

/** Something a guide can be pulled off: a model edge, a guide, or an axis. */
export interface GuideSource {
  a: THREE.Vector3;
  b: THREE.Vector3;
  /** Guides and axes have no corners: a click anywhere on them pulls a guide. */
  endless: boolean;
  label: string;
}

/** The world axes as guide sources (red x, green, blue - PolyForm's y is up). */
export function axisSources(reach = TAPE_GUIDE_REACH): GuideSource[] {
  return [
    { a: new THREE.Vector3(-reach, 0, 0), b: new THREE.Vector3(reach, 0, 0), endless: true, label: 'Red axis' },
    { a: new THREE.Vector3(0, 0, -reach), b: new THREE.Vector3(0, 0, reach), endless: true, label: 'Green axis' },
    { a: new THREE.Vector3(0, -reach, 0), b: new THREE.Vector3(0, reach, 0), endless: true, label: 'Blue axis' },
  ];
}

const featureEdgeCache = new WeakMap<THREE.BufferGeometry, Float32Array>();

/**
 * A mesh's visible edges (creases sharper than 20°, and outlines) in world space - what a
 * person sees as the object's edges, not the diagonals across its flat faces.
 */
export function featureEdges(mesh: THREE.Mesh): GuideSource[] {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  let positions = featureEdgeCache.get(geometry);
  if (!positions) {
    positions = new THREE.EdgesGeometry(geometry, 20).getAttribute('position').array as Float32Array;
    featureEdgeCache.set(geometry, positions);
  }
  const out: GuideSource[] = [];
  for (let i = 0; i + 5 < positions.length; i += 6) {
    out.push({
      a: new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]).applyMatrix4(mesh.matrixWorld),
      b: new THREE.Vector3(positions[i + 3], positions[i + 4], positions[i + 5]).applyMatrix4(mesh.matrixWorld),
      endless: false,
      label: 'Edge',
    });
  }
  return out;
}

export interface EdgePick {
  source: GuideSource;
  /** The point on the edge nearest the pointer. */
  point: THREE.Vector3;
  /** The pointer is on one of the edge's corners: that means measure, not a guide. */
  onCorner: boolean;
}

/**
 * The edge under the pointer (within `radiusPx` on screen), measured in screen space so a far
 * edge is as easy to hit as a near one. `pointerPx` and the result of `toScreen` are in pixels.
 */
export function pickGuideSource(
  sources: readonly GuideSource[],
  pointerPx: { x: number; y: number },
  camera: THREE.Camera,
  size: { width: number; height: number },
  radiusPx = 8,
  cornerPx = 12,
): EdgePick | null {
  const view = camera.matrixWorldInverse;
  const toScreen = (v: THREE.Vector3) => {
    const p = v.clone().project(camera);
    return new THREE.Vector2(((p.x + 1) / 2) * size.width, ((-p.y + 1) / 2) * size.height);
  };
  const near = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (camera as THREE.PerspectiveCamera).near * 1.01 : -Infinity;
  const pointer = new THREE.Vector2(pointerPx.x, pointerPx.y);

  let best: EdgePick | null = null;
  let bestDist = radiusPx;
  for (const source of sources) {
    // Clip to what's in front of the camera, so a long guide running past it still projects.
    let a = source.a.clone(), b = source.b.clone();
    const za = -a.clone().applyMatrix4(view).z, zb = -b.clone().applyMatrix4(view).z;
    if (za < near && zb < near) continue;
    if (za < near) a = a.lerp(b, (near - za) / (zb - za));
    else if (zb < near) b = b.lerp(a, (near - zb) / (za - zb));

    const sa = toScreen(a), sb = toScreen(b);
    const ab = sb.clone().sub(sa);
    const len2 = ab.lengthSq();
    const t = len2 < 1e-9 ? 0 : THREE.MathUtils.clamp(pointer.clone().sub(sa).dot(ab) / len2, 0, 1);
    const onScreen = sa.clone().addScaledVector(ab, t);
    const dist = onScreen.distanceTo(pointer);
    if (dist > bestDist) continue;

    // The world point: t on screen isn't t in the world under perspective, so find the point on
    // the edge nearest the pointer's ray instead.
    const ndc = new THREE.Vector2((pointer.x / size.width) * 2 - 1, -(pointer.y / size.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const point = new THREE.Vector3();
    ray.ray.distanceSqToSegment(source.a, source.b, undefined, point);

    const onCorner = !source.endless && (toScreen(source.a).distanceTo(pointer) < cornerPx || toScreen(source.b).distanceTo(pointer) < cornerPx);
    best = { source, point, onCorner };
    bestDist = dist;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Where the guide goes
// ---------------------------------------------------------------------------

/**
 * The offset from the picked line to the guide, for a pointer ray. The pointer is read on a
 * plane that contains the line: the surface under the pointer when there is one (so a guide
 * pulled off a floor edge slides along the floor), else the level plane for a level line, else
 * the plane facing the camera. Only the part square to the line counts.
 */
export function guideOffset(
  linePoint: THREE.Vector3,
  lineDir: THREE.Vector3,
  ray: THREE.Ray,
  surfaceHit: THREE.Vector3 | null,
): THREE.Vector3 {
  const d = lineDir.clone().normalize();
  let q: THREE.Vector3 | null = surfaceHit ? surfaceHit.clone() : null;
  if (!q) {
    let normal: THREE.Vector3;
    if (Math.abs(d.y) < 1e-3) normal = new THREE.Vector3(0, 1, 0);
    else {
      const view = ray.direction.clone();
      normal = view.sub(d.clone().multiplyScalar(view.dot(d)));
      if (normal.lengthSq() < 1e-9) normal = new THREE.Vector3(0, 1, 0).cross(d);
      normal.normalize();
    }
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, linePoint);
    q = ray.intersectPlane(plane, new THREE.Vector3());
    if (!q) {
      // Looking along the plane: fall back to the camera-facing plane.
      const view = ray.direction.clone();
      const n2 = view.sub(d.clone().multiplyScalar(view.dot(d))).normalize();
      q = ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n2, linePoint), new THREE.Vector3());
    }
    if (!q) return new THREE.Vector3();
  }
  const rel = q.sub(linePoint);
  return rel.sub(d.clone().multiplyScalar(rel.dot(d)));
}

/** The offset at an exact typed distance, keeping the direction you moved (a minus sign flips it). */
export function offsetAtDistance(dragged: THREE.Vector3, lineDir: THREE.Vector3, distance: number): THREE.Vector3 | null {
  if (dragged.lengthSq() < 1e-12) return null;
  const d = lineDir.clone().normalize();
  const side = dragged.clone().sub(d.multiplyScalar(dragged.dot(d)));
  if (side.lengthSq() < 1e-12) return null;
  return side.normalize().multiplyScalar(distance);
}

// ---------------------------------------------------------------------------
// Where guides cross
// ---------------------------------------------------------------------------

/** Points where two guides meet (within 1 mm), inside both segments. */
export function guideCrossings(segments: readonly [THREE.Vector3, THREE.Vector3][], tolerance = 1e-3): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const p = new THREE.Vector3(), q = new THREE.Vector3();
  segments.forEach(([a0, a1], i) => {
    for (const [b0, b1] of segments.slice(i + 1)) {
      const da = a1.clone().sub(a0), db = b1.clone().sub(b0);
      if (da.clone().normalize().cross(db.clone().normalize()).lengthSq() < 1e-10) continue; // parallel
      closestPointsOfSegments(a0, a1, b0, b1, p, q);
      if (p.distanceTo(q) <= tolerance) out.push(p.clone().add(q).multiplyScalar(0.5));
    }
  });
  return out;
}

function closestPointsOfSegments(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3, c1: THREE.Vector3, c2: THREE.Vector3) {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  const c = d1.dot(r), b = d1.dot(d2);
  const denom = a * e - b * b;
  let s = denom > 1e-12 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
  let t = (b * s + f) / e;
  if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
  else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
  c1.copy(p1).addScaledVector(d1, s);
  c2.copy(p2).addScaledVector(d2, t);
}

// ---------------------------------------------------------------------------
// Snapping onto guides
// ---------------------------------------------------------------------------

export interface GuideSnap {
  point: THREE.Vector3;
  label: 'On guide' | 'Guide crossing';
  /** Pixels from the pointer. */
  screenDist: number;
}

/**
 * Where a drawing tool could snap to guides under the pointer: the point on each guide nearest
 * the pointer's ray, and every crossing of two guides. Nearest first.
 */
export function guideSnapCandidates(
  segments: readonly [THREE.Vector3, THREE.Vector3][],
  crossings: readonly THREE.Vector3[],
  ray: THREE.Ray,
  camera: THREE.Camera,
  size: { width: number; height: number },
  pointerPx: { x: number; y: number },
): GuideSnap[] {
  const out: GuideSnap[] = [];
  const screenDist = (v: THREE.Vector3) => {
    const p = v.clone().project(camera);
    if (p.z >= 1 || p.z <= -1) return Infinity; // behind the camera or past the far plane
    return Math.hypot(((p.x + 1) / 2) * size.width - pointerPx.x, ((-p.y + 1) / 2) * size.height - pointerPx.y);
  };
  for (const [a, b] of segments) {
    const point = new THREE.Vector3();
    ray.distanceSqToSegment(a, b, undefined, point);
    const d = screenDist(point);
    if (Number.isFinite(d)) out.push({ point, label: 'On guide', screenDist: d });
  }
  for (const c of crossings) {
    const d = screenDist(c);
    if (Number.isFinite(d)) out.push({ point: c.clone(), label: 'Guide crossing', screenDist: d });
  }
  return out.sort((x, y) => x.screenDist - y.screenDist);
}
