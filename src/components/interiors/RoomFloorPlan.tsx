import type { SpatialRoom } from '../../lib/spatial/rooms';
import type { Shape } from '../../types';
import type { RoomFurnishingRequest } from '../../lib/interiors/furnishBatch';

export function RoomFloorPlan({ rooms, shapes, selectedId, queue, onSelect }: {
  rooms: SpatialRoom[]; shapes: Shape[]; selectedId: string; queue: RoomFurnishingRequest[]; onSelect: (id: string) => void;
}) {
  const points = rooms.flatMap(room => room.boundary);
  if (!points.length) return null;
  const minX = Math.min(...points.map(p => p[0])), minZ = Math.min(...points.map(p => p[1]));
  const width = Math.max(1, Math.max(...points.map(p => p[0])) - minX);
  const depth = Math.max(1, Math.max(...points.map(p => p[1])) - minZ);
  const scale = 440 / Math.max(width, depth), pad = 24;
  const x = (n: number) => pad + (n - minX) * scale, z = (n: number) => pad + (n - minZ) * scale;
  const wallIds = new Set(rooms.flatMap(room => room.boundaryWallIds));
  return <svg viewBox={`0 0 ${width * scale + pad * 2} ${depth * scale + pad * 2}`} className="w-full max-h-80 rounded-xl bg-slate-50 dark:bg-slate-950 border border-gray-200 dark:border-gray-700" role="group" aria-label={`Floor plan, level ${rooms[0].level}`}>
    {rooms.map((room, i) => {
      const selected = room.id === selectedId, queued = queue.some(item => item.roomId === room.id);
      const label = `${room.name ?? `Room ${i + 1}`} · ${room.areaM2.toFixed(1)} m²${queued ? ' · queued' : ''}`;
      return <g key={room.id} role="button" tabIndex={0} aria-label={label} aria-pressed={selected}
        onClick={() => onSelect(room.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(room.id); } }} className="cursor-pointer focus:outline-none focus:stroke-blue-600">
        <title>{label}</title>
        <polygon points={room.boundary.map(p => `${x(p[0])},${z(p[1])}`).join(' ')} fill={selected ? '#bfdbfe' : queued ? '#d1fae5' : '#ffffff'} stroke={selected ? '#2563eb' : '#94a3b8'} strokeWidth={selected ? 3 : 1.5} />
        <text x={x(room.at[0])} y={z(room.at[1]) - 5} textAnchor="middle" fontSize="12" fill="#1e293b" pointerEvents="none">{room.name ?? `Room ${i + 1}`}</text>
        <text x={x(room.at[0])} y={z(room.at[1]) + 11} textAnchor="middle" fontSize="10" fill="#475569" pointerEvents="none">{room.areaM2.toFixed(1)} m²{queued ? ' · queued' : ''}</text>
      </g>;
    })}
    {shapes.filter(shape => shape.type === 'wall' && wallIds.has(shape.id)).map(wall => {
      const angle = wall.rotation?.[1] ?? (wall.quaternion ? Math.atan2(2 * (wall.quaternion[3]*wall.quaternion[1] + wall.quaternion[0]*wall.quaternion[2]), 1 - 2 * (wall.quaternion[1]**2 + wall.quaternion[2]**2)) : 0);
      const half = Number(wall.args?.[0] ?? 1) / 2;
      return <line key={wall.id} x1={x(wall.position[0] - Math.cos(angle)*half)} y1={z(wall.position[2] + Math.sin(angle)*half)} x2={x(wall.position[0] + Math.cos(angle)*half)} y2={z(wall.position[2] - Math.sin(angle)*half)} stroke="#475569" strokeWidth={Math.max(2, Number(wall.args?.[2] ?? 0.2) * scale)} pointerEvents="none" />;
    })}
  </svg>;
}
