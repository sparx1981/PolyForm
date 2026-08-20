export interface ArchStyleDef {
  id: string;
  type: 'door' | 'window';
  name: string;
  category: 'Modern' | 'Classic' | 'Commercial' | 'Specialty';
  description: string;
  defaultDimensions: [number, number, number]; // [width, height, depth]
  hasGlass: boolean;
  features: string[];
}

export const DOOR_STYLES: ArchStyleDef[] = [
  {
    id: 'flush',
    type: 'door',
    name: 'Modern Flush Door',
    category: 'Modern',
    description: 'Clean minimalist architectural flat panel with contemporary stainless lever handle.',
    defaultDimensions: [0.9, 2.1, 0.15],
    hasGlass: false,
    features: ['Minimalist Flush Leaf', 'Stainless Lever Handle', 'Concealed Frame']
  },
  {
    id: '4panel',
    type: 'door',
    name: '4-Panel Classic Victorian',
    category: 'Classic',
    description: 'Traditional solid timber door with four recessed moulded panels and brass round knob.',
    defaultDimensions: [0.9, 2.1, 0.15],
    hasGlass: false,
    features: ['4 Moulded Bevel Panels', 'Classic Round Knob', 'Traditional Casing']
  },
  {
    id: 'french',
    type: 'door',
    name: 'Full-Lite French Glass Door',
    category: 'Classic',
    description: 'Full-height 6-pane divided light glass door providing natural daylight flow.',
    defaultDimensions: [0.9, 2.1, 0.15],
    hasGlass: true,
    features: ['6 Clear Glass Lights', 'Perimeter Timber Stile', 'Decorative Muntins']
  },
  {
    id: 'half-glass',
    type: 'door',
    name: 'Craftsman Half-Glass Door',
    category: 'Modern',
    description: 'Upper half dual clear glass panes with lower solid recessed shaker panel.',
    defaultDimensions: [0.9, 2.1, 0.15],
    hasGlass: true,
    features: ['Upper Dual Glass Panes', 'Lower Solid Shaker', 'Architectural Handle']
  },
  {
    id: 'double-french',
    type: 'door',
    name: 'Double French Glass Doors',
    category: 'Classic',
    description: 'Grand dual-leaf pair with 12 divided clear glass panes and central astragal.',
    defaultDimensions: [1.8, 2.1, 0.15],
    hasGlass: true,
    features: ['Dual Master Leafs', '12 Clear Glass Panes', 'Central Astragal & Locks']
  },
  {
    id: 'barn',
    type: 'door',
    name: 'Shaker Barn / Z-Brace Door',
    category: 'Specialty',
    description: 'Rustic contemporary sliding barn door with diagonal Z-brace battens and top header rail.',
    defaultDimensions: [1.0, 2.15, 0.15],
    hasGlass: false,
    features: ['Z-Brace Diagonal Battens', 'Top Roller Track Guide', 'Black Metal Pull Bar']
  },
  {
    id: 'horizontal-slat',
    type: 'door',
    name: 'Contemporary Horizontal Groove',
    category: 'Modern',
    description: 'Modern entrance door with 5 horizontal shadow reveal lines and long stainless pull.',
    defaultDimensions: [0.95, 2.1, 0.15],
    hasGlass: false,
    features: ['5 Shadow Reveal Grooves', 'Extended Pull Handle', 'Contemporary Styling']
  },
  {
    id: 'pivot',
    type: 'door',
    name: 'Grand Architectural Pivot Door',
    category: 'Modern',
    description: 'Oversized luxury entrance door with offset pivot axis and full-height vertical bar pull.',
    defaultDimensions: [1.2, 2.4, 0.18],
    hasGlass: false,
    features: ['Offset Pivot Pins', '1.8m Vertical Pull Bar', 'Oversized Luxury Scale']
  }
];

export const WINDOW_STYLES: ArchStyleDef[] = [
  {
    id: 'cross',
    type: 'window',
    name: 'Classic 4-Pane Casement',
    category: 'Classic',
    description: 'Timeless 2x2 grid casement window with exterior sill and clear see-through glass.',
    defaultDimensions: [1.2, 1.2, 0.12],
    hasGlass: true,
    features: ['2x2 Divided Light Grid', 'Sill Ledge Overhang', 'Clear See-Through Glass']
  },
  {
    id: 'picture',
    type: 'window',
    name: 'Panoramic Picture Window',
    category: 'Modern',
    description: 'Unobstructed single large glass pane offering uninterrupted outdoor views.',
    defaultDimensions: [1.6, 1.4, 0.12],
    hasGlass: true,
    features: ['Single Large Glass Pane', 'Ultra-Slim Perimeter Frame', 'Panoramic Sightlines']
  },
  {
    id: 'georgian',
    type: 'window',
    name: '6-Pane Georgian / Colonial',
    category: 'Classic',
    description: 'Colonial style 3x2 divided light grid with slender architectural glazing bars.',
    defaultDimensions: [1.2, 1.5, 0.12],
    hasGlass: true,
    features: ['3x2 Colonial Grid (6 Panes)', 'Architectural Glazing Bars', 'Exterior Drip Sill']
  },
  {
    id: 'slider',
    type: 'window',
    name: '2-Pane Horizontal Slider',
    category: 'Modern',
    description: 'Dual sash horizontal sliding window with overlapping center meeting rail.',
    defaultDimensions: [1.5, 1.0, 0.12],
    hasGlass: true,
    features: ['Dual Overlapping Sashes', 'Center Interlock Rail', 'Low Profile Sill']
  },
  {
    id: 'ribbon',
    type: 'window',
    name: '3-Pane Panoramic Ribbon',
    category: 'Modern',
    description: 'Wide horizontal ribbon window divided into 3 equal modern landscape panes.',
    defaultDimensions: [2.4, 0.9, 0.12],
    hasGlass: true,
    features: ['3 Panoramic Landscape Panes', 'Vertical Slim Dividers', 'Modern Horizontal Flow']
  },
  {
    id: 'arch',
    type: 'window',
    name: 'Arched Top / Palladian Window',
    category: 'Classic',
    description: 'Elegant semi-circular arched transom top with radial divided clear glass.',
    defaultDimensions: [1.2, 1.8, 0.12],
    hasGlass: true,
    features: ['Curved Arched Header', 'Radial Sunburst Glazing', 'Lower Dual Casements']
  },
  {
    id: 'double-hung',
    type: 'window',
    name: 'Traditional Double-Hung Sash',
    category: 'Classic',
    description: 'Two vertically sliding sashes with prominent meeting rail and deep exterior sill.',
    defaultDimensions: [1.0, 1.5, 0.14],
    hasGlass: true,
    features: ['Upper & Lower Sashes', 'Center Meeting Rail', 'Traditional Deep Sill']
  },
  {
    id: 'transom',
    type: 'window',
    name: 'Transom Hopper & Fixed Window',
    category: 'Commercial',
    description: 'Upper horizontal ventilation transom hopper positioned above fixed main viewing pane.',
    defaultDimensions: [1.2, 1.6, 0.12],
    hasGlass: true,
    features: ['Upper 1/3 Transom Hopper', 'Lower 2/3 Fixed Pane', 'Horizontal Transom Bar']
  }
];
