import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { KernelArcHost } from './kernelArcHost';
import { vec3 } from '../lib/geometry/math';
import { axisLock, computeSnap, edgeLock, SnapMemory, type SnapInput } from './snapEngine';

const size = { width: 800, height: 600 };
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Looking straight down from 20 m; ground (y = 0) is what's under the pointer. */
function topCamera() {
  const camera = new THREE.PerspectiveCamera(50, size.width / size.height, 0.1, 1000);
  camera.position.set(0, 20, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return camera;
}
const camera = topCamera();

function host() {
  return new KernelArcHost({ cameraDirection: vec3(0, 0, -1), upAxis: vec3(0, 1, 0) });
}
const draw = (h: KernelArcHost, ...pts: [number, number, number][]) => {
  for (let i = 0; i + 1 < pts.length; i++) h.commitSegment(vec3(...pts[i]!), vec3(...pts[i + 1]!));
};

/** A snap input with the pointer at a ground position (metres). */
function at(h: KernelArcHost, x: number, z: number, over: Partial<SnapInput> = {}): SnapInput {
  const world = V(x, 0, z);
  const p = world.clone().project(camera);
  const pointer = { x: ((p.x + 1) / 2) * size.width, y: ((-p.y + 1) / 2) * size.height };
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(p.x, p.y), camera);
  return { graph: h.graph, camera, size, pointer, ray: rc.ray, cursor: world, plane: new THREE.Plane(V(0, 1, 0), 0), ...over };
}

/** A pixel is about this many metres at ground level from 20 m up. */
const PX = (2 * 20 * Math.tan(THREE.MathUtils.degToRad(25))) / size.height;

describe('points', () => {
  it('snaps to a corner, ahead of a midpoint or the edge it sits on', () => {
    const h = host();
    draw(h, [0, 0, 0], [4, 0, 0]);
    const r = computeSnap(at(h, 0.02, 0.02));
    expect(r.kind).toBe('endpoint');
    expect(r.point.toArray()).toEqual([0, 0, 0]);
  });

  it('snaps to the midpoint', () => {
    const h = host();
    draw(h, [0, 0, 0], [4, 0, 0]);
    expect(computeSnap(at(h, 2, 0.05)).kind).toBe('midpoint');
  });

  it('snaps to a point ON an edge, so a line can end on it and split it', () => {
    const h = host();
    draw(h, [0, 0, 0], [8, 0, 0]);
    const r = computeSnap(at(h, 2.5, 3 * PX));
    expect(r.kind).toBe('edge');
    expect(r.label).toBe('On edge');
    expect(r.point.x).toBeCloseTo(2.5, 1);
    expect(r.point.z).toBeCloseTo(0, 9);
  });

  it('snaps to where an edge and a guide cross, though neither has a corner there', () => {
    const h = host();
    draw(h, [1, 0, -4], [1, 0, 4]);
    const guide: [THREE.Vector3, THREE.Vector3] = [V(-4, 0, 1.5), V(4, 0, 1.5)];
    const r = computeSnap(at(h, 1.02, 1.53, { guides: [guide] }));
    expect(r.kind).toBe('intersection');
    expect(r.point.x).toBeCloseTo(1, 9);
    expect(r.point.z).toBeCloseTo(1.5, 9);
  });

  it('a crossing drawn in the model is a corner: the drawing engine splits both edges there', () => {
    const h = host();
    draw(h, [-4, 0, 1], [4, 0, 1]);
    draw(h, [1, 0, -4], [1, 0, 4]);
    const r = computeSnap(at(h, 1.02, 1.03));
    expect(r.kind).toBe('endpoint');
    expect(r.point.toArray().map(v => +v.toFixed(9))).toEqual([1, 0, 1]);
  });

  it('offers nothing when the pointer is far from everything', () => {
    const h = host();
    draw(h, [0, 0, 0], [4, 0, 0]);
    const r = computeSnap(at(h, 1, 3));
    expect(r.kind).toBe('none');
    expect(r.point.toArray()).toEqual([1, 0, 3]);
  });

  it('closes a chain on its first point', () => {
    const h = host();
    const r = computeSnap(at(h, 3.02, 3.02, { closePoint: V(3, 0, 3) }));
    expect(r.kind).toBe('close');
  });

  it('snaps onto a guide, and where two guides cross', () => {
    const h = host();
    const g1: [THREE.Vector3, THREE.Vector3] = [V(-10, 0, 2), V(10, 0, 2)];
    expect(computeSnap(at(h, 3, 2 + 2 * PX, { guides: [g1] })).kind).toBe('guide');
    const r = computeSnap(at(h, 3.02, 2.02, { guides: [g1], guideCrossings: [V(3, 0, 2)] }));
    expect(r.kind).toBe('intersection');
  });

  it('puts a snapped point on the drawing plane', () => {
    const h = host();
    draw(h, [0, 0, 0], [4, 0, 0]);
    const raised = new THREE.Plane(V(0, 1, 0), -1); // y = 1
    const r = computeSnap(at(h, 0.02, 0.02, { plane: raised }));
    expect(r.point.y).toBeCloseTo(1, 9);
    expect(r.marker!.y).toBe(0); // the marker stays on the corner itself
  });
});

describe('directions from the point being drawn from', () => {
  it('offers the red axis, and the green one', () => {
    const h = host();
    const red = computeSnap(at(h, 3, 2 * PX, { from: V(0, 0, 0) }));
    expect(red.kind).toBe('axis');
    expect(red.label).toBe('On Red axis');
    expect(red.point.z).toBeCloseTo(0, 9);
    expect(red.point.x).toBeCloseTo(3, 9);
    const green = computeSnap(at(h, 2 * PX, 3, { from: V(0, 0, 0) }));
    expect(green.label).toBe('On Green axis');
  });

  it('offers nothing on the vertical axis while drawing flat on the ground', () => {
    const h = host();
    expect(computeSnap(at(h, 3, 3, { from: V(0, 0, 0) })).kind).toBe('none');
  });

  it('continues an edge the pen is at the end of', () => {
    const h = host();
    // A diagonal edge, drawing on from its end.
    draw(h, [0, 0, 0], [2, 0, 2]);
    const r = computeSnap(at(h, 4 + 2 * PX, 4, { from: V(2, 0, 2), inference: true }));
    expect(r.kind).toBe('extension');
    expect(r.point.x).toBeCloseTo(r.point.z, 1);
  });

  it('is parallel or perpendicular to an edge that was rested on', () => {
    const h = host();
    draw(h, [5, 0, 5], [8, 0, 7]); // some slanted edge
    const d = V(3, 0, 2).normalize();
    const memory = new SnapMemory(0);
    memory.acquireEdge({ a: V(5, 0, 5), b: V(8, 0, 7), id: -1 });
    const from = V(-4, 0, -4);
    const along = from.clone().addScaledVector(d, 3);
    const par = computeSnap(at(h, along.x, along.z + 1.5 * PX, { from, memory }));
    expect(par.kind).toBe('parallel');
    const perpDir = new THREE.Vector3().crossVectors(V(0, 1, 0), d);
    const p2 = from.clone().addScaledVector(perpDir, 3);
    const perp = computeSnap(at(h, p2.x, p2.z + 1.5 * PX, { from, memory }));
    expect(perp.kind).toBe('perpendicular');
  });

  it('lines up with a corner that was rested on, along an axis', () => {
    const h = host();
    const memory = new SnapMemory(0);
    memory.points = [V(2, 0, 3)];
    const r = computeSnap(at(h, 6, 3 + 2 * PX, { memory }));
    expect(r.kind).toBe('from');
    expect(r.label).toBe('From point on Red axis');
    expect(r.point.z).toBeCloseTo(3, 9);
  });

  it('finds the point lined up with two things at once', () => {
    const h = host();
    const memory = new SnapMemory(0);
    memory.points = [V(2, 0, -3)];
    // Level with `from` along x and in line with the corner along z: (2, 0, 1).
    const r = computeSnap(at(h, 2.03, 1.04, { from: V(-3, 0, 1), memory }));
    expect(r.marker!.x).toBeCloseTo(2, 9);
    expect(r.marker!.z).toBeCloseTo(1, 9);
    expect(r.guides).toHaveLength(2);
  });

  it('lands where an axis line meets an edge', () => {
    const h = host();
    draw(h, [3, 0, -5], [3, 0, 3]); // a green-axis edge at x = 3 (its midpoint is at z = -1)
    const r = computeSnap(at(h, 3.03, 0.03, { from: V(-2, 0, 0) }));
    expect(r.kind).toBe('intersection');
    expect(r.point.x).toBeCloseTo(3, 9);
    expect(r.point.z).toBeCloseTo(0, 9);
  });

  it('can be switched off, leaving the points', () => {
    const h = host();
    expect(computeSnap(at(h, 3, 2 * PX, { from: V(0, 0, 0), inference: false })).kind).toBe('none');
  });
});

describe('waking what the pointer rests on', () => {
  it('takes a corner only after it has been rested on', () => {
    const memory = new SnapMemory(300);
    const rest = { kind: 'endpoint' as const, marker: V(1, 0, 1), hoverEdge: null };
    memory.update(rest, 0);
    memory.update(rest, 200);
    expect(memory.points).toHaveLength(0);
    memory.update(rest, 350);
    expect(memory.points).toHaveLength(1);
    expect(memory.progress(350)).toBe(1);
  });

  it('keeps the two most recent corners and the edge rested on', () => {
    const memory = new SnapMemory(0);
    for (const [i, x] of [1, 2, 3].entries()) {
      const r = { kind: 'endpoint' as const, marker: V(x, 0, 0), hoverEdge: null };
      memory.update(r, i * 10);
      memory.update(r, i * 10 + 1);
    }
    expect(memory.points.map(p => p.x)).toEqual([2, 3]);
    const e = { kind: 'none' as const, marker: null, hoverEdge: { a: V(0, 0, 0), b: V(1, 0, 0), id: 4 as never } };
    memory.update(e, 100);
    memory.update(e, 101);
    expect(memory.edge?.b.x).toBe(1);
  });
});

describe('locks', () => {
  it('holds an axis whatever the pointer does', () => {
    const h = host();
    const r = computeSnap(at(h, 3, 2, { lockLine: axisLock(V(0, 0, 0), 'x') }));
    expect(r.kind).toBe('lock');
    expect(r.point.toArray().map(v => +v.toFixed(9))).toEqual([3, 0, 0]);
    expect(r.guides[0]!.dashed).toBe(false);
  });

  it('still lands on a corner that sits on the locked line', () => {
    const h = host();
    draw(h, [5, 0, 0], [5, 0, 3]);
    const r = computeSnap(at(h, 5.03, 0.04, { lockLine: axisLock(V(0, 0, 0), 'x') }));
    expect(r.kind).toBe('endpoint');
    expect(r.point.toArray()).toEqual([5, 0, 0]);
  });

  it('lines up with a corner that is off the locked line', () => {
    const h = host();
    draw(h, [5, 0, 3], [5, 0, 6]);
    const r = computeSnap(at(h, 5.03, 3.04, { lockLine: axisLock(V(0, 0, 0), 'x') }));
    expect(r.kind).toBe('from');
    expect(r.point.toArray().map(v => +v.toFixed(9))).toEqual([5, 0, 0]);
  });

  it('lands where the locked line crosses an edge', () => {
    const h = host();
    draw(h, [4, 0, -3], [4, 0, 3]);
    const r = computeSnap(at(h, 4.03, 0.05, { lockLine: axisLock(V(0, 0, 0), 'x') }));
    expect(r.kind).toBe('intersection');
    expect(r.point.x).toBeCloseTo(4, 9);
  });

  it('holds a line parallel to an edge (the Down-arrow lock)', () => {
    const h = host();
    const lock = edgeLock(V(0, 0, 0), { a: V(0, 0, 0), b: V(3, 0, 3), id: -1 }, 'parallel')!;
    const r = computeSnap(at(h, 4, 1, { lockLine: lock }));
    expect(r.point.x).toBeCloseTo(r.point.z, 9);
    const perp = edgeLock(V(0, 0, 0), { a: V(0, 0, 0), b: V(3, 0, 3), id: -1 }, 'perpendicular', new THREE.Plane(V(0, 1, 0), 0))!;
    const r2 = computeSnap(at(h, 2, -1, { lockLine: perp }));
    expect(r2.point.x).toBeCloseTo(-r2.point.z, 9);
  });

  it('holds what an inference was showing (the Shift lock)', () => {
    const h = host();
    const shown = computeSnap(at(h, 3, 2 * PX, { from: V(0, 0, 0) }));
    expect(shown.line).not.toBeNull();
    // Shift held: the pointer wanders away, the line stays.
    const held = computeSnap(at(h, 5, 2, { lockLine: shown.line }));
    expect(held.point.z).toBeCloseTo(0, 9);
    expect(held.point.x).toBeCloseTo(5, 9);
  });
});

describe('snaps never land off screen', () => {
  const size2 = { width: 800, height: 600 };
  const onScreen = (cam: THREE.PerspectiveCamera, p: THREE.Vector3) => {
    const v = p.clone().project(cam);
    return v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
  };
  const input = (cam: THREE.PerspectiveCamera, h: KernelArcHost, ndc: THREE.Vector2, over: Partial<SnapInput> = {}): SnapInput => {
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, cam);
    return {
      graph: h.graph, camera: cam, size: size2,
      pointer: { x: ((ndc.x + 1) / 2) * size2.width, y: ((-ndc.y + 1) / 2) * size2.height },
      ray: rc.ray, cursor: rc.ray.at(10, new THREE.Vector3()), plane: null, ...over,
    };
  };

  it('an on-edge snap on an edge standing off the drawing plane does not pull the point off screen', () => {
    // A wall-top edge at eye level; drawing on the ground 3 m below it. Put on the ground, the
    // point under the pointer would be hundreds of pixels below the bottom of the canvas.
    const cam = new THREE.PerspectiveCamera(50, size2.width / size2.height, 0.1, 1000);
    cam.position.set(2, 3, 10);
    cam.lookAt(0, 3, 0);
    cam.updateMatrixWorld(true);
    const h = host();
    draw(h, [0, 3, -20], [0, 3, 7]);
    const under = V(0, 3, 3).project(cam);
    const ground = new THREE.Plane(V(0, 1, 0), 0);
    const r = computeSnap(input(cam, h, new THREE.Vector2(under.x, under.y), { plane: ground }));
    expect(onScreen(cam, r.point)).toBe(true);
    expect(r.kind).not.toBe('edge');
  });

  it('drops any snap that would land off the canvas, keeping the pointer position', () => {
    const cam = new THREE.PerspectiveCamera(50, size2.width / size2.height, 0.1, 1000);
    cam.position.set(2, 3, 10);
    cam.lookAt(0, 3, 0);
    cam.updateMatrixWorld(true);
    const h = host();
    // A corner right under the pointer, 3 m above the ground being drawn on: put on the ground
    // it is far below the bottom of the canvas.
    const corner = V(0, 3, 5);
    const under = corner.clone().project(cam);
    const ground = new THREE.Plane(V(0, 1, 0), 0);
    const inp = input(cam, h, new THREE.Vector2(under.x, under.y), { plane: ground, extraPoints: [{ point: corner, kind: 'endpoint' }] });
    const r = computeSnap(inp);
    expect(r.kind).toBe('none');
    expect(r.point.toArray()).toEqual(inp.cursor.toArray());
  });
});
