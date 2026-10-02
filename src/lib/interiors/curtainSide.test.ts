import { describe, expect, it } from 'vitest';
import type { Shape } from '../../types';
import { detectRooms } from '../spatial/rooms';
import { planRoomFurnishing, pointInPolygonOrNear } from './smartFurnish';

type V2 = [number, number];
let n = 0;
function wallBetween(a: V2, b: V2, thick: number, mode: 'rot' | 'rotNeg' | 'z' | 'quat'): Shape {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
  // three.js rotation about Y by r maps local +x to (cos r, 0, -sin r); so r = atan2(-dz, dx).
  const r = Math.atan2(-dz, dx);
  if (mode === 'z' && Math.abs(dx) < 1e-9) return { id: `w${n++}`, type: 'wall', position: [(a[0]+b[0])/2, 1.4, (a[1]+b[1])/2], args: [thick, 2.8, len + thick], color: '#fff' } as Shape;
  if (mode === 'z') return { id: `w${n++}`, type: 'wall', position: [(a[0]+b[0])/2, 1.4, (a[1]+b[1])/2], args: [len + thick, 2.8, thick], color: '#fff' } as Shape;
  if (mode === 'quat') { const s = Math.sin(r/2), c = Math.cos(r/2); return { id: `w${n++}`, type: 'wall', position: [(a[0]+b[0])/2, 1.4, (a[1]+b[1])/2], quaternion: [0, s, 0, c], args: [len + thick, 2.8, thick], color: '#fff' } as Shape; }
  return { id: `w${n++}`, type: 'wall', position: [(a[0]+b[0])/2, 1.4, (a[1]+b[1])/2], rotation: [0, mode === 'rot' ? r : r + Math.PI, 0], args: [len + thick, 2.8, thick], color: '#fff' } as Shape;
}
function scenario(poly: V2[], thick: number, mode: 'rot' | 'rotNeg' | 'z' | 'quat') {
  const walls = poly.map((p, i) => wallBetween(p, poly[(i + 1) % poly.length]!, thick, mode));
  const shapes: Shape[] = [...walls];
  walls.forEach((w, i) => {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const len = Math.hypot(b[0]-a[0], b[1]-a[1]);
    if (len < 2.5) return;
    shapes.push({ id: `win${i}`, type: 'window', hostWallId: w.id, position: [(a[0]+b[0])/2, 1.5, (a[1]+b[1])/2], rotation: mode === 'z' && Math.abs(b[0] - a[0]) < 1e-9 ? [0, Math.PI / 2, 0] : w.rotation, quaternion: w.quaternion, args: [1.2, 1.2, thick], color: '#fff' } as Shape);
  });
  return shapes;
}
const squares: Record<string, V2[]> = {
  ccw: [[0,0],[6,0],[6,5],[0,5]],
  cw: [[0,0],[0,5],[6,5],[6,0]],
  L: [[0,0],[8,0],[8,3],[4,3],[4,6],[0,6]],
};
// Curtains belong on the room side of a window, however the wall was drawn: either rotation, a reversed wall, a wall
// built along z, or one rotated by a quaternion; in clockwise and anticlockwise rooms and an L-shaped one.
describe('curtains hang inside the room', () => {
  for (const [name, poly] of Object.entries(squares)) for (const thick of [0.2, 0.35]) for (const mode of ['rot','rotNeg','quat'] as const) {
    it(`${name} t=${thick} ${mode}`, () => {
      const shapes = scenario(poly, thick, mode);
      const room = detectRooms(shapes, { cell: 0.1 })[0]!;
      expect(room).toBeDefined();
      const plan = planRoomFurnishing(shapes, room, 'living-room');
      const curtains = plan.shapes.filter(s => s.customData.furnitureType === 'curtain');
      expect(curtains.length).toBeGreaterThan(0);
      for (const c of curtains) {
        const yaw = c.rotation![1]!;
        // Its front faces into the room, and it stands inside the room too.
        expect(pointInPolygonOrNear([c.position[0], c.position[2]], room.boundary, 0)).toBe(true);
        expect(pointInPolygonOrNear([c.position[0] + Math.sin(yaw) * 0.6, c.position[2] + Math.cos(yaw) * 0.6], room.boundary, 0)).toBe(true);
        expect(pointInPolygonOrNear([c.position[0] - Math.sin(yaw) * 0.6, c.position[2] - Math.cos(yaw) * 0.6], room.boundary, 0)).toBe(false);
      }
    });
  }
});
