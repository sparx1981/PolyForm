export interface BetaEnvironmentSettings {
  enabled: boolean;
  animateDayCycle: boolean; dayCycleSpeed: number;
  sky: boolean; stars: boolean; clouds: boolean; atmosphere: boolean; flare: boolean; grading: boolean;
  date: string; latitude: number; longitude: number; elevation: number; useSite: boolean;
  starIntensity: number; coverage: number; cloudType: 'cumulus' | 'stratus' | 'cirrus';
  altitude: number; thickness: number; layers: number; quality: 'auto' | 'low' | 'medium' | 'high';
  windScale: number; flareIntensity: number; ghosts: number; halo: number;
  grade: 'neutral' | 'warm' | 'cool'; gradeStrength: number; exposure: number;
}

export function defaultBetaEnvironment(): BetaEnvironmentSettings {
  return { enabled: false, animateDayCycle: false, dayCycleSpeed: 0.2, sky: true, stars: true, clouds: false, atmosphere: true, flare: false, grading: false,
    date: '2026-06-21T12:00', latitude: 51.5074, longitude: -0.1278, elevation: 0, useSite: true,
    starIntensity: 10, coverage: 0.35, cloudType: 'cumulus', altitude: 1500, thickness: 1000, layers: 1,
    quality: 'auto', windScale: 1, flareIntensity: 0.08, ghosts: 0.15, halo: 0.15,
    grade: 'neutral', gradeStrength: 0.5, exposure: 1 };
}

export function normalizeBetaEnvironment(input: unknown): BetaEnvironmentSettings {
  const d = defaultBetaEnvironment();
  const r = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const result = { ...d };
  for (const k of ['enabled', 'animateDayCycle', 'clouds', 'atmosphere', 'flare', 'grading', 'useSite'] as const)
    if (typeof r[k] === 'boolean') result[k] = r[k];
  const ranges = { latitude: [-89.9,89.9], longitude: [-180,180], elevation: [-100,9000],
    dayCycleSpeed: [0.05,2], coverage: [0,1], altitude: [200,12000], thickness: [100,6000], layers: [1,3],
    windScale: [0,5], flareIntensity: [0,1], ghosts: [0,1], halo: [0,1], gradeStrength: [0,1], exposure: [0.1,4] };
  for (const k of Object.keys(ranges) as Array<keyof typeof ranges>) {
    const v = r[k];
    if (typeof v === 'number' && Number.isFinite(v)) result[k] = Math.max(ranges[k][0], Math.min(ranges[k][1], v));
  }
  result.layers = Math.round(result.layers);
  if (['auto','low','medium','high'].includes(String(r.quality))) result.quality = r.quality as typeof d.quality;
  if (['neutral','warm','cool'].includes(String(r.grade))) result.grade = r.grade as typeof d.grade;
  if (['cumulus','stratus','cirrus'].includes(String(r.cloudType))) result.cloudType = r.cloudType as typeof d.cloudType;
  // Always UTC, independent of the browser timezone; keep invalid imports out of astronomy.
  if (typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(r.date) && Number.isFinite(Date.parse(r.date + 'Z'))) result.date = r.date;
  return result;
}
