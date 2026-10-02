import { useMemo, useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Armchair, Bath, BedDouble, Box, Briefcase, Check, CookingPot, Laptop, Lightbulb, Loader2, Sofa, Sparkles, Toilet, Wrench, X } from 'lucide-react';
import { useApp } from '../../AppContext';
import { detectRooms } from '../../lib/spatial/rooms';
import { type FurnishingPreset } from '../../lib/interiors/smartFurnish';
import { furnishRooms, furnishingsInRoom, type RoomFurnishingRequest } from '../../lib/interiors/furnishBatch';
import { RoomFloorPlan } from './RoomFloorPlan';
import { useModalA11y } from '../ui/useModalA11y';
import { cn } from '../../lib/utils';

const PRESETS: Array<{
  id: FurnishingPreset;
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  { id: 'bedroom', label: 'Bedroom', description: 'Bed, paired bedside tables, wardrobe, console and a reading chair.', icon: <BedDouble size={17} /> },
  { id: 'living-room', label: 'Living room', description: 'Sofa, tables, chairs and a TV unit scaled to the room, kept off doors and facing the sofa, with curtains at windows.', icon: <Sofa size={17} /> },
  { id: 'storage', label: 'Storage', description: 'Three cabinets distributed around available walls.', icon: <Box size={17} /> },
  { id: 'office', label: 'Office', description: 'Up to three desks, each with its chair, plus a bookcase and filing cabinets.', icon: <Briefcase size={17} /> },
  { id: 'home-office', label: 'Home office', description: 'A desk and chair, bookcase, reading chair and curtains at the window.', icon: <Laptop size={17} /> },
  { id: 'kitchen', label: 'Kitchen', description: 'Base and wall units with sink and hob sized to the wall, a fridge freezer and, if there is space, a dining table and chairs.', icon: <CookingPot size={17} /> },
  { id: 'bathroom', label: 'Bathroom', description: 'Bath, toilet, basin and a shower if it fits. Fixtures sit on walls and share a wet wall.', icon: <Bath size={17} /> },
  { id: 'toilet', label: 'Toilet', description: 'A toilet and a small basin with proper space in front.', icon: <Toilet size={17} /> },
  { id: 'workshop', label: 'Garage / Workshop', description: 'Workbenches, tool chests, shelving racks and machines scaled to the space, with a free-standing bench in big rooms.', icon: <Wrench size={17} /> },
];

export default function InteriorStudio() {
  const { shapes, setShapes } = useApp();
  const [open, setOpen] = useState(false);
  const dialogRef = useModalA11y<HTMLDivElement>(open, () => setOpen(false));
  const [roomId, setRoomId] = useState<string>('');
  const [preset, setPreset] = useState<FurnishingPreset>('bedroom');
  const [queue, setQueue] = useState<RoomFurnishingRequest[]>([]);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [settleSoft, setSettleSoft] = useState(true);
  const [lighting, setLighting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('polyform:interior-studio', handler);
    return () => window.removeEventListener('polyform:interior-studio', handler);
  }, []);

  const rooms = useMemo(() => open ? detectRooms(shapes).map((room, i) => ({ ...room, name: room.name ?? `Room ${i + 1}` })) : [], [shapes, open]);

  useEffect(() => {
    if (!open) return;
    if (!rooms.length) {
      setRoomId('');
      return;
    }
    if (!roomId || !rooms.some(room => room.id === roomId)) setRoomId(rooms[0].id);
  }, [rooms, roomId, open]);

  const selectedRoom = rooms.find(room => room.id === roomId);
  const selectRoom = (id: string) => {
    setRoomId(id);
    const pending = queue.find(item => item.roomId === id);
    if (pending) setPreset(pending.preset);
    setReplaceExisting(pending?.replaceExisting ?? false);
    setLighting(pending?.lighting ?? true);
  };
  const enqueue = () => {
    if (!selectedRoom) return;
    setQueue(previous => [...previous.filter(item => item.roomId !== roomId), { roomId, preset, replaceExisting, lighting }]);
    setMessage(`${selectedRoom.name} queued. Pick another room, or apply the queue below.`);
  };

  const furnish = () => {
    if (!queue.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const batch = furnishRooms(shapes, rooms, queue, settleSoft);
      setShapes(batch.shapes);
      setQueue([]);
      const summary = batch.results.map(result => {
        const room = rooms.find(room => room.id === result.roomId)!;
        return `${room.name}: ${result.placed} placed${result.removed ? `, ${result.removed} replaced` : ''}${result.skipped ? `, ${result.skipped} could not fit` : ''}${result.lights ? `, ${result.lights} lights` : ''}`;
      }).join(' · ');
      setMessage(`${summary}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not furnish this room.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Interior Studio"
        className="fixed inset-0 z-[112] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          className="w-full max-w-4xl max-h-[88vh] overflow-hidden rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl"
        >
          <header className="px-5 py-4 flex items-center justify-between border-b border-gray-200 dark:border-gray-800">
            <div>
              <h2 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Armchair size={18} className="text-polyform-blue" /> Interior Studio
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">Complete room arrangements with access space, upholstered furniture and window-fitted curtains.</p>
            </div>
            <button onClick={() => setOpen(false)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Close">
              <X size={18} />
            </button>
          </header>

          <div className="p-5 space-y-5 overflow-y-auto max-h-[calc(88vh-72px)]">
            {!rooms.length ? (
              <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-5 text-sm text-amber-800 dark:text-amber-200">
                No enclosed rooms were detected. Create or import a closed wall layout first, then reopen Interior Studio.
              </div>
            ) : (
              <>
                <div className="grid lg:grid-cols-2 gap-5">
                <section className="space-y-2 lg:sticky lg:top-0 self-start">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-xs font-semibold text-gray-600 dark:text-gray-300" htmlFor="interior-floor">Choose a floor, then pick a room</label>
                    <select id="interior-floor" value={selectedRoom?.level ?? rooms[0].level} onChange={e => selectRoom(rooms.find(room => room.level === Number(e.target.value))!.id)}
                      className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
                      {[...new Set(rooms.map(room => room.level))].map(level => <option key={level} value={level}>Level {level} · {rooms.find(room => room.level === level)!.elevation.toFixed(1)} m elevation</option>)}
                    </select>
                  </div>
                  <RoomFloorPlan rooms={rooms.filter(room => room.level === selectedRoom?.level)} shapes={shapes} selectedId={roomId} queue={queue} onSelect={selectRoom} />
                  <div className="flex flex-wrap gap-2" aria-label="Rooms on this floor">
                    {rooms.filter(room => room.level === selectedRoom?.level).map(room => <button key={room.id} aria-pressed={room.id === roomId} onClick={() => selectRoom(room.id)}
                      className={cn('rounded-lg border px-3 py-2 text-xs', room.id === roomId ? 'border-polyform-blue bg-blue-50 dark:bg-blue-950/30' : 'border-gray-200 dark:border-gray-700')}>
                      {room.name} · {room.areaM2.toFixed(1)} m²{queue.some(item => item.roomId === room.id) ? ' · queued' : ''}
                    </button>)}
                  </div>
                  {selectedRoom && (
                    <p className="text-[11px] text-gray-500">
                      {selectedRoom.boundaryWallIds.length} bounding walls · {selectedRoom.openingIds.length} hosted openings · {selectedRoom.perimeterM.toFixed(1)} m perimeter
                    </p>
                  )}
                </section>

                <div className="space-y-4">
                <section className="space-y-2">
                  <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Furnishing preset</div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {PRESETS.map(option => (
                      <button key={option.id} onClick={() => setPreset(option.id)} aria-pressed={preset === option.id}
                        className={cn(
                          'text-left rounded-xl border p-3 flex gap-3 transition-colors',
                          preset === option.id
                            ? 'border-polyform-blue bg-blue-50 dark:bg-blue-950/30'
                            : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800',
                        )}>
                        <span className={cn('mt-0.5', preset === option.id ? 'text-polyform-blue' : 'text-gray-500')}>{option.icon}</span>
                        <span>
                          <span className="block text-sm font-semibold">{option.label}</span>
                          <span className="block text-[11px] text-gray-500 mt-0.5">{option.description}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                <label className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={settleSoft} onChange={e => setSettleSoft(e.target.checked)} />
                  <Sparkles size={16} className="text-polyform-blue" />
                  <span className="flex-1">
                    <span className="block text-sm font-semibold">Relax upholstery and drape</span>
                    <span className="block text-[11px] text-gray-500">Save a relaxed upholstery shape and curtain drape. Beds and sofas remain static. Curtains respond to plant wind, enabled grass/flower wind beneath the room, Weather wind and nearby movement in Walk Mode.</span>
                  </span>
                </label>

                <label className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={lighting} onChange={e => setLighting(e.target.checked)} />
                  <Lightbulb size={16} className="text-polyform-blue" />
                  <span className="flex-1">
                    <span className="block text-sm font-semibold">Add lighting for the room type</span>
                    <span className="block text-[11px] text-gray-500">Ceiling lights, lamps, pendants, vanity and task lights chosen for what the room is. They are ordinary fixtures you can edit, and furnishing the room again replaces them.</span>
                  </span>
                </label>

                <label className="flex items-start gap-3 rounded-xl border border-gray-200 dark:border-gray-700 p-3 cursor-pointer">
                  <input type="checkbox" checked={replaceExisting} onChange={e => setReplaceExisting(e.target.checked)} className="mt-1" />
                  <span><span className="block text-sm font-semibold">Replace existing furnishings in {selectedRoom?.name}</span>
                    <span className="text-xs text-gray-500">Off by default. {selectedRoom ? furnishingsInRoom(shapes, selectedRoom, rooms).length : 0} existing furniture items in this room. Walls, doors and windows are kept.</span></span>
                </label>
                <button onClick={enqueue} disabled={!selectedRoom || busy} className="w-full rounded-xl border border-polyform-blue text-polyform-blue py-3 text-sm font-bold disabled:opacity-50">
                  {queue.some(item => item.roomId === roomId) ? 'Update queued room' : `Add ${selectedRoom?.name ?? 'room'} to queue`}
                </button>
                <section className="space-y-2 rounded-xl border border-gray-200 dark:border-gray-700 p-3" aria-label="Furnishing queue">
                  <h3 className="text-sm font-semibold">Furnishing queue · {queue.length} rooms</h3>
                  {!queue.length && <p className="text-xs text-gray-500">Choose a room and preset, add it, then repeat on any floor. Apply when ready.</p>}
                  {queue.map(item => <div key={item.roomId} className="flex items-center gap-2 text-xs py-1">
                    <button onClick={() => selectRoom(item.roomId)} className="flex-1 text-left text-polyform-blue underline underline-offset-2">
                      {rooms.find(room => room.id === item.roomId)?.name ?? 'Room no longer exists'} · Level {rooms.find(room => room.id === item.roomId)?.level ?? '?'} · {PRESETS.find(option => option.id === item.preset)?.label} · {item.replaceExisting ? 'replace furniture' : 'keep existing'}
                    </button>
                    <button aria-label={`Remove ${rooms.find(room => room.id === item.roomId)?.name ?? 'room'} from queue`} onClick={() => setQueue(previous => previous.filter(entry => entry.roomId !== item.roomId))} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"><X size={14} /></button>
                  </div>)}
                  <button onClick={furnish} disabled={!queue.length || busy} className="w-full rounded-xl bg-polyform-blue text-white py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                    {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Apply {queue.length || ''} queued rooms
                  </button>
                </section>
                </div>
                </div>
              </>
            )}

            {message && (
              <div className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 p-3 text-xs text-blue-800 dark:text-blue-200">
                {message}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
