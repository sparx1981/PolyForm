import * as THREE from 'three';
import type { Shape, TerrainData } from '../../types';
import type { GraphicsSettings } from '../graphics/graphicsSettings';
import type { ClothWind } from './curtainCloth';

/** Prefer the smallest terrain containing the window; distant landscapes cannot drive indoor cloth. */
export function curtainTerrain(shapes: Shape[], position: [number, number, number]): TerrainData | undefined {
  let found: TerrainData | undefined, area = Infinity;
  const local = new THREE.Vector3(), matrix = new THREE.Matrix4();
  for (const shape of shapes) {
    const terrain = shape.terrainData;
    if (!terrain) continue;
    const rotation = shape.quaternion ? new THREE.Quaternion(...shape.quaternion) : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(shape.rotation ?? [0, 0, 0])));
    matrix.compose(new THREE.Vector3(...shape.position), rotation, new THREE.Vector3(...(shape.scale ?? [1, 1, 1]))).invert();
    local.set(...position).applyMatrix4(matrix);
    if (Math.abs(local.x) <= terrain.width / 2 && Math.abs(local.z) <= terrain.depth / 2 && terrain.width * terrain.depth < area) {
      found = terrain; area = terrain.width * terrain.depth;
    }
  }
  return found;
}

/** Artist wind sliders become a shared breeze; each active source contributes, so none is masked.
 * Speed controls gust frequency, strength controls airflow. Weather provides a world-space vector. */
export function curtainWind(settings: GraphicsSettings, terrain?: TerrainData): ClothWind {
  const plant = settings.vegetation;
  let strength = plant.windEnabled ? Math.max(0, plant.strength) * 12 : 0;
  let frequency = strength * plant.speed;
  const add = (enabled: boolean, amount: number, speed: number) => {
    if (!enabled) return;
    const breeze = 3 * Math.sqrt(THREE.MathUtils.clamp(amount, 0, 1));
    strength += breeze; frequency += breeze * speed;
  };
  const grass = terrain?.grass, flowers = terrain?.flowers;
  add(!!grass?.enabled && grass.animate !== false, grass?.animationStrength ?? grass?.windStrength ?? 0.01, grass?.windSpeed ?? 2);
  add(!!flowers?.enabled && flowers.animate !== false, flowers?.animationStrength ?? 0.02, flowers?.windSpeed ?? 2);
  const direction = THREE.MathUtils.degToRad(plant.direction);
  let x = Math.cos(direction) * strength, z = Math.sin(direction) * strength;
  if (settings.weather.enabled) { x += settings.weather.windX; z += settings.weather.windZ; }
  const length = Math.hypot(x, z), limit = length > 8 ? 8 / length : 1;
  return { x: x * limit, z: z * limit, speed: strength > 0 ? frequency / strength : 1 };
}
