/** Normalized movement intent: x = strafe (+right), z = forward (+forward), magnitude 0..1 for analog (touch) input. */
export interface MoveIntent {
  x: number;
  z: number;
  magnitude: number;
}

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyC']);

/**
 * Combines keyboard state and touch joystick/look state into one
 * source-agnostic move intent + jump/look-delta API, so the physics loop
 * (playerPhysics.ts) and desktop/touch input don't need to know about each
 * other (spec §7.1, keeping this input-source agnostic is also what would
 * let a P2 gamepad feed the same shape later).
 *
 * Deliberately framework/WebGL-free so it can be constructed and driven in
 * plain unit tests if needed, though its own tests live at the physics
 * layer since it's mostly event plumbing.
 */
export class WalkInputState {
  private keys = new Set<string>();
  private jumpQueued = false;
  private touchCrouch = false;
  private touchMove: MoveIntent = { x: 0, z: 0, magnitude: 0 };
  private lookDelta = { dx: 0, dy: 0 };
  private listenersAttached = false;

  private handleKeyDown = (e: KeyboardEvent) => {
    if (!MOVE_KEYS.has(e.code)) return;
    e.preventDefault();
    this.keys.add(e.code);
    if (e.code === 'Space') this.jumpQueued = true;
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    if (!MOVE_KEYS.has(e.code)) return;
    e.preventDefault();
    this.keys.delete(e.code);
  };

  private handleClear = () => {
    this.keys.clear();
  };

  /** Attaches window-level keyboard listeners; call the returned cleanup on unmount/exit. */
  attach(): () => void {
    if (this.listenersAttached) return () => {};
    this.listenersAttached = true;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleClear);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.handleClear();
    });
    return () => {
      window.removeEventListener('keydown', this.handleKeyDown);
      window.removeEventListener('keyup', this.handleKeyUp);
      window.removeEventListener('blur', this.handleClear);
      this.listenersAttached = false;
    };
  }

  /** Called by WalkModeOverlay's joystick handler with the current analog stick vector (each component -1..1, magnitude already clamped to 0..1). */
  setTouchMove(x: number, z: number, magnitude: number) {
    this.touchMove = { x, z, magnitude };
  }

  /** Called by WalkModeOverlay's look-drag handler; accumulated and drained once per frame by the controller. */
  addLookDelta(dx: number, dy: number) {
    this.lookDelta.dx += dx;
    this.lookDelta.dy += dy;
  }

  getAndClearLookDelta(): { dx: number; dy: number } {
    const d = this.lookDelta;
    this.lookDelta = { dx: 0, dy: 0 };
    return d;
  }

  /** Diagonal keyboard input is normalized to a unit vector so diagonal movement isn't faster (spec §5.3). Touch input already reports an analog magnitude. */
  getMove(): MoveIntent {
    let kx = 0;
    let kz = 0;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) kx += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) kx -= 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) kz += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) kz -= 1;

    if (kx !== 0 || kz !== 0) {
      const len = Math.hypot(kx, kz);
      return { x: kx / len, z: kz / len, magnitude: 1 };
    }
    if (this.touchMove.magnitude > 0) return this.touchMove;
    return { x: 0, z: 0, magnitude: 0 };
  }

  /** True at most once per Space press / jump-button tap; consuming it clears it. */
  consumeJumpPressed(): boolean {
    if (this.keys.has('Space')) {
      // Held keys keep re-triggering consumeJumpPressed every frame
      // otherwise - only fire once per press by removing it immediately,
      // the same one-shot behavior a "queued" flag gives touch taps.
      this.keys.delete('Space');
      return true;
    }
    if (this.jumpQueued) {
      this.jumpQueued = false;
      return true;
    }
    return false;
  }

  /** Called by the touch Jump button. */
  queueJump() {
    this.jumpQueued = true;
  }

  /** True while C is held or the touch Crouch button is on - crouch. */
  isCrouching(): boolean {
    return this.keys.has('KeyC') || this.touchCrouch;
  }

  /** Called by the touch Crouch button (a toggle: holding a button while steering is awkward). */
  toggleTouchCrouch() {
    this.touchCrouch = !this.touchCrouch;
    return this.touchCrouch;
  }

  /** True while either Shift key is held - sprint (spec follow-up: hold Shift to sprint). */
  isSprinting(): boolean {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  reset() {
    this.keys.clear();
    this.jumpQueued = false;
    this.touchCrouch = false;
    this.touchMove = { x: 0, z: 0, magnitude: 0 };
    this.lookDelta = { dx: 0, dy: 0 };
  }
}

/**
 * The communication channel between WalkModeController (mounted inside
 * the R3F <Canvas>, owns the camera/pointer-lock/physics) and
 * WalkModeOverlay (a plain DOM sibling of the canvas that renders the
 * HUD/pause screen/touch controls) - these are two different React trees
 * that can't pass props to each other directly. Held as a single stable
 * ref on AppContext (see `walkBridgeRef`) so neither side needs to
 * re-render just because the other assigned a callback.
 */
export interface WalkBridge {
  inputState: WalkInputState;
  /** Set by WalkModeController while paused; the overlay's "click to resume" handler calls this. */
  requestResume: (() => void) | null;
  /** Set by WalkModeController; the overlay's touch Exit button calls this. */
  requestExit: (() => void) | null;
  buildInfo: { triangleCount: number; buildTimeMs: number } | null;
}

export function createWalkBridge(): WalkBridge {
  return { inputState: new WalkInputState(), requestResume: null, requestExit: null, buildInfo: null };
}
