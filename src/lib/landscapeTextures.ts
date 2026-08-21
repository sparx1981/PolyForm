// Realistic / Photorealistic Procedural Texture Generators for Landscapes and Terrain

export interface LandscapeTexturePreset {
  id: string;
  name: string;
  category: 'vegetation' | 'stone' | 'ground' | 'paved' | 'snow';
  description: string;
  roughness: number;
  metalness: number;
  defaultRepeat: number;
  previewColor: string;
  generate: () => string; // Returns data URL
}

const canvasCache = new Map<string, HTMLCanvasElement>();
const textureCache = new Map<string, string>();

function createNoiseCanvas(
  presetId: string,
  width: number,
  height: number,
  drawFn: (ctx: CanvasRenderingContext2D, width: number, height: number) => void
): string {
  if (typeof document === 'undefined') return '';
  if (textureCache.has(presetId)) return textureCache.get(presetId)!;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  drawFn(ctx, width, height);
  canvasCache.set(presetId, canvas);
  const dataUrl = canvas.toDataURL('image/png');
  textureCache.set(presetId, dataUrl);
  canvasCache.set(dataUrl, canvas);
  return dataUrl;
}

// Pseudo random with seed
function mulberry32(a: number) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export const LANDSCAPE_TEXTURES: LandscapeTexturePreset[] = [
  {
    id: 'lush_grass',
    name: 'Lush Meadow Grass',
    category: 'vegetation',
    description: 'High-density organic meadow grass with blade variations, soil depth, and subtle clover speckles',
    roughness: 0.85,
    metalness: 0.05,
    defaultRepeat: 8,
    previewColor: '#2d7a27',
    generate: () => {
      if (textureCache.has('lush_grass')) return textureCache.get('lush_grass')!;
      return createNoiseCanvas('lush_grass', 512, 512, (ctx, w, h) => {
        const rand = mulberry32(101);
        // Base dark fertile soil layer
        ctx.fillStyle = '#1e3815';
        ctx.fillRect(0, 0, w, h);

        // Medium green grass foundation
        for (let i = 0; i < 18000; i++) {
          const x = rand() * w;
          const y = rand() * h;
          const tone = 0.8 + rand() * 0.4;
          const g = Math.floor(100 * tone + 20);
          ctx.fillStyle = `rgba(${Math.floor(35 * tone)}, ${g}, ${Math.floor(25 * tone)}, 0.45)`;
          ctx.beginPath();
          ctx.arc(x, y, 1.5 + rand() * 2.5, 0, Math.PI * 2);
          ctx.fill();
        }

        // Fine grass blades and bright green highlights
        for (let i = 0; i < 12000; i++) {
          const x = rand() * w;
          const y = rand() * h;
          const len = 3 + rand() * 7;
          const angle = (rand() - 0.5) * 0.8;
          const bright = rand();
          const r = Math.floor(40 + bright * 45);
          const g = Math.floor(140 + bright * 80);
          const b = Math.floor(30 + bright * 35);
          ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.65)`;
          ctx.lineWidth = 0.8 + rand() * 0.8;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.sin(angle) * len, y - Math.cos(angle) * len);
          ctx.stroke();
        }

        // Subtle organic yellow/warm dry tips & flower flecks
        for (let i = 0; i < 1500; i++) {
          const x = rand() * w;
          const y = rand() * h;
          ctx.fillStyle = rand() > 0.4 ? 'rgba(160, 180, 50, 0.4)' : 'rgba(230, 230, 180, 0.5)';
          ctx.beginPath();
          ctx.arc(x, y, 0.9, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  },

  {
    id: 'manicured_turf',
    name: 'Manicured Lawn Turf',
    category: 'vegetation',
    description: 'Estate lawn with alternating mower roller directional sheen stripes and fine root thatch',
    roughness: 0.75,
    metalness: 0.05,
    defaultRepeat: 6,
    previewColor: '#34942d',
    generate: () => {
      if (textureCache.has('manicured_turf')) return textureCache.get('manicured_turf')!;
      return createNoiseCanvas('manicured_turf', 512, 512, (ctx, w, h) => {
        const rand = mulberry32(202);
        // Base grass green
        ctx.fillStyle = '#2d7d26';
        ctx.fillRect(0, 0, w, h);

        // Alternating mowing stripes (vertical bands)
        const stripeWidth = w / 8;
        for (let s = 0; s < 8; s++) {
          const isLight = s % 2 === 0;
          ctx.fillStyle = isLight ? 'rgba(65, 160, 50, 0.28)' : 'rgba(25, 80, 20, 0.25)';
          ctx.fillRect(s * stripeWidth, 0, stripeWidth, h);
        }

        // Fine blade texture
        for (let i = 0; i < 15000; i++) {
          const x = rand() * w;
          const y = rand() * h;
          const tone = rand();
          ctx.strokeStyle = `rgba(${Math.floor(40 + tone * 40)}, ${Math.floor(130 + tone * 70)}, ${Math.floor(30 + tone * 30)}, 0.5)`;
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + (rand() - 0.5) * 2, y - (2 + rand() * 4));
          ctx.stroke();
        }
      });
    }
  },

  {
    id: 'alpine_rock',
    name: 'Alpine Granite Stone',
    category: 'stone',
    description: 'Weathered metamorphic rock with mineral crystallization, fissures, and slate strata',
    roughness: 0.9,
    metalness: 0.15,
    defaultRepeat: 6,
    previewColor: '#6e737b',
    generate: () => {
      if (textureCache.has('alpine_rock')) return textureCache.get('alpine_rock')!;
      return createNoiseCanvas('alpine_rock', 512, 512, (ctx, w, h) => {
        const rand = mulberry32(303);
        // Slate-grey stone base
        ctx.fillStyle = '#5c6168';
        ctx.fillRect(0, 0, w, h);

        // Geological strata patches
        for (let i = 0; i < 4000; i++) {
          const x = rand() * w;
          const y = rand() * h;
          const radius = 8 + rand() * 24;
          const val = Math.floor(70 + rand() * 80);
          ctx.fillStyle = `rgba(${val}, ${val + Math.floor(rand() * 10)}, ${val + Math.floor(rand() * 18)}, 0.22)`;
          ctx.beginPath();
          ctx.ellipse(x, y, radius, radius * 0.45, 0.25, 0, Math.PI * 2);
          ctx.fill();
        }

        // Quartz & mineral crystal flecks
        for (let i = 0; i < 8000; i++) {
          const x = rand() * w;
          const y = rand() * h;
          const lum = rand() > 0.8 ? 240 : (rand() < 0.2 ? 30 : Math.floor(100 + rand() * 100));
          ctx.fillStyle = `rgba(${lum}, ${lum}, ${lum + 8}, 0.5)`;
          ctx.fillRect(x, y, 1.2 + rand() * 1.5, 1.2 + rand() * 1.5);
        }

        // Cracks & fissures
        ctx.lineWidth = 1.2;
        for (let c = 0; c < 15; c++) {
          let cx = rand() * w;
          let cy = rand() * h;
          ctx.strokeStyle = 'rgba(25, 27, 30, 0.45)';
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          for (let step = 0; step < 8; step++) {
            cx += (rand() - 0.4) * 20;
            cy += (rand() - 0.4) * 20;
            ctx.lineTo(cx, cy);
          }
          ctx.stroke();
        }
      });
    }
  },

  {
    id: 'forest_mulch',
    name: 'Forest Soil & Pine Mulch',
    category: 'ground',
    description: 'Rich dark humus earth with decaying organic pine bark, needles, and loamy texture',
    roughness: 0.95,
    metalness: 0.02,
    defaultRepeat: 8,
    previewColor: '#453123',
    generate: () => {
      if (textureCache.has('forest_mulch')) return textureCache.get('forest_mulch')!;
      return createNoiseCanvas('forest_mulch', 512, 512, (ctx, w, h) => {
        const rand = mulberry32(404);
        // Rich dark soil base
        ctx.fillStyle = '#2b1e16';
        ctx.fillRect(0, 0, w, h);

        // Mulch particles & bark chips
        for (let i = 0; i < 9000; i++) {
          const x = rand() * w;
          const y = rand() * h;
          const r = Math.floor(60 + rand() * 50);
          const g = Math.floor(40 + rand() * 35);
          const b = Math.floor(25 + rand() * 20);
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.55)`;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(rand() * Math.PI);
          ctx.fillRect(-3, -1.5, 6 + rand() * 5, 2.5 + rand() * 2);
          ctx.restore();
        }

        // Pine needles
        for (let i = 0; i < 2500; i++) {
          const x = rand() * w;
          const y = rand() * h;
          const len = 6 + rand() * 10;
          const ang = rand() * Math.PI * 2;
          ctx.strokeStyle = rand() > 0.5 ? 'rgba(120, 80, 35, 0.65)' : 'rgba(80, 95, 35, 0.5)';
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
          ctx.stroke();
        }
      });
    }
  },

  {
    id: 'desert_sand',
    name: 'Desert & Coastal Sand',
    category: 'ground',
    description: 'Fine golden silica sand with subtle wind ripple micro-patterns and mica mineral sparkles',
    roughness: 0.9,
    metalness: 0.05,
    defaultRepeat: 8,
    previewColor: '#d4b37d',
    generate: () => {
      if (textureCache.has('desert_sand')) return textureCache.get('desert_sand')!;
      return createNoiseCanvas('desert_sand', 512, 512, (ctx, w, h) => {
        const rand = mulberry32(505);
        // Golden sand foundation
        ctx.fillStyle = '#c9a56c';
        ctx.fillRect(0, 0, w, h);

        // Wind ripple wavy bands
        for (let y = 0; y < h; y += 14) {
          ctx.strokeStyle = 'rgba(175, 138, 85, 0.35)';
          ctx.lineWidth = 4;
          ctx.beginPath();
          for (let x = 0; x <= w; x += 16) {
            const waveY = y + Math.sin(x * 0.04) * 3.5 + Math.cos(x * 0.015) * 2;
            if (x === 0) ctx.moveTo(x, waveY);
            else ctx.lineTo(x, waveY);
          }
          ctx.stroke();
        }

        // Granular sand speckles
        for (let i = 0; i < 22000; i++) {
          const x = rand() * w;
          const y = rand() * h;
          const delta = (rand() - 0.5) * 55;
          const r = Math.max(0, Math.min(255, Math.floor(215 + delta)));
          const g = Math.max(0, Math.min(255, Math.floor(180 + delta * 0.9)));
          const b = Math.max(0, Math.min(255, Math.floor(125 + delta * 0.7)));
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.5)`;
          ctx.fillRect(x, y, 1.2, 1.2);
        }

        // Mica sparkle flecks
        for (let i = 0; i < 600; i++) {
          const x = rand() * w;
          const y = rand() * h;
          ctx.fillStyle = 'rgba(255, 250, 220, 0.75)';
          ctx.beginPath();
          ctx.arc(x, y, 0.8, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  },

  {
    id: 'cobblestone',
    name: 'Cobblestone Pavers',
    category: 'paved',
    description: 'Rustic architectural stone paving blocks with natural joint mortar and weathered edge bevels',
    roughness: 0.75,
    metalness: 0.05,
    defaultRepeat: 4,
    previewColor: '#7c7e82',
    generate: () => {
      if (textureCache.has('cobblestone')) return textureCache.get('cobblestone')!;
      return createNoiseCanvas('cobblestone', 512, 512, (ctx, w, h) => {
        const rand = mulberry32(606);
        // Mortar joint background
        ctx.fillStyle = '#3a3d40';
        ctx.fillRect(0, 0, w, h);

        const cols = 8;
        const rows = 12;
        const blockW = w / cols;
        const blockH = h / rows;
        const gap = 3.5;

        for (let r = 0; r < rows; r++) {
          const rowOffset = (r % 2) * (blockW / 2);
          for (let c = -1; c <= cols; c++) {
            const bx = c * blockW + rowOffset + gap / 2;
            const by = r * blockH + gap / 2;
            const bw = blockW - gap;
            const bh = blockH - gap;

            const tone = 0.85 + rand() * 0.3;
            const cr = Math.floor(120 * tone);
            const cg = Math.floor(122 * tone);
            const cb = Math.floor(125 * tone);

            ctx.fillStyle = `rgb(${cr}, ${cg}, ${cb})`;
            ctx.beginPath();
            // Rounded corners on pavers
            const rad = 3.5;
            ctx.roundRect ? ctx.roundRect(bx, by, bw, bh, rad) : ctx.rect(bx, by, bw, bh);
            ctx.fill();

            // Internal stone grain on each paver
            for (let k = 0; k < 120; k++) {
              const px = bx + rand() * bw;
              const py = by + rand() * bh;
              ctx.fillStyle = rand() > 0.5 ? 'rgba(230, 230, 230, 0.15)' : 'rgba(30, 30, 30, 0.2)';
              ctx.fillRect(px, py, 1.5, 1.5);
            }
          }
        }
      });
    }
  },

  {
    id: 'crushed_gravel',
    name: 'Crushed River Gravel',
    category: 'stone',
    description: 'Multi-tonal rounded river pebbles and crushed mineral stones for paths and driveways',
    roughness: 0.9,
    metalness: 0.1,
    defaultRepeat: 6,
    previewColor: '#8a8885',
    generate: () => {
      if (textureCache.has('crushed_gravel')) return textureCache.get('crushed_gravel')!;
      return createNoiseCanvas('crushed_gravel', 512, 512, (ctx, w, h) => {
        const rand = mulberry32(707);
        // Base dark aggregate sand
        ctx.fillStyle = '#444240';
        ctx.fillRect(0, 0, w, h);

        const stonesCount = 4500;
        for (let i = 0; i < stonesCount; i++) {
          const x = rand() * w;
          const y = rand() * h;
          const sizeX = 2.5 + rand() * 4;
          const sizeY = 2 + rand() * 3.5;
          const rot = rand() * Math.PI;

          // Color variety: greys, ochres, basalt, terracotta
          const paletteChoice = rand();
          let fill = '';
          if (paletteChoice < 0.45) {
            const g = Math.floor(120 + rand() * 60);
            fill = `rgb(${g}, ${g}, ${g + 5})`;
          } else if (paletteChoice < 0.75) {
            fill = `rgb(${Math.floor(160 + rand() * 40)}, ${Math.floor(135 + rand() * 35)}, ${Math.floor(100 + rand() * 30)})`;
          } else if (paletteChoice < 0.9) {
            const d = Math.floor(50 + rand() * 40);
            fill = `rgb(${d}, ${d}, ${d})`;
          } else {
            fill = `rgb(${Math.floor(140 + rand() * 30)}, ${Math.floor(90 + rand() * 25)}, ${Math.floor(75 + rand() * 20)})`;
          }

          ctx.fillStyle = fill;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(rot);
          ctx.beginPath();
          ctx.ellipse(0, 0, sizeX, sizeY, 0, 0, Math.PI * 2);
          ctx.fill();

          // Highlight rim
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.lineWidth = 0.6;
          ctx.stroke();
          ctx.restore();
        }
      });
    }
  },

  {
    id: 'fresh_snow',
    name: 'Fresh Alpine Snow',
    category: 'snow',
    description: 'Crisp high-altitude snowpack with subtle glacial blue shadows, wind crusting, and icy sparkle',
    roughness: 0.7,
    metalness: 0.05,
    defaultRepeat: 6,
    previewColor: '#e8edf5',
    generate: () => {
      if (textureCache.has('fresh_snow')) return textureCache.get('fresh_snow')!;
      return createNoiseCanvas('fresh_snow', 512, 512, (ctx, w, h) => {
        const rand = mulberry32(808);
        // Bright snow foundation with soft cool blue undertone
        ctx.fillStyle = '#ebf2fa';
        ctx.fillRect(0, 0, w, h);

        // Wind drift soft shading
        for (let i = 0; i < 2500; i++) {
          const x = rand() * w;
          const y = rand() * h;
          ctx.fillStyle = 'rgba(200, 220, 245, 0.25)';
          ctx.beginPath();
          ctx.ellipse(x, y, 12 + rand() * 20, 4 + rand() * 8, 0.3, 0, Math.PI * 2);
          ctx.fill();
        }

        // Crystalline frost sparkle
        for (let i = 0; i < 9000; i++) {
          const x = rand() * w;
          const y = rand() * h;
          const isBright = rand() > 0.85;
          ctx.fillStyle = isBright ? 'rgba(255, 255, 255, 0.95)' : 'rgba(235, 245, 255, 0.5)';
          ctx.fillRect(x, y, isBright ? 1.5 : 1, isBright ? 1.5 : 1);
        }
      });
    }
  },

  {
    id: 'weathered_asphalt',
    name: 'Weathered Road Asphalt',
    category: 'paved',
    description: 'Dense dark bitumen roadway aggregate with micro-pores, gravel flecks, and surface wear patina',
    roughness: 0.85,
    metalness: 0.1,
    defaultRepeat: 6,
    previewColor: '#2b2d30',
    generate: () => {
      if (textureCache.has('weathered_asphalt')) return textureCache.get('weathered_asphalt')!;
      return createNoiseCanvas('weathered_asphalt', 512, 512, (ctx, w, h) => {
        const rand = mulberry32(909);
        // Dark bitumen base
        ctx.fillStyle = '#26282b';
        ctx.fillRect(0, 0, w, h);

        // Aggregate stones embedded in tar
        for (let i = 0; i < 16000; i++) {
          const x = rand() * w;
          const y = rand() * h;
          const lum = Math.floor(55 + rand() * 65);
          ctx.fillStyle = `rgba(${lum}, ${lum}, ${lum + 4}, 0.55)`;
          ctx.fillRect(x, y, 1.2 + rand() * 1.6, 1.2 + rand() * 1.6);
        }

        // Dark tar patches & subtle wear marks
        for (let i = 0; i < 800; i++) {
          const x = rand() * w;
          const y = rand() * h;
          ctx.fillStyle = 'rgba(18, 19, 21, 0.4)';
          ctx.beginPath();
          ctx.arc(x, y, 2 + rand() * 5, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  },

  {
    id: 'terracotta_clay',
    name: 'Arid Clay & Terracotta',
    category: 'ground',
    description: 'Sun-baked terracotta soil with fine fissures, mineral crust, and warm earthen tones',
    roughness: 0.9,
    metalness: 0.05,
    defaultRepeat: 6,
    previewColor: '#ad5c39',
    generate: () => {
      if (textureCache.has('terracotta_clay')) return textureCache.get('terracotta_clay')!;
      return createNoiseCanvas('terracotta_clay', 512, 512, (ctx, w, h) => {
        const rand = mulberry32(1010);
        // Baked clay foundation
        ctx.fillStyle = '#9e502e';
        ctx.fillRect(0, 0, w, h);

        // Tonal variation
        for (let i = 0; i < 6000; i++) {
          const x = rand() * w;
          const y = rand() * h;
          const r = Math.floor(140 + rand() * 45);
          const g = Math.floor(70 + rand() * 35);
          const b = Math.floor(40 + rand() * 25);
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.45)`;
          ctx.beginPath();
          ctx.arc(x, y, 3 + rand() * 6, 0, Math.PI * 2);
          ctx.fill();
        }

        // Micro-fissures in dry mud
        ctx.lineWidth = 1.0;
        for (let c = 0; c < 20; c++) {
          let cx = rand() * w;
          let cy = rand() * h;
          ctx.strokeStyle = 'rgba(60, 25, 15, 0.45)';
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          for (let s = 0; s < 6; s++) {
            cx += (rand() - 0.45) * 16;
            cy += (rand() - 0.45) * 16;
            ctx.lineTo(cx, cy);
          }
          ctx.stroke();
        }
      });
    }
  }
];

export const LANDSCAPE_PRESET_IDS = new Set(LANDSCAPE_TEXTURES.map(t => t.id));

export function getLandscapeCanvas(key?: string): HTMLCanvasElement | null {
  if (!key) return null;
  if (canvasCache.has(key)) return canvasCache.get(key)!;
  const preset = LANDSCAPE_TEXTURES.find(t => t.id === key);
  if (preset) {
    preset.generate();
    return canvasCache.get(preset.id) || null;
  }
  return null;
}

export function getLandscapeTextureUrl(id: string): string {
  const preset = LANDSCAPE_TEXTURES.find(t => t.id === id) || LANDSCAPE_TEXTURES[0];
  return preset.generate();
}

