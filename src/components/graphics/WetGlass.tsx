import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useApp } from '../../AppContext';
import { glassWeatherTargets, makeWetGlass, stepGlassWeather, wetGlassUniforms } from '../../lib/graphics/wetGlass';

/** True while the weather puts rain or snow on the glass (windows and doors swap to wet glass). */
export function useGlassWeather(): boolean {
  const { graphicsSettings } = useApp();
  const target = glassWeatherTargets(graphicsSettings.weather);
  return target.rain > 0 || target.snow > 0;
}

/** Advances the shared wet-glass animation towards the current weather. Mount once. */
export function GlassWeatherDriver() {
  const { graphicsSettings } = useApp();
  const target = useMemo(() => glassWeatherTargets(graphicsSettings.weather), [graphicsSettings.weather]);
  const gl = useThree(state => state.gl);
  useFrame((_, delta) => stepGlassWeather(target, Math.min(delta, 0.1)));
  // Dry glass the next time the weather starts, so it wets up again gradually.
  useEffect(() => () => { wetGlassUniforms.uGlassRain.value = 0; wetGlassUniforms.uGlassSnow.value = 0; }, []);
  // The view through wet glass is drops and mist: half resolution is indistinguishable and
  // makes the extra transmission pass about four times cheaper.
  useEffect(() => {
    const previous = gl.transmissionResolutionScale;
    gl.transmissionResolutionScale = 0.5;
    return () => { gl.transmissionResolutionScale = previous; };
  }, [gl]);
  return null;
}

/** Beyond this, drops are sub-pixel: the pane is drawn as plain glass (no transmission pass). */
const NEAR_METRES = 28, FAR_METRES = 34;
const sphere = new THREE.Sphere();

/** Window and door glass with rain or snow on it (see wetGlass.ts). */
export function WetGlassMaterial({ attach, selected }: { attach: string; selected: boolean }) {
  const material = useMemo(() => {
    const glass = makeWetGlass(new THREE.MeshPhysicalMaterial({
      color: '#f1f8fc', roughness: 0.03, metalness: 0, transmission: 1, thickness: 0, ior: 1.5,
      side: THREE.DoubleSide,
    }));
    // Remember which mesh uses it, so its distance can be checked before each frame.
    glass.onBeforeRender = (_renderer, _scene, _camera, _geometry, object) => { glass.userData.object = object; };
    return glass;
  }, []);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    material.emissive.set(selected ? '#0063A3' : '#000000');
    material.emissiveIntensity = selected ? 0.2 : 0;
  }, [material, selected]);

  // Only glass close enough to show its drops pays for the transmission pass; three skips the
  // pass entirely when no transmissive glass is in view.
  useFrame(({ camera }) => {
    const object = material.userData.object as THREE.Mesh | undefined;
    if (!object?.geometry) return;
    let distance: number;
    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      const ortho = camera as THREE.OrthographicCamera;
      distance = (ortho.top - ortho.bottom) / ortho.zoom;
    } else {
      if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere();
      sphere.copy(object.geometry.boundingSphere!).applyMatrix4(object.matrixWorld);
      distance = Math.max(0, camera.position.distanceTo(sphere.center) - sphere.radius);
    }
    const wet = material.transmission > 0;
    const wantWet = wet ? distance < FAR_METRES : distance < NEAR_METRES;
    if (wet === wantWet) return;
    // Far: the plain tinted glass used in dry weather.
    material.transmission = wantWet ? 1 : 0;
    material.transparent = !wantWet;
    material.opacity = wantWet ? 1 : 0.2;
    material.depthWrite = wantWet;
    material.color.set(wantWet ? '#f1f8fc' : '#e0f2fe');
    material.needsUpdate = true;
  });
  return <primitive object={material} attach={attach} />;
}
