// Procedural Roof Tile Texture and Material Generator
// Supports customizable tile shapes, tile sizes, solid colors, textures, and multi-color randomization

export type RoofTileShape = 
  | 'none'          // No 3D tiles / smooth clean roof planes (maximum performance)
  | 'roman'         // Curved Spanish / Mission barrel
  | 'flat'          // Interlocking rectangular slate / shingle
  | 'scallop'       // Beaver-tail / rounded fish-scale
  | 'diamond'       // French diagonal rhombus / lozenge
  | 'pantile'       // S-curve undulating wave profile
  | 'standing-seam';// Modern standing seam architectural metal ribs

export interface RoofTilePaletteItem {
  id: string;
  type: 'color' | 'texture';
  value: string; // Hex color string or texture identifier
  name: string;
}

export interface RoofTileSettings {
  shape: RoofTileShape;
  size: number; // in meters, e.g. 0.35m (range: 0.15m - 0.80m)
  color: string; // primary base color
  randomizeColor: boolean;
  colorPalette: RoofTilePaletteItem[]; // up to 8 user-defined colors or textures
  seed?: number;
}

export interface TileShapeOption {
  id: RoofTileShape;
  name: string;
  category: 'performance' | 'traditional' | 'contemporary' | 'heritage';
  description: string;
  svgPath: string;
}

export const ROOF_TILE_SHAPES: TileShapeOption[] = [
  {
    id: 'none',
    name: 'No Tile (Smooth / Fast)',
    category: 'performance',
    description: 'Clean planar roof planes with zero tile geometry or tile textures for maximum rendering performance.',
    svgPath: 'M20 2C10.06 2 2 10.06 2 20C2 29.94 10.06 38 20 38C29.94 38 38 29.94 38 20C38 10.06 29.94 2 20 2ZM6 20C6 12.27 12.27 6 20 6C23.23 6 26.2 7.1 28.59 8.94L8.94 28.59C7.1 26.2 6 23.23 6 20ZM20 34C16.77 34 13.8 32.9 11.41 31.06L31.06 11.41C32.9 13.8 34 16.77 34 20C34 27.73 27.73 34 20 34Z'
  },
  {
    id: 'roman',
    name: 'Spanish / Roman Barrel',
    category: 'traditional',
    description: 'Curved barrel tiles with alternating convex caps, deep shadow troughs, and Mediterranean warmth.',
    svgPath: 'M2 14C5 8 11 8 14 14C17 8 23 8 26 14C29 8 35 8 38 14V32C35 26 29 26 26 32C23 26 17 26 14 32C11 26 5 26 2 32Z'
  },
  {
    id: 'flat',
    name: 'Flat Interlocking Slate',
    category: 'contemporary',
    description: 'Crisp rectangular interlocking slate and shingles laid in staggered running bond.',
    svgPath: 'M2 6H38V18H2ZM2 18H20V30H2ZM20 18H38V30H20Z'
  },
  {
    id: 'scallop',
    name: 'Beaver-Tail Scallop',
    category: 'heritage',
    description: 'Heritage fish-scale rounded bottom tiles creating ornamental European architectural roofs.',
    svgPath: 'M2 6H38V16C38 24 30 30 20 30C10 30 2 24 2 16Z'
  },
  {
    id: 'diamond',
    name: 'Diamond Lozenge',
    category: 'heritage',
    description: 'Diagonal rhombus interlocking tiles forming geometric diamond facets.',
    svgPath: 'M20 2L36 18L20 34L4 18Z'
  },
  {
    id: 'pantile',
    name: 'S-Curve Pantile',
    category: 'traditional',
    description: 'Continuous undulating S-curve profile with elegant light roll and drainage flutes.',
    svgPath: 'M2 18C2 10 10 10 16 18C22 26 30 26 38 18V30C30 38 22 38 16 30C10 22 2 22 2 30Z'
  },
  {
    id: 'standing-seam',
    name: 'Standing Seam Metal',
    category: 'contemporary',
    description: 'Modern architectural metal trays separated by crisp, raised vertical interlocking ribs.',
    svgPath: 'M4 4H10V32H4ZM18 4H24V32H18ZM32 4H38V32H32Z'
  }
];

export const PRESET_ROOF_COLORS = [
  { name: 'Terracotta Red', value: '#991b1b', type: 'color' as const },
  { name: 'Spanish Clay', value: '#b45309', type: 'color' as const },
  { name: 'Tuscan Ochre', value: '#d97706', type: 'color' as const },
  { name: 'Burnt Umber', value: '#7c2d12', type: 'color' as const },
  { name: 'Charcoal Slate', value: '#1e293b', type: 'color' as const },
  { name: 'Anthracite Zinc', value: '#334155', type: 'color' as const },
  { name: 'Weathered Lead', value: '#475569', type: 'color' as const },
  { name: 'Forest Green', value: '#14532d', type: 'color' as const },
];

export const PRESET_ROOF_TEXTURES = [
  { id: 'weathered_clay', name: 'Weathered Clay', previewColor: '#a84e2a', baseColor: '#964423' },
  { id: 'aged_slate', name: 'Aged Slate', previewColor: '#2b3340', baseColor: '#252c38' },
  { id: 'copper_patina', name: 'Copper Patina', previewColor: '#2d8276', baseColor: '#256d63' },
  { id: 'mossy_terracotta', name: 'Mossy Terracotta', previewColor: '#846034', baseColor: '#78562d' },
  { id: 'glazed_ceramic', name: 'Glazed Ceramic', previewColor: '#294361', baseColor: '#1e344d' },
  { id: 'sandstone_rustic', name: 'Rustic Sandstone', previewColor: '#b88950', baseColor: '#aa7a42' },
];

export const DEFAULT_ROOF_TILE_SETTINGS: RoofTileSettings = {
  shape: 'roman',
  size: 0.35, // 35 cm standard
  color: '#991b1b',
  randomizeColor: false,
  colorPalette: [
    { id: 'pal-1', type: 'color', value: '#991b1b', name: 'Terracotta' },
    { id: 'pal-2', type: 'color', value: '#b45309', name: 'Spanish Clay' },
    { id: 'pal-3', type: 'color', value: '#7c2d12', name: 'Burnt Umber' },
    { id: 'pal-4', type: 'color', value: '#d97706', name: 'Tuscan Ochre' },
  ],
  seed: 42,
};

const _tileTextureCache = new Map<string, string>();
const _tileCanvasCache = new Map<string, HTMLCanvasElement>();

export function getRoofTileCanvas(key: string): HTMLCanvasElement | undefined {
  return _tileCanvasCache.get(key);
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const n = parseInt(full || '991b1b', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + [clamp(r), clamp(g), clamp(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function adjustColorBrightness(hex: string, percent: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 + percent), g * (1 + percent), b * (1 + percent));
}

// Deterministic pseudorandom generator
function mulberry32(a: number) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Generates a seamless high-resolution procedural roof tile texture canvas.
 */
export function generateRoofTileTexture(settings: Partial<RoofTileSettings>): string {
  if (typeof document === 'undefined') return '';

  const cfg: RoofTileSettings = {
    ...DEFAULT_ROOF_TILE_SETTINGS,
    ...settings,
    colorPalette: (settings.colorPalette && settings.colorPalette.length > 0) 
      ? settings.colorPalette.slice(0, 8) 
      : DEFAULT_ROOF_TILE_SETTINGS.colorPalette,
  };

  if (cfg.shape === 'none') {
    return '';
  }

  const cacheKey = JSON.stringify({
    shape: cfg.shape,
    size: cfg.size,
    color: cfg.color,
    rand: cfg.randomizeColor,
    pal: cfg.colorPalette.map(p => `${p.type}:${p.value}`),
    seed: cfg.seed || 42
  });

  if (_tileTextureCache.has(cacheKey)) {
    return _tileTextureCache.get(cacheKey)!;
  }

  const canvas = document.createElement('canvas');
  const sizePx = 512;
  canvas.width = sizePx;
  canvas.height = sizePx;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const rng = mulberry32(cfg.seed || 42);

  // Background underlay
  ctx.fillStyle = adjustColorBrightness(cfg.color, -0.35);
  ctx.fillRect(0, 0, sizePx, sizePx);

  // Grid sizing based on tile shape and size
  let cols = 8;
  let rows = 12;

  if (cfg.shape === 'standing-seam') {
    cols = 8;
    rows = 1; // Seamless vertical sheets
  } else if (cfg.shape === 'diamond') {
    cols = 8;
    rows = 8;
  } else if (cfg.shape === 'flat') {
    cols = 6;
    rows = 14;
  } else if (cfg.shape === 'scallop') {
    cols = 8;
    rows = 14;
  } else if (cfg.shape === 'roman') {
    cols = 8;
    rows = 12;
  } else if (cfg.shape === 'pantile') {
    cols = 8;
    rows = 12;
  }

  const tileW = sizePx / cols;
  const tileH = sizePx / rows;

  const getTileFill = (c: number, r: number): { hex: string; textureId?: string } => {
    if (!cfg.randomizeColor || cfg.colorPalette.length === 0) {
      // Subtle natural variation even without randomization
      const jitter = (rng() - 0.5) * 0.12;
      return { hex: adjustColorBrightness(cfg.color, jitter) };
    }

    const itemIdx = Math.floor(rng() * cfg.colorPalette.length);
    const item = cfg.colorPalette[itemIdx] || cfg.colorPalette[0];

    if (item.type === 'texture') {
      const texPreset = PRESET_ROOF_TEXTURES.find(t => t.id === item.value);
      const base = texPreset ? texPreset.baseColor : cfg.color;
      const jitter = (rng() - 0.5) * 0.14;
      return { hex: adjustColorBrightness(base, jitter), textureId: item.value };
    }

    const jitter = (rng() - 0.5) * 0.14;
    return { hex: adjustColorBrightness(item.value, jitter) };
  };

  // 1. STANDING SEAM METAL
  if (cfg.shape === 'standing-seam') {
    for (let c = 0; c < cols; c++) {
      const x = c * tileW;
      const fill = getTileFill(c, 0);

      // Pan base gradient
      const panGrad = ctx.createLinearGradient(x, 0, x + tileW, 0);
      panGrad.addColorStop(0, adjustColorBrightness(fill.hex, 0.08));
      panGrad.addColorStop(0.15, fill.hex);
      panGrad.addColorStop(0.85, adjustColorBrightness(fill.hex, -0.05));
      panGrad.addColorStop(1, adjustColorBrightness(fill.hex, -0.25));

      ctx.fillStyle = panGrad;
      ctx.fillRect(x, 0, tileW, sizePx);

      // Subtle metallic micro-texture lines
      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
      for (let i = 0; i < 4; i++) {
        const lx = x + 6 + (tileW - 12) * (i / 3);
        ctx.fillRect(lx, 0, 1.5, sizePx);
      }

      // Vertical Standing Seam Rib (raised double fold)
      const seamW = 6;
      ctx.fillStyle = adjustColorBrightness(fill.hex, -0.5); // Deep shadow side
      ctx.fillRect(x + tileW - seamW, 0, seamW, sizePx);

      ctx.fillStyle = adjustColorBrightness(fill.hex, 0.35); // Sharp highlight cap
      ctx.fillRect(x + tileW - seamW + 1.5, 0, 2, sizePx);
    }
  }

  // 2. FLAT SLATE / SHINGLE
  else if (cfg.shape === 'flat') {
    for (let r = 0; r < rows; r++) {
      const y = r * tileH;
      const xOffset = (r % 2 === 1) ? tileW * 0.5 : 0;

      for (let c = -1; c <= cols + 1; c++) {
        const x = c * tileW + xOffset;
        const fill = getTileFill(c, r);

        // Tile body with slate gradient
        const slateGrad = ctx.createLinearGradient(x, y, x, y + tileH);
        slateGrad.addColorStop(0, adjustColorBrightness(fill.hex, 0.12));
        slateGrad.addColorStop(0.7, fill.hex);
        slateGrad.addColorStop(1, adjustColorBrightness(fill.hex, -0.22));

        ctx.fillStyle = slateGrad;
        ctx.fillRect(x + 1, y + 1, tileW - 2, tileH - 2);

        // Slate fine grain fissures
        ctx.fillStyle = 'rgba(0, 0, 0, 0.06)';
        ctx.fillRect(x + 4, y + tileH * 0.4, tileW - 8, 1);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(x + 5, y + tileH * 0.7, tileW - 10, 1);

        // Top and Left edge bevel highlight
        ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.fillRect(x + 1, y + 1, tileW - 2, 1.5);
        ctx.fillRect(x + 1, y + 1, 1.5, tileH - 2);

        // Bottom overlap cast shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(x, y + tileH - 2.5, tileW, 2.5);

        // Vertical joint gap
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(x + tileW - 1.5, y, 1.5, tileH);
      }
    }
  }

  // 3. SPANISH / ROMAN BARREL
  else if (cfg.shape === 'roman') {
    for (let r = 0; r < rows; r++) {
      const y = r * tileH;

      for (let c = 0; c < cols; c++) {
        const x = c * tileW;
        const fill = getTileFill(c, r);

        // Under-tile (trough)
        ctx.fillStyle = adjustColorBrightness(fill.hex, -0.4);
        ctx.fillRect(x, y, tileW * 0.35, tileH);

        // Over-tile (barrel roll)
        const rollX = x + tileW * 0.2;
        const rollW = tileW * 0.75;
        const rollGrad = ctx.createLinearGradient(rollX, 0, rollX + rollW, 0);
        rollGrad.addColorStop(0, adjustColorBrightness(fill.hex, -0.3));
        rollGrad.addColorStop(0.35, adjustColorBrightness(fill.hex, 0.35)); // Sunlight crest
        rollGrad.addColorStop(0.7, fill.hex);
        rollGrad.addColorStop(1, adjustColorBrightness(fill.hex, -0.45)); // Shadow trough

        ctx.fillStyle = rollGrad;
        ctx.beginPath();
        // Barrel lip at bottom
        ctx.moveTo(rollX, y);
        ctx.lineTo(rollX + rollW, y);
        ctx.lineTo(rollX + rollW, y + tileH - 4);
        ctx.bezierCurveTo(rollX + rollW - 2, y + tileH, rollX + 2, y + tileH, rollX, y + tileH - 4);
        ctx.closePath();
        ctx.fill();

        // Barrel bottom lip shadow and highlight
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(rollX + rollW * 0.2, y + tileH - 2);
        ctx.lineTo(rollX + rollW * 0.6, y + tileH - 2);
        ctx.stroke();

        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fillRect(rollX, y + tileH - 2, rollW, 2);
      }
    }
  }

  // 4. BEAVER-TAIL SCALLOP
  else if (cfg.shape === 'scallop') {
    for (let r = 0; r < rows; r++) {
      const y = r * tileH;
      const xOffset = (r % 2 === 1) ? tileW * 0.5 : 0;

      for (let c = -1; c <= cols + 1; c++) {
        const x = c * tileW + xOffset;
        const fill = getTileFill(c, r);

        const scallopGrad = ctx.createLinearGradient(x, y, x, y + tileH);
        scallopGrad.addColorStop(0, adjustColorBrightness(fill.hex, 0.15));
        scallopGrad.addColorStop(0.6, fill.hex);
        scallopGrad.addColorStop(1, adjustColorBrightness(fill.hex, -0.25));

        ctx.fillStyle = scallopGrad;
        ctx.beginPath();
        ctx.moveTo(x + 2, y);
        ctx.lineTo(x + tileW - 2, y);
        ctx.lineTo(x + tileW - 2, y + tileH * 0.6);
        // Rounded beaver-tail bottom arc
        ctx.bezierCurveTo(x + tileW - 2, y + tileH, x + 2, y + tileH, x + 2, y + tileH * 0.6);
        ctx.closePath();
        ctx.fill();

        // Rim highlight on curve
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x + tileW * 0.5, y + tileH * 0.6, tileW * 0.42, 0.1 * Math.PI, 0.9 * Math.PI, false);
        ctx.stroke();

        // Bottom drop shadow
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x + tileW * 0.5, y + tileH * 0.65, tileW * 0.44, 0.15 * Math.PI, 0.85 * Math.PI, false);
        ctx.stroke();
      }
    }
  }

  // 5. DIAMOND LOZENGE
  else if (cfg.shape === 'diamond') {
    for (let r = 0; r < rows; r++) {
      const y = r * tileH;
      const xOffset = (r % 2 === 1) ? tileW * 0.5 : 0;

      for (let c = -1; c <= cols + 1; c++) {
        const x = c * tileW + xOffset;
        const cx = x + tileW * 0.5;
        const cy = y + tileH * 0.5;
        const fill = getTileFill(c, r);

        // Diamond facets
        // Left facet (lighter)
        ctx.fillStyle = adjustColorBrightness(fill.hex, 0.12);
        ctx.beginPath();
        ctx.moveTo(cx, y);
        ctx.lineTo(x, cy);
        ctx.lineTo(cx, y + tileH);
        ctx.closePath();
        ctx.fill();

        // Right facet (darker / shadow)
        ctx.fillStyle = adjustColorBrightness(fill.hex, -0.15);
        ctx.beginPath();
        ctx.moveTo(cx, y);
        ctx.lineTo(x + tileW, cy);
        ctx.lineTo(cx, y + tileH);
        ctx.closePath();
        ctx.fill();

        // Diamond bevel seams
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(cx, y);
        ctx.lineTo(x, cy);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(x, cy);
        ctx.lineTo(cx, y + tileH);
        ctx.lineTo(x + tileW, cy);
        ctx.stroke();
      }
    }
  }

  // 6. PANTILE S-CURVE
  else if (cfg.shape === 'pantile') {
    for (let r = 0; r < rows; r++) {
      const y = r * tileH;

      for (let c = 0; c < cols; c++) {
        const x = c * tileW;
        const fill = getTileFill(c, r);

        // S-curve wave gradient
        const waveGrad = ctx.createLinearGradient(x, 0, x + tileW, 0);
        waveGrad.addColorStop(0, adjustColorBrightness(fill.hex, -0.35)); // Trough shadow
        waveGrad.addColorStop(0.25, fill.hex);
        waveGrad.addColorStop(0.55, adjustColorBrightness(fill.hex, 0.3)); // Wave roll crest
        waveGrad.addColorStop(0.85, fill.hex);
        waveGrad.addColorStop(1, adjustColorBrightness(fill.hex, -0.3));

        ctx.fillStyle = waveGrad;
        ctx.fillRect(x, y, tileW, tileH - 2);

        // Horizontal lap shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fillRect(x, y + tileH - 3, tileW, 3);

        // Tile overlap lip highlight
        ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.fillRect(x + tileW * 0.3, y + tileH - 4, tileW * 0.4, 1.5);
      }
    }
  }

  _tileCanvasCache.set(cacheKey, canvas);
  const dataUrl = canvas.toDataURL('image/png');
  _tileTextureCache.set(cacheKey, dataUrl);
  _tileCanvasCache.set(dataUrl, canvas);

  return dataUrl;
}
