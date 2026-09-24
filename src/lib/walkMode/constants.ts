import { PORTAL_EYE_HEIGHT } from '../portalNavigation';

/** Reuses Portal Navigation's standing eye height so the two features agree on where "standing" puts your eyes (spec §7.4). */
export const EYE_HEIGHT = PORTAL_EYE_HEIGHT;

export const PLAYER_HEIGHT = 1.75; // top of capsule
export const CAPSULE_RADIUS = 0.3; // fits standard 0.9m doorways with room to spare
export const MAX_STEP_HEIGHT = 0.3; // staircase riser ~0.18m, single step ~0.18m

export const GRAVITY = 20; // m/s^2 - real 9.81 feels floaty in first person
export const JUMP_SPEED = 5.5; // m/s, apex ~= 0.75m
export const GROUND_ACCEL = 12; // /s, exponential approach to target velocity
export const GROUND_DAMPING = 10; // /s, exponential decay of x/z when no input
export const AIR_CONTROL = 0.3; // multiplier on accel while airborne
export const SPRINT_MULTIPLIER = 1.6; // multiplies Movement Speed while Shift is held

// Crouch (hold C): a shorter capsule so the player fits under low obstacles, lower eyes, slower walk.
export const CROUCH_HEIGHT = 1.1; // top of capsule while crouched
export const CROUCH_EYE_HEIGHT = 0.95;
export const CROUCH_SPEED_MULTIPLIER = 0.45;
export const CROUCH_TRANSITION_MS = 110; // eye height easing between standing and crouched

export const PHYSICS_SUBSTEPS = 5;
export const MAX_FRAME_DT = 0.05; // seconds, clamp to avoid tunnelling after a hitch/tab-switch
export const FALL_RESPAWN_DEPTH = 10; // meters below bounds.min.y before respawning

// Camera framing while walking (spec §7.3 / §13.4).
export const WALK_FOV = 60;
export const WALK_NEAR = 0.05;

// Collision-world rebuild debounce when shapes change mid-walk (spec §7.2).
export const REBUILD_DEBOUNCE_MS = 500;

// How long the "Preparing Walk Mode..." message must be shown for before we
// consider the BVH build slow enough to bother the user with it (spec §5.2.1).
export const SLOW_BUILD_THRESHOLD_MS = 150;

// ESC-vs-pause classification timing (spec §7.6).
export const LOCK_LOSS_CLASSIFY_DELAY_MS = 150;
export const RECENT_BLUR_WINDOW_MS = 300;

// HUD auto-fade while walking (spec §5.1).
export const HUD_FADE_MS = 4000;

// Step-up camera-Y smoothing (spec §7.5 step 5).
export const STEP_UP_SMOOTH_MS = 80;

export interface WalkSettingRange {
  min: number;
  max: number;
  step: number;
  default: number;
  storageKey: string;
}

export const MOVEMENT_SPEED_RANGE: WalkSettingRange = {
  min: 0.5,
  max: 8.0,
  step: 0.1,
  default: 2.5,
  storageKey: 'polyform_walk_speed',
};

export const MOUSE_SENSITIVITY_RANGE: WalkSettingRange = {
  min: 0.2,
  max: 3.0,
  step: 0.1,
  default: 1.0,
  storageKey: 'polyform_walk_sensitivity',
};

/** Degrees-per-pixel base rate for touch look, multiplied by Mouse Sensitivity (spec §5.4). */
export const TOUCH_LOOK_DEG_PER_PX = 0.25;

export const TOUCH_JOYSTICK_RADIUS_PX = 60; // 120px base / 2
export const TOUCH_JOYSTICK_KNOB_PX = 48;
export const TOUCH_JOYSTICK_DEADZONE = 0.12; // fraction of radius
