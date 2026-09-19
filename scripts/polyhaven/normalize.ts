import type { SourceMapChoice } from './types';

const ALIASES: Record<string, string> = {
  diffuse: 'basecolor', basecolor: 'basecolor', albedo: 'basecolor', nor_gl: 'normal-gl', normal_gl: 'normal-gl',
  nor_dx: 'normal-dx', normal_dx: 'normal-dx', rough: 'roughness', roughness: 'roughness', metal: 'metalness', metallic: 'metalness',
  ao: 'ao', arm: 'orm', orm: 'orm', rough_ao: 'roughness-ao', displacement: 'height', height: 'height', bump: 'bump',
  opacity: 'opacity', alpha: 'opacity', emission: 'emissive', emissive: 'emissive', spec: 'specular', specular: 'specular',
  translucent: 'transmission', transmission: 'transmission', hdri: 'environment', tonemapped: 'preview',
};
const CONTAINERS = new Set(['blend', 'gltf', 'mtlx', 'sbsar', 'colorchart']);
const QUALITY_VALUE: Record<string, number> = { '1k': 1, '2k': 2, '4k': 4, '8k': 8, '16k': 16 };
const FORMAT_PREFERENCE: Record<string, string[]> = {
  basecolor: ['png', 'exr', 'jpg', 'webp'],
  'normal-gl': ['png', 'exr', 'jpg'], 'normal-dx': ['png', 'exr', 'jpg'],
  roughness: ['png', 'exr', 'jpg'], metalness: ['png', 'exr', 'jpg'], ao: ['png', 'exr', 'jpg'],
  orm: ['png', 'exr', 'jpg'], 'roughness-ao': ['png', 'exr', 'jpg'], bump: ['png', 'exr', 'jpg'],
  height: ['exr', 'png', 'jpg'], opacity: ['png', 'exr', 'jpg'], emissive: ['exr', 'png', 'jpg'],
  specular: ['png', 'exr', 'jpg'], transmission: ['png', 'exr', 'jpg'], environment: ['hdr', 'exr'], preview: ['jpg', 'png'],
};

function leaves(node: unknown, path: string[] = []): Array<{ path: string[]; leaf: Record<string, unknown> }> {
  if (!node || typeof node !== 'object') return [];
  const object = node as Record<string, unknown>;
  if (typeof object.url === 'string') return [{ path, leaf: object }];
  return Object.entries(object).flatMap(([key, value]) => leaves(value, [...path, key]));
}

export function normalizeFileInventory(files: unknown, ceiling: '1k' | '2k' | '4k'): SourceMapChoice[] {
  if (!files || typeof files !== 'object') throw new Error('Invalid files payload');
  const choices: SourceMapChoice[] = [];
  for (const [rawKey, variants] of Object.entries(files as Record<string, unknown>)) {
    const lower = rawKey.toLowerCase();
    if (CONTAINERS.has(lower)) {
      choices.push({ sourceKey: rawKey, status: 'container', reason: 'Container/dependency inventory retained; not a texture map.' });
      continue;
    }
    const semantic = ALIASES[lower];
    if (!semantic) {
      choices.push({ sourceKey: rawKey, status: 'unresolved-map', reason: 'Unknown source map key requires a reviewed adapter.' });
      continue;
    }
    const variantsFound = leaves(variants);
    const eligible = variantsFound.filter(item => {
      const quality = item.path.find(part => QUALITY_VALUE[part.toLowerCase()]);
      return !quality || QUALITY_VALUE[quality.toLowerCase()]! <= QUALITY_VALUE[ceiling]!;
    }).sort((a, b) => {
      const aq = a.path.find(part => QUALITY_VALUE[part.toLowerCase()])?.toLowerCase() ?? '1k';
      const bq = b.path.find(part => QUALITY_VALUE[part.toLowerCase()])?.toLowerCase() ?? '1k';
      const qualityDifference = QUALITY_VALUE[bq]! - QUALITY_VALUE[aq]!;
      if (qualityDifference) return qualityDifference;
      const preference = FORMAT_PREFERENCE[semantic] ?? [];
      const aFormat = a.path.at(-1)?.toLowerCase() ?? '';
      const bFormat = b.path.at(-1)?.toLowerCase() ?? '';
      const aRank = preference.indexOf(aFormat);
      const bRank = preference.indexOf(bFormat);
      return (aRank < 0 ? 999 : aRank) - (bRank < 0 ? 999 : bRank);
    });
    if (!eligible.length) {
      choices.push({ sourceKey: rawKey, semantic, status: 'unresolved-map', reason: `No source at or below ${ceiling}.` });
      continue;
    }
    eligible.forEach((item, index) => choices.push({
      sourceKey: rawKey, semantic, status: index === 0 ? 'selected' : 'alternative',
      resolution: item.path.find(part => QUALITY_VALUE[part.toLowerCase()]), format: item.path.at(-1)?.toLowerCase(),
      leaf: item.leaf as SourceMapChoice['leaf'], reason: index === 0 ? 'Highest suitable source at configured ceiling.' : 'Available duplicate retained in inventory.',
    }));
  }
  return choices;
}
