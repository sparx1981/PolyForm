import type { WeatherKind, WeatherLayerOptions } from './WeatherSystem';
import { WEATHER_DEFAULTS } from './WeatherSystem';

export interface WeatherLayerSettings extends WeatherLayerOptions { enabled: boolean; color: string }
export interface GraphicsSettings {
  vegetation: { instancing: boolean; windEnabled: boolean; strength: number; speed: number; direction: number };
  weather: {
    enabled: boolean; windX: number; windZ: number; width: number; height: number;
    cloudsMode: 'fast' | 'volumetric';
    layers: Record<WeatherKind, WeatherLayerSettings>;
  };
}

export function defaultGraphicsSettings(): GraphicsSettings {
  return {
    vegetation: { instancing: true, windEnabled: true, strength: 0.12, speed: 1.6, direction: 20 },
    weather: { enabled: false, windX: 1.2, windZ: 0.3, width: 160, height: 50, cloudsMode: 'fast',
      layers: Object.fromEntries(Object.entries(WEATHER_DEFAULTS).map(([kind, options]) =>
        [kind, { ...options, enabled: kind === 'clouds', color: String(options.color) }])) as GraphicsSettings['weather']['layers'] },
  };
}

const number = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
/** Whitelist fields and clamp imported/cloud data. Missing fields reset to defaults. */
export function normalizeGraphicsSettings(input: unknown): GraphicsSettings {
  const defaults = defaultGraphicsSettings(), root = record(input), v = record(root.vegetation), w = record(root.weather);
  const bool = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback;
  const result = defaultGraphicsSettings();
  result.vegetation = { instancing: bool(v.instancing, true), windEnabled: bool(v.windEnabled, true),
    strength: number(v.strength, 0.12, 0, 0.4), speed: number(v.speed, 1.6, 0, 5), direction: number(v.direction, 20, 0, 360) };
  Object.assign(result.weather, { enabled: bool(w.enabled, false), windX: number(w.windX, 1.2, -20, 20),
    windZ: number(w.windZ, 0.3, -20, 20), width: number(w.width, 160, 20, 1000), height: number(w.height, 50, 5, 200),
    cloudsMode: w.cloudsMode === 'volumetric' ? 'volumetric' : 'fast' });
  for (const kind of Object.keys(result.weather.layers) as WeatherKind[]) {
    const raw = record(record(w.layers)[kind]), d = defaults.weather.layers[kind];
    result.weather.layers[kind] = {
      enabled: bool(raw.enabled, d.enabled), color: typeof raw.color === 'string' && /^#[\da-f]{6}$/i.test(raw.color) ? raw.color : d.color,
      count: Math.round(number(raw.count, d.count, 0, kind === 'rain' || kind === 'snow' ? 30000 : 400)),
      size: number(raw.size, d.size, 0.01, 80), opacity: number(raw.opacity, d.opacity, 0, 1),
      speed: number(raw.speed, d.speed, 0, 40), gravity: number(raw.gravity, d.gravity, 0, 20), turbulence: number(raw.turbulence, d.turbulence, 0, 5),
      density: number(raw.density, d.density, 0, 1), altitude: number(raw.altitude, d.altitude, -100, 500),
      thickness: number(raw.thickness, d.thickness, 0.1, 100),
      cloudType: ['cumulus', 'cirrus', 'stratus'].includes(raw.cloudType) ? raw.cloudType : d.cloudType,
    };
  }
  return result;
}
