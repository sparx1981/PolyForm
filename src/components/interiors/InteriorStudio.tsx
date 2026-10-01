import { useMemo, useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Armchair, BedDouble, Box, Check, Loader2, Sofa, Sparkles, X } from 'lucide-react';
import { useApp } from '../../AppContext';
import { detectRooms } from '../../lib/spatial/rooms';
import { planRoomFurnishing, type FurnishingPreset } from '../../lib/interiors/smartFurnish';
import { bakeSemanticSimulation } from '../../lib/interiors/bakeSimulation';
import { checkModelHealth } from '../../lib/reconstruction/modelHealth';
import { useModalA11y } from '../ui/useModalA11y';
import { cn } from '../../lib/utils';

const PRESETS: Array<{
  id: FurnishingPreset;
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  { id: 'bedroom', label: 'Bedroom', description: 'Bed, paired bedside tables, wardrobe, console and a reading chair.', icon: <BedDouble size={17} /> },
  { id: 'living-room', label: 'Living room', description: 'Sofa, coffee table, lounge chairs and supporting storage.', icon: <Sofa size={17} /> },
  { id: 'soft-furnishings', label: 'Soft furnishings', description: 'Upholstered seating and draped curtains fitted inside real windows.', icon: <Sparkles size={17} /> },
  { id: 'storage', label: 'Storage', description: 'Three cabinets distributed around available walls.', icon: <Box size={17} /> },
  { id: 'minimal', label: 'Minimal', description: 'One sofa placed conservatively.', icon: <Armchair size={17} /> },
];

export default function InteriorStudio() {
  const { shapes, setShapes } = useApp();
  const [open, setOpen] = useState(false);
  const dialogRef = useModalA11y<HTMLDivElement>(open, () => setOpen(false));
  const [roomId, setRoomId] = useState<string>('');
  const [preset, setPreset] = useState<FurnishingPreset>('bedroom');
  const [settleSoft, setSettleSoft] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('polyform:interior-studio', handler);
    return () => window.removeEventListener('polyform:interior-studio', handler);
  }, []);

  const rooms = useMemo(() => detectRooms(shapes), [shapes]);

  useEffect(() => {
    if (!rooms.length) {
      setRoomId('');
      return;
    }
    if (!roomId || !rooms.some(room => room.id === roomId)) setRoomId(rooms[0].id);
  }, [rooms, roomId]);

  const selectedRoom = rooms.find(room => room.id === roomId);

  const furnish = () => {
    if (!selectedRoom) return;
    setBusy(true);
    setMessage(null);
    try {
      const plan = planRoomFurnishing(shapes, selectedRoom, preset);
      const inserted = settleSoft
        ? plan.shapes.map(shape => {
            const sim = shape.customData?.semanticComponent?.simulation;
            return sim?.bakeable ? bakeSemanticSimulation(shape, sim.type === 'cloth' ? 0.32 : 0.42) : shape;
          })
        : plan.shapes;

      const combined = [...shapes, ...inserted];
      const health = checkModelHealth(combined);
      setShapes(previous => [...previous, ...inserted]);

      const placedLabel = inserted.length === 1 ? '1 item' : `${inserted.length} items`;
      const skipped = plan.unplaced.length
        ? ` ${plan.unplaced.length} item${plan.unplaced.length === 1 ? '' : 's'} could not be placed without a collision.`
        : '';
      setMessage(
        `Placed ${placedLabel} in ${selectedRoom.name ?? `Room ${selectedRoom.level}`}.${skipped} Model health: ${health.errors} errors, ${health.warnings} warnings.`,
      );
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
          className="w-full max-w-3xl max-h-[88vh] overflow-hidden rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl"
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
                <section className="space-y-2">
                  <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">Room</label>
                  <select value={roomId} onChange={e => setRoomId(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
                    {rooms.map((room, index) => (
                      <option key={room.id} value={room.id}>
                        {room.name ?? `Room ${index + 1}`} · Level {room.level} · {room.areaM2.toFixed(1)} m²
                      </option>
                    ))}
                  </select>
                  {selectedRoom && (
                    <p className="text-[11px] text-gray-500">
                      {selectedRoom.boundaryWallIds.length} bounding walls · {selectedRoom.openingIds.length} hosted openings · {selectedRoom.perimeterM.toFixed(1)} m perimeter
                    </p>
                  )}
                </section>

                <section className="space-y-2">
                  <div className="text-xs font-semibold text-gray-600 dark:text-gray-300">Furnishing preset</div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {PRESETS.map(option => (
                      <button key={option.id} onClick={() => setPreset(option.id)}
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
                    <span className="block text-sm font-semibold">Settle soft furnishings</span>
                    <span className="block text-[11px] text-gray-500">Bake a gentle soft-body/cloth settle into beds, sofas and curtains when supported.</span>
                  </span>
                </label>

                <button onClick={furnish} disabled={!selectedRoom || busy}
                  className="w-full rounded-xl bg-polyform-blue text-white py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  Furnish selected room
                </button>
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
