import * as THREE from 'three';
import { DOOR_CODE, PATTERN_CODE, type BuildingProfile } from './buildingStyle';

/**
 * Turns a building's plain solid into one that can be dressed: two material groups (walls, then
 * roof) and, on every vertex, what the facade shader needs:
 *
 *  - `uv`: walls are (distance along the wall, height) in metres; roof faces are (across, up the
 *    slope) in metres, so a material laid on them keeps its true size;
 *  - `aWall`: (distance along this wall, this wall's length, 1 if it is the wall the door goes on);
 *  - `aS1`, `aS2`: the profile's floor height, window rhythm and size, sill, eave, pattern and door;
 *  - `color`: the wall or roof tint.
 *
 * Shading by triangle: anything facing up is roof; the rest is wall.
 */

const ROOF_FACING = 0.35;

export function styledBuildingGeometry(base: THREE.BufferGeometry, profile: BuildingProfile): THREE.BufferGeometry {
  const src = base.index ? base.toNonIndexed() : base.clone();
  const pos = src.getAttribute('position');
  const triangles = pos.count / 3;
  const P = (i: number) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));

  type Wall = { min: number; max: number; tx: number; tz: number };
  const walls = new Map<string, Wall>();
  const wallTris: { i: number; key: string }[] = [];
  const roofTris: { i: number; n: THREE.Vector3 }[] = [];
  const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();

  for (let t = 0; t < triangles; t++) {
    const a = P(t * 3), b = P(t * 3 + 1), c = P(t * 3 + 2);
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    if (n.y > ROOF_FACING) { roofTris.push({ i: t, n: n.clone() }); continue; }
    if (n.y < -ROOF_FACING) continue; // the underside is never seen
    // A wall: known by the direction it faces and how far it stands from the origin.
    const hl = Math.hypot(n.x, n.z) || 1;
    const nx = n.x / hl, nz = n.z / hl;
    const tx = -nz, tz = nx; // along the wall
    const d = nx * a.x + nz * a.z;
    const key = `${Math.round(nx * 100)}|${Math.round(nz * 100)}|${Math.round(d * 20)}`;
    let w = walls.get(key);
    if (!w) { w = { min: Infinity, max: -Infinity, tx, tz }; walls.set(key, w); }
    for (const v of [a, b, c]) {
      const along = v.x * tx + v.z * tz;
      if (along < w.min) w.min = along;
      if (along > w.max) w.max = along;
    }
    wallTris.push({ i: t, key });
  }

  // The door goes on the longest wall.
  let doorKey = '';
  let longest = 0;
  for (const [key, w] of walls) if (w.max - w.min > longest) { longest = w.max - w.min; doorKey = key; }
  if (longest < 3) doorKey = '';

  const total = (wallTris.length + roofTris.length) * 3;
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const color = new Float32Array(total * 3);
  const aWall = new Float32Array(total * 3);
  const aS1 = new Float32Array(total * 4);
  const aS2 = new Float32Array(total * 4);

  const wallColor = new THREE.Color(profile.wallTint);
  // The roof picture is already coloured, so the tint only nudges it: lightened so it doesn't double-darken.
  const roofColor = new THREE.Color(profile.roofTint).lerp(new THREE.Color(1, 1, 1), 0.45);
  let o = 0;

  const put = (v: THREE.Vector3, nn: THREE.Vector3, u: number, vv: number, col: THREE.Color, w0: number, w1: number, w2: number) => {
    position.set([v.x, v.y, v.z], o * 3);
    normal.set([nn.x, nn.y, nn.z], o * 3);
    uv.set([u, vv], o * 2);
    color.set([col.r, col.g, col.b], o * 3);
    aWall.set([w0, w1, w2], o * 3);
    aS1.set([profile.storeyHeight, profile.bayWidth, profile.windowWidth, profile.windowHeight], o * 4);
    aS2.set([profile.sill, profile.eave, PATTERN_CODE[profile.pattern], DOOR_CODE[profile.door]], o * 4);
    o++;
  };

  for (const { i, key } of wallTris) {
    const w = walls.get(key)!;
    const a = P(i * 3), b = P(i * 3 + 1), c = P(i * 3 + 2);
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
    for (const v of [a, b, c]) {
      const along = v.x * w.tx + v.z * w.tz - w.min;
      put(v, n, along, v.y, wallColor, along, w.max - w.min, key === doorKey ? 1 : 0);
    }
  }
  const wallVertexCount = o;

  const up = new THREE.Vector3(0, 1, 0);
  const t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
  for (const { i, n: fn } of roofTris) {
    t1.crossVectors(up, fn);
    if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0); else t1.normalize();
    t2.crossVectors(fn, t1).normalize();
    for (let k = 0; k < 3; k++) {
      const v = P(i * 3 + k);
      put(v, fn, v.dot(t1), v.dot(t2), roofColor, 0, 0, -1);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setAttribute('aWall', new THREE.BufferAttribute(aWall, 3));
  g.setAttribute('aS1', new THREE.BufferAttribute(aS1, 4));
  g.setAttribute('aS2', new THREE.BufferAttribute(aS2, 4));
  g.addGroup(0, wallVertexCount, 0);
  g.addGroup(wallVertexCount, total - wallVertexCount, 1);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  src.dispose();
  return g;
}
