import * as THREE from 'three';
import { useEffect, useRef, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import type { Shape, WalkModePhase } from '../../types';
import { buildCollisionWorld, disposeCollisionWorld, type CollisionWorld } from '../../lib/walkMode/collisionWorld';
import { checkCapsuleFits, createPlayerState, stepPlayer, type PlayerState } from '../../lib/walkMode/playerPhysics';
import {
  EYE_HEIGHT,
  WALK_FOV,
  WALK_NEAR,
  REBUILD_DEBOUNCE_MS,
  LOCK_LOSS_CLASSIFY_DELAY_MS,
  RECENT_BLUR_WINDOW_MS,
  STEP_UP_SMOOTH_MS,
  TOUCH_LOOK_DEG_PER_PX,
  SPRINT_MULTIPLIER,
} from '../../lib/walkMode/constants';
import { lockLossClassifier } from '../../lib/walkMode/lockLossClassifier';
import type { WalkBridge } from '../../lib/walkMode/inputState';
import { isFloorSurface, extractYawFromQuaternion } from '../../lib/portalNavigation';

interface SavedCameraState {
  fov: number;
  near: number;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

import { isTouchOnlyDevice } from '../../lib/walkMode/deviceDetection';

interface WalkModeControllerProps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  gl: THREE.WebGLRenderer;
  shapes: Shape[];
  floorEnabled: boolean;
  phase: WalkModePhase;
  setPhase: (phase: WalkModePhase) => void;
  movementSpeed: number;
  mouseSensitivity: number;
  bridge: WalkBridge;
  onExit: () => void;
  onToast?: (msg: string) => void;
}

const _touchLookEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const PITCH_LIMIT = Math.PI / 2 - 0.01;

/**
 * Owns Walk Mode end-to-end while `activeTool === 'walk'`: builds/rebuilds
 * the collision world, runs the placing -> walking -> paused state machine
 * (spec §5), drives PointerLockControls and the physics loop, and restores
 * the camera/tool on exit. Deliberately self-contained (its own native
 * listeners on gl.domElement, not Viewport's existing pointer/keyboard
 * dispatch) per spec §7.7's "keep Viewport changes small" instruction.
 */
export default function WalkModeController({
  scene,
  camera,
  gl,
  shapes,
  floorEnabled,
  phase,
  setPhase,
  movementSpeed,
  mouseSensitivity,
  bridge,
  onExit,
  onToast,
}: WalkModeControllerProps) {
  const collisionWorldRef = useRef<CollisionWorld | null>(null);
  const playerStateRef = useRef<PlayerState | null>(null);
  const controlsRef = useRef<PointerLockControls | null>(null);
  const savedCameraRef = useRef<SavedCameraState | null>(null);
  const phaseRef = useRef<WalkModePhase>(phase);
  const recentBlurRef = useRef(0);
  const rebuildTimeoutRef = useRef<number | null>(null);
  const hoverRef = useRef<{ point: THREE.Vector3; valid: boolean } | null>(null);
  const markerRef = useRef<THREE.Mesh>(null);
  const markerMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const exitingRef = useRef(false);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const restoreCamera = useCallback(() => {
    const saved = savedCameraRef.current;
    if (saved) {
      camera.fov = saved.fov;
      camera.near = saved.near;
      camera.updateProjectionMatrix();
    }
    savedCameraRef.current = null;
  }, [camera]);

  const exitWalkMode = useCallback(() => {
    if (exitingRef.current) return;
    exitingRef.current = true;
    controlsRef.current?.unlock();
    restoreCamera();
    setPhase('inactive');
    onExit();
  }, [onExit, restoreCamera, setPhase]);

  // --- Collision world: initial build (deferred one rAF so "Preparing Walk
  // Mode..." actually gets a chance to paint before the synchronous build
  // work - see WalkModeOverlay), then debounced rebuilds while active.
  useEffect(() => {
    setPhase('preparing');
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      let world: CollisionWorld | null = null;
      let buildFailed = false;
      try {
        world = buildCollisionWorld(scene, shapes, floorEnabled);
      } catch (err) {
        // A malformed/unsupported shape's geometry shouldn't hard-lock the
        // UI on "Preparing Walk Mode..." forever - bail out to the
        // previous tool the same way "nothing to walk on" does.
        console.error('[WalkMode] Failed to build collision world:', err);
        buildFailed = true;
      }
      collisionWorldRef.current = world;
      bridge.buildInfo = world ? { triangleCount: world.triangleCount, buildTimeMs: world.buildTimeMs } : null;
      if (!world) {
        onToast?.(buildFailed ? 'Walk Mode could not be started for this model.' : 'Walk Mode needs a floor or some architecture to walk on.');
        setPhase('inactive');
        onExit();
        return;
      }
      setPhase('placing');
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      disposeCollisionWorld(collisionWorldRef.current);
      collisionWorldRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phaseRef.current === 'inactive' || phaseRef.current === 'preparing') return;
    if (rebuildTimeoutRef.current) window.clearTimeout(rebuildTimeoutRef.current);
    rebuildTimeoutRef.current = window.setTimeout(() => {
      let world: CollisionWorld | null = null;
      try {
        world = buildCollisionWorld(scene, shapes, floorEnabled);
      } catch (err) {
        console.error('[WalkMode] Failed to rebuild collision world:', err);
        // Keep the previous (still-disposed-free) world rather than
        // leaving the player with no collision at all.
        return;
      }
      disposeCollisionWorld(collisionWorldRef.current);
      collisionWorldRef.current = world;
      bridge.buildInfo = world ? { triangleCount: world.triangleCount, buildTimeMs: world.buildTimeMs } : null;
    }, REBUILD_DEBOUNCE_MS);
    return () => {
      if (rebuildTimeoutRef.current) window.clearTimeout(rebuildTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapes, floorEnabled]);

  // --- Input state lifecycle (keyboard move/jump) - lives for the whole
  // mounted session, harmless while 'placing'/'preparing' since nothing
  // reads it until 'walking'.
  useEffect(() => {
    const cleanup = bridge.inputState.attach();
    return () => {
      cleanup();
      bridge.inputState.reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- PointerLockControls setup/teardown for the whole session.
  useEffect(() => {
    const controls = new PointerLockControls(camera, gl.domElement);
    controlsRef.current = controls;

    const onLock = () => {
      if (phaseRef.current === 'paused') setPhase('walking');
    };
    const onUnlock = () => {
      window.setTimeout(() => {
        if (phaseRef.current !== 'walking' && phaseRef.current !== 'paused') return;
        const outcome = lockLossClassifier({
          hasFocus: document.hasFocus(),
          hidden: document.hidden,
          blurredWithinMs: performance.now() - recentBlurRef.current < RECENT_BLUR_WINDOW_MS,
        });
        if (outcome === 'pause') {
          setPhase('paused');
        } else {
          exitWalkMode();
        }
      }, LOCK_LOSS_CLASSIFY_DELAY_MS);
    };
    const onBlur = () => {
      recentBlurRef.current = performance.now();
    };

    controls.addEventListener('lock', onLock);
    controls.addEventListener('unlock', onUnlock);
    window.addEventListener('blur', onBlur);

    bridge.requestResume = () => {
      if (!isTouchOnlyDevice()) {
        try {
          controls.lock();
        } catch {
          setPhase('walking');
        }
      } else {
        setPhase('walking');
      }
    };
    bridge.requestExit = () => exitWalkMode();

    return () => {
      controls.removeEventListener('lock', onLock);
      controls.removeEventListener('unlock', onUnlock);
      window.removeEventListener('blur', onBlur);
      controls.dispose();
      controlsRef.current = null;
      bridge.requestResume = null;
      bridge.requestExit = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (controlsRef.current) controlsRef.current.pointerSpeed = mouseSensitivity;
  }, [mouseSensitivity]);

  // --- Escape while not pointer-locked yet (placing) or already paused:
  // the browser only auto-unlocks when a lock is actually held, so this
  // covers the two phases where that mechanism doesn't apply.
  useEffect(() => {
    if (phase !== 'placing' && phase !== 'paused') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitWalkMode();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase, exitWalkMode]);

  // --- Placement: hover + click while 'placing'.
  useEffect(() => {
    if (phase !== 'placing') return;
    const dom = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    const raycastAt = (clientX: number, clientY: number) => {
      const world = collisionWorldRef.current;
      if (!world) return null;
      const rect = dom.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hit = world.bvh.raycastFirst(raycaster.ray, THREE.DoubleSide);
      if (!hit || !hit.face || !isFloorSurface(hit.face.normal)) return null;
      const valid = checkCapsuleFits(world.bvh, hit.point);
      return { point: hit.point.clone(), valid };
    };

    const onMove = (e: PointerEvent) => {
      hoverRef.current = raycastAt(e.clientX, e.clientY);
    };

    const onClick = (e: MouseEvent) => {
      const hit = raycastAt(e.clientX, e.clientY);
      if (!hit || !hit.valid) return;

      const world = collisionWorldRef.current;
      if (!world) return;

      playerStateRef.current = createPlayerState(hit.point.clone());
      savedCameraRef.current = {
        fov: camera.fov,
        near: camera.near,
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
      };
      const yaw = extractYawFromQuaternion(camera.quaternion);
      camera.fov = WALK_FOV;
      camera.near = WALK_NEAR;
      camera.updateProjectionMatrix();
      camera.position.set(hit.point.x, hit.point.y + EYE_HEIGHT, hit.point.z);
      camera.quaternion.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));

      setPhase('walking');
      if (!isTouchOnlyDevice()) {
        try {
          controlsRef.current?.lock();
        } catch (err) {
          console.warn('[WalkMode] Initial pointer lock failed:', err);
        }
      }
    };

    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('click', onClick);
    return () => {
      hoverRef.current = null;
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('click', onClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // --- Walking phase desktop interaction:
  // 1. If canvas is clicked while walking and pointer is unlocked, re-lock.
  // 2. Fallback pointer drag-to-look if pointer lock is not currently held.
  useEffect(() => {
    if (phase !== 'walking') return;
    const dom = gl.domElement;
    let isDragging = false;
    let lastX = 0;
    let lastY = 0;

    const onWalkingClick = () => {
      if (!isTouchOnlyDevice() && controlsRef.current && !controlsRef.current.isLocked) {
        try {
          controlsRef.current.lock();
        } catch (err) {
          console.warn('[WalkMode] Pointer lock on click failed:', err);
        }
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      isDragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    };

    const onPointerMove = (e: PointerEvent) => {
      // If pointer is locked, PointerLockControls handles mouse look natively on document mousemove
      if (controlsRef.current?.isLocked) return;
      if (isDragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        bridge.inputState.addLookDelta(dx, dy);
      }
    };

    const onPointerUp = () => {
      isDragging = false;
    };

    dom.addEventListener('click', onWalkingClick);
    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    return () => {
      dom.removeEventListener('click', onWalkingClick);
      dom.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [phase, gl.domElement, bridge]);

  // --- Per-frame: placement marker while placing, physics + camera while walking.
  useFrame((_, rawDt) => {
    if (phase === 'placing') {
      const marker = markerRef.current;
      const mat = markerMaterialRef.current;
      const hover = hoverRef.current;
      if (!marker || !mat) return;
      if (!hover) {
        marker.visible = false;
        return;
      }
      marker.visible = true;
      marker.position.copy(hover.point).addScaledVector(new THREE.Vector3(0, 1, 0), 0.02);
      mat.color.set(hover.valid ? '#22c55e' : '#ef4444');
      return;
    }

    if (phase !== 'walking') return;
    const world = collisionWorldRef.current;
    const playerState = playerStateRef.current;
    if (!world || !playerState) return;

    // Touch/manual look (native mousemove-driven PointerLockControls
    // handles desktop look on its own via `pointerSpeed`).
    const { dx, dy } = bridge.inputState.getAndClearLookDelta();
    if (dx !== 0 || dy !== 0) {
      _touchLookEuler.setFromQuaternion(camera.quaternion);
      _touchLookEuler.y -= dx * TOUCH_LOOK_DEG_PER_PX * (Math.PI / 180) * mouseSensitivity;
      _touchLookEuler.x -= dy * TOUCH_LOOK_DEG_PER_PX * (Math.PI / 180) * mouseSensitivity;
      _touchLookEuler.x = THREE.MathUtils.clamp(_touchLookEuler.x, -PITCH_LIMIT, PITCH_LIMIT);
      camera.quaternion.setFromEuler(_touchLookEuler);
    }

    // Enforce pitch limits across both native PointerLockControls and manual look
    _touchLookEuler.setFromQuaternion(camera.quaternion);
    if (_touchLookEuler.x < -PITCH_LIMIT || _touchLookEuler.x > PITCH_LIMIT) {
      _touchLookEuler.x = THREE.MathUtils.clamp(_touchLookEuler.x, -PITCH_LIMIT, PITCH_LIMIT);
      camera.quaternion.setFromEuler(_touchLookEuler);
    }

    const move = bridge.inputState.getMove();
    const jumpRequested = bridge.inputState.consumeJumpPressed();
    const cameraYaw = extractYawFromQuaternion(camera.quaternion);
    const speed = bridge.inputState.isSprinting() ? movementSpeed * SPRINT_MULTIPLIER : movementSpeed;

    stepPlayer(
      playerState,
      { move, jumpRequested, cameraYaw, speed },
      rawDt,
      world.bvh,
      { min: world.bounds.min, max: world.bounds.max }
    );

    // Ease the step-up camera offset back toward 0 (spec §7.5 step 5).
    const tau = STEP_UP_SMOOTH_MS / 1000;
    const t = 1 - Math.exp(-rawDt / tau);
    playerState.cameraYOffset *= 1 - t;

    camera.position.set(playerState.feet.x, playerState.feet.y + EYE_HEIGHT + playerState.cameraYOffset, playerState.feet.z);
  });

  return (
    <mesh ref={markerRef} rotation={[-Math.PI / 2, 0, 0]} visible={false} raycast={() => {}}>
      <ringGeometry args={[0.25, 0.32, 32]} />
      <meshBasicMaterial ref={markerMaterialRef} color="#22c55e" toneMapped={false} depthTest={false} depthWrite={false} transparent opacity={0.9} side={THREE.DoubleSide} />
    </mesh>
  );
}
