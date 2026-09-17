export interface PlantSpecies {
  id: string;
  name: string;
  category: 'tree' | 'bush' | 'flower' | 'grass' | 'hedge';
  scientificName?: string;
  description: string;
  defaultHeight: number; // in meters
  defaultSpread: number; // in meters
  foliageColor: string;
  trunkColor?: string;
  modelType: 'procedural' | 'fbx' | 'usd' | 'gltf';
  modelPath?: string;
  texturePath?: string;
  variations?: string[];
  thumbnailColor?: string;
}

const ADDITIONAL_PROCEDURAL_SPECIES: PlantSpecies[] = [
  {
    id: 'norway_spruce', name: 'Norway Spruce', category: 'tree', scientificName: 'Picea abies',
    description: 'Tiered evergreen with a narrow spire and broad lower needle boughs.',
    defaultHeight: 10, defaultSpread: 4, foliageColor: '#244c38', trunkColor: '#654533', modelType: 'procedural'
  },
  {
    id: 'flowering_cherry', name: 'Flowering Cherry', category: 'tree', scientificName: 'Prunus serrulata',
    description: 'Spreading branching crown with pale pink spring blossom clusters.',
    defaultHeight: 5, defaultSpread: 5.5, foliageColor: '#e9b8ca', trunkColor: '#594039', modelType: 'procedural'
  },
  {
    id: 'creeping_juniper', name: 'Creeping Juniper', category: 'bush', scientificName: 'Juniperus horizontalis',
    description: 'Low spreading blue-green evergreen with radial woody stems.',
    defaultHeight: 0.45, defaultSpread: 1.8, foliageColor: '#567c79', modelType: 'procedural'
  },
  {
    id: 'rosemary_shrub', name: 'Rosemary', category: 'bush', scientificName: 'Salvia rosmarinus',
    description: 'Upright aromatic shrub with narrow silvery green needle sprays.',
    defaultHeight: 1.1, defaultSpread: 0.9, foliageColor: '#678570', modelType: 'procedural'
  },
];

export const PLANT_SPECIES_CATALOG: PlantSpecies[] = [
  // --- BUSHES & GROUND COVER ---
  {
    id: 'ribbon_grass',
    name: 'Ribbon Grass (Phalaris arundinacea)',
    category: 'bush',
    scientificName: 'Phalaris arundinacea var. picta',
    description: 'Realistic garden grass and perennial ornamental bush cluster with variegated blades and natural foliage density.',
    defaultHeight: 0.55,
    defaultSpread: 0.70,
    foliageColor: '#70a04b',
    modelType: 'fbx',
    modelPath: '/models/plants/ribbon_grass/Ribbon_Grass_tbdpec3r_Mid_tbdpec3r_',
    texturePath: '/models/plants/ribbon_grass/Ribbon_Grass_tbdpec3r_Mid_2K_',
    variations: ['VarC', 'VarD', 'VarE', 'VarF'],
    thumbnailColor: '#65a30d'
  },
  {
    id: 'boxwood_hedge_bush',
    name: 'Boxwood Shrub (Buxus sempervirens)',
    category: 'bush',
    scientificName: 'Buxus sempervirens',
    description: 'Dense evergreen shrub cluster ideal for garden borders, formal landscaping, and natural manicured bushes.',
    defaultHeight: 0.90,
    defaultSpread: 1.05,
    foliageColor: '#2d6a4f',
    modelType: 'procedural',
    thumbnailColor: '#15803d'
  },
  {
    id: 'hydrangea_bush',
    name: 'Hydrangea Bush (Hydrangea macrophylla)',
    category: 'bush',
    scientificName: 'Hydrangea macrophylla',
    description: 'Broadleaf flowering shrub with lush clustered canopy and organic mounds.',
    defaultHeight: 1.20,
    defaultSpread: 1.35,
    foliageColor: '#38bdf8',
    modelType: 'procedural',
    thumbnailColor: '#38bdf8'
  },
  {
    id: 'lavender_shrub',
    name: 'English Lavender (Lavandula angustifolia)',
    category: 'bush',
    scientificName: 'Lavandula angustifolia',
    description: 'Aromatic perennial shrub with silver-green foliage and violet flowering spikes.',
    defaultHeight: 0.65,
    defaultSpread: 0.75,
    foliageColor: '#818cf8',
    modelType: 'procedural',
    thumbnailColor: '#818cf8'
  },
  {
    id: 'wild_rose_bush',
    name: 'Wild Rose Bush (Rosa canina)',
    category: 'bush',
    scientificName: 'Rosa canina',
    description: 'Natural thorny flowering shrub with arching woody canes, layered rose foliage, and delicate pastel pink blossoms.',
    defaultHeight: 1.10,
    defaultSpread: 1.25,
    foliageColor: '#2d6a4f',
    modelType: 'procedural',
    thumbnailColor: '#f43f5e'
  },
  {
    id: 'fern_cluster',
    name: 'Woodland Sword Fern (Polystichum munitum)',
    category: 'bush',
    scientificName: 'Polystichum munitum',
    description: 'Evergreen woodland fern with graceful arching pinnate fronds cascading from a fibrous crown.',
    defaultHeight: 0.60,
    defaultSpread: 0.85,
    foliageColor: '#15803d',
    modelType: 'procedural',
    thumbnailColor: '#16a34a'
  },
  {
    id: 'ornamental_grass',
    name: 'Feather Reed Grass (Calamagrostis)',
    category: 'bush',
    scientificName: 'Calamagrostis x acutiflora',
    description: 'Architectural ornamental grass forming a dense upright fountain of variegated blades crowned by golden wheat plumes.',
    defaultHeight: 0.95,
    defaultSpread: 0.75,
    foliageColor: '#84cc16',
    modelType: 'procedural',
    thumbnailColor: '#eab308'
  },

  // --- TREES ---
  {
    id: 'english_oak',
    name: 'English Oak (Quercus robur)',
    category: 'tree',
    scientificName: 'Quercus robur',
    description: 'Stately high-fidelity architectural broadleaf tree with sweeping layered canopy branches from high-resolution scan.',
    defaultHeight: 12.0,
    defaultSpread: 8.0,
    foliageColor: '#2d6a4f',
    trunkColor: '#5c4033',
    modelType: 'gltf',
    modelPath: '/models/trees/english_oak/english_oak_',
    variations: ['a', 'b', 'c', 'd'],
    thumbnailColor: '#166534'
  },
  {
    id: 'silver_birch',
    name: 'Silver Birch (Betula pendula)',
    category: 'tree',
    scientificName: 'Betula pendula',
    description: 'Slender, elegant deciduous tree with distinctive pale bark and light open foliage.',
    defaultHeight: 8.5,
    defaultSpread: 4.0,
    foliageColor: '#40916c',
    trunkColor: '#e2e8f0',
    modelType: 'procedural',
    thumbnailColor: '#15803d'
  },
  {
    id: 'scots_pine',
    name: 'Scots Pine (Pinus sylvestris)',
    category: 'tree',
    scientificName: 'Pinus sylvestris',
    description: 'Coniferous evergreen tree with irregular umbrella crown and textured needle clusters.',
    defaultHeight: 9.0,
    defaultSpread: 5.5,
    foliageColor: '#1b4332',
    trunkColor: '#78350f',
    modelType: 'procedural',
    thumbnailColor: '#14532d'
  },
  {
    id: 'japanese_maple',
    name: 'Japanese Maple (Acer palmatum)',
    category: 'tree',
    scientificName: 'Acer palmatum',
    description: 'Delicate ornamental landscape tree with crimson-amber canopy and multi-stem silhouette.',
    defaultHeight: 4.2,
    defaultSpread: 4.0,
    foliageColor: '#991b1b',
    trunkColor: '#451a03',
    modelType: 'procedural',
    thumbnailColor: '#b91c1c'
  },
  {
    id: 'mediterranean_cypress',
    name: 'Columnar Cypress (Cupressus sempervirens)',
    category: 'tree',
    scientificName: 'Cupressus sempervirens',
    description: 'Tall, slender pencil-shaped evergreen architectural tree for avenues and perimeter accents.',
    defaultHeight: 10.0,
    defaultSpread: 1.8,
    foliageColor: '#14532d',
    trunkColor: '#3f2c1d',
    modelType: 'procedural',
    thumbnailColor: '#166534'
  },
  {
    id: 'olive_tree',
    name: 'Mediterranean Olive (Olea europaea)',
    category: 'tree',
    scientificName: 'Olea europaea',
    description: 'Gnarled sculptural trunk with soft silvery-green foliage crown.',
    defaultHeight: 4.5,
    defaultSpread: 4.8,
    foliageColor: '#65a30d',
    trunkColor: '#78716c',
    modelType: 'procedural',
    thumbnailColor: '#65a30d'
  },
  {
    id: 'weeping_willow',
    name: 'Weeping Willow (Salix babylonica)',
    category: 'tree',
    scientificName: 'Salix babylonica',
    description: 'Graceful cascading canopy with drooping branches ideal for watersides and open lawns.',
    defaultHeight: 8.0,
    defaultSpread: 8.5,
    foliageColor: '#52796f',
    trunkColor: '#4a3728',
    modelType: 'procedural',
    thumbnailColor: '#4ade80'
  },
  ...ADDITIONAL_PROCEDURAL_SPECIES
];
