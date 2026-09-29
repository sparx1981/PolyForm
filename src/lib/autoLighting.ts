import type { CustomLight, Shape } from '../types';
import { buildingLevels, floorPlans } from './presentation/floorPlans';
import { findLampStyle } from './lampStyles';

export type LightMood = 'warm' | 'neutral' | 'cool';
export type AutoLightSource = 'place' | 'fixtures' | 'custom';
const COLOURS = { warm: '#ffdfb5', neutral: '#fff4e5', cool: '#e4efff' };
export const AUTO_LIGHT_PREFIX = 'auto-room-light-';
/** Ceiling fixtures Auto light can place, in the order they are offered. */
export const AUTO_FIXTURE_STYLES: { id: string; name: string }[] = [
  { id: 'recessed', name: 'Recessed downlight' },
  { id: 'troffer', name: 'Office panel light' },
  { id: 'track', name: 'Track light' },
  { id: 'pendant', name: 'Pendant light' },
  { id: 'chandelier', name: 'Chandelier' },
  { id: 'high-bay', name: 'Warehouse high-bay' },
];
export const DEFAULT_AUTO_FIXTURE_STYLES = ['recessed'];
export const AUTO_LIGHT_LIMIT = 24;
export const AUTO_FIXTURE_PREFIX = 'auto-fixture-';
const FIXTURE_LIMIT = 24;

/** Recessed downlights suit most rooms; a big room gets a small grid so it isn't lit from one spot. */
function fixtureSpots(room: { at: [number, number]; size: [number, number]; areaM2: number }): [number, number][] {
  const n = room.areaM2 > 40 ? 3 : room.areaM2 > 18 ? 2 : 1;
  if (n === 1) return [[room.at[0], room.at[1]]];
  // Spread along the room's longer side; the detector's interior point stays one of the spots.
  const alongX = room.size[0] >= room.size[1];
  const span = (alongX ? room.size[0] : room.size[1]) / (n + 1);
  return Array.from({ length: n }, (_, k) => {
    const off = (k - (n - 1) / 2) * span;
    return alongX ? [room.at[0] + off, room.at[1]] : [room.at[0], room.at[1] + off];
  });
}

/** A lighting starting point in renderer units, kept as ordinary editable scene lights. */
export function planAutoLighting(shapes: Shape[], lights: CustomLight[], source: AutoLightSource, mood: LightMood, fixtureStyles: readonly string[] = DEFAULT_AUTO_FIXTURE_STYLES): { lights: CustomLight[]; changed: number; message: string; addShapes?: Shape[]; removeShapeIds?: string[] } {
  const visible = shapes.filter(s => !s.hidden);
  const levels = buildingLevels(visible);
  const rooms = floorPlans(visible, [], 300).flatMap(plan => {
    const level = levels.find(l => Math.abs(l.elevation - plan.elevation) < 0.1);
    const tops = level?.walls.map(w => w.position[1] + (Array.isArray(w.args) ? (w.args[1] ?? 2.8) / 2 : 1.4)) ?? [];
    const ceiling = tops.length ? Math.min(...tops) : plan.elevation + 2.8;
    return plan.rooms.map(room => ({ ...room, floor: plan.elevation, ceiling }));
  });
  const colour = COLOURS[mood];
  if (source === 'place') {
    if (!rooms.length) return { lights, changed: 0, message: 'No enclosed rooms found. Close the wall layout so fixtures can be placed inside.' };
    const chosen = AUTO_FIXTURE_STYLES.filter(f => fixtureStyles.includes(f.id));
    if (!chosen.length) return { lights, changed: 0, message: 'Tick at least one fixture type to place.' };
    const addShapes: Shape[] = [];
    rooms.forEach((room, i) => {
      // With several types ticked they share out between the rooms, so each one is used.
      const style = chosen[i % chosen.length]!;
      // A track light, pendant or chandelier is one fixture for the room, not a grid of them.
      const spots = style.id === 'recessed' || style.id === 'troffer' || style.id === 'high-bay' ? fixtureSpots(room) : [[room.at[0], room.at[1]] as [number, number]];
      for (const [x, z] of spots) {
        if (addShapes.length >= FIXTURE_LIMIT) return;
        addShapes.push({ id: `${AUTO_FIXTURE_PREFIX}${i}-${addShapes.length}`, name: `Room ${i + 1} ${style.name.toLowerCase()}`, type: 'lamp',
          position: [x, room.ceiling, z], quaternion: [0, 0, 0, 1], scale: [1, 1, 1], args: [1, 3.2, 1],
          archStyle: style.id, color: '#1e293b', roughness: 0.7, metalness: 0.1 });
      }
    });
    const removeShapeIds = shapes.filter(s => s.id.startsWith(AUTO_FIXTURE_PREFIX)).map(s => s.id);
    return { lights, changed: addShapes.length, addShapes, removeShapeIds,
      message: `Placed ${addShapes.length} ceiling fixtures in ${rooms.length} rooms. Each has an editable light in Custom Lights.${addShapes.length >= FIXTURE_LIMIT ? ' Limited to 24 fixtures.' : ''}` };
  }
  if (source === 'fixtures') {
    const fixtures = new Map(visible.filter(s => s.type === 'lamp').map(s => [s.id, s]));
    const bound = lights.filter(l => l.parentShapeId && fixtures.has(l.parentShapeId));
    if (!bound.length) return { lights, changed: 0, message: 'Add a light fixture first, or choose Custom room lights.' };
    const assignments = new Map<string, number>();
    for (const l of bound) {
      let best = -1, distance = Infinity;
      rooms.forEach((r, i) => {
        if (l.position[1] < r.floor || l.position[1] > r.ceiling + 0.3) return;
        const d = Math.hypot(l.position[0] - r.at[0], l.position[2] - r.at[1]);
        if (d < distance && d <= Math.hypot(...r.size) / 2 + 0.5) { best = i; distance = d; }
      });
      assignments.set(l.id, best);
    }
    const counts = new Map<number, number>();
    assignments.forEach(i => counts.set(i, (counts.get(i) ?? 0) + 1));
    const next = lights.map(l => {
      const i = assignments.get(l.id);
      if (i === undefined) return l;
      const fixture = fixtures.get(l.parentShapeId!)!;
      const defaults = findLampStyle(fixture.archStyle ?? 'classic').light;
      const room = rooms[i];
      const energy = room ? Math.max(10, Math.min(100, room.areaM2 * 3)) / counts.get(i)! : defaults.intensity;
      return { ...l, color: colour, intensity: l.type === 'rect' ? Math.max(2, Math.min(12, energy / 5)) : energy / Math.max(0.1, l.scale ?? 1) };
    });
    return { lights: next, changed: bound.length, message: `Balanced ${bound.length} fixtures. Their positions and beam directions are preserved.` };
  }
  if (!rooms.length) return { lights, changed: 0, message: 'No enclosed rooms found. Close the wall layout, or choose Existing fixtures.' };
  const generated: CustomLight[] = [];
  for (const [i, room] of rooms.entries()) {
    if (generated.length >= AUTO_LIGHT_LIMIT) break;
    const height = Math.max(0.5, room.ceiling - room.floor - 0.25);
    const y = room.floor + height;
    const reach = Math.hypot(...room.size) + height;
    const energy = Math.max(12, Math.min(100, room.areaM2 * 3));
    // A broad downlight supplies the key; a much softer panel fills the shadows.
    // Both use the room detector's guaranteed interior point, including L-shaped rooms.
    generated.push({ id: `${AUTO_LIGHT_PREFIX}${i}-key`, name: `Room ${i + 1} · key`, type: 'spot',
      position: [room.at[0], y, room.at[1]], target: [room.at[0], room.floor, room.at[1]],
      intensity: energy, color: colour, distance: reach, decay: 2,
      angle: Math.min(1.35, Math.max(0.65, Math.atan2(Math.hypot(...room.size) / 2, height))), penumbra: 0.75 });
    generated.push({ id: `${AUTO_LIGHT_PREFIX}${i}-fill`, name: `Room ${i + 1} · soft fill`, type: 'rect',
      position: [room.at[0], y - 0.05, room.at[1]], rotationX: -90, intensity: 2.5, color: colour,
      width: Math.min(1.5, room.size[0] * 0.35), height: Math.min(1.5, room.size[1] * 0.35) });
  }
  return { lights: [...lights.filter(l => !l.id.startsWith(AUTO_LIGHT_PREFIX)), ...generated], changed: generated.length,
    message: `Created ${generated.length} editable lights for ${generated.length / 2} rooms.${rooms.length * 2 > AUTO_LIGHT_LIMIT ? ' Limited to 12 rooms to keep rendering responsive.' : ''}` };
}
