export interface RoadMaterialPreset {
  id: string;
  name: string;
  category: 'road' | 'pathway';
  color: string;
  roughness: number;
  metalness: number;
  description: string;
}

export const ROAD_MATERIALS: RoadMaterialPreset[] = [
  {
    id: 'asphalt-weathered',
    name: 'Weathered Road Asphalt',
    category: 'road',
    color: '#2b2d31',
    roughness: 0.85,
    metalness: 0.1,
    description: 'Standard roadway bitumen asphalt with mineral aggregate wear',
  },
  {
    id: 'asphalt-dark',
    name: 'Fresh Bitumen Asphalt',
    category: 'road',
    color: '#16181b',
    roughness: 0.65,
    metalness: 0.15,
    description: 'Freshly paved jet-black dense highway asphalt',
  },
  {
    id: 'concrete-brushed',
    name: 'Brushed Concrete Pavement',
    category: 'road',
    color: '#9ca3af',
    roughness: 0.65,
    metalness: 0.05,
    description: 'Light grey broom-finished civil engineered concrete slab',
  },
  {
    id: 'cobblestone',
    name: 'Cobblestone Pavers',
    category: 'pathway',
    color: '#52525b',
    roughness: 0.75,
    metalness: 0.05,
    description: 'Interlocking architectural stone cobblestone paving blocks',
  },
  {
    id: 'gravel-crushed',
    name: 'Crushed Gravel Pathway',
    category: 'pathway',
    color: '#a8a29e',
    roughness: 0.95,
    metalness: 0.0,
    description: 'Compacted natural aggregate crushed gravel trail',
  },
  {
    id: 'brick-paver',
    name: 'Red Clay Brick Pavers',
    category: 'pathway',
    color: '#994d38',
    roughness: 0.8,
    metalness: 0.05,
    description: 'Traditional terracotta herringbone architectural brick paving',
  },
  {
    id: 'timber-boardwalk',
    name: 'Timber Boardwalk Planks',
    category: 'pathway',
    color: '#855a3c',
    roughness: 0.75,
    metalness: 0.0,
    description: 'Treated natural cedar timber pedestrian boardwalk deck',
  },
  {
    id: 'dirt-trail',
    name: 'Compacted Earth Trail',
    category: 'pathway',
    color: '#6d523b',
    roughness: 0.95,
    metalness: 0.0,
    description: 'Natural parkway dirt and packed soil hiking corridor',
  },
];

export function getRoadMaterial(materialId?: string): RoadMaterialPreset {
  return ROAD_MATERIALS.find(m => m.id === materialId) || ROAD_MATERIALS[0];
}
