import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  axisSources, featureEdges, guideCrossings, guideOffset, guideSegment, isGuideShape, makeGuideArgs,
  guideSnapCandidates, offsetAtDistance, pickGuideSource, type GuideSource,
} from './tapeGuides';

const size = { width: 800, height: 600 };

/** A camera looking straight down at the ground from 20 m up. */
function topCamera() {
  const camera = new THREE.PerspectiveCamera(50, size.width / size.height, 0.1, 1000);
  camera.position.set(0, 20, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return camera;
}

const toPx = (v: THREE.Vector3, camera: THREE.Camera) => {
  const p = v.clone().project(camera);
  return { x: ((p.x + 1) / 2) * size.width, y: ((-p.y + 1) / 2) * size.height };
};

const edge = (a: [number, number, number], b: [number, number, number]): GuideSource =>
  ({ a: new THREE.Vector3(...a), b: new THREE.Vector3(...b), endless: false, label: 'Edge' });

describe('guide shapes', () => {
  it('counts tape guides and protractor guides, not plain measurements', () => {
    expect(isGuideShape({ type: 'measurement', args: { kind: 'guide' } })).toBe(true);
    expect(isGuideShape({ type: 'measurement', args: { kind: 'protractor' } })).toBe(true);
    expect(isGuideShape({ type: 'measurement', args: { start: [0, 0, 0], end: [1, 0, 0] } })).toBe(false);
    expect(isGuideShape({ type: 'box', args: { kind: 'guide' } })).toBe(false);
  });

  it('saves a long line through the point', () => {
    const args = makeGuideArgs(new THREE.Vector3(0, 0, 2), new THREE.Vector3(3, 0, 0), 2, 10);
    expect(args.direction).toEqual([1, 0, 0]);
    expect(args.start).toEqual([-10, 0, 2]);
    expect(args.end).toEqual([10, 0, 2]);
    expect(guideSegment({ type: 'measurement', args })!.map(v => v.toArray())).toEqual([[-10, 0, 2], [10, 0, 2]]);
  });
});

describe('pickGuideSource', () => {
  const camera = topCamera();
  const wallEdge = edge([-4, 0, 0], [4, 0, 0]);

  it('picks the edge under the pointer', () => {
    const pick = pickGuideSource([wallEdge], toPx(new THREE.Vector3(1, 0, 0), camera), camera, size)!;
    expect(pick.source).toBe(wallEdge);
    expect(pick.onCorner).toBe(false);
    expect(pick.point.x).toBeCloseTo(1, 3);
    expect(pick.point.z).toBeCloseTo(0, 3);
  });

  it('ignores edges away from the pointer', () => {
    expect(pickGuideSource([wallEdge], toPx(new THREE.Vector3(1, 0, 3), camera), camera, size)).toBeNull();
  });

  it('treats a corner as a measuring point', () => {
    expect(pickGuideSource([wallEdge], toPx(new THREE.Vector3(4, 0, 0), camera), camera, size)!.onCorner).toBe(true);
  });

  it('never treats an axis as having corners', () => {
    const red = axisSources(4)[0]!;
    expect(pickGuideSource([red], toPx(new THREE.Vector3(4, 0, 0), camera), camera, size)!.onCorner).toBe(false);
  });

  it('picks the nearer of two edges', () => {
    const other = edge([-4, 0, 0.5], [4, 0, 0.5]);
    const pick = pickGuideSource([wallEdge, other], toPx(new THREE.Vector3(0, 0, 0.4), camera), camera, size, 30)!;
    expect(pick.source).toBe(other);
  });

  it('still picks a long guide that runs behind the camera', () => {
    const camera2 = new THREE.PerspectiveCamera(50, size.width / size.height, 0.1, 1000);
    camera2.position.set(0, 2, 10);
    camera2.lookAt(0, 0, 0);
    camera2.updateMatrixWorld(true);
    const along = edge([0, 0, -100], [0, 0, 100]); // passes under the camera and out behind it
    const pick = pickGuideSource([along], toPx(new THREE.Vector3(0, 0, 0), camera2), camera2, size);
    expect(pick?.source).toBe(along);
  });
});

describe('guideOffset', () => {
  const camera = topCamera();
  const rayAt = (x: number, z: number) => {
    const px = toPx(new THREE.Vector3(x, 0, z), camera);
    const r = new THREE.Raycaster();
    r.setFromCamera(new THREE.Vector2((px.x / size.width) * 2 - 1, -(px.y / size.height) * 2 + 1), camera);
    return r.ray;
  };

  it('slides a level guide along the level plane, square to the line', () => {
    const off = guideOffset(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), rayAt(3, 2.5), null);
    expect(off.x).toBeCloseTo(0, 5);
    expect(off.y).toBeCloseTo(0, 5);
    expect(off.z).toBeCloseTo(2.5, 5);
  });

  it('uses the surface under the pointer when there is one', () => {
    const off = guideOffset(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), rayAt(0, 1), new THREE.Vector3(5, 1, 0));
    expect(off.toArray().map(v => +v.toFixed(5))).toEqual([0, 1, 0]);
  });

  it('turns a typed distance into an offset the way you moved', () => {
    const d = new THREE.Vector3(1, 0, 0);
    expect(offsetAtDistance(new THREE.Vector3(0.3, 0, -0.7), d, 2)!.toArray().map(v => +v.toFixed(5))).toEqual([0, 0, -2]);
    expect(offsetAtDistance(new THREE.Vector3(0, 0, -0.7), d, -2)!.toArray().map(v => +v.toFixed(5))).toEqual([0, 0, 2]);
    expect(offsetAtDistance(new THREE.Vector3(5, 0, 0), d, 2)).toBeNull();
  });
});

describe('guideCrossings', () => {
  it('finds where guides cross, and not where parallel or apart ones would', () => {
    const seg = (a: [number, number, number], b: [number, number, number]): [THREE.Vector3, THREE.Vector3] =>
      [new THREE.Vector3(...a), new THREE.Vector3(...b)];
    const crossings = guideCrossings([
      seg([-10, 0, 2], [10, 0, 2]),
      seg([3, 0, -10], [3, 0, 10]),
      seg([-10, 0, 5], [10, 0, 5]),   // parallel to the first
      seg([0, 1, -10], [0, 1, 10]),   // a metre above: misses
    ]);
    expect(crossings.map(p => p.toArray().map(v => +v.toFixed(5)))).toEqual([[3, 0, 2], [3, 0, 5]]);
  });
});

describe('featureEdges', () => {
  it("gives a box's twelve edges, not the diagonals of its faces", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    mesh.position.set(10, 0, 0);
    mesh.updateMatrixWorld(true);
    const edges = featureEdges(mesh);
    expect(edges).toHaveLength(12);
    expect(Math.min(...edges.map(e => e.a.x))).toBeCloseTo(9);
  });
});

describe('guideSnapCandidates', () => {
  it('offers the nearest point along a guide, and guide crossings', () => {
    const camera = topCamera();
    const px = toPx(new THREE.Vector3(3.05, 0, 2.1), camera);
    const r = new THREE.Raycaster();
    r.setFromCamera(new THREE.Vector2((px.x / size.width) * 2 - 1, -(px.y / size.height) * 2 + 1), camera);
    const a: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(-10, 0, 2), new THREE.Vector3(10, 0, 2)];
    const b: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(3, 0, -10), new THREE.Vector3(3, 0, 10)];
    const snaps = guideSnapCandidates([a, b], guideCrossings([a, b]), r.ray, camera, size, px);
    expect(snaps).toHaveLength(3);
    const crossing = snaps.find(s => s.label === 'Guide crossing')!;
    expect(crossing.point.toArray().map(v => +v.toFixed(5))).toEqual([3, 0, 2]);
    const onFirst = snaps.filter(s => s.label === 'On guide').find(s => Math.abs(s.point.z - 2) < 1e-6)!;
    expect(onFirst.point.x).toBeCloseTo(3.05, 2);
  });
});
