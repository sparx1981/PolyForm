import type { Shape, SiteRoute } from '../../types';
import { categoryOf } from './buildingStyle';
import { hash01 } from './buildingStyle';
import { gridHeightAt } from './terrain';
import { findSiteGround } from './site';

/**
 * Auto Street Light: lamp posts along the roads of an imported site, and garden / path lights for some
 * of the existing houses. They are ordinary lamp fixtures (each with its own editable light), tagged so
 * turning the option off takes them away again and turning it on replaces them.
 *
 * Roads get lights on their kerb, the way roads are lit: a main road has shoebox (LED cutoff) lights
 * staggered along both sides; a wide dual road gets double-arm cobra heads down the middle; a street
 * gets cobra heads on one side; a lane gets fewer. Nothing goes at a junction or through a building.
 */

type P = [number, number];

export const STREET_LIGHT_PREFIX = 'auto-street-light-';
export const STREET_LIGHT_TAG = 'auto-street-light';
const MAX_ROAD_LIGHTS = 16;
const MAX_HOUSE_LIGHTS = 8;

export interface PlannedLight {
  id: string;
  style: 'modern-led' | 'cobra' | 'cobra-double' | 'post-top' | 'victorian' | 'bollard' | 'solar-path';
  x: number; z: number;
  /** Turn about the vertical so an arm reaches over the road (radians). */
  yaw: number;
  /** Pole height, metres. */
  height: number;
  name: string;
}

const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Point `d` metres along a polyline, with its direction. */
function along(pts: P[], d: number): { p: P; dir: P } | null {
  let left = d;
  for (let i = 0; i + 1 < pts.length; i++) {
    const seg = dist(pts[i]!, pts[i + 1]!);
    if (left <= seg && seg > 0) {
      const t = left / seg;
      return { p: [pts[i]![0] + (pts[i + 1]![0] - pts[i]![0]) * t, pts[i]![1] + (pts[i + 1]![1] - pts[i]![1]) * t], dir: [(pts[i + 1]![0] - pts[i]![0]) / seg, (pts[i + 1]![1] - pts[i]![1]) / seg] };
    }
    left -= seg;
  }
  return null;
}

function nearestOnLine(pts: P[], q: P): { p: P; d: number } {
  let best = { p: pts[0]!, d: Infinity };
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const vx = b[0] - a[0], vz = b[1] - a[1];
    const len2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * vx + (q[1] - a[1]) * vz) / len2));
    const p: P = [a[0] + vx * t, a[1] + vz * t];
    const d = dist(p, q);
    if (d < best.d) best = { p, d };
  }
  return best;
}

function inside(poly: P[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!, [xj, zj] = poly[j]!;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** Yaw that turns a fixture's arm (out along local +x) to point along `dir`. */
const yawToward = (dir: P) => Math.atan2(-dir[1], dir[0]);

export interface StreetLightInput {
  routes: SiteRoute[];
  /** The site's buildings: outline and position in the model (x, z), and what the map calls them. */
  buildings: { id: string; position: P; footprint: P[]; kind?: string | undefined; height: number }[];
}

export function planStreetLights({ routes, buildings }: StreetLightInput): PlannedLight[] {
  const roads = routes.filter(r => r.kind === 'road' && r.points.length >= 2);
  const roadLights: PlannedLight[] = [];
  const outlines = buildings.map(b => b.footprint.map(([x, z]) => [x + b.position[0], z + b.position[1]] as P));
  const clearOfBuildings = (x: number, z: number) => !outlines.some(o => inside(o, x, z));
  const clearOfJunctions = (x: number, z: number, self: SiteRoute) =>
    !roads.some(r => r !== self && nearestOnLine(r.points, [x, z]).d < (r.width ?? 6) / 2 + 4);

  for (const road of roads) {
    if (road.noPavement) continue;
    const w = road.width ?? 6;
    const length = road.points.reduce((sum, p, i) => (i ? sum + dist(road.points[i - 1]!, p) : 0), 0);
    if (length < 12) continue;
    const main = w >= 9, dual = w >= 13;
    const spacing = main ? 30 : w >= 6 ? 34 : 42;
    const offset = w / 2 + 0.7;
    const count = Math.max(1, Math.floor(length / spacing));
    const gap = length / count;
    for (let k = 0; k < count; k++) {
      const at = along(road.points, gap * (k + 0.5));
      if (!at) continue;
      const left: P = [at.dir[1], -at.dir[0]]; // to the left of the way the road runs
      const side = main ? (k % 2 === 0 ? 1 : -1) : (hash01(road.id, 5) < 0.5 ? 1 : -1);
      const kerb: P = [at.p[0] + left[0] * offset * side, at.p[1] + left[1] * offset * side];
      const centre = at.p;
      const use: { x: number; z: number; style: PlannedLight['style']; toward: P }[] = [];
      if (dual) use.push({ x: centre[0], z: centre[1], style: 'cobra-double', toward: left }); // arms out both ways along the local x
      else use.push({ x: kerb[0], z: kerb[1], style: main ? 'modern-led' : 'cobra', toward: [-left[0] * side, -left[1] * side] });
      for (const u of use) {
        if (!clearOfBuildings(u.x, u.z) || !clearOfJunctions(u.x, u.z, road)) continue;
        roadLights.push({
          id: `${STREET_LIGHT_PREFIX}${road.id}-${k}`, style: u.style, x: u.x, z: u.z, yaw: yawToward(u.toward),
          height: main ? 9 : 7.5, name: u.style === 'modern-led' ? 'Street light (LED)' : u.style === 'cobra-double' ? 'Street light (double arm)' : 'Street light (cobra head)',
        });
      }
    }
  }
  // Keep the ones nearest the middle of the site if there are too many (each is a real light).
  const centre: P = buildings.length ? [buildings.reduce((s, b) => s + b.position[0], 0) / buildings.length, buildings.reduce((s, b) => s + b.position[1], 0) / buildings.length] : [0, 0];
  const trimmed = roadLights.length > MAX_ROAD_LIGHTS
    ? [...roadLights].sort((a, b) => dist([a.x, a.z], centre) - dist([b.x, b.z], centre)).slice(0, MAX_ROAD_LIGHTS)
    : roadLights;

  // Houses: a light at the gate and a couple along the path in, for some of them.
  const houseLights: PlannedLight[] = [];
  const houses = buildings.filter(b => categoryOf(b.kind, b.height) === 'house' && b.footprint.length >= 3)
    .filter(b => hash01(b.id, 9) < 0.5)
    .sort((a, b) => hash01(a.id, 10) - hash01(b.id, 10));
  for (const house of houses) {
    if (houseLights.length >= MAX_HOUSE_LIGHTS) break;
    const outline = house.footprint.map(([x, z]) => [x + house.position[0], z + house.position[1]] as P);
    const middle: P = [outline.reduce((s, p) => s + p[0], 0) / outline.length, outline.reduce((s, p) => s + p[1], 0) / outline.length];
    let best: { p: P; d: number; w: number } | null = null;
    for (const r of roads) {
      const n = nearestOnLine(r.points, middle);
      if (!best || n.d < best.d) best = { ...n, w: r.width ?? 6 };
    }
    if (!best) continue;
    const kerb = best.p;
    const toRoad: P = [(kerb[0] - middle[0]) / (best.d || 1), (kerb[1] - middle[1]) / (best.d || 1)];
    // Where the way in meets the house: walk out from the middle until the outline is left.
    let frontDist = 0;
    while (frontDist < best.d && inside(outline, middle[0] + toRoad[0] * frontDist, middle[1] + toRoad[1] * frontDist)) frontDist += 0.25;
    const front: P = [middle[0] + toRoad[0] * frontDist, middle[1] + toRoad[1] * frontDist];
    const pavement = best.w / 2 + 1.6;
    const gate: P = [kerb[0] - toRoad[0] * pavement, kerb[1] - toRoad[1] * pavement];
    const run = dist(gate, front);
    if (run < 3.5 || run > 40) continue;
    const dir: P = [(front[0] - gate[0]) / run, (front[1] - gate[1]) / run];
    const side: P = [-dir[1], dir[0]];
    const gateStyle: PlannedLight['style'] = hash01(house.id, 11) < 0.5 ? 'post-top' : 'victorian';
    const pathStyle: PlannedLight['style'] = hash01(house.id, 12) < 0.5 ? 'solar-path' : 'bollard';
    const spots: { t: number; lateral: number; style: PlannedLight['style']; height: number; name: string }[] = [
      { t: 0.04, lateral: 1.1, style: gateStyle, height: 2.6, name: gateStyle === 'post-top' ? 'Gate light (acorn)' : 'Gate light (Victorian)' },
      { t: 0.4, lateral: 0.9, style: pathStyle, height: 0.7, name: pathStyle === 'solar-path' ? 'Path light (solar)' : 'Path light (bollard)' },
      { t: 0.75, lateral: -0.9, style: pathStyle, height: 0.7, name: pathStyle === 'solar-path' ? 'Path light (solar)' : 'Path light (bollard)' },
    ];
    spots.forEach((spot, k) => {
      const x = gate[0] + dir[0] * run * spot.t + side[0] * spot.lateral;
      const z = gate[1] + dir[1] * run * spot.t + side[1] * spot.lateral;
      if (outlines.some(o => inside(o, x, z))) return;
      houseLights.push({ id: `${STREET_LIGHT_PREFIX}${house.id}-${k}`, style: spot.style, x, z, yaw: 0, height: spot.height, name: spot.name });
    });
  }
  return [...trimmed, ...houseLights.slice(0, MAX_HOUSE_LIGHTS)];
}

/** The model with the planned lights standing on the site's ground (any earlier ones replaced). */
export function withStreetLights(shapes: Shape[], lights: PlannedLight[], ground: Shape | undefined): Shape[] {
  const kept = shapes.filter(s => !s.id.startsWith(STREET_LIGHT_PREFIX));
  const t = ground?.terrainData;
  const [gx, gy, gz] = ground?.position ?? [0, 0, 0];
  const made: Shape[] = lights.map(l => {
    const y = t ? gridHeightAt(t, l.x - gx, l.z - gz) + gy : 0;
    const half = l.yaw / 2;
    return {
      id: l.id, name: l.name, type: 'lamp', position: [l.x, y, l.z], quaternion: [0, Math.sin(half), 0, Math.cos(half)],
      scale: [1, 1, 1], args: [1, l.height, 1], archStyle: l.style, color: '#1e293b', roughness: 0.7, metalness: 0.2, tags: [STREET_LIGHT_TAG],
    } as unknown as Shape;
  });
  return [...kept, ...made];
}

/** The model without any Auto Street Lights. */
export function withoutStreetLights(shapes: Shape[]): Shape[] {
  return shapes.filter(s => !s.id.startsWith(STREET_LIGHT_PREFIX));
}

/**
 * Switches Auto Street Light on or off for the imported site: plans the lights from its roads and
 * buildings, stands them on the ground and remembers the setting. Without the site's roads loaded
 * there is nothing to light, so the model comes back unchanged.
 */
export function applyAutoStreetLights(shapes: Shape[], on: boolean): Shape[] {
  const ground = findSiteGround(shapes);
  const site = ground?.terrainData?.site;
  if (!ground || !site) return shapes;
  const mark = (list: Shape[]) => list.map(s => (s.terrainData?.site ? { ...s, terrainData: { ...s.terrainData, site: { ...s.terrainData.site, autoStreetLights: on } } } : s));
  if (!on) return mark(withoutStreetLights(shapes));
  if (!site.routes) return shapes;
  const [gx, , gz] = ground.position;
  const routes = site.routes.map(r => ({ ...r, points: r.points.map(([x, z]) => [x + gx, z + gz] as P) }));
  const buildings = shapes.filter(s => s.type === 'site_building' && s.siteBuildingData && !s.hidden).map(s => ({
    id: s.id, position: [s.position[0], s.position[2]] as P, footprint: s.siteBuildingData!.footprint as P[], kind: s.siteBuildingData!.kind, height: s.siteBuildingData!.height,
  }));
  return mark(withStreetLights(shapes, planStreetLights({ routes, buildings }), ground));
}
