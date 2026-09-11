import * as THREE from 'three';

export interface RoadMaterialPreset {
  id: string;
  name: string;
  category: 'road' | 'pathway';
  color: string;
  roughness: number;
  metalness: number;
  description: string;
  /** Real-world size (in meters) that one tile of the generated texture represents, for physically-based UV repeat. */
  tileSizeMeters: number;
  /** Generates a tileable diffuse PBR-style texture as a data URL. */
  generate: () => string;
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const textureCache = new Map<string, string>();
const threeTextureCache = new Map<string, THREE.Texture>();

function createTileableCanvas(
  presetId: string,
  size: number,
  drawFn: (ctx: CanvasRenderingContext2D, size: number, rand: () => number) => void
): string {
  if (typeof document === 'undefined') return '';
  if (textureCache.has(presetId)) return textureCache.get(presetId)!;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const rand = mulberry32(hashString(presetId));
  drawFn(ctx, size, rand);
  const dataUrl = canvas.toDataURL('image/png');
  textureCache.set(presetId, dataUrl);
  return dataUrl;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
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
    tileSizeMeters: 5,
    generate: () =>
      createTileableCanvas('asphalt-weathered', 512, (ctx, size, rand) => {
        ctx.fillStyle = '#2b2d31';
        ctx.fillRect(0, 0, size, size);
        for (let i = 0; i < 9000; i++) {
          const x = rand() * size;
          const y = rand() * size;
          const tone = 0.5 + rand() * 0.9;
          const g = Math.floor(45 * tone);
          ctx.fillStyle = `rgba(${g + 8}, ${g + 6}, ${g + 10}, 0.5)`;
          ctx.beginPath();
          ctx.arc(x, y, 0.5 + rand() * 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
        // Subtle weathered cracks
        ctx.strokeStyle = 'rgba(10,10,12,0.35)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 6; i++) {
          ctx.beginPath();
          let x = rand() * size, y = rand() * size;
          ctx.moveTo(x, y);
          for (let j = 0; j < 8; j++) {
            x += (rand() - 0.5) * 60;
            y += (rand() - 0.5) * 60;
            ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }),
  },
  {
    id: 'asphalt-dark',
    name: 'Fresh Bitumen Asphalt',
    category: 'road',
    color: '#16181b',
    roughness: 0.65,
    metalness: 0.15,
    description: 'Freshly paved jet-black dense highway asphalt',
    tileSizeMeters: 5,
    generate: () =>
      createTileableCanvas('asphalt-dark', 512, (ctx, size, rand) => {
        ctx.fillStyle = '#16181b';
        ctx.fillRect(0, 0, size, size);
        for (let i = 0; i < 12000; i++) {
          const x = rand() * size;
          const y = rand() * size;
          const tone = 0.4 + rand() * 0.8;
          const g = Math.floor(30 * tone);
          ctx.fillStyle = `rgba(${g + 5}, ${g + 5}, ${g + 8}, 0.55)`;
          ctx.beginPath();
          ctx.arc(x, y, 0.4 + rand() * 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }),
  },
  {
    id: 'concrete-brushed',
    name: 'Brushed Concrete Pavement',
    category: 'road',
    color: '#9ca3af',
    roughness: 0.65,
    metalness: 0.05,
    description: 'Light grey broom-finished civil engineered concrete slab',
    tileSizeMeters: 4,
    generate: () =>
      createTileableCanvas('concrete-brushed', 512, (ctx, size, rand) => {
        ctx.fillStyle = '#9ca3af';
        ctx.fillRect(0, 0, size, size);
        // Broom-finish streaks running across the slab
        for (let y = 0; y < size; y += 3) {
          const wobble = Math.sin(y * 0.15) * 2;
          ctx.strokeStyle = `rgba(120,124,132,${0.15 + rand() * 0.15})`;
          ctx.lineWidth = 1 + rand();
          ctx.beginPath();
          ctx.moveTo(0, y + wobble);
          ctx.lineTo(size, y + wobble);
          ctx.stroke();
        }
        // Expansion joint lines dividing slabs
        ctx.strokeStyle = 'rgba(70,74,80,0.6)';
        ctx.lineWidth = 3;
        ctx.strokeRect(2, 2, size - 4, size - 4);
        for (let i = 0; i < 5000; i++) {
          const x = rand() * size, y = rand() * size;
          ctx.fillStyle = `rgba(160,163,170,${0.1 + rand() * 0.2})`;
          ctx.beginPath();
          ctx.arc(x, y, 0.5 + rand(), 0, Math.PI * 2);
          ctx.fill();
        }
      }),
  },
  {
    id: 'cobblestone',
    name: 'Cobblestone Pavers',
    category: 'pathway',
    color: '#52525b',
    roughness: 0.75,
    metalness: 0.05,
    description: 'Interlocking architectural stone cobblestone paving blocks',
    tileSizeMeters: 1,
    generate: () =>
      createTileableCanvas('cobblestone', 512, (ctx, size, rand) => {
        ctx.fillStyle = '#2f2f34';
        ctx.fillRect(0, 0, size, size);
        const cols = 6, rows = 6;
        const cw = size / cols, ch = size / rows;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const offset = (r % 2) * (cw / 2);
            const x = c * cw + offset - cw / 2;
            const y = r * ch;
            const tone = 0.6 + rand() * 0.5;
            const g = Math.floor(80 * tone);
            ctx.fillStyle = `rgb(${g + 10}, ${g + 8}, ${g + 12})`;
            const pad = 2.5;
            ctx.beginPath();
            ctx.roundRect(x + pad, y + pad, cw - pad * 2, ch - pad * 2, 4);
            ctx.fill();
          }
        }
      }),
  },
  {
    id: 'gravel-crushed',
    name: 'Crushed Gravel Pathway',
    category: 'pathway',
    color: '#a8a29e',
    roughness: 0.95,
    metalness: 0.0,
    description: 'Compacted natural aggregate crushed gravel trail',
    tileSizeMeters: 3,
    generate: () =>
      createTileableCanvas('gravel-crushed', 512, (ctx, size, rand) => {
        ctx.fillStyle = '#8f8a83';
        ctx.fillRect(0, 0, size, size);
        for (let i = 0; i < 14000; i++) {
          const x = rand() * size;
          const y = rand() * size;
          const tone = 0.5 + rand() * 0.9;
          const g = Math.floor(120 * tone);
          ctx.fillStyle = `rgba(${g + 30}, ${g + 25}, ${g + 18}, 0.8)`;
          ctx.beginPath();
          ctx.arc(x, y, 1 + rand() * 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }),
  },
  {
    id: 'brick-paver',
    name: 'Red Clay Brick Pavers',
    category: 'pathway',
    color: '#994d38',
    roughness: 0.8,
    metalness: 0.05,
    description: 'Traditional terracotta herringbone architectural brick paving',
    tileSizeMeters: 0.6,
    generate: () =>
      createTileableCanvas('brick-paver', 512, (ctx, size, rand) => {
        ctx.fillStyle = '#3a2a22';
        ctx.fillRect(0, 0, size, size);
        const brickW = size / 4, brickH = size / 8;
        for (let r = 0; r < 8; r++) {
          const rowOffset = (r % 2) * (brickW / 2);
          for (let c = -1; c < 5; c++) {
            const x = c * brickW + rowOffset;
            const y = r * brickH;
            const tone = 0.75 + rand() * 0.4;
            const rr = Math.floor(153 * tone);
            const gg = Math.floor(77 * tone);
            const bb = Math.floor(56 * tone);
            ctx.fillStyle = `rgb(${rr}, ${gg}, ${bb})`;
            ctx.fillRect(x + 2, y + 2, brickW - 4, brickH - 4);
          }
        }
      }),
  },
  {
    id: 'timber-boardwalk',
    name: 'Timber Boardwalk Planks',
    category: 'pathway',
    color: '#855a3c',
    roughness: 0.75,
    metalness: 0.0,
    description: 'Treated natural cedar timber pedestrian boardwalk deck',
    tileSizeMeters: 2,
    generate: () =>
      createTileableCanvas('timber-boardwalk', 512, (ctx, size, rand) => {
        ctx.fillStyle = '#6f4a30';
        ctx.fillRect(0, 0, size, size);
        const plankCount = 5;
        const plankW = size / plankCount;
        for (let p = 0; p < plankCount; p++) {
          const x = p * plankW;
          const tone = 0.85 + rand() * 0.3;
          const r = Math.floor(133 * tone), g = Math.floor(90 * tone), b = Math.floor(60 * tone);
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
          ctx.fillRect(x + 2, 0, plankW - 4, size);
          // Wood grain lines along the plank
          ctx.strokeStyle = `rgba(60,38,22,0.3)`;
          for (let i = 0; i < 6; i++) {
            const gx = x + 4 + rand() * (plankW - 8);
            ctx.beginPath();
            ctx.moveTo(gx, 0);
            for (let y = 0; y < size; y += 16) {
              ctx.lineTo(gx + (rand() - 0.5) * 4, y);
            }
            ctx.stroke();
          }
        }
      }),
  },
  {
    id: 'dirt-trail',
    name: 'Compacted Earth Trail',
    category: 'pathway',
    color: '#6d523b',
    roughness: 0.95,
    metalness: 0.0,
    description: 'Natural parkway dirt and packed soil hiking corridor',
    tileSizeMeters: 3,
    generate: () =>
      createTileableCanvas('dirt-trail', 512, (ctx, size, rand) => {
        ctx.fillStyle = '#5c4530';
        ctx.fillRect(0, 0, size, size);
        for (let i = 0; i < 16000; i++) {
          const x = rand() * size;
          const y = rand() * size;
          const tone = 0.5 + rand() * 0.9;
          const r = Math.floor(109 * tone), g = Math.floor(82 * tone), b = Math.floor(59 * tone);
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.6)`;
          ctx.beginPath();
          ctx.arc(x, y, 1 + rand() * 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }),
  },
];

export function getRoadMaterial(materialId?: string): RoadMaterialPreset {
  return ROAD_MATERIALS.find((m) => m.id === materialId) || ROAD_MATERIALS[0];
}

/** Loads (and caches) a tileable THREE.Texture for a road/pathway material preset. */
export function getCachedRoadTexture(materialId?: string): THREE.Texture | null {
  const preset = getRoadMaterial(materialId);
  if (threeTextureCache.has(preset.id)) {
    return threeTextureCache.get(preset.id)!;
  }
  const url = preset.generate();
  if (!url) return null;
  const texture = new THREE.TextureLoader().load(url);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  threeTextureCache.set(preset.id, texture);
  return texture;
}
