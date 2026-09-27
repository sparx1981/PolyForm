import type { Shape } from '../types';
import { ROOF_BUILD_VERSION, updateRoofAssembly } from './archRoofGenerator';
import { refreshRoofExtras } from './roofExtras';
import { initRoofSkeleton, roofSkeletonReady } from './roofSkeleton';

/** Pitched roofs built before the straight-skeleton roofs (they have no `buildVersion` yet). */
export const roofsToUpgrade = (shapes: Shape[]) => shapes.filter(s =>
  s.roofData && !s.parentShapeId && s.tags?.includes('roof-assembly') &&
  s.roofData.roofType !== 'parapet' && (s.roofData.buildVersion ?? 1) < ROOF_BUILD_VERSION);

/**
 * Rebuilds older pitched roofs the current way, keeping each roof's height, overhang, fascia,
 * tiles and extras (gutters, dormers and so on), which follow the new shape. Returns the same
 * array when nothing needed changing.
 */
export function upgradeRoofs(shapes: Shape[]): Shape[] {
  if (!roofSkeletonReady()) return shapes;
  const old = roofsToUpgrade(shapes);
  if (!old.length) return shapes;
  let out = shapes;
  for (const roof of old) {
    try {
      out = updateRoofAssembly(out, roof.id, {}).updatedShapes;
      if (roof.roofData?.extras) out = refreshRoofExtras(out, roof.id);
    } catch (err) {
      console.warn('[roof] Could not rebuild roof', roof.id, err);
    }
  }
  return out;
}

/** `upgradeRoofs`, once the roof skeleton code has loaded (it loads in the background at start). */
export async function upgradeRoofsWhenReady(shapes: Shape[]): Promise<Shape[]> {
  if (!roofsToUpgrade(shapes).length) return shapes;
  await initRoofSkeleton();
  return upgradeRoofs(shapes);
}
