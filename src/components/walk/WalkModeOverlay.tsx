import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../AppContext';
import { TOUCH_JOYSTICK_RADIUS_PX, TOUCH_JOYSTICK_DEADZONE, HUD_FADE_MS } from '../../lib/walkMode/constants';
import { useIsTouchOnlyDevice } from '../../lib/walkMode/deviceDetection';

/**
 * The DOM half of Walk Mode (spec §5.1/§5.4): a plain sibling of the R3F
 * <Canvas>, so it talks to WalkModeController purely through the shared
 * `walkBridgeRef` (see that ref's own doc comment) rather than props -
 * these are two different React trees.
 */
export default function WalkModeOverlay() {
  const { walkModePhase, walkBridgeRef } = useApp();
  const bridge = walkBridgeRef.current;
  const [hudVisible, setHudVisible] = useState(true);
  const hudTimerRef = useRef<number | null>(null);
  const isTouchDevice = useIsTouchOnlyDevice();

  useEffect(() => {
    if (walkModePhase !== 'walking') {
      setHudVisible(true);
      return;
    }
    setHudVisible(true);
    if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
    hudTimerRef.current = window.setTimeout(() => setHudVisible(false), HUD_FADE_MS);
    return () => {
      if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
    };
  }, [walkModePhase]);

  if (walkModePhase === 'inactive') return null;

  return (
    <div className="absolute inset-0 z-[900]" style={{ pointerEvents: 'none' }}>
      {walkModePhase === 'preparing' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-auto">
          <div className="bg-gray-900 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-xl border border-gray-700">
            Preparing Walk Mode...
          </div>
        </div>
      )}

      {walkModePhase === 'placing' && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2">
          <div className="bg-gray-900/90 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-xl border border-gray-700 text-center">
            Click a spot on the floor to start walking
          </div>
        </div>
      )}

      {walkModePhase === 'walking' && !isTouchDevice && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-1.5 h-1.5 rounded-full bg-white/70 shadow-[0_0_2px_rgba(0,0,0,0.8)]" />
        </div>
      )}

      {walkModePhase === 'walking' && hudVisible && !isTouchDevice && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
          <div className="bg-gray-900/80 text-white text-xs px-3 py-1.5 rounded-lg shadow-lg border border-gray-700 text-center">
            WASD to move · Mouse to look · Space to jump · Esc to exit
          </div>
        </div>
      )}

      {walkModePhase === 'paused' && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-auto cursor-pointer"
          onClick={() => bridge.requestResume?.()}
        >
          <div className="bg-gray-900 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-xl border border-gray-700">
            Click to resume walking
          </div>
        </div>
      )}

      {walkModePhase === 'walking' && isTouchDevice && <TouchControls bridge={bridge} />}
    </div>
  );
}

function TouchControls({ bridge }: { bridge: ReturnType<typeof useApp>['walkBridgeRef']['current'] }) {
  const joystickBaseRef = useRef<HTMLDivElement>(null);
  const [knobOffset, setKnobOffset] = useState({ x: 0, y: 0 });
  const activeJoystickTouchRef = useRef<number | null>(null);
  const activeLookTouchRef = useRef<{ id: number; x: number; y: number } | null>(null);

  const handleJoystickStart = (e: React.TouchEvent) => {
    const touch = e.changedTouches[0];
    activeJoystickTouchRef.current = touch.identifier;
    updateJoystick(touch.clientX, touch.clientY);
  };

  const updateJoystick = (clientX: number, clientY: number) => {
    const base = joystickBaseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, TOUCH_JOYSTICK_RADIUS_PX);
    if (dist > 0) {
      dx = (dx / dist) * clamped;
      dy = (dy / dist) * clamped;
    }
    setKnobOffset({ x: dx, y: dy });
    const magnitude = clamped / TOUCH_JOYSTICK_RADIUS_PX;
    if (magnitude < TOUCH_JOYSTICK_DEADZONE) {
      bridge.inputState.setTouchMove(0, 0, 0);
    } else {
      // Screen up (-dy) is forward (+z); screen right (+dx) is strafe right (+x).
      bridge.inputState.setTouchMove(dx / TOUCH_JOYSTICK_RADIUS_PX, -dy / TOUCH_JOYSTICK_RADIUS_PX, magnitude);
    }
  };

  const handleJoystickMove = (e: React.TouchEvent) => {
    for (const touch of Array.from(e.changedTouches)) {
      if (touch.identifier === activeJoystickTouchRef.current) {
        updateJoystick(touch.clientX, touch.clientY);
      }
    }
  };

  const endJoystick = (e: React.TouchEvent) => {
    for (const touch of Array.from(e.changedTouches)) {
      if (touch.identifier === activeJoystickTouchRef.current) {
        activeJoystickTouchRef.current = null;
        setKnobOffset({ x: 0, y: 0 });
        bridge.inputState.setTouchMove(0, 0, 0);
      }
    }
  };

  const handleLookStart = (e: React.TouchEvent) => {
    const touch = e.changedTouches[0];
    activeLookTouchRef.current = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
  };

  const handleLookMove = (e: React.TouchEvent) => {
    const active = activeLookTouchRef.current;
    if (!active) return;
    for (const touch of Array.from(e.changedTouches)) {
      if (touch.identifier === active.id) {
        const dx = touch.clientX - active.x;
        const dy = touch.clientY - active.y;
        active.x = touch.clientX;
        active.y = touch.clientY;
        bridge.inputState.addLookDelta(dx, dy);
      }
    }
  };

  const handleLookEnd = (e: React.TouchEvent) => {
    const active = activeLookTouchRef.current;
    if (!active) return;
    for (const touch of Array.from(e.changedTouches)) {
      if (touch.identifier === active.id) activeLookTouchRef.current = null;
    }
  };

  return (
    <>
      {/* Look area: the whole right two-thirds of the screen (excluding the
          joystick's own corner) is a drag-to-look surface. */}
      <div
        className="absolute inset-0 right-0"
        style={{ pointerEvents: 'auto' }}
        onTouchStart={handleLookStart}
        onTouchMove={handleLookMove}
        onTouchEnd={handleLookEnd}
        onTouchCancel={handleLookEnd}
      />

      <div
        ref={joystickBaseRef}
        className="absolute bottom-8 left-8 w-[120px] h-[120px] rounded-full bg-white/10 border border-white/30"
        style={{ pointerEvents: 'auto' }}
        onTouchStart={handleJoystickStart}
        onTouchMove={handleJoystickMove}
        onTouchEnd={endJoystick}
        onTouchCancel={endJoystick}
      >
        <div
          className="absolute w-12 h-12 rounded-full bg-white/40 border border-white/60"
          style={{
            left: `calc(50% + ${knobOffset.x}px - 24px)`,
            top: `calc(50% + ${knobOffset.y}px - 24px)`,
          }}
        />
      </div>

      <button
        className="absolute bottom-8 right-8 w-16 h-16 rounded-full bg-white/15 border border-white/40 text-white text-xs font-semibold"
        style={{ pointerEvents: 'auto' }}
        onTouchStart={(e) => {
          e.stopPropagation();
          bridge.inputState.queueJump();
        }}
      >
        Jump
      </button>

      <button
        className="absolute top-6 right-6 px-3 py-1.5 rounded-lg bg-white/15 border border-white/40 text-white text-xs font-semibold"
        style={{ pointerEvents: 'auto' }}
        onTouchStart={(e) => {
          e.stopPropagation();
          bridge.requestExit?.();
        }}
      >
        Exit
      </button>
    </>
  );
}
