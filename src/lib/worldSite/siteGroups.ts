import type { Shape } from '../../types';

/**
 * How an imported 3D site is grouped for the Outliner and the Section plane's "what it cuts":
 * the ground, and the existing buildings sorted by what the map says they are.
 */
export interface SiteBuildingGroup {
  /** Stable key, e.g. "house". */
  key: string;
  /** "Existing house". */
  label: string;
  shapes: Shape[];
}

/** The map's building type as a word ("semidetached_house" -> "semidetached house"; nothing useful -> "building"). */
export function buildingKindWord(kind: string | undefined): string {
  const k = (kind ?? '').trim().toLowerCase();
  if (!k || k === 'yes' || k === 'building') return 'building';
  return k.replace(/_/g, ' ');
}

export function siteBuildingGroups(shapes: readonly Shape[]): SiteBuildingGroup[] {
  const groups = new Map<string, SiteBuildingGroup>();
  for (const s of shapes) {
    if (s.type !== 'site_building' || !s.siteBuildingData) continue;
    const word = buildingKindWord(s.siteBuildingData.kind);
    const key = word.replace(/\s+/g, '-');
    const group = groups.get(key) ?? { key, label: `Existing ${word}`, shapes: [] };
    group.shapes.push(s);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.shapes.length - a.shapes.length || a.label.localeCompare(b.label));
}

/** The imported ground, if the model has an imported site. */
export function siteGroundOf(shapes: readonly Shape[]): Shape | undefined {
  return shapes.find(s => s.type === 'terrain' && !!s.terrainData?.site);
}

/** Everything that is part of the imported site's own data (ground and existing buildings). */
export function siteShapeIds(shapes: readonly Shape[]): Set<string> {
  const ids = new Set<string>();
  const ground = siteGroundOf(shapes);
  if (ground) ids.add(ground.id);
  for (const s of shapes) if (s.type === 'site_building') ids.add(s.id);
  return ids;
}
