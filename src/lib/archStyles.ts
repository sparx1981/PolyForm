export interface ArchStyleDef {
  id: string;
  type: 'door' | 'window' | 'staircase' | 'wall';
  name: string;
  category: 'Modern' | 'Classic' | 'Commercial' | 'Specialty' | 'Layout' | 'Structure' | 'Overlapping' | 'Interlocking' | 'Inline / Flush' | 'Masonry';
  description: string;
  defaultDimensions: [number, number, number]; // [width, height, depth/length]
  hasGlass: boolean;
  features: string[];
  claddingCategory?: 'Overlapping' | 'Interlocking' | 'Inline / Flush' | 'Masonry';
}

export interface StairStructureOption {
  id: 'closed' | 'open' | 'floating' | 'mono-stringer';
  name: string;
  description: string;
}

export interface RailingOption {
  id: 'none' | 'left' | 'right' | 'both';
  name: string;
  description: string;
}

export const STAIR_STRUCTURE_OPTIONS: StairStructureOption[] = [
  {
    id: 'closed',
    name: 'Closed Riser',
    description: 'Traditional solid construction with fully enclosed vertical riser boards connecting each step.'
  },
  {
    id: 'open',
    name: 'Open Riser',
    description: 'Contemporary airy design without vertical backing boards, allowing light to pass between steps.'
  },
  {
    id: 'floating',
    name: 'Floating (Cantilevered)',
    description: 'Treads anchored directly to wall structure with hidden steel brackets, appearing to hover in mid-air.'
  },
  {
    id: 'mono-stringer',
    name: 'Central Stringer (Mono Stringer)',
    description: 'Treads mounted atop a single structural steel or heavy timber spine beam running underneath the flight.'
  }
];

export const RAILING_OPTIONS: RailingOption[] = [
  {
    id: 'none',
    name: 'No Railing',
    description: 'Open staircase without handrails or balustrades.'
  },
  {
    id: 'left',
    name: 'Left Side Only',
    description: 'Architectural handrail and balusters installed on the left flight side.'
  },
  {
    id: 'right',
    name: 'Right Side Only',
    description: 'Architectural handrail and balusters installed on the right flight side.'
  },
  {
    id: 'both',
    name: 'Both Sides',
    description: 'Complete dual-side balustrade handrails along both left and right edges.'
  }
];

export const STAIR_STYLES: ArchStyleDef[] = [
  {
    id: 'straight',
    type: 'staircase',
    name: 'Straight Flight',
    category: 'Layout',
    description: 'A single continuous linear flight of stairs without bends or intermediate landings. Clean, direct, and cost-effective.',
    defaultDimensions: [1.0, 2.7, 3.8],
    hasGlass: false,
    features: ['Single Continuous Flight', 'Direct Linear Ascent', 'Standard Floor-to-Floor Transition']
  },
  {
    id: 'l-shape',
    type: 'staircase',
    name: 'L-Shaped (Quarter-Turn)',
    category: 'Layout',
    description: 'A straight lower flight that makes a 90-degree turn at a flat corner landing. Fits neatly into room corners and adds visual privacy.',
    defaultDimensions: [1.0, 2.7, 3.2],
    hasGlass: false,
    features: ['90° Quarter-Turn Corner', 'Intermediate Rest Landing', 'Ideal Corner Placement']
  },
  {
    id: 'u-shape',
    type: 'staircase',
    name: 'U-Shaped (Half-Turn / Switchback)',
    category: 'Layout',
    description: 'Two parallel flights connected by a 180-degree switchback landing. Compact footprint with an efficient vertical circulation core.',
    defaultDimensions: [2.0, 2.7, 2.4],
    hasGlass: false,
    features: ['180° Switchback Turn', 'Dual Parallel Flights', 'Compact Floorplan Footprint']
  },
  {
    id: 'c-shape',
    type: 'staircase',
    name: 'C-Shaped (Half-Turn Curved)',
    category: 'Layout',
    description: 'Continuous 180-degree radial curved sweep along an exterior wall rather than sharp 90-degree landing corners.',
    defaultDimensions: [2.2, 2.7, 2.8],
    hasGlass: false,
    features: ['180° Continuous Curved Arc', 'Wall-Hugging Radial Treads', 'Smooth Architectural Flow']
  },
  {
    id: 'winder',
    type: 'staircase',
    name: 'Winder (Quarter-Turn with Winders)',
    category: 'Layout',
    description: 'A space-saving quarter-turn variation that replaces the flat landing with triangular pie-wedge steps.',
    defaultDimensions: [1.0, 2.7, 2.9],
    hasGlass: false,
    features: ['Space-Saving Pie Winders', 'Continuous Corner Ascent', 'Compact 90° Corner Transition']
  },
  {
    id: 'spiral',
    type: 'staircase',
    name: 'Spiral Staircase (Central Post)',
    category: 'Layout',
    description: 'Treads radiate outward in a full 360-degree helical circle around a central vertical column post. Ultra-compact footprint.',
    defaultDimensions: [2.0, 2.7, 2.0],
    hasGlass: false,
    features: ['Central Steel Column Spine', '360° Radial Fan Treads', 'Ultra-Compact Diameter Footprint']
  },
  {
    id: 'curved',
    type: 'staircase',
    name: 'Curved / Helical (Open-Center)',
    category: 'Layout',
    description: 'Gracefully swoops in a grand continuous arc without a central post, creating a striking focal point for luxury foyers and open halls.',
    defaultDimensions: [2.8, 2.7, 3.4],
    hasGlass: false,
    features: ['Grand Open-Center Arc', 'Dual Curved Stringers', 'Luxury Foyer Statement']
  },
  {
    id: 'bifurcated',
    type: 'staircase',
    name: 'Bifurcated (Grand Grandstand)',
    category: 'Layout',
    description: 'Wide master flight rising to an intermediate central landing, then splitting into two opposite-facing wings. Iconic imperial entryway staircase.',
    defaultDimensions: [5.8, 2.7, 3.8],
    hasGlass: false,
    features: ['Wide Master Bottom Flight', 'Dual Symmetrical Top Wings', 'Grand Mezzanine Landing']
  }
];

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
  },
  {
    id: 'bifold',
    type: 'door',
    name: 'Bi-Fold Multi-Leaf Patio Door',
    category: 'Modern',
    description: 'Architectural multi-panel concertina folding patio doors with slim aluminum sightlines and flush floor track.',
    defaultDimensions: [2.4, 2.1, 0.15],
    hasGlass: true,
    features: ['3-Leaf Concertina Folding Panels', 'Overhead Top Roller Track', 'Flush Floor Threshold', 'Full-Width Outdoor Opening']
  },
  {
    id: 'patio-sliding',
    type: 'door',
    name: 'Sliding Glass Patio Door',
    category: 'Modern',
    description: 'Wide dual-panel sliding glass door with large expansive view and heavy-duty sliding rollers.',
    defaultDimensions: [2.0, 2.1, 0.15],
    hasGlass: true,
    features: ['Dual Expansive Glass Panes', 'Heavy Duty Roller Guides', 'Integrated Security Deadbolt', 'Seamless Patio Access']
  },
  {
    id: 'shutters',
    type: 'door',
    name: 'French Doors with Louvered Shutters',
    category: 'Classic',
    description: 'Full-lite French glass doors flanked by authentic operable louvered exterior timber shutters with wrought iron strap hinges.',
    defaultDimensions: [1.8, 2.1, 0.18],
    hasGlass: true,
    features: ['Dual French Glass Leafs', 'Operable Louvered Shutters', 'Wrought Iron Strap Hinges', 'Traditional Architectural Charm']
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
  },
  {
    id: 'bay',
    type: 'window',
    name: '3-Sided Architectural Bay Window',
    category: 'Classic',
    description: 'Cantilevered 3-sided bay window projecting outward from the wall plane with wide center picture window and dual 45° flanking sashes.',
    defaultDimensions: [2.0, 1.5, 0.45],
    hasGlass: true,
    features: ['45° Angled Flanking Casements', 'Wide Center Picture Pane', 'Projecting Sill & Base Shelf', 'Panoramic Daylighting']
  },
  {
    id: 'velux-roof',
    type: 'window',
    name: 'Velux Roof Skylight Window',
    category: 'Specialty',
    description: 'Roof-integrated pitched skylight window with perimeter weather flashing, center-pivot opening sash, and low-E insulated glass.',
    defaultDimensions: [0.9, 1.2, 0.15],
    hasGlass: true,
    features: ['Pitched Roof Flashing Collar', 'Center-Pivot Opening Sash', 'Low-E Insulated Glazing', 'Top Control Ventilation Bar']
  }
];

export const WALL_STYLES: ArchStyleDef[] = [
  // 1. OVERLAPPING PROFILES
  {
    id: 'feather-edge',
    type: 'wall',
    name: 'Feather Edge (Weatherboard)',
    category: 'Overlapping',
    claddingCategory: 'Overlapping',
    description: 'Traditional horizontal tapered timber boards lapped thick-edge over thin-edge. Delivers superior water shedding and deep classic shadow lines.',
    defaultDimensions: [3.0, 2.8, 0.20],
    hasGlass: false,
    features: ['Tapered Overlap Profile', 'Horizontal Sawn Texture', 'Traditional Water Runoff', 'Deep Natural Shadow Lines']
  },
  {
    id: 'standard-overlap',
    type: 'wall',
    name: 'Standard Overlap Boarding',
    category: 'Overlapping',
    claddingCategory: 'Overlapping',
    description: 'Uniform rectangular horizontal boards overlapping with a consistent exposed face. Robust, economical, and timeless exterior envelope.',
    defaultDimensions: [3.0, 2.8, 0.20],
    hasGlass: false,
    features: ['Uniform Board Spacing', 'Clean Stepped Shadow', 'Horizontal Lap Joints', 'Proven Weather Protection']
  },

  // 2. INTERLOCKING PROFILES
  {
    id: 'tongue-groove',
    type: 'wall',
    name: 'Tongue & Groove (T&G)',
    category: 'Interlocking',
    claddingCategory: 'Interlocking',
    description: 'Precision milled interlocking boards with subtle V-joint chamfers. Provides a weather-tight, smooth flush facade with clean linear accents.',
    defaultDimensions: [3.0, 2.8, 0.20],
    hasGlass: false,
    features: ['Interlocking Tongue & Groove', 'Micro V-Joint Channels', 'Modern Flush Alignment', 'Concealed Fastening']
  },
  {
    id: 'shiplap',
    type: 'wall',
    name: 'Shiplap Cladding',
    category: 'Interlocking',
    claddingCategory: 'Interlocking',
    description: 'Rebated interlocking edge with a distinctive scooped upper curvature. Accentuates shadow lines while actively channeling water away from joints.',
    defaultDimensions: [3.0, 2.8, 0.20],
    hasGlass: false,
    features: ['Rebated Overlap Profile', 'Scooped Shadow Channel', 'Enhanced Drainage Lip', 'Horizontal Linear Rhythm']
  },
  {
    id: 'loglap',
    type: 'wall',
    name: 'Loglap Profile',
    category: 'Interlocking',
    claddingCategory: 'Interlocking',
    description: 'Convex curved exterior face giving a solid rounded log-cabin aesthetic with the structural rigidity of interlocking tongue-and-groove boards.',
    defaultDimensions: [3.0, 2.8, 0.20],
    hasGlass: false,
    features: ['Curved Convex Bullnose', 'Rustic Cabin Aesthetic', 'Heavyweight Solid Board', 'Tongue & Groove Base']
  },

  // 3. INLINE & FLUSH-JOINT PROFILES
  {
    id: 'shadow-gap',
    type: 'wall',
    name: 'Shadow Gap Profile',
    category: 'Inline / Flush',
    claddingCategory: 'Inline / Flush',
    description: 'Sharp contemporary architectural profile featuring deliberate 10-15mm recessed square shadow reveals between flat face boards.',
    defaultDimensions: [3.0, 2.8, 0.20],
    hasGlass: false,
    features: ['Recessed Square Reveal', 'Crisp Minimalist Lines', 'Architectural Modernism', 'High-End Facade Finish']
  },
  {
    id: 'rainscreen',
    type: 'wall',
    name: 'Rainscreen (Open-Joint / Slatted)',
    category: 'Inline / Flush',
    claddingCategory: 'Inline / Flush',
    description: 'Rhomboid chamfered battens with open ventilation shadow gaps over a dark breathable weather membrane. Maximizes airflow and rapid drying.',
    defaultDimensions: [3.0, 2.8, 0.20],
    hasGlass: false,
    features: ['Rhomboid Slatted Battens', 'Open Continuous Ventilation', 'Dark Recessed Membrane', 'Contemporary Architectural Appeal']
  },
  {
    id: 'board-on-board',
    type: 'wall',
    name: 'Board on Board (Yorkshire Boarding)',
    category: 'Inline / Flush',
    claddingCategory: 'Inline / Flush',
    description: 'Alternating dual-layer vertical boards with staggered relief. Produces rich three-dimensional textural depth and continuous ventilation.',
    defaultDimensions: [3.0, 2.8, 0.20],
    hasGlass: false,
    features: ['Staggered Dual Layers', 'Vertical Architectural Rhythm', 'Deep 3D Surface Relief', 'Natural Timber Breathing']
  },

  // 4. MASONRY & SHEET FINISHES
  {
    id: 'smooth-render',
    type: 'wall',
    name: 'Monolithic Smooth Stucco / Render',
    category: 'Masonry',
    claddingCategory: 'Masonry',
    description: 'Seamless monolithic smooth rendered exterior finish. Crisp, bright, and contemporary.',
    defaultDimensions: [3.0, 2.8, 0.20],
    hasGlass: false,
    features: ['Monolithic Flat Plane', 'Pure Architectural Volume', 'Smooth Texture', 'Modern Minimalist']
  },
  {
    id: 'brick-running',
    type: 'wall',
    name: 'Facing Brickwork (Running Bond)',
    category: 'Masonry',
    claddingCategory: 'Masonry',
    description: 'Traditional architectural clay facing brickwork in a standard running stretcher bond with recessed mortar joints.',
    defaultDimensions: [3.0, 2.8, 0.20],
    hasGlass: false,
    features: ['Running Stretcher Bond', 'Recessed Mortar Lines', 'Thermal Mass Appearance', 'Classic British Brickwork']
  },
  {
    id: 'ashlar-stone',
    type: 'wall',
    name: 'Ashlar Dressed Stone',
    category: 'Masonry',
    claddingCategory: 'Masonry',
    description: 'Precision cut rectangular natural limestone ashlar masonry blocks with fine hairline joints.',
    defaultDimensions: [3.0, 2.8, 0.20],
    hasGlass: false,
    features: ['Dressed Ashlar Blocks', 'Fine Mortar Joints', 'Luxury Stone Facade', 'Substantial Architectural Mass']
  }
];

