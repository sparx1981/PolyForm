import { interiorFurnitureCatalog, type InteriorFurnitureType } from './parametricFurniture';

/** How the Interior Studio gallery groups its pieces. Curtains are left out: they hang on a window, so furnishing places them. */
export const GALLERY_GROUPS: ReadonlyArray<{ id: string; label: string; types: readonly InteriorFurnitureType[] }> = [
  { id: 'seating', label: 'Seating', types: ['sofa', 'armchair', 'office-chair', 'dining-chair'] },
  { id: 'tables', label: 'Tables', types: ['coffee-table', 'side-table', 'dining-table', 'desk', 'console'] },
  { id: 'storage', label: 'Storage', types: ['cabinet', 'bookcase', 'filing-cabinet', 'tv-unit'] },
  { id: 'bedroom', label: 'Bedroom', types: ['bed', 'nightstand'] },
  { id: 'kitchen-bath', label: 'Kitchen & bath', types: ['kitchen-run', 'fridge', 'bath', 'shower', 'toilet', 'basin'] },
  { id: 'workshop', label: 'Workshop', types: ['workbench', 'tool-cabinet', 'shelving-rack', 'machine'] },
];

export interface GalleryItem { type: InteriorFurnitureType; name: string; size: string }

/** Every placeable piece with its name and default size (width x depth x height, metres), grouped for the gallery. */
export function galleryItems(): Array<{ id: string; label: string; items: GalleryItem[] }> {
  const catalog = new Map(interiorFurnitureCatalog().map(entry => [entry.type, entry]));
  return GALLERY_GROUPS.map(group => ({
    id: group.id,
    label: group.label,
    items: group.types.flatMap(type => {
      const entry = catalog.get(type);
      if (!entry) return [];
      const d = entry.defaults;
      return [{ type, name: entry.name, size: `${d.width.toFixed(2)} × ${d.depth.toFixed(2)} × ${d.height.toFixed(2)} m` }];
    }),
  }));
}
