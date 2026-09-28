import type { Shape } from '../types';
import { ROOF_BUILD_VERSION, updateRoofAssembly } from './archRoofGenerator';
import { refreshRoofExtras } from './roofExtras';
import { roofWholeBuilding, storeysOf } from './buildingRoofs';
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
  // Several storeys under one old roof: that roof was traced round every storey's walls at once,
  // so it is redone storey by storey (main roof on top, extensions below) in the same style.
  if (storeysOf(shapes).length > 1 && old.length === 1 && !old[0].roofData?.extensionSite) {
    const roof = old[0], rd = roof.roofData;
    const tiles = roof.roofTileData ?? shapes.find(s => s.parentShapeId === roof.id && s.tags?.includes('roof-tiles'))?.roofTileData;
    const redone = roofWholeBuilding(shapes, {
      roofType: rd.roofType === 'hip' ? 'hip' : 'gable',
      ridgeHeight: rd.ridgeHeight, usePitchAngle: false,
      eaveOverhang: rd.eaveOverhang, fasciaHeight: rd.fasciaHeight, color: roof.color,
      ...(tiles ? { tileShape: tiles.shape, tileSize: tiles.size, tileColor: tiles.color, randomizeColor: tiles.randomizeColor, colorPalette: tiles.colorPalette, seed: tiles.seed } : {}),
    });
    if (redone) return redone.shapes;
  }
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
