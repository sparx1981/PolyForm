import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';

/**
 * Fits the sun's shadow camera to what is being looked at, every frame.
 *
 * A directional light's shadow only covers its own small orthographic box (three's default is
 * 10 m x 10 m around the light's target), so everything outside that square was left unshadowed.
 * Here the box follows the view: it is centred on the orbit target (or just ahead of the walker)
 * and sized to the viewing distance, so near views get crisp shadows and far views still shadow
 * the whole visible model. The sun's direction is unchanged (light position minus the origin,
 * as before); only where along that direction the light sits moves.
 *
 * The box is snapped to whole shadow-map texels and its size to fixed steps, so shadows do not
 * crawl or shimmer as the camera moves.
 */
export interface SunShadowRigProps {
  lightRef: React.MutableRefObject<THREE.DirectionalLight>;
  /** The sun's position; its direction from the origin is the light direction. */
  sunPosition: [number, number, number];
  enabled: boolean;
  walking: boolean;
}

const MIN_RADIUS = 12;
const MAX_RADIUS = 260;
const WALK_RADIUS = 45;

const direction = new THREE.Vector3();
const centre = new THREE.Vector3();
const forward = new THREE.Vector3();
const lightSpace = new THREE.Matrix4();
const lightSpaceInverse = new THREE.Matrix4();
const local = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ALT_UP = new THREE.Vector3(0, 0, 1);
const ORIGIN = new THREE.Vector3();

/** Radius in fixed ~20% steps, so zooming does not rescale the shadow map continuously. */
export function quantizeShadowRadius(radius: number): number {
  const clamped = THREE.MathUtils.clamp(radius, MIN_RADIUS, MAX_RADIUS);
  const step = Math.log(1.2);
  return Math.min(MAX_RADIUS, Math.exp(Math.ceil(Math.log(clamped) / step) * step));
}

export function SunShadowRig({ lightRef, sunPosition, enabled, walking }: SunShadowRigProps) {
  const { scene, gl } = useThree();
  const mapSize = useMemo(() => Math.min(4096, gl.capabilities.maxTextureSize || 2048), [gl]);

  useEffect(() => {
    const light = lightRef.current;
    if (!light) return;
    // The target must be in the scene for its world matrix to update.
    scene.add(light.target);
    return () => { scene.remove(light.target); };
  }, [scene, lightRef]);

  useEffect(() => {
    const light = lightRef.current;
    if (!light || !enabled) return;
    const shadow = light.shadow;
    if (shadow.mapSize.x !== mapSize) {
      shadow.mapSize.set(mapSize, mapSize);
      shadow.map?.dispose();
      shadow.map = null;
    }
    shadow.radius = 2.5;
    shadow.blurSamples = 12;
  }, [lightRef, enabled, mapSize]);

  useFrame(({ camera }) => {
    const light = lightRef.current;
    if (!light) return;
    direction.set(sunPosition[0], sunPosition[1], sunPosition[2]);
    if (direction.lengthSq() < 1e-8) direction.set(0.5, 1, 0.3);
    direction.normalize();

    // What the viewer is looking at.
    const controls = (scene.userData.controls as { target?: THREE.Vector3 } | undefined);
    let radius: number;
    if (walking || !controls?.target) {
      camera.getWorldDirection(forward).setY(0);
      if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
      forward.normalize();
      radius = WALK_RADIUS;
      centre.copy(camera.position).addScaledVector(forward, radius * 0.45);
    } else {
      const distance = camera.position.distanceTo(controls.target);
      radius = distance * 1.4;
      // Lean the box toward the camera: near ground fills more of the screen than far ground.
      centre.copy(controls.target).lerp(camera.position, 0.25);
    }
    const orthographic = (camera as THREE.OrthographicCamera).isOrthographicCamera;
    if (orthographic) {
      const ortho = camera as THREE.OrthographicCamera;
      radius = Math.max(radius, (ortho.right - ortho.left) / ortho.zoom * 0.75);
    }
    radius = quantizeShadowRadius(radius);

    // Snap the centre to whole texels in the light's own frame.
    const texel = (2 * radius) / light.shadow.mapSize.x;
    lightSpace.lookAt(direction, ORIGIN, Math.abs(direction.y) > 0.99 ? ALT_UP : UP);
    lightSpaceInverse.copy(lightSpace).invert();
    local.copy(centre).applyMatrix4(lightSpaceInverse);
    local.x = Math.round(local.x / texel) * texel;
    local.y = Math.round(local.y / texel) * texel;
    centre.copy(local.applyMatrix4(lightSpace));

    const lift = radius * 2 + 60;
    light.position.copy(centre).addScaledVector(direction, lift);
    light.target.position.copy(centre);
    light.target.updateMatrixWorld();

    const shadowCamera = light.shadow.camera as THREE.OrthographicCamera;
    if (shadowCamera.right !== radius || shadowCamera.far !== lift + radius * 2) {
      shadowCamera.left = -radius; shadowCamera.right = radius;
      shadowCamera.top = radius; shadowCamera.bottom = -radius;
      shadowCamera.near = 0.5;
      shadowCamera.far = lift + radius * 2;
      shadowCamera.updateProjectionMatrix();
    }
    // Depth bias scales with the texel size so large views don't acne and close views don't peter-pan.
    light.shadow.bias = -0.0003;
    light.shadow.normalBias = texel * 1.5;
  });

  return null;
}
