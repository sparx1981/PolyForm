import type { Shape } from '../../types';
import { PLANT_SPECIES_CATALOG } from '../plantLibrary';

/** Plant catalogue lookups for plans and the BOM (kept out of the plan drawer so the connector doesn't bundle the catalogue). */
const byId = new Map(PLANT_SPECIES_CATALOG.map(p => [p.id, p]));

export function plantName(s: Shape): string | undefined {
  return s.plantSpeciesId ? byId.get(s.plantSpeciesId)?.name : undefined;
}

export function plantSpread(s: Shape): number {
  const species = s.plantSpeciesId ? byId.get(s.plantSpeciesId) : undefined;
  if (!species) return 0;
  return species.defaultSpread * (s.scale?.[0] ?? 1);
}

/** Height of a plant, metres (0 when the species is unknown). */
export function plantHeight(s: Shape): number {
  const species = s.plantSpeciesId ? byId.get(s.plantSpeciesId) : undefined;
  if (!species) return 0;
  return species.defaultHeight * (s.scale?.[1] ?? 1);
}
