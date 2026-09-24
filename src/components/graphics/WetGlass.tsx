import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
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
  useFrame((_, delta) => stepGlassWeather(target, Math.min(delta, 0.1)));
  // Dry glass the next time the weather starts, so it wets up again gradually.
  useEffect(() => () => { wetGlassUniforms.uGlassRain.value = 0; wetGlassUniforms.uGlassSnow.value = 0; }, []);
  return null;
}

/** Window and door glass with rain or snow on it (see wetGlass.ts). */
export function WetGlassMaterial({ attach, selected }: { attach: string; selected: boolean }) {
  const material = useMemo(() => makeWetGlass(new THREE.MeshPhysicalMaterial({
    color: '#f1f8fc', roughness: 0.03, metalness: 0, transmission: 1, thickness: 0, ior: 1.5,
    side: THREE.DoubleSide,
  })), []);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    material.emissive.set(selected ? '#0063A3' : '#000000');
    material.emissiveIntensity = selected ? 0.2 : 0;
  }, [material, selected]);
  return <primitive object={material} attach={attach} />;
}
