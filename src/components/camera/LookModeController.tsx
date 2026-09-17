import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

interface LookModeControllerProps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  gl: THREE.WebGLRenderer;
  mouseSensitivity?: number;
  onExit?: () => void;
  onToast?: (msg: string) => void;
}

const PITCH_LIMIT = Math.PI / 2 - 0.01;
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _dir = new THREE.Vector3();

/**
 * LookModeController:
 * Controls camera orientation (pitch & yaw) directly from mouse movement,
 * identical to walk mode's mouse-look but without any player translation,
 * physics, or walking.
 * Supports:
 *  1. Desktop PointerLock on canvas click (free 360° mouse-look)
 *  2. Click-and-drag mouse rotation when not locked
 *  3. Touch-and-drag look for mobile / tablet devices
 *  4. Keeps OrbitControls target updated in front of camera
 */
export default function LookModeController({
  scene,
  camera,
  gl,
  mouseSensitivity = 1.0,
  onExit,
  onToast
}: LookModeControllerProps) {
  const controlsRef = useRef<PointerLockControls | null>(null);
  const isDraggingRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  // Synchronize OrbitControls target so returning to orbit or other tools preserves look vector
  const syncOrbitTarget = () => {
    if (scene.userData.controls && scene.userData.controls.target) {
      camera.getWorldDirection(_dir);
      const targetDist = camera.position.distanceTo(scene.userData.controls.target) || 12;
      scene.userData.controls.target.copy(camera.position).addScaledVector(_dir, targetDist);
    }
  };

  // 1. Initialize PointerLockControls on the canvas
  useEffect(() => {
    const dom = gl.domElement;
    const controls = new PointerLockControls(camera, dom);
    controlsRef.current = controls;
    controls.pointerSpeed = mouseSensitivity;

    const onLock = () => {
      setIsLocked(true);
      if (onToast) onToast('Look Tool: Mouse locked · Move to look around · Esc to release');
    };

    const onUnlock = () => {
      setIsLocked(false);
      syncOrbitTarget();
    };

    controls.addEventListener('lock', onLock);
    controls.addEventListener('unlock', onUnlock);

    // Click on canvas to lock mouse for smooth 360° look
    const handleCanvasClick = (e: MouseEvent) => {
      // Don't lock if user was dragging
      if (isDraggingRef.current) return;
      if (!controls.isLocked) {
        controls.lock();
      }
    };

    dom.addEventListener('click', handleCanvasClick);

    // Fallback: Pointer drag when not pointer locked (or before user clicks to lock)
    const handlePointerDown = (e: PointerEvent) => {
      isDraggingRef.current = true;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (controls.isLocked) {
        // PointerLockControls already updates camera rotation natively; clamp pitch
        _euler.setFromQuaternion(camera.quaternion);
        _euler.x = THREE.MathUtils.clamp(_euler.x, -PITCH_LIMIT, PITCH_LIMIT);
        camera.quaternion.setFromEuler(_euler);
        syncOrbitTarget();
        return;
      }

      if (isDraggingRef.current && lastPointerRef.current) {
        const dx = e.clientX - lastPointerRef.current.x;
        const dy = e.clientY - lastPointerRef.current.y;
        lastPointerRef.current = { x: e.clientX, y: e.clientY };

        _euler.setFromQuaternion(camera.quaternion);
        _euler.y -= dx * 0.0025 * mouseSensitivity;
        _euler.x -= dy * 0.0025 * mouseSensitivity;
        _euler.x = THREE.MathUtils.clamp(_euler.x, -PITCH_LIMIT, PITCH_LIMIT);
        camera.quaternion.setFromEuler(_euler);
        syncOrbitTarget();
      }
    };

    const handlePointerUp = () => {
      isDraggingRef.current = false;
      lastPointerRef.current = null;
      syncOrbitTarget();
    };

    dom.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    // Keyboard shortcuts (Esc to release/exit)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (controls.isLocked) {
          controls.unlock();
        } else if (onExit) {
          onExit();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      controls.removeEventListener('lock', onLock);
      controls.removeEventListener('unlock', onUnlock);
      dom.removeEventListener('click', handleCanvasClick);
      dom.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      window.removeEventListener('keydown', handleKeyDown);
      controls.dispose();
      controlsRef.current = null;
    };
  }, [camera, gl.domElement, mouseSensitivity, onExit, onToast]);

  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.pointerSpeed = mouseSensitivity;
    }
  }, [mouseSensitivity]);

  useFrame(() => {
    // Keep pitch within limits
    _euler.setFromQuaternion(camera.quaternion);
    if (_euler.x < -PITCH_LIMIT || _euler.x > PITCH_LIMIT) {
      _euler.x = THREE.MathUtils.clamp(_euler.x, -PITCH_LIMIT, PITCH_LIMIT);
      camera.quaternion.setFromEuler(_euler);
    }
  });

  return null;
}
