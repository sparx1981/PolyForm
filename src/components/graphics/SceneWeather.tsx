import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useApp } from '../../AppContext';
import { WeatherSystem, type WeatherKind } from '../../lib/graphics/WeatherSystem';

export function SceneWeather() {
  const { graphicsSettings } = useApp();
  const settings = graphicsSettings.weather;
  const { scene, gl, size, viewport } = useThree();
  const system = useRef<WeatherSystem | null>(null);
  const center = useRef(new THREE.Vector3());
  const occlusion = useRef({ frames: 0, at: new THREE.Vector3(Infinity, 0, 0) });
  useEffect(() => {
    if (!settings.enabled) return;
    const weather = new WeatherSystem().init(scene, gl); system.current = weather;
    return () => { system.current = null; weather.dispose(); };
  }, [settings.enabled, scene, gl]);
  useEffect(() => {
    const weather = system.current; if (!weather) return;
    weather.setBounds(new THREE.Vector3(settings.width, settings.height, settings.width));
    weather.setWind(new THREE.Vector2(settings.windX, settings.windZ)); weather.setCloudMode(settings.cloudsMode);
    for (const kind of Object.keys(settings.layers) as WeatherKind[]) {
      const layer = settings.layers[kind];
      // Lazy allocation: disabled layers are hidden, never simulated on the CPU.
      if (layer.enabled) weather.configureLayer(kind, layer);
      weather.setEnabled(kind, layer.enabled);
    }
  }, [settings]);
  useEffect(() => { system.current?.resize(gl); }, [gl, size.width, size.height, viewport.dpr, settings.enabled]);
  useFrame(({ camera }, delta) => {
    if (!system.current) return;
    center.current.set(camera.position.x, 0, camera.position.z);
    system.current.setCenter(center.current); system.current.update(delta);
    // Refresh the roof/ground occlusion map when the view has moved, and a few times a second
    // otherwise so edited or moving geometry is picked up.
    const state = occlusion.current;
    if (system.current.hasPrecipitation && (++state.frames >= 12 || state.at.distanceToSquared(center.current) > 4)) {
      state.frames = 0; state.at.copy(center.current);
      system.current.updateOcclusion(gl, scene);
    }
  });
  return null;
}
