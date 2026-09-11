export interface MaterialPreset {
  id: string;
  name: string;
  color: string;
  roughness: number;
  metalness: number;
  opacity?: number;
  /**
   * Real PBR texture maps, once real image files are available (e.g. a
   * downloaded Poly Haven texture set placed under public/textures/materials/<id>/).
   * Left undefined until then - the preset still renders correctly via the
   * flat color/roughness/metalness above.
   */
  textureUrl?: string;
  normalMapUrl?: string;
  roughnessMapUrl?: string;
  metalnessMapUrl?: string;
  aoMapUrl?: string;
  displacementMapUrl?: string;
}

export const MATERIAL_PRESETS: MaterialPreset[] = [
  { id: 'red-brick', name: 'Red Clay Brick', color: '#9c3b2e', roughness: 0.85, metalness: 0.02 },
  { id: 'coursed-stone', name: 'Coursed Stone', color: '#a8a29e', roughness: 0.9, metalness: 0.0 },
  { id: 'polished-concrete', name: 'Polished Concrete', color: '#9ca3af', roughness: 0.35, metalness: 0.05 },
  { id: 'stucco-white', name: 'White Stucco', color: '#f5f5f4', roughness: 0.9, metalness: 0.0 },
  { id: 'vertical-timber', name: 'Vertical Timber Cladding', color: '#6b4423', roughness: 0.75, metalness: 0.0 },
  { id: 'architectural-glass', name: 'Architectural Glass', color: '#bfdbfe', roughness: 0.05, metalness: 0.1, opacity: 0.4 },
  { id: 'standing-seam-zinc', name: 'Standing Seam Zinc', color: '#94a3b8', roughness: 0.35, metalness: 0.85 },
  { id: 'weathered-steel', name: 'Weathered Corten Steel', color: '#78350f', roughness: 0.7, metalness: 0.6 },
  { id: 'travertine-marble', name: 'Travertine Marble', color: '#e7e5e4', roughness: 0.25, metalness: 0.02 },
  { id: 'terracotta-tile', name: 'Terracotta Tile', color: '#c2410c', roughness: 0.8, metalness: 0.02 },
  { id: 'black-granite', name: 'Black Granite', color: '#18181b', roughness: 0.2, metalness: 0.1 },
];

export function getMaterialPreset(id: string): MaterialPreset | undefined {
  return MATERIAL_PRESETS.find(p => p.id === id);
}
